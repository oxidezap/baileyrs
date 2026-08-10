/**
 * Send-path wire fidelity, on generated messages.
 *
 * `scripts/compatibility/wire-fidelity-core.ts` already asks this question — does
 * a field planted on a message survive `relayMessage` and reach the bridge — but
 * it asks it about a list of cases somebody wrote down, one field at a time. That
 * misses the failure it was built to catch most: a send path that preserves every
 * field in isolation and loses one when a particular neighbour is present.
 *
 * Here the messages come from the schema, arbitrarily shaped and arbitrarily
 * deep, and the oracle is the whole message rather than a list of paths:
 *
 *   fidelity     everything in a plain encode of the input is still in the bytes
 *                the bridge received — additions are fine, losses are not
 *   readability  upstream protobufjs can read those bytes and finds the same
 *                fields, so a message baileyrs sends is one Baileys could parse
 *   builder      generateWAMessageFromContent keeps the content it was given
 *
 * "Additions are fine" is deliberate: the send path legitimately attaches device
 * metadata and ephemeral wrappers, and a fuzzer that called those a divergence
 * would be unusable.
 */

import { describe, it } from 'node:test'
import { decodeProto, encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { equivalent, normalise, omitsKeysOnly } from './harness/compare.ts'
import type { Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import { relayedBytes } from './harness/send-path.ts'
import { generateProtoObject } from './generators/proto.ts'
import { generateJid } from './generators/jid.ts'
import type { Random } from './harness/random.ts'

const upstream = (await import('baileys')) as unknown as {
	proto: {
		Message: {
			decode(bytes: Uint8Array): unknown
			toObject(message: unknown, options: Record<string, unknown>): Record<string, unknown>
		}
	}
	generateWAMessageFromContent: (jid: string, content: unknown, options: Record<string, unknown>) => unknown
}

const local = (await import('../index.ts')) as unknown as {
	generateWAMessageFromContent: (jid: string, content: unknown, options: Record<string, unknown>) => unknown
}

const TO_OBJECT = { longs: String, enums: Number, defaults: false, arrays: false, objects: false, oneofs: false }

/** Everything in `reference` is present and equal in `actual`; extras are allowed. */
const preserves = (actual: unknown, reference: unknown): boolean =>
	equivalent(actual, reference) || omitsKeysOnly(reference, actual)

interface WireCase {
	readonly jid: string
	readonly message: Record<string, unknown>
}

const isUsable = (value: WireCase): boolean =>
	typeof value?.jid === 'string' && typeof value.message === 'object' && value.message !== null

const generateCase = (random: Random): WireCase => ({
	// Group, DM, newsletter and broadcast take different branches through the send
	// path, and a field lost on only one of them is exactly what a single-jid test
	// would never see.
	jid: random.weighted<string>([
		[4, '120363000000000000@g.us'],
		[3, '15551234567@s.whatsapp.net'],
		[2, '120363000000000000@newsletter'],
		[1, 'status@broadcast'],
		[1, generateJid(random)]
	]),
	message: generateProtoObject(random, 'Message', 3, { fieldProbability: 0.35 })
})

describe('send-path wire fidelity on generated messages', () => {
	it('hands the bridge everything the message carried', async () => {
		await fuzz<WireCase>({
			target: 'wire:fidelity',
			runs: 250,
			generate: generateCase,
			check: async value => {
				if (!isUsable(value)) return []
				const { jid, message } = value

				// A plain encode/decode of the same input, through the same codec — so
				// anything that differs is the send path's doing and not the codec's.
				let reference: unknown
				try {
					// The reference encode gets its own copy: `relayMessage` may mutate the
					// message it is handed, and a reference built from a mutated object
					// would compare the send path against its own output.
					reference = decodeProto('Message', encodeProto('Message', structuredClone(message)))
				} catch {
					// The codec cannot carry this message at all; that is the codec
					// fuzzer's subject, not this one's.
					return []
				}

				let sentBytes: Uint8Array
				try {
					sentBytes = await relayedBytes(message, { jid })
				} catch (error) {
					return {
						target: 'wire:fidelity',
						input: { jid, message },
						local: `<relayMessage threw: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<bytes handed to the bridge>',
						detail: 'the send path produced no bytes for a message the codec accepts'
					}
				}

				let sent: unknown
				try {
					sent = decodeProto('Message', sentBytes)
				} catch (error) {
					return {
						target: 'wire:fidelity',
						input: { jid, message },
						local: `<the bridge cannot decode what it sent: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: normalise(reference),
						detail: 'baileyrs cannot read back the bytes it handed the bridge'
					}
				}
				if (preserves(sent, reference)) return []

				return {
					target: 'wire:fidelity',
					input: { jid, message },
					local: normalise(sent),
					upstream: normalise(reference),
					detail: 'the send path dropped or altered part of the message'
				}
			}
		})
	})

	it('sends bytes upstream Baileys can read', async () => {
		await fuzz<WireCase>({
			target: 'wire:upstream-readable',
			runs: 250,
			generate: generateCase,
			check: async value => {
				if (!isUsable(value)) return []
				const { jid, message } = value

				let sentBytes: Uint8Array
				try {
					sentBytes = await relayedBytes(message, { jid })
				} catch {
					// Covered by wire:fidelity; reporting it twice helps nobody.
					return []
				}

				const findings: Divergence[] = []
				let upstreamView: Record<string, unknown>
				try {
					upstreamView = upstream.proto.Message.toObject(upstream.proto.Message.decode(sentBytes), TO_OBJECT)
				} catch (error) {
					return {
						target: 'wire:upstream-readable',
						input: { jid, message },
						local: Buffer.from(sentBytes).toString('hex').slice(0, 200),
						upstream: `<protobufjs cannot decode it: ${String((error as Error)?.message).slice(0, 120)}>`,
						detail: 'baileyrs sent bytes upstream Baileys cannot parse'
					}
				}

				// Field *numbers* are the contract between the two: a field placed at a
				// different number still decodes, just into something else. Comparing
				// what upstream sees against what the bridge sees catches that.
				let bridgeView: unknown
				try {
					bridgeView = decodeProto('Message', sentBytes)
				} catch (error) {
					// The bridge refusing to read back bytes upstream just parsed is a
					// finding, not a crash in the fuzzer — most often the 2^53 decode
					// ceiling, which the known-divergence registry already tracks.
					return {
						target: 'wire:upstream-readable',
						input: { jid, message },
						local: `<the bridge cannot decode what it sent: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: normalise(upstreamView),
						detail: 'baileyrs cannot read back the bytes it handed the bridge'
					}
				}
				// Both views decode the *same* bytes, so neither side can legitimately
				// hold a field the other lacks — which makes exact equality the right
				// test in both directions.
				//
				// The bridge-side superset was the one previously let through, and it is
				// the case this target is named for: a field the bridge writes at a
				// number upstream does not declare is discarded by upstream as unknown
				// and read straight back by the bridge, so a subset check in that
				// direction reports nothing. The reverse is data the library sent and
				// cannot read back, which the fidelity check above cannot catch either
				// — its reference goes through the same bridge encode/decode pair and
				// lacks the field too.
				if (!equivalent(bridgeView, upstreamView)) {
					findings.push({
						target: 'wire:upstream-readable',
						input: { jid, message },
						local: normalise(bridgeView),
						upstream: normalise(upstreamView),
						detail: preserves(bridgeView, upstreamView)
							? 'the bridge read fields from the sent bytes that upstream discards as unknown'
							: 'upstream read fields from the sent bytes that the bridge does not return'
					})
				}
				return findings
			}
		})
	})

	it('builds the same message from content as upstream does', async () => {
		await fuzz<WireCase>({
			target: 'wire:message-builder',
			runs: 250,
			generate: generateCase,
			check: value => {
				if (!isUsable(value)) return []
				const { jid, message } = value

				// A fixed timestamp and message id: everything else about this call is
				// deterministic, and without them the two sides differ on the clock.
				const options = {
					userJid: '15550000000@s.whatsapp.net',
					messageId: '3EB0FUZZ0000000000',
					timestamp: new Date(1_700_000_000_000)
				}

				// Upstream first: if it rejects the generated shape, there is nothing to
				// compare against and the input says nothing about baileyrs.
				let upstreamBuilt: unknown
				try {
					upstreamBuilt = upstream.generateWAMessageFromContent(jid, structuredClone(message), { ...options })
				} catch {
					return []
				}

				// A local-only throw is the divergence, not a reason to skip: upstream
				// built an envelope from this content and baileyrs did not. Swallowing
				// it would contradict the oracle's own rule that throwing is part of
				// the contract.
				let localBuilt: unknown
				try {
					localBuilt = local.generateWAMessageFromContent(jid, structuredClone(message), { ...options })
				} catch (error) {
					return {
						target: 'wire:message-builder',
						input: { jid, message },
						local: `<threw ${(error as Error)?.name}: ${String((error as Error)?.message).slice(0, 160)}>`,
						upstream: '<an envelope>',
						detail: 'baileyrs could not build a message upstream built'
					}
				}

				const strip = (built: unknown): unknown => {
					let record: Record<string, unknown>
					try {
						record = structuredClone(built) as Record<string, unknown>
					} catch {
						// A builder output that will not clone is not something to crash the
						// runner over; compare what can be read instead.
						record = { ...(built as Record<string, unknown>) }
					}
					// `messageTimestamp` is the clock, and the two stamp it independently
					// even with a fixed `timestamp` option. Everything else in the envelope
					// — key, participant, status, message — is compared.
					delete record.messageTimestamp
					return normalise(record)
				}

				const localView = strip(localBuilt)
				const upstreamView = strip(upstreamBuilt)
				if (equivalent(localView, upstreamView)) return []

				return {
					target: 'wire:message-builder',
					input: { jid, message },
					local: localView,
					upstream: upstreamView,
					detail: 'generateWAMessageFromContent produced a different envelope'
				}
			}
		})
	})
})
