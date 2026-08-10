/**
 * Decoder robustness under mutation.
 *
 * Everything the socket receives is attacker-influenced: a peer chooses the bytes
 * of every message it sends, and the transport can corrupt the rest. The codec
 * fuzzer next door asks whether two implementations agree on *valid* input; this
 * one asks what happens on input that is not valid, where the answers that matter
 * are not about parity at all.
 *
 * The properties are deliberately not "both decoders reject the same bytes".
 * protobufjs is famously lenient and the Rust decoder is not, so strictness
 * parity would report a difference on most mutations and say nothing useful.
 * What is asserted instead:
 *
 *   safety      a decode either returns or throws a normal Error — never a WASM
 *               abort, never a non-Error throw, never an unbounded stall
 *   agreement   when *both* decoders accept the bytes, they must agree on what
 *               they mean; a peer that gets two different messages out of one
 *               payload is a dessynchronisation waiting to happen
 *   stability   what the bridge accepts, it must re-encode and re-decode to the
 *               same thing — otherwise a malformed payload silently mutates data
 *   leaks       decoding a few thousand malformed payloads must not grow the heap
 *               without bound (skipped unless run with --expose-gc)
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeProto, encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { equivalent, normalise } from './harness/compare.ts'
import { canonicalWire } from './harness/wire.ts'
import { makeRandom, type Random } from './harness/random.ts'
import { fuzz } from './harness/runner.ts'
import { generateProtoObject, HOT_PROTO_PATHS } from './generators/proto.ts'
import { mutate, MUTATORS, type MutatorName } from './generators/mutation.ts'

const upstream = (await import('baileys')) as unknown as { proto: Record<string, unknown> }

interface UpstreamType {
	encode(message: unknown): { finish(): Uint8Array }
	decode(bytes: Uint8Array): unknown
	toObject(message: unknown, options: Record<string, unknown>): Record<string, unknown>
}

const upstreamType = (path: string): UpstreamType | undefined => {
	let cursor: unknown = upstream.proto
	for (const segment of path.split('.')) {
		if (cursor === null || (typeof cursor !== 'object' && typeof cursor !== 'function')) return undefined
		cursor = (cursor as Record<string, unknown>)[segment]
	}
	const candidate = cursor as unknown as UpstreamType | undefined
	return typeof cursor === 'function' && typeof candidate?.encode === 'function' ? candidate : undefined
}

const TO_OBJECT = { longs: String, enums: Number, defaults: false, arrays: false, objects: false, oneofs: false }

type Attempt = { ok: true; value: unknown } | { ok: false; error: unknown }

const attempt = (call: () => unknown): Attempt => {
	try {
		return { ok: true, value: call() }
	} catch (error) {
		return { ok: false, error }
	}
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** The paths robustness cares about: what a peer can actually put on the wire. */
const PATHS = HOT_PROTO_PATHS.filter(path => upstreamType(path) !== undefined)

interface MutationCase {
	readonly path: string
	readonly mutator: MutatorName
	readonly bytes: Uint8Array
}

const validEncoding = (random: Random, path: string): Uint8Array => {
	const message = generateProtoObject(random, path, 3, { fieldProbability: 0.5 })
	const encoded = attempt(() => encodeProto(path, message))
	return encoded.ok ? (encoded.value as Uint8Array) : new Uint8Array(0)
}

const generateCase = (random: Random): MutationCase => {
	const path = PATHS.length > 0 ? random.pick(PATHS) : 'Message'
	const base = validEncoding(random, path)
	const other = validEncoding(random, path)
	const mutator = random.pick(MUTATORS)
	// A couple of rounds of mutation reach states one round cannot: a truncated
	// message whose surviving length prefix is then made to lie, and so on.
	let bytes = mutate(random, base, other, mutator).bytes
	if (random.bool(0.3)) bytes = mutate(random, bytes, other, random.pick(MUTATORS)).bytes
	return { path, mutator, bytes }
}

const isUsable = (value: MutationCase): boolean =>
	typeof value?.path === 'string' && value.path.length > 0 && value.bytes instanceof Uint8Array

describe('protobuf decoder robustness under mutation', () => {
	it('fails cleanly on malformed input', async () => {
		await fuzz<MutationCase>({
			target: 'proto:mutation-safety',
			runs: 400,
			shrinkFailures: false,
			// A decode that takes a second on a payload of a few hundred bytes is a
			// denial-of-service vector even when the answer is eventually correct.
			slowMs: 1_000,
			generate: generateCase,
			check: value => {
				if (!isUsable(value)) return []
				const { path, mutator, bytes } = value

				const result = attempt(() => decodeProto(path, bytes))
				if (result.ok) return []

				// A thrown Error is the contract. A thrown string, a thrown undefined,
				// or a WASM `unreachable` surfacing as something else means the failure
				// path is not one callers can handle.
				if (result.error instanceof Error) return []
				return {
					target: 'proto:mutation-safety',
					input: { path, mutator, bytes: hex(bytes) },
					local: `<threw a non-Error: ${typeof result.error} ${String(result.error).slice(0, 120)}>`,
					upstream: '<an Error>',
					detail: 'a malformed payload produced something a caller cannot catch as an Error'
				}
			}
		})
	})

	it('agrees with upstream whenever both decoders accept the bytes', async () => {
		await fuzz<MutationCase>({
			target: 'proto:mutation-agreement',
			runs: 400,
			shrinkFailures: false,
			generate: generateCase,
			check: value => {
				if (!isUsable(value)) return []
				const { path, mutator, bytes } = value
				const type = upstreamType(path)
				if (!type) return []

				const local = attempt(() => decodeProto(path, bytes))
				const remote = attempt(() => type.toObject(type.decode(bytes), TO_OBJECT))

				// Strictness differences are expected and uninteresting; only what both
				// sides claim to understand is compared.
				if (!local.ok || !remote.ok) return []
				if (equivalent(local.value, remote.value)) return []

				// Well-formed protobuf has exactly one meaning, whether or not the
				// fields make sense for this message type — two decoders reading it
				// differently is a bug. Bytes that do not frame as protobuf at all have
				// no defined meaning, so disagreement there is a strictness difference
				// and is reported separately.
				const wellFormed = canonicalWire(bytes) !== undefined
				return {
					target: wellFormed ? 'proto:mutation-agreement' : 'proto:mutation-interpretation',
					input: { path, mutator, bytes: hex(bytes) },
					local: normalise(local.value),
					upstream: normalise(remote.value),
					detail: wellFormed
						? 'both decoders read the same well-formed payload differently'
						: 'both decoders accepted bytes that are not well-formed protobuf, and read them differently'
				}
			}
		})
	})

	it('re-encodes what it accepts to something it reads the same way', async () => {
		await fuzz<MutationCase>({
			target: 'proto:mutation-stability',
			runs: 400,
			shrinkFailures: false,
			generate: generateCase,
			check: value => {
				if (!isUsable(value)) return []
				const { path, mutator, bytes } = value

				const first = attempt(() => decodeProto(path, bytes))
				if (!first.ok) return []

				const reencoded = attempt(() => encodeProto(path, first.value as Record<string, unknown>))
				if (!reencoded.ok) {
					return {
						target: 'proto:mutation-stability',
						input: { path, mutator, bytes: hex(bytes) },
						local: `<cannot re-encode its own output: ${String((reencoded.error as Error)?.message).slice(0, 120)}>`,
						upstream: '<a re-encodable object>',
						detail: 'the decoder produced an object its own encoder rejects'
					}
				}

				const second = attempt(() => decodeProto(path, reencoded.value as Uint8Array))
				if (!second.ok) {
					return {
						target: 'proto:mutation-stability',
						input: { path, mutator, bytes: hex(bytes) },
						local: `<cannot decode its own output: ${String((second.error as Error)?.message).slice(0, 120)}>`,
						upstream: '<a decodable payload>',
						detail: 'the codec cannot read back what it just wrote'
					}
				}

				if (equivalent(first.value, second.value)) return []
				return {
					target: 'proto:mutation-stability',
					input: { path, mutator, bytes: hex(bytes) },
					local: normalise(second.value),
					upstream: normalise(first.value),
					detail: 'decode → encode → decode did not reach a fixed point'
				}
			}
		})
	})

	it('does not leak memory across thousands of malformed decodes', { skip: typeof global.gc !== 'function' }, () => {
		// Only meaningful with --expose-gc, which `npm run test:e2e` already uses.
		// Without it the measurement is dominated by whatever the collector has not
		// got around to, so the test skips rather than reporting noise.
		const collect = global.gc as () => void
		const random = makeRandom('leak-probe')
		const warmup = 200
		const measured = 4_000

		const run = (count: number) => {
			for (let index = 0; index < count; index++) {
				const value = generateCase(random)
				try {
					decodeProto(value.path, value.bytes)
				} catch {
					// Rejection is the expected outcome; this measures allocation, not parity.
				}
			}
		}

		run(warmup)
		collect()
		const before = process.memoryUsage().heapUsed
		run(measured)
		collect()
		const after = process.memoryUsage().heapUsed

		const growthMb = (after - before) / (1024 * 1024)
		assert.ok(
			growthMb < 32,
			`heap grew ${growthMb.toFixed(1)}MB across ${measured} malformed decodes — a handle or buffer is being retained`
		)
	})
})
