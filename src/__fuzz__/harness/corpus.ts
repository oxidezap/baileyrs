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
import { fileURLToPath } from 'node:url'

// `URL.pathname` leaves percent escapes undecoded, so a checkout under a path
// with a space or a non-ASCII character would read and write the corpus
// somewhere else entirely.
export const CORPUS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'corpus')

const BYTES_TAG = '__bytes__'
const BIGINT_TAG = '__bigint__'
const UNDEFINED_TAG = '__undefined__'
const NUMBER_TAG = '__number__'
const BUFFER_TAG = '__buffer__'
const DATE_TAG = '__date__'
const ERROR_TAG = '__error__'

/**
 * JSON cannot hold the values these fuzzers care most about, so tag them.
 *
 * `NaN`, `Infinity` and `-0` all survive `JSON.stringify` as `null` or `0`, and
 * those are exactly the numbers a codec fuzzer plants on purpose — a corpus
 * entry that replayed as `null` would stop reproducing what it was recorded for.
 */
const encode = (value: unknown): unknown => {
	if (value === undefined) return { [UNDEFINED_TAG]: true }
	if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() }
	if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))) {
		return { [NUMBER_TAG]: Object.is(value, -0) ? '-0' : String(value) }
	}
	// Buffer before Uint8Array: `Buffer.isBuffer` is the narrower test, and the
	// crypto helpers call Buffer methods on their arguments, so a recorded failure
	// that replayed as a plain Uint8Array would exercise a different call.
	if (Buffer.isBuffer(value)) return { [BUFFER_TAG]: value.toString('base64') }
	if (value instanceof Uint8Array) return { [BYTES_TAG]: Buffer.from(value).toString('base64') }
	// Date and Error have no enumerable own properties worth speaking of, so the
	// generic object branch below would flatten either one to `{}` — and both are
	// generated deliberately (`getCodeFromWSError` takes an Error; the value
	// generator emits Dates).
	if (value instanceof Date) return { [DATE_TAG]: value.getTime() }
	if (value instanceof Error) {
		return { [ERROR_TAG]: { name: value.name, message: value.message } }
	}
	if (Array.isArray(value)) return value.map(encode)
	if (typeof value === 'object' && value !== null) {
		const out: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(value)) {
			// `__proto__` must stay an own key: the generators plant it deliberately,
			// and plain assignment would move the prototype instead.
			Object.defineProperty(out, key, { value: encode(nested), enumerable: true, writable: true, configurable: true })
		}
		return out
	}
	return value
}

/** A tag object is one that carries the tag *and nothing else*, so an ordinary
 * payload with a colliding key is not mistaken for an encoded value. */
const taggedAs = (record: Record<string, unknown>, tag: string): boolean =>
	Object.hasOwn(record, tag) && Object.keys(record).length === 1

const decode = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(decode)
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>
		if (taggedAs(record, UNDEFINED_TAG)) return undefined
		if (taggedAs(record, BIGINT_TAG)) return BigInt(String(record[BIGINT_TAG]))
		if (taggedAs(record, BYTES_TAG)) return new Uint8Array(Buffer.from(String(record[BYTES_TAG]), 'base64'))
		if (taggedAs(record, BUFFER_TAG)) return Buffer.from(String(record[BUFFER_TAG]), 'base64')
		if (taggedAs(record, DATE_TAG)) return new Date(Number(record[DATE_TAG]))
		if (taggedAs(record, ERROR_TAG)) {
			const shape = record[ERROR_TAG] as { name?: string; message?: string }
			const error = new Error(String(shape?.message ?? ''))
			error.name = String(shape?.name ?? 'Error')
			return error
		}
		if (taggedAs(record, NUMBER_TAG)) {
			const raw = String(record[NUMBER_TAG])
			return raw === '-0' ? -0 : Number(raw)
		}
		const out: Record<string, unknown> = {}
		for (const [key, nested] of Object.entries(record)) {
			Object.defineProperty(out, key, { value: decode(nested), enumerable: true, writable: true, configurable: true })
		}
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
