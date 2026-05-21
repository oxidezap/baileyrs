// Ratchet semantic equivalence across the wrap-legacy-store boundary:
// chain converted Rust→JS (or back) must derive identical message keys.
// Pins the off-by-one between Rust `chain_key.index` and JS `chainKey.counter`.

import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import SessionRecord from 'libsignal/src/session_record.js'
import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
import { expect } from '../../__tests__/expect.ts'
import { fill, makeWrapped, BRIDGE_SESSION_KEY_LID, UPSTREAM_SESSION_KEY_LID } from './_legacy-store-fixtures.ts'

const MSG_SEED = Buffer.from([0x01])
const CHAIN_SEED = Buffer.from([0x02])
const hmac = (key: Buffer, seed: Buffer): Buffer => createHmac('sha256', key).update(seed).digest() as Buffer

function walkChain(initialKey: Buffer, n: number): { keyAfterNSteps: Buffer; msgKeys: Buffer[] } {
	let k: Buffer = Buffer.from(initialKey)
	const msgKeys: Buffer[] = []
	for (let i = 0; i < n; i++) {
		msgKeys.push(hmac(k, MSG_SEED))
		k = hmac(k, CHAIN_SEED)
	}
	return { keyAfterNSteps: k, msgKeys }
}

// Matches libsignal's in-memory shape after SessionRecord.deserialize.
interface JSChainShape {
	chainKey: { counter: number; key: Buffer }
	chainType: number
	messageKeys: Record<string, Buffer>
}

// Replica of libsignal's private SessionCipher.fillMessageKeys.
function jsFillMessageKeys(chain: JSChainShape, target: number): void {
	while (chain.chainKey.counter < target) {
		const key = chain.chainKey.key
		chain.chainKey.counter += 1
		chain.messageKeys[chain.chainKey.counter] = hmac(key, MSG_SEED)
		chain.chainKey.key = hmac(key, CHAIN_SEED)
	}
}

interface BuildChainOpts {
	initialChainKey: Buffer
	senderRustIndex?: number
	receiverRustIndex?: number
	senderRatchetPub?: Uint8Array
	receiverRatchetPub?: Uint8Array
}

function buildBridgeProto(opts: BuildChainOpts): Uint8Array {
	const {
		initialChainKey,
		senderRustIndex = 0,
		receiverRustIndex = 0,
		senderRatchetPub = fill(33, 2),
		receiverRatchetPub = fill(33, 5)
	} = opts
	return bridgeProto.RecordStructure.encode(
		bridgeProto.RecordStructure.create({
			currentSession: bridgeProto.SessionStructure.create({
				sessionVersion: 3,
				localIdentityPublic: fill(33, 9),
				remoteIdentityPublic: fill(33, 8),
				rootKey: fill(32, 11),
				previousCounter: 0,
				senderChain: {
					senderRatchetKey: senderRatchetPub,
					senderRatchetKeyPrivate: fill(32, 3),
					chainKey: { index: senderRustIndex, key: new Uint8Array(initialChainKey) },
					messageKeys: []
				},
				receiverChains: [
					{
						senderRatchetKey: receiverRatchetPub,
						chainKey: { index: receiverRustIndex, key: new Uint8Array(initialChainKey) },
						messageKeys: []
					}
				],
				remoteRegistrationId: 1234,
				localRegistrationId: 5678,
				aliceBaseKey: fill(33, 7)
			}),
			previousSessions: []
		})
	).finish()
}

interface JsSessionOpts {
	senderRatchetPub: Buffer
	senderRatchetPriv: Buffer
	chainKey: Buffer
	counter: number
}

function buildJsSession(opts: JsSessionOpts) {
	const baseKey = Buffer.from(fill(33, 7))
	return {
		_sessions: {
			[baseKey.toString('base64')]: {
				registrationId: 9999,
				currentRatchet: {
					ephemeralKeyPair: {
						pubKey: opts.senderRatchetPub.toString('base64'),
						privKey: opts.senderRatchetPriv.toString('base64')
					},
					lastRemoteEphemeralKey: Buffer.alloc(0).toString('base64'),
					previousCounter: 0,
					rootKey: Buffer.from(fill(32, 11)).toString('base64')
				},
				indexInfo: {
					baseKey: baseKey.toString('base64'),
					baseKeyType: 1,
					closed: -1,
					used: 0,
					created: 0,
					remoteIdentityKey: Buffer.from(fill(33, 8)).toString('base64')
				},
				_chains: {
					[opts.senderRatchetPub.toString('base64')]: {
						chainKey: { counter: opts.counter, key: opts.chainKey.toString('base64') },
						chainType: 1,
						messageKeys: {}
					}
				}
			}
		},
		version: 'v1' as const
	}
}

async function writeProtoAndReadJS(protoBytes: Uint8Array): Promise<ReturnType<typeof SessionRecord.deserialize>> {
	const { wrapped, keys } = await makeWrapped()
	await wrapped.set('session', BRIDGE_SESSION_KEY_LID, protoBytes)
	const stored = keys.raw['session']?.[UPSTREAM_SESSION_KEY_LID]
	if (!stored) throw new Error('wrapper did not write session under upstream key')
	return SessionRecord.deserialize(stored)
}

function chainFor(rec: ReturnType<typeof SessionRecord.deserialize>, ratchetPub: Uint8Array) {
	const session = rec.getOpenSession()
	if (!session) throw new Error('no open session')
	const chain = session._chains[Buffer.from(ratchetPub).toString('base64')]
	if (!chain) throw new Error(`no chain for ratchet ${Buffer.from(ratchetPub).toString('hex').slice(0, 12)}…`)
	return chain
}

describe('wrap-legacy-store: Rust↔JS chain-key index/counter mapping', () => {
	const senderRatchet = fill(33, 2)
	const receiverRatchet = fill(33, 5)

	test('fresh Rust chain (index=0) → JS counter=-1', async () => {
		const rec = await writeProtoAndReadJS(
			buildBridgeProto({ initialChainKey: Buffer.from(fill(32, 42)), senderRustIndex: 0 })
		)
		expect(chainFor(rec, senderRatchet).chainKey.counter).toBe(-1)
	})

	test('Rust index=N → JS counter=N-1 for arbitrary N', async () => {
		for (const n of [0, 1, 2, 5, 17, 100, 940]) {
			const rec = await writeProtoAndReadJS(
				buildBridgeProto({ initialChainKey: Buffer.from(fill(32, 50)), senderRustIndex: n })
			)
			expect(chainFor(rec, senderRatchet).chainKey.counter).toBe(n - 1)
		}
	})

	test('receiver chain mirrors sender chain mapping', async () => {
		const rec = await writeProtoAndReadJS(
			buildBridgeProto({
				initialChainKey: Buffer.from(fill(32, 11)),
				senderRustIndex: 0,
				receiverRustIndex: 5
			})
		)
		expect(chainFor(rec, receiverRatchet).chainKey.counter).toBe(4)
	})

	test('JS counter=N → Rust index=N+1 (inverse direction)', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: buildJsSession({
				senderRatchetPub: Buffer.from(fill(33, 2)),
				senderRatchetPriv: Buffer.from(fill(32, 3)),
				chainKey: Buffer.from(fill(32, 70)),
				counter: 6
			})
		}
		const protoBytes = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoBytes)
		expect(decoded.currentSession?.senderChain?.chainKey?.index).toBe(7)
	})

	test('fresh JS chain (counter=-1) → Rust index=0', async () => {
		const { wrapped, keys } = await makeWrapped()
		keys.raw['session'] = {
			[UPSTREAM_SESSION_KEY_LID]: buildJsSession({
				senderRatchetPub: Buffer.from(fill(33, 2)),
				senderRatchetPriv: Buffer.from(fill(32, 3)),
				chainKey: Buffer.from(fill(32, 21)),
				counter: -1
			})
		}
		const protoBytes = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(protoBytes)
		expect(decoded.currentSession?.senderChain?.chainKey?.index).toBe(0)
	})
})

describe('wrap-legacy-store: ratchet semantic equivalence after Rust→JS', () => {
	const senderRatchet = fill(33, 2)
	const receiverRatchet = fill(33, 5)

	test('JS derives the same msg key Rust would derive natively', async () => {
		const k0 = Buffer.from(fill(32, 99))
		const { keyAfterNSteps: k3 } = walkChain(k0, 3)
		const rec = await writeProtoAndReadJS(buildBridgeProto({ initialChainKey: k3, senderRustIndex: 3 }))
		const chain = chainFor(rec, senderRatchet)

		expect(chain.chainKey.counter).toBe(2)
		expect(chain.chainKey.key.equals(k3)).toBe(true)

		const jsChain: JSChainShape = {
			chainKey: { counter: chain.chainKey.counter, key: chain.chainKey.key },
			chainType: chain.chainType,
			messageKeys: {}
		}
		jsFillMessageKeys(jsChain, 3)
		const { msgKeys: expected } = walkChain(k0, 4)
		expect(jsChain.messageKeys[3]!.equals(expected[3]!)).toBe(true)
	})

	test('receiver chain decrypts the next inbound msg after roundtrip', async () => {
		const k0 = Buffer.from(fill(32, 33))
		const { keyAfterNSteps: kN } = walkChain(k0, 5)
		const rec = await writeProtoAndReadJS(
			buildBridgeProto({ initialChainKey: kN, senderRustIndex: 0, receiverRustIndex: 5 })
		)
		const chain = chainFor(rec, receiverRatchet)
		expect(chain.chainKey.counter).toBe(4)

		const jsChain: JSChainShape = {
			chainKey: { counter: chain.chainKey.counter, key: chain.chainKey.key },
			chainType: chain.chainType,
			messageKeys: {}
		}
		jsFillMessageKeys(jsChain, 5)
		const { msgKeys: expected } = walkChain(k0, 6)
		expect(jsChain.messageKeys[5]!.equals(expected[5]!)).toBe(true)
	})

	test('Rust→JS→Rust is a fixed point for chain state (index + bytes)', async () => {
		const initial = Buffer.from(fill(32, 77))
		const original = buildBridgeProto({
			initialChainKey: initial,
			senderRustIndex: 4,
			receiverRustIndex: 6
		})
		const { wrapped } = await makeWrapped()
		await wrapped.set('session', BRIDGE_SESSION_KEY_LID, original)
		const round = (await wrapped.get('session', BRIDGE_SESSION_KEY_LID)) as Uint8Array
		const decoded = bridgeProto.RecordStructure.decode(round)

		expect(decoded.currentSession?.senderChain?.chainKey?.index).toBe(4)
		expect(decoded.currentSession?.receiverChains?.[0]?.chainKey?.index).toBe(6)
		expect(Buffer.from(decoded.currentSession?.senderChain?.chainKey?.key ?? []).equals(initial)).toBe(true)
		expect(Buffer.from(decoded.currentSession?.receiverChains?.[0]?.chainKey?.key ?? []).equals(initial)).toBe(true)
	})
})
