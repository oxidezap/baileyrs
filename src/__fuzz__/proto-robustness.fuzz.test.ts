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
import { schemaAt } from './harness/schema-context.ts'
import { makeRandom, type Random } from './harness/random.ts'
import { fuzz } from './harness/runner.ts'
import { generateProtoObject, textFieldPredicate, HOT_PROTO_PATHS } from './generators/proto.ts'
import { mutate, MUTATORS, type MessageCycle } from './generators/mutation.ts'

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

/**
 * The tag bytes of a message cycle, per schema path.
 *
 * `Message` reaches itself through `ephemeralMessage` (field 40, a
 * `FutureProofMessage`) and that type's `message` (field 1). Wrapping along those
 * two tags gives the nesting bomb a real recursive *message* descent instead of
 * one message holding a deeply nested length-delimited value — the latter tests
 * the length and bounds path, which is worth doing, but a decoder with unbounded
 * recursion passes it at any depth.
 *
 * Only `Message` has a cheap two-hop cycle worth hard-coding; everything else
 * falls back to the flat wrap, and the mutator says so.
 */
const MESSAGE_CYCLE: MessageCycle = [[0xc2, 0x02], [0x0a]]

const cycleFor = (path: string): MessageCycle | undefined => (path === 'Message' ? MESSAGE_CYCLE : undefined)

/**
 * The paths robustness cares about: what a peer can actually put on the wire.
 *
 * Every hot path, not the subset upstream still resolves. Two of the three
 * targets here — that a malformed payload is rejected rather than trapping the
 * module, and that decode → encode → decode is stable — are claims about the
 * bridge alone and need no upstream codec at all. Filtering the *generator* on
 * upstream meant a path dropping out of protobufjs, through schema or API drift,
 * silently removed it from those two as well, and a trap or an unstable round
 * trip reachable only there would have kept reporting clean.
 *
 * Only the agreement target needs both sides, and it already skips a path it
 * cannot resolve — at the point where that actually matters.
 */
const PATHS = HOT_PROTO_PATHS

interface MutationCase {
	readonly path: string
	/** The mutator chain applied, in order. */
	readonly mutator: string
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
	const first = random.pick(MUTATORS)
	// A couple of rounds of mutation reach states one round cannot: a truncated
	// message whose surviving length prefix is then made to lie, and so on.
	let bytes = mutate(random, base, other, first, cycleFor(path)).bytes
	const applied: string[] = [first]
	if (random.bool(0.3)) {
		const second = random.pick(MUTATORS)
		bytes = mutate(random, bytes, other, second, cycleFor(path)).bytes
		applied.push(second)
	}
	// The whole chain is recorded, not just the first: the later mutation usually
	// dominates the resulting bytes, and triage keys on what produced them.
	return { path, mutator: applied.join(' → '), bytes }
}

const isUsable = (value: MutationCase): boolean =>
	typeof value?.path === 'string' && value.path.length > 0 && value.bytes instanceof Uint8Array

/**
 * The first WASM trap seen in this process, if any.
 *
 * A trap leaves the module unusable for the rest of the process: every later
 * decode throws for the same reason. Two things follow, and both matter.
 *
 * Reporting each one would turn a single defect into hundreds of findings and
 * bury it in its own duplicates — so only the first is reported.
 *
 * And every target that decodes through the bridge has to know. The other three
 * treat a failed decode as an ordinary rejection (`if (!ok) return []`), which is
 * right for a validation error and badly wrong for a trap: they would report
 * clean having checked nothing, which is the exact failure this file exists to
 * rule out. So the flag is set by whichever target hits it first, and they all
 * consult it.
 */
type WasmTrap = WebAssembly.RuntimeError | WebAssembly.CompileError

/** Both trap types, matching what `compareOutcomes` already treats as a trap. */
const isTrap = (error: unknown): error is WasmTrap =>
	error instanceof WebAssembly.RuntimeError || error instanceof WebAssembly.CompileError

let firstTrap: WasmTrap | undefined

/**
 * Every bridge decode in this file goes through here.
 *
 * The trap bookkeeping has to be in one place: a decode site that skipped it
 * would silently swallow the one failure mode the file is about.
 */
const decodeThroughBridge = (path: string, bytes: Uint8Array): Attempt => {
	const result = attempt(() => decodeProto(path, bytes))
	if (!result.ok && isTrap(result.error)) {
		firstTrap ??= result.error
	}
	return result
}

/** Reports the trap once, from whichever target reached it first. */
const trapFinding = (path: string, mutator: string, bytes: Uint8Array, failure: WasmTrap) => ({
	target: 'proto:mutation-safety',
	input: { path, mutator, bytes: hex(bytes) },
	local: `<WASM trap: ${failure.message.slice(0, 160)}>`,
	upstream: '<a validation Error>',
	detail: 'a malformed payload trapped the WASM module instead of being rejected'
})

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

				// Once the module has trapped, every later decode throws for that same
				// reason. Reporting each would bury the finding in its own duplicates.
				if (firstTrap) return []

				const result = decodeThroughBridge(path, bytes)
				if (result.ok) return []

				// A WebAssembly trap — `unreachable`, an out-of-bounds access — is an
				// `Error` subclass, so an `instanceof Error` check alone would accept
				// exactly the aborts this target says must never happen.
				//
				// The test is the instance, never the message text. Matching on words
				// like "out of bounds" would turn any validation error that happens to
				// phrase itself that way into a trap report, and there is no allowlist
				// entry for this target — a false positive here is a hard suite failure.
				const failure = result.error
				if (isTrap(failure)) {
					return trapFinding(path, mutator, bytes, failure)
				}

				// Otherwise a thrown Error is the contract. A thrown string or a thrown
				// undefined means the failure path is not one callers can handle.
				if (failure instanceof Error) return []
				return {
					target: 'proto:mutation-safety',
					input: { path, mutator, bytes: hex(bytes) },
					local: `<threw a non-Error: ${typeof failure} ${String(failure).slice(0, 120)}>`,
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

				if (firstTrap) return []
				const local = decodeThroughBridge(path, bytes)
				if (!local.ok && isTrap(local.error)) {
					return trapFinding(path, mutator, bytes, local.error)
				}
				const remote = attempt(() => type.toObject(type.decode(bytes), TO_OBJECT))

				// Strictness differences are expected and uninteresting; only what both
				// sides claim to understand is compared. A trap is not a rejection, so it
				// is caught above rather than falling into this branch and reading as a
				// clean run that checked nothing.
				if (!local.ok || !remote.ok) return []
				// Schema-aware, as the codec differential is. `normalise` folds every
				// decimal string into a bigint so a Rust u64 can be compared against a
				// protobufjs Long, which also folds a *declared string* holding `'0'`
				// together with the number `0` — and the generator emits `'0'` on purpose.
				// Mutated input is exactly where a parser turns one into the other, and
				// the valid-message differential never sees these payloads.
				if (equivalent(local.value, remote.value, { isTextField: textFieldPredicate(path) })) return []

				// Well-formed protobuf has exactly one meaning, whether or not the
				// fields make sense for this message type — two decoders reading it
				// differently is a bug. Bytes that do not frame as protobuf at all have
				// no defined meaning, so disagreement there is a strictness difference
				// and is reported separately.
				//
				// With the schema, not without. Unschooled, the scan cannot tell a
				// nested message from a `bytes` field, so it frames only the top level
				// and calls a payload well-formed whose *submessage* is corrupt — which
				// is where a `lying-length` or a `flip-bit` usually lands. Measured on
				// the four findings this fixed: three framed at the top and not inside,
				// and belong to the interpretation class the entry beside this one
				// already calls undefined behaviour. `wire.ts` states the rule — every
				// caller that has a schema passes it — and this one has `path`.
				const wellFormed = canonicalWire(bytes, schemaAt(path)) !== undefined
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

				if (firstTrap) return []
				const first = decodeThroughBridge(path, bytes)
				if (!first.ok && isTrap(first.error)) {
					return trapFinding(path, mutator, bytes, first.error)
				}
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

				const second = decodeThroughBridge(path, reencoded.value as Uint8Array)
				// The same check the first decode gets. A trap is not "cannot read back
				// what it just wrote" — it leaves the module unusable for every later
				// decode in the process, and reporting it as an ordinary stability
				// finding buries the one failure mode this file exists to catch under a
				// description that does not name it.
				if (!second.ok && isTrap(second.error)) {
					return trapFinding(path, mutator, bytes, second.error)
				}
				if (!second.ok) {
					return {
						target: 'proto:mutation-stability',
						input: { path, mutator, bytes: hex(bytes) },
						local: `<cannot decode its own output: ${String((second.error as Error)?.message).slice(0, 120)}>`,
						upstream: '<a decodable payload>',
						detail: 'the codec cannot read back what it just wrote'
					}
				}

				// Same predicate as the agreement check above: re-encoding and re-reading
				// is where a decoder's own type confusion would show, so folding the two
				// types together here would hide it in the one place it is visible.
				if (equivalent(first.value, second.value, { isTextField: textFieldPredicate(path) })) return []
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

		// Cases are generated up front so the measured window contains decoding and
		// nothing else — otherwise the generator's own allocation is what the delta
		// would be measuring.
		const warmupCases = Array.from({ length: 200 }, () => generateCase(random))
		const measuredCases = Array.from({ length: 4_000 }, () => generateCase(random))

		const run = (cases: readonly MutationCase[]) => {
			for (const value of cases) {
				// Rejection is the expected outcome; this measures allocation, not
				// parity. It still goes through the shared helper so a trap here is
				// recorded rather than swallowed as one more rejection.
				decodeThroughBridge(value.path, value.bytes)
			}
		}

		/**
		 * `heapUsed` alone is the wrong instrument here.
		 *
		 * A leaked WASM linear-memory allocation or a retained bridge buffer lives
		 * outside the V8 managed heap, so `heapUsed` can stay flat while the memory
		 * this probe exists to catch grows without bound. `external` is where a
		 * WebAssembly.Memory backing store shows up, so the budget covers it too.
		 *
		 * `arrayBuffers` is deliberately not added: Node reports it as a *subset* of
		 * `external`, not alongside it. Measured directly — allocating one 64MB
		 * Buffer moves both by 64MB — so summing the two would score 20MB of real
		 * growth as 40MB and fail the 32MB budget on a run that never leaked.
		 */
		const footprint = () => {
			const usage = process.memoryUsage()
			return usage.heapUsed + usage.external
		}

		run(warmupCases)
		collect()
		// The helper records a trap but nothing here consulted it, so a trap reached
		// only by this fixed corpus would let all 4,200 calls complete and the test
		// pass on memory growth alone — with the module already unusable, which also
		// makes the measurement meaningless.
		const assertNoTrap = (stage: string) => {
			const trap = firstTrap
			assert.ok(trap === undefined, `a ${stage} payload trapped the WASM module: ${trap?.message ?? ''}`)
		}
		assertNoTrap('warmup')

		/**
		 * Measured as a slope across batches, not as one before/after delta.
		 *
		 * WASM linear memory only ever grows: the first payload bigger than anything
		 * in the warmup raises the high-water mark once and it never comes back down.
		 * Against a single total that one-time step is indistinguishable from a leak,
		 * and it lands in `external`, which is noisy to begin with.
		 *
		 * A leak keeps allocating, so it shows up as growth in the *last* batches as
		 * much as the first. A high-water step shows up once and then flattens. The
		 * budget is therefore applied to the second half only, with the first half
		 * left to absorb the one-time growth.
		 */
		const batches = 8
		const size = Math.ceil(measuredCases.length / batches)
		const marks: number[] = []
		for (let index = 0; index < measuredCases.length; index += size) {
			run(measuredCases.slice(index, index + size))
			collect()
			marks.push(footprint())
		}

		// The baseline is the mark that *ends* the first half, so the window measured
		// is exactly the second half. Taking `marks[length / 2]` instead would start
		// one batch late and measure a window smaller than the message claimed.
		assertNoTrap('measured')

		const baseline = Math.ceil(marks.length / 2) - 1
		const measuredInWindow = (marks.length - 1 - baseline) * size
		const tailGrowthMb = (marks.at(-1)! - marks[baseline]!) / (1024 * 1024)
		assert.ok(
			tailGrowthMb < 32,
			`heap + external memory grew ${tailGrowthMb.toFixed(1)}MB across the last ${measuredInWindow} of ${measuredCases.length} malformed decodes — a handle or buffer is being retained. Marks (MB): ${marks.map(mark => (mark / (1024 * 1024)).toFixed(1)).join(', ')}`
		)
	})
})
