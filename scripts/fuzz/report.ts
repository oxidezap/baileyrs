#!/usr/bin/env node

/**
 * Aggregates the per-target JSON reports a fuzz run writes into FUZZ_REPORT_DIR.
 *
 * The nightly job needs three things a test runner cannot give it. First, one
 * readable summary instead of eight TAP streams. Second, the *stale* entries in
 * the known-divergence registry — an entry that excused nothing across a whole
 * deep run is either fixed or no longer reachable, and either way it should be
 * deleted rather than left to excuse a future regression. That question can only
 * be answered across targets, and `node --test` runs each file in its own
 * process. Third, an issue body worth opening.
 *
 * Usage:
 *   FUZZ_REPORT_DIR=./fuzz-reports npm run fuzz:deep
 *   node scripts/fuzz/report.ts ./fuzz-reports [--markdown] [--fail-on-stale]
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { KNOWN_DIVERGENCES, staleEntries } from '../../src/__fuzz__/harness/divergence.ts'

interface Report {
	target: string
	seed: string
	mode: string
	runs: number
	corpusReplayed: number
	excused: number
	excusedBy?: string[]
	openFindings?: string[]
	truncated?: { ran: number; planned: number }
	findings: { target: string; detail?: string }[]
	crashes?: string[]
}

const argv = process.argv.slice(2)
const directory = resolve(
	argv.find(argument => !argument.startsWith('--')) ?? process.env.FUZZ_REPORT_DIR ?? 'fuzz-reports'
)
const markdown = argv.includes('--markdown')
const failOnStale = argv.includes('--fail-on-stale')

if (!existsSync(directory)) {
	console.error(`fuzz report: no such directory ${directory}`)
	console.error('Run the suite with FUZZ_REPORT_DIR set to collect per-target reports first.')
	process.exit(2)
}

const reports: Report[] = readdirSync(directory)
	.filter(name => name.endsWith('.json'))
	.map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')) as Report)
	.toSorted((left, right) => left.target.localeCompare(right.target))

if (reports.length === 0) {
	console.error(`fuzz report: ${directory} holds no reports`)
	process.exit(2)
}

const totals = reports.reduce(
	(accumulator, report) => ({
		runs: accumulator.runs + report.runs,
		corpus: accumulator.corpus + report.corpusReplayed,
		excused: accumulator.excused + report.excused,
		findings: accumulator.findings + report.findings.length,
		crashes: accumulator.crashes + (report.crashes?.length ?? 0)
	}),
	{ runs: 0, corpus: 0, excused: 0, findings: 0, crashes: 0 }
)

const truncated = reports.filter(report => report.truncated)
const seeds = [...new Set(reports.map(report => report.seed))]
const mode = reports[0]?.mode ?? 'smoke'

/**
 * Registry entries that excused nothing anywhere in this run.
 *
 * Each report names the exact entry ids that fired, which is why this can be
 * stated rather than guessed. It is the one question a per-file test runner
 * cannot answer on its own: `node --test` gives every file its own process, so
 * no single run sees the whole registry being exercised.
 *
 * An entry that excuses nothing is either fixed or no longer reachable. Both are
 * reasons to delete it — an allowlist that outlives its divergence is how the
 * same bug comes back unnoticed.
 */
const used = [...new Set(reports.flatMap(report => report.excusedBy ?? []))]
// A truncated target may simply not have reached the input that would have used
// an entry, so "excused nothing" proves nothing this run. Expired entries are
// still enforced — that check does not depend on coverage.
const complete = truncated.length === 0
const candidates = complete ? staleEntries(used) : []

const today = new Date().toISOString().slice(0, 10)
const expired = KNOWN_DIVERGENCES.filter(entry => entry.review < today)
const open = KNOWN_DIVERGENCES.filter(entry => entry.status === 'open')

const lines: string[] = []
const heading = (text: string) => lines.push(markdown ? `## ${text}` : `\n${text}`)

lines.push(markdown ? '# Fuzz run' : 'fuzz run')
lines.push(
	`mode ${mode} · seed${seeds.length > 1 ? 's' : ''} ${seeds.join(', ')} · ${totals.runs} inputs across ${reports.length} targets`
)
lines.push(
	`${totals.findings} unexcused finding(s) · ${totals.crashes} crash(es) · ${totals.excused} excused · ${totals.corpus} replayed from the corpus`
)

if (truncated.length > 0) {
	heading('Truncated targets')
	lines.push('These did not finish inside their time budget, so their coverage is partial:')
	for (const report of truncated) {
		lines.push(`- ${report.target}: ${report.truncated!.ran} of ${report.truncated!.planned}`)
	}
}

if (totals.findings > 0) {
	heading('Unexcused findings')
	for (const report of reports) {
		if (report.findings.length === 0) continue
		lines.push(`- **${report.target}** — ${report.findings.length}`)
		const details = [...new Set(report.findings.map(finding => finding.detail ?? 'no detail'))]
		for (const detail of details.slice(0, 5)) lines.push(`  - ${detail}`)
	}
	lines.push('')
	lines.push(`Reproduce with \`FUZZ_SEED=${seeds[0]} FUZZ_ONLY="<target>" npm run fuzz\`.`)
}

// A crash is a failure with no divergence attached — a check or generator that
// threw, or an expired allowlist entry under strict mode. Without this section a
// crash-only run printed "0 findings" while the job went red, which reads as a
// broken workflow rather than a real result.
if (totals.crashes > 0) {
	heading('Crashes')
	for (const report of reports) {
		for (const crash of report.crashes ?? []) lines.push(`- **${report.target}** — ${crash.trim()}`)
	}
}

if (open.length > 0) {
	heading('Open findings still on the books')
	for (const entry of open) lines.push(`- \`${entry.id}\` (review by ${entry.review})`)
}

if (expired.length > 0) {
	heading('Known divergences past review')
	for (const entry of expired) lines.push(`- \`${entry.id}\` was due ${entry.review} — re-argue it or delete it`)
}

if (!complete) {
	heading('Registry stale-entry check skipped')
	lines.push('At least one target was truncated, so this run cannot establish which entries are unused.')
} else if (candidates.length > 0) {
	heading('Registry entries that excused nothing')
	lines.push('These excused nothing anywhere in this run — fixed, or no longer reachable. Either way, delete them:')
	for (const entry of candidates) lines.push(`- \`${entry.id}\``)
}

console.log(lines.join('\n'))

const failed =
	totals.findings > 0 || totals.crashes > 0 || (failOnStale && (expired.length > 0 || candidates.length > 0))
process.exit(failed ? 1 : 0)
