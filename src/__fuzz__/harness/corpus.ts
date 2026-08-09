/**
 * Corpus persistence.
 *
 * A fuzzer that only ever generates fresh input re-earns every find by luck. The
 * corpus is the memory: each minimised failing input is written to
 * `src/__fuzz__/corpus/<target>.json` and replayed *before* random generation on
 * every later run, so a fixed bug stays fixed even when the seed moves on.
 *
 * Corpus files are meant to be committed. They are small, they are the evidence
 * behind a fix, and they cost a few milliseconds to replay.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CORPUS_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', 'corpus')

const BYTES_TAG = '__bytes__'
const BIGINT_TAG = '__bigint__'
const UNDEFINED_TAG = '__undefined__'

/** JSON cannot hold the values these fuzzers care most about, so tag them. */
const encode = (value: unknown): unknown => {
	if (value === undefined) return { [UNDEFINED_TAG]: true }
	if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() }
	if (value instanceof Uint8Array) return { [BYTES_TAG]: Buffer.from(value).toString('base64') }
	if (Array.isArray(value)) return value.map(encode)
	if (typeof value === 'object' && value !== null) {
		const out: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(value)) out[key] = encode(nested)
		return out
	}
	return value
}

const decode = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(decode)
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>
		if (UNDEFINED_TAG in record) return undefined
		if (BIGINT_TAG in record) return BigInt(String(record[BIGINT_TAG]))
		if (BYTES_TAG in record) return new Uint8Array(Buffer.from(String(record[BYTES_TAG]), 'base64'))
		const out: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(record)) out[key] = decode(nested)
		return out
	}
	return value
}

/** `proto:Message.roundTrip` → `proto-message-roundtrip`, safe as a filename. */
export const corpusSlug = (target: string): string =>
	target
		.replaceAll(/[^\dA-Za-z]+/gu, '-')
		.replaceAll(/^-|-$/gu, '')
		.toLowerCase() || 'unnamed'

export interface CorpusEntry {
	/** Free-form note describing what this input caught, written when it was recorded. */
	readonly note: string
	readonly input: unknown
}

const fileFor = (target: string): string => join(CORPUS_ROOT, `${corpusSlug(target)}.json`)

export const loadCorpus = (target: string): CorpusEntry[] => {
	const path = fileFor(target)
	if (!existsSync(path)) return []
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as { note?: unknown; input?: unknown }[]
		if (!Array.isArray(parsed)) return []
		return parsed.map(entry => ({ note: String(entry.note ?? ''), input: decode(entry.input) }))
	} catch (error) {
		// A corrupt corpus must not take the suite down with it: the fuzzer still
		// works without its memory, it just forgets.
		console.warn(`fuzz: ignoring unreadable corpus ${path}: ${(error as Error).message}`)
		return []
	}
}

/** Appends an entry, de-duplicating on the encoded input. */
export const recordCorpus = (target: string, entry: CorpusEntry): void => {
	mkdirSync(CORPUS_ROOT, { recursive: true })
	const existing = loadCorpus(target)
	const encoded = JSON.stringify(encode(entry.input))
	if (existing.some(candidate => JSON.stringify(encode(candidate.input)) === encoded)) return
	const next = [...existing, entry].map(candidate => ({ note: candidate.note, input: encode(candidate.input) }))
	writeFileSync(fileFor(target), `${JSON.stringify(next, undefined, '\t')}\n`)
}

/** Every target that has a stored corpus, for reporting. */
export const corpusTargets = (): string[] =>
	existsSync(CORPUS_ROOT)
		? readdirSync(CORPUS_ROOT)
				.filter(name => name.endsWith('.json'))
				.map(name => name.slice(0, -'.json'.length))
		: []
