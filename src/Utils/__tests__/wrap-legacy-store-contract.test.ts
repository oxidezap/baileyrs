import { Buffer } from 'node:buffer'
import { describe, test } from 'node:test'
import { proto as bridgeProto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { AuthenticationState, SignalKeyStore } from '../../Types/index.ts'
import { expect } from '../../__tests__/expect.ts'
import { initAuthCreds } from '../generics.ts'
import { wrapLegacyStore } from '../wrap-legacy-store.ts'
import {
	MirrorStore,
	NativeStore,
	DeviceRecordKey,
	LegacyStore,
	RouteKind,
	SignalKeyLength,
	StoreCatalog,
	TimeValue
} from '../../Compatibility/legacy-store/constants.ts'
import { decodeNativeEnvelope } from '../../Compatibility/legacy-store/common.ts'
import {
	BRIDGE_SESSION_KEY_LID,
	SAMPLE_GROUP,
	UPSTREAM_SESSION_KEY_LID,
	buildBridgeSenderKeyBytes,
	buildBridgeSessionBytes,
	fill,
	makeMemKeys,
	makeWrapped
} from './_legacy-store-fixtures.ts'

const textBytes = (value: string): Uint8Array => new TextEncoder().encode(value)

function withDerivedReceiverMessageKey(value: Uint8Array): Uint8Array {
	const record = bridgeProto.RecordStructure.decode(value)
	const receiver = record.currentSession?.receiverChains?.[0]
	if (!receiver) throw new Error('session fixture has no receiver chain')
	receiver.messageKeys = [
		{
			index: 0,
			cipherKey: fill(32, 43),
			macKey: fill(32, 47),
			iv: fill(16, 53)
		}
	]
	return bridgeProto.RecordStructure.encode(record).finish()
}

describe('wrap-legacy-store: catalog contract', () => {
	test('the route catalog is runtime-exhaustive over every native namespace', () => {
		expect(Object.keys(StoreCatalog).toSorted()).toEqual(Object.values(NativeStore).toSorted())
		expect(StoreCatalog[NativeStore.DEVICE].kind).toBe(RouteKind.DEVICE)
	})

	test('batch capability includes an actual getMany implementation', async () => {
		const { wrapped } = await makeWrapped()
		expect(wrapped.capabilities).toEqual({ batch: true })
		expect(typeof wrapped.getMany).toBe('function')
	})

	test('unknown namespaces fail before touching the backing store', async () => {
		const { wrapped, keys } = await makeWrapped()
		let writes = 0
		const originalSet = keys.set.bind(keys)
		keys.set = async updates => {
			writes++
			await originalSet(updates)
		}
		await expect(wrapped.set('future_store', 'key', textBytes('value'))).rejects.toThrow(/unsupported native store/)
		expect(writes).toBe(0)
	})
})

describe('wrap-legacy-store: exact native mirror', () => {
	test('one projected set persists exact native bytes and legacy projection in one call', async () => {
		const { wrapped, keys } = await makeWrapped()
		const native = buildBridgeSessionBytes()
		let writes = 0
		let lastUpdate: Record<string, Record<string, unknown>> | undefined
		const originalSet = keys.set.bind(keys)
		keys.set = async updates => {
			writes++
			lastUpdate = updates
			await originalSet(updates)
		}

		await wrapped.set(NativeStore.SESSION, BRIDGE_SESSION_KEY_LID, native)

		expect(writes).toBe(1)
		expect(Object.keys(lastUpdate!).toSorted()).toEqual([MirrorStore.SESSION, LegacyStore.SESSION].toSorted())
		expect(lastUpdate?.[LegacyStore.SESSION]?.[UPSTREAM_SESSION_KEY_LID]).toBeDefined()
		const envelope = decodeNativeEnvelope(lastUpdate?.[MirrorStore.SESSION]?.[BRIDGE_SESSION_KEY_LID])
		expect(envelope).not.toBe(null)
		expect(Buffer.from(envelope!.payload).equals(Buffer.from(native))).toBe(true)
	})

	test('an unrepresentable session stays lossless until the legacy owner actually changes it', async () => {
		const { wrapped, keys } = await makeWrapped()
		const representable = buildBridgeSessionBytes()
		await wrapped.set(NativeStore.SESSION, BRIDGE_SESSION_KEY_LID, representable)
		const legacyBefore = keys.raw[LegacyStore.SESSION]?.[UPSTREAM_SESSION_KEY_LID]
		const native = withDerivedReceiverMessageKey(representable)

		let writes = 0
		const originalSet = keys.set.bind(keys)
		keys.set = async updates => {
			writes++
			await originalSet(updates)
		}
		await wrapped.set(NativeStore.SESSION, BRIDGE_SESSION_KEY_LID, native)

		expect(writes).toBe(1)
		expect(keys.raw[LegacyStore.SESSION]?.[UPSTREAM_SESSION_KEY_LID]).toBe(legacyBefore)
		const nativeOnly = decodeNativeEnvelope(keys.raw[MirrorStore.SESSION]?.[BRIDGE_SESSION_KEY_LID])
		expect(nativeOnly?.nativeOnly).toBe(true)
		expect(Buffer.from(nativeOnly!.payload).equals(Buffer.from(native))).toBe(true)
		const lossless = await wrapped.get(NativeStore.SESSION, BRIDGE_SESSION_KEY_LID)
		expect(Buffer.from(lossless!).equals(Buffer.from(native))).toBe(true)

		const legacySession = legacyBefore as {
			_sessions: Record<string, { registrationId: number }>
		}
		Object.values(legacySession._sessions)[0]!.registrationId = 8765
		const takenOver = await wrapped.get(NativeStore.SESSION, BRIDGE_SESSION_KEY_LID)
		const decoded = bridgeProto.RecordStructure.decode(takenOver!)
		expect(decoded.currentSession?.remoteRegistrationId).toBe(8765)
		expect(decodeNativeEnvelope(keys.raw[MirrorStore.SESSION]?.[BRIDGE_SESSION_KEY_LID])?.nativeOnly).toBe(false)
	})

	test('device payload keeps fields that have no legacy creds equivalent byte-for-byte', async () => {
		const { wrapped, keys } = await makeWrapped()
		const native = textBytes(
			JSON.stringify({
				pn: { user: '559980000003', server: 's.whatsapp.net', device: 7, agent: 0, integrator: 0 },
				lid: { user: '100000037037034', server: 'lid', device: 7, agent: 1, integrator: 0 },
				registration_id: 123,
				noise_key: Array(SignalKeyLength.KEY_PAIR).fill(1),
				identity_key: Array(SignalKeyLength.KEY_PAIR).fill(2),
				custom_native_field: { preserved: true }
			})
		)

		await wrapped.set(NativeStore.DEVICE, DeviceRecordKey.DEVICE, native)
		const loaded = await wrapped.get(NativeStore.DEVICE, DeviceRecordKey.DEVICE)

		expect(Buffer.from(loaded!).equals(Buffer.from(native))).toBe(true)
		expect(keys.raw[MirrorStore.DEVICE]?.[DeviceRecordKey.DEVICE]).toBeDefined()
	})

	test('cold legacy import seeds a persistent mirror without an adapter-local cache', async () => {
		const { wrapped, keys } = await makeWrapped()
		const first = fill(32, 11)
		const second = fill(32, 13)
		keys.raw[LegacyStore.IDENTITY] = {
			'559980000001.0': Buffer.concat([Buffer.from([SignalKeyLength.CURVE_PUBLIC_PREFIX]), Buffer.from(first)]),
			'559980000002.0': Buffer.concat([Buffer.from([SignalKeyLength.CURVE_PUBLIC_PREFIX]), Buffer.from(second)])
		}
		let reads = 0
		let writes = 0
		const originalGet = keys.get.bind(keys)
		const originalSet = keys.set.bind(keys)
		keys.get = async (type, ids) => {
			reads++
			return originalGet(type, ids)
		}
		keys.set = async updates => {
			writes++
			return originalSet(updates)
		}
		const requested = ['559980000001@s.whatsapp.net.0', '559980000002@s.whatsapp.net.0']

		const imported = await wrapped.getMany!(NativeStore.IDENTITY, requested)
		expect(imported.length).toBe(2)
		expect(reads).toBe(2)
		expect(writes).toBe(1)
		expect(Object.keys(keys.raw[MirrorStore.IDENTITY] ?? {}).toSorted()).toEqual(requested.toSorted())

		await wrapped.getMany!(NativeStore.IDENTITY, requested)
		expect(reads).toBe(4)
		expect(writes).toBe(1)
	})

	test('a new adapter detects an upstream takeover and replaces a stale mirror', async () => {
		const { wrapped, keys, creds } = await makeWrapped()
		const nativeKey = '559980000003@s.whatsapp.net.0'
		const legacyKey = '559980000003.0'
		const before = fill(32, 17)
		const after = fill(32, 19)
		await wrapped.set(NativeStore.IDENTITY, nativeKey, before)
		keys.raw[LegacyStore.IDENTITY]![legacyKey] = Buffer.concat([
			Buffer.from([SignalKeyLength.CURVE_PUBLIC_PREFIX]),
			Buffer.from(after)
		])

		const state: AuthenticationState = { creds, keys: keys as unknown as SignalKeyStore }
		const rewrapped = await wrapLegacyStore(state, async () => {})
		const loaded = await rewrapped.get(NativeStore.IDENTITY, nativeKey)

		expect(Buffer.from(loaded!).equals(Buffer.from(after))).toBe(true)
		const envelope = decodeNativeEnvelope(keys.raw[MirrorStore.IDENTITY]?.[nativeKey])
		expect(Buffer.from(envelope!.payload).equals(Buffer.from(after))).toBe(true)
	})

	test('a failed projected write never poisons the persistent mirror', async () => {
		const { wrapped, keys } = await makeWrapped()
		const nativeKey = '559980000004@s.whatsapp.net.0'
		const legacyKey = '559980000004.0'
		const attempted = fill(32, 23)
		const durable = fill(32, 29)
		const originalSet = keys.set.bind(keys)
		keys.set = async () => {
			throw new Error('write failed')
		}
		await expect(wrapped.set(NativeStore.IDENTITY, nativeKey, attempted)).rejects.toThrow(/write failed/)

		keys.set = originalSet
		keys.raw[LegacyStore.IDENTITY] = {
			[legacyKey]: Buffer.concat([Buffer.from([SignalKeyLength.CURVE_PUBLIC_PREFIX]), Buffer.from(durable)])
		}
		const loaded = await wrapped.get(NativeStore.IDENTITY, nativeKey)
		expect(Buffer.from(loaded!).equals(Buffer.from(durable))).toBe(true)
	})

	test('translated-key collisions reject the whole batch before persistence', async () => {
		const { wrapped, keys } = await makeWrapped()
		let writes = 0
		const originalSet = keys.set.bind(keys)
		keys.set = async updates => {
			writes++
			return originalSet(updates)
		}
		await expect(
			wrapped.setMany!(NativeStore.IDENTITY, [
				['559980000005:7@s.whatsapp.net.0', fill(32, 31)],
				['559980000005:7@s.whatsapp.net.9', fill(32, 37)]
			])
		).rejects.toThrow(/duplicate key/)
		expect(writes).toBe(0)
	})

	test('invalid Signal components fail before either projection is persisted', async () => {
		const { wrapped, keys } = await makeWrapped()
		let writes = 0
		const originalSet = keys.set.bind(keys)
		keys.set = async updates => {
			writes++
			return originalSet(updates)
		}
		const malformed = buildBridgeSenderKeyBytes({ signingPublic: fill(31, 41) })

		await expect(
			wrapped.set(NativeStore.SENDER_KEY, `${SAMPLE_GROUP}:100000037037034@lid.0`, malformed)
		).rejects.toThrow(/sender signing public key/)
		expect(writes).toBe(0)
	})
})

describe('wrap-legacy-store: deterministic import', () => {
	test('the same legacy LID mapping always produces the same bytes and sentinel timestamps', async () => {
		const makeImported = async () => {
			const keys = makeMemKeys()
			keys.raw[LegacyStore.LID_MAPPING] = { '100000037037034_reverse': '559980000003' }
			const state = {
				creds: initAuthCreds(),
				keys: keys as unknown as SignalKeyStore
			} satisfies AuthenticationState
			const wrapped = await wrapLegacyStore(state, async () => {})
			return (await wrapped.get(NativeStore.LID_MAPPING, 'lid:100000037037034'))!
		}
		const first = await makeImported()
		const second = await makeImported()
		const decoded = JSON.parse(Buffer.from(first).toString()) as { created_at: number; updated_at: number }

		expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
		expect(decoded.created_at).toBe(TimeValue.UNKNOWN_SECONDS)
		expect(decoded.updated_at).toBe(decoded.created_at)
	})
})
