/**
 * The property runner every fuzzer in this directory goes through.
 *
 * It owns the parts that decide whether a fuzz suite is useful or ignored:
 * a fixed seed by default (so `npm test` never fails by luck), a bounded budget
 * (so it stays a test and not a job), shrinking before reporting, the corpus
 * replayed ahead of fresh input, and the known-divergence allowlist applied
 * before anything is called a failure.
 *
 * Environment:
 *   FUZZ_SEED                seed string (default `baileyrs-fuzz-v1`)
 *   FUZZ_RUNS                iterations per target, overrides every default
 *   FUZZ_MODE                `smoke` (default) or `deep`
 *   FUZZ_DEEP_FACTOR         multiplier applied to budgets in deep mode (default 25)
 *   FUZZ_TIME_BUDGET_MS      per-target wall-clock ceiling
 *   FUZZ_ONLY                substring filter over target names, for triage
 *   FUZZ_RECORD              `1` to append minimised failures to the corpus
 *   FUZZ_STRICT_ALLOWLIST    `1` to fail on expired allowlist entries
 *   FUZZ_REPORT_DIR          directory to write per-target JSON reports into
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyAllowlist, KNOWN_DIVERGENCES, type Divergence } from './divergence.ts'
import { loadCorpus, recordCorpus, corpusSlug } from './corpus.ts'
import { makeRandom, type Random } from './random.ts'
import { shrink } from './shrink.ts'

const environment = (name: string): string | undefined => {
	const value = process.env[name]
	return value === undefined || value === '' ? undefined : value
}

export const FUZZ_SEED = environment('FUZZ_SEED') ?? 'baileyrs-fuzz-v1'
export const FUZZ_MODE = environment('FUZZ_MODE') === 'deep' ? 'deep' : 'smoke'

const deepFactor = Number(environment('FUZZ_DEEP_FACTOR') ?? 25)
const runsOverride = environment('FUZZ_RUNS') === undefined ? undefined : Number(environment('FUZZ_RUNS'))
const timeBudgetOverride =
	environment('FUZZ_TIME_BUDGET_MS') === undefined ? undefined : Number(environment('FUZZ_TIME_BUDGET_MS'))
const onlyFilter = environment('FUZZ_ONLY')
const recording = environment('FUZZ_RECORD') === '1'
const strictAllowlist = environment('FUZZ_STRICT_ALLOWLIST') === '1'
const reportDirectory = environment('FUZZ_REPORT_DIR')

/** Wall-clock ceiling per target: keeps `npm test` predictable on a busy runner. */
const defaultTimeBudgetMs = FUZZ_MODE === 'deep' ? 180_000 : 6_000

export interface FuzzOptions<T> {
	/** Stable identity, e.g. `jid:jidDecode`. Also names the corpus file. */
	readonly target: string
	/** Builds one input. Must consume `random` only — never `Math.random`. */
	readonly generate: (random: Random) => T
	/**
	 * Inspects one input. Return the differences found (empty when the input is
	 * fine); throwing is also a finding, reported as a crash.
	 */
	readonly check: (input: T) => readonly Divergence[] | Divergence | void | Promise<readonly Divergence[] | Divergence | void>
	/** Iterations in smoke mode; deep mode multiplies this. Default 150. */
	readonly runs?: number
	/** Set false when the input is already minimal (raw byte strings, mostly). */
	readonly shrinkFailures?: boolean
	/**
	 * Set false when the input is an argument list whose length is part of the
	 * call being tested — shrinking would otherwise report "called with fewer
	 * arguments", which is a different question.
	 */
	readonly shrinkRoot?: boolean
	/**
	 * Reports an input that takes longer than this to check. Catches the
	 * algorithmic blow-ups (deep nesting, quadratic parsing) that never surface
	 * as a wrong answer, only as a stalled socket.
	 */
	readonly slowMs?: number
}

export interface FuzzReport {
	readonly target: string
	readonly seed: string
	readonly mode: string
	readonly runs: number
	readonly corpusReplayed: number
	readonly excused: number
	readonly findings: readonly Divergence[]
}

/**
 * Renders a generated value for a failure report without ever throwing.
 *
 * Generated input deliberately contains values that break naive formatting —
 * `__proto__` keys that swap an object's prototype, revoked proxies, getters
 * that throw. A reporter that dies on the input hides the very finding it was
 * called to describe, so every step here has a fallback.
 */
const preview = (value: unknown, limit = 900): string => {
	const seen = new WeakSet<object>()
	let text: string | undefined
	try {
		text = JSON.stringify(
			value,
			(_key, nested: unknown) => {
				if (typeof nested === 'bigint') return `${nested.toString()}n`
				if (nested instanceof Uint8Array) return `<bytes ${nested.length}: ${Buffer.from(nested.slice(0, 32)).toString('hex')}>`
				if (typeof nested === 'object' && nested !== null) {
					if (seen.has(nested)) return '<circular>'
					seen.add(nested)
				}
				if (typeof nested === 'function') return `<function ${nested.name || 'anonymous'}>`
				if (typeof nested === 'symbol') return nested.toString()
				return nested
			},
			1
		)
	} catch {
		text = undefined
	}
	if (typeof text !== 'string') {
		try {
			text = String(value)
		} catch {
			text = `<unprintable ${typeof value}>`
		}
	}
	return text.length > limit ? `${text.slice(0, limit)}… (${text.length} chars)` : text
}

const replayHint = (target: string): string =>
	`FUZZ_SEED=${FUZZ_SEED} FUZZ_ONLY=${JSON.stringify(target)} FUZZ_RUNS=${runsOverride ?? 'as-configured'} npm test`

const describeFinding = (finding: Divergence, index: number): string =>
	[
		`  [${index + 1}] ${finding.target}${finding.detail ? ` — ${finding.detail}` : ''}`,
		`      input     ${preview(finding.input)}`,
		`      baileyrs  ${preview(finding.local)}`,
		`      baileys   ${preview(finding.upstream)}`
	].join('\n')

const asList = (result: readonly Divergence[] | Divergence | void): readonly Divergence[] => {
	if (!result) return []
	return Array.isArray(result) ? result : [result as Divergence]
}

const writeReport = (report: FuzzReport): void => {
	if (!reportDirectory) return
	mkdirSync(reportDirectory, { recursive: true })
	writeFileSync(
		join(reportDirectory, `${corpusSlug(report.target)}.json`),
		`${JSON.stringify(report, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value), '\t')}\n`
	)
}

/**
 * Runs one property to exhaustion of its budget and throws a single readable
 * error describing every unexcused difference it found.
 */
export const fuzz = async <T>(options: FuzzOptions<T>): Promise<FuzzReport> => {
	const { target, generate, check } = options

	const baseRuns = options.runs ?? 150
	const runs = runsOverride ?? (FUZZ_MODE === 'deep' ? Math.ceil(baseRuns * deepFactor) : baseRuns)
	const timeBudgetMs = timeBudgetOverride ?? defaultTimeBudgetMs
	const shrinkFailures = options.shrinkFailures ?? true

	const skipped = onlyFilter !== undefined && !target.includes(onlyFilter)
	const corpus = skipped ? [] : loadCorpus(target)

	const findings: Divergence[] = []
	const crashes: string[] = []
	let excused = 0
	let executed = 0

	const runOne = async (input: T, origin: string): Promise<readonly Divergence[]> => {
		const startedAt = performance.now()
		let produced: readonly Divergence[]
		try {
			produced = asList(await check(input))
		} catch (error) {
			const failure = error as Error
			crashes.push(
				`  [crash] ${target} (${origin})\n      input   ${preview(input)}\n      threw   ${failure?.name ?? 'Error'}: ${failure?.message ?? String(error)}`
			)
			return []
		}
		const elapsed = performance.now() - startedAt
		if (options.slowMs !== undefined && elapsed > options.slowMs) {
			return [
				...produced,
				{
					target: `${target}#slow`,
					input,
					local: `${elapsed.toFixed(0)}ms`,
					upstream: `<= ${options.slowMs}ms`,
					detail: 'single input exceeded the per-check time ceiling'
				}
			]
		}
		return produced
	}

	// The corpus first: past finds are cheap and must never silently come back.
	for (const entry of corpus) {
		const produced = await runOne(entry.input as T, `corpus: ${entry.note}`)
		executed++
		findings.push(...produced)
	}

	if (!skipped) {
		const deadline = performance.now() + timeBudgetMs
		const random = makeRandom(`${FUZZ_SEED}:${target}`)
		for (let index = 0; index < runs; index++) {
			if (performance.now() > deadline) break
			let input: T
			try {
				input = generate(random)
			} catch (error) {
				crashes.push(`  [crash] ${target} generator threw: ${(error as Error).message}`)
				break
			}
			const produced = await runOne(input, `run ${index}`)
			executed++
			if (produced.length === 0) continue

			// Minimise against "this input still produces a finding on this target",
			// not against "produces the identical finding": generated inputs often
			// carry several at once and the smallest reproducer is what matters.
			const minimised = shrinkFailures
				? await shrink(input, async candidate => (await runOne(candidate, 'shrink')).length > 0, {
						maxEvaluations: FUZZ_MODE === 'deep' ? 1_200 : 300,
						shrinkRoot: options.shrinkRoot ?? true
					})
				: input

			const minimisedFindings = await runOne(minimised, 'minimised')
			findings.push(...(minimisedFindings.length > 0 ? minimisedFindings : produced))

			if (recording) {
				recordCorpus(target, { note: `seed ${FUZZ_SEED}, run ${index}`, input: minimised })
			}
		}
	}

	const outcome = applyAllowlist(findings, new Date())
	excused = findings.length - outcome.unexcused.length

	const report: FuzzReport = {
		target,
		seed: FUZZ_SEED,
		mode: FUZZ_MODE,
		runs: executed,
		corpusReplayed: corpus.length,
		excused,
		findings: outcome.unexcused
	}
	writeReport(report)

	// Open findings are printed on every single run. They are recorded so the
	// suite stays green and does not re-report them as news, never so they can be
	// forgotten — an allowlist you cannot see is indistinguishable from a bug.
	for (const id of outcome.openHits) {
		const entry = KNOWN_DIVERGENCES.find(candidate => candidate.id === id)
		console.warn(`fuzz: open finding "${id}" still reproduces on ${target} (review by ${entry?.review ?? 'unknown'})`)
	}

	for (const entry of outcome.expired) {
		const message = `fuzz: known-divergence "${entry.id}" was due for review on ${entry.review} — re-argue it or delete it`
		if (strictAllowlist) crashes.push(`  [allowlist] ${message}`)
		else console.warn(message)
	}

	if (outcome.unexcused.length > 0 || crashes.length > 0) {
		const lines = [
			`fuzz found ${outcome.unexcused.length} divergence(s) and ${crashes.length} crash(es) on ${target}`,
			`  seed      ${FUZZ_SEED} (mode ${FUZZ_MODE}, ${executed} inputs, ${corpus.length} from corpus)`,
			`  replay    ${replayHint(target)}`,
			`  record    add FUZZ_RECORD=1 to freeze the minimised input into the corpus`,
			...outcome.unexcused.map((finding, index) => describeFinding(finding, index)),
			...crashes
		]
		throw new Error(lines.join('\n'))
	}

	return report
}
