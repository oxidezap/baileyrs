// Baileys legacy auth-state projection onto the bridge's neutral byte store.
import { Buffer } from 'node:buffer'
import type { AuthenticationState } from '../../Types/index.ts'
import {
	NativeStore,
	RouteKind,
	type DeviceRecordKeyName,
	type NativeStoreName,
	type ProjectedStoreName
} from './constants.ts'
import {
	decodeNativeEnvelope,
	encodeNativeEnvelope,
	encodeNativeOnlyEnvelope,
	envelopeMatchesLegacy,
	toBytes
} from './common.ts'
import { createLegacyCodecs } from './codecs/index.ts'
import { createDeviceProjection, parseDeviceRecordKey } from './device.ts'
import { isProjectedStoreName, legacyKey, parseNativeStoreName, resolveRoute } from './routing.ts'
import {
	NATIVE_ONLY_PROJECTION,
	type LegacyKeysStore,
	type LegacyStoreLogger,
	type Warn,
	type WrappedLegacyStore
} from './types.ts'

type ByteResult = [key: string, value: Uint8Array]
type ByteEntry = [key: string, value: Uint8Array]

const emptyBucket = (): Record<string, unknown> => Object.create(null) as Record<string, unknown>
const ownValue = (bucket: Record<string, unknown>, key: string): unknown =>
	Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : null

function uniqueKeys(keys: readonly string[], label: string): void {
	const seen = new Set<string>()
	for (const key of keys) {
		if (seen.has(key)) throw new TypeError(`${label} contains duplicate key: ${key}`)
		seen.add(key)
	}
}

function createWarn(logger?: LegacyStoreLogger): Warn {
	return logger ? (message, error) => logger.warn({ err: error }, message) : () => {}
}

export async function wrapLegacyStore(
	state: AuthenticationState,
	saveCreds: () => Promise<void>,
	logger?: LegacyStoreLogger
): Promise<WrappedLegacyStore> {
	if (!state.creds || !state.keys) {
		throw new TypeError('wrapLegacyStore requires legacy creds and keys')
	}

	const warn = createWarn(logger)
	const keys = state.keys as unknown as LegacyKeysStore
	const codecs = createLegacyCodecs({
		localIdentityPublic: state.creds.signedIdentityKey.public,
		localRegistrationId: state.creds.registrationId
	})
	const device = createDeviceProjection(state.creds)

	const readBucket = async (type: string, ids: string[]): Promise<Record<string, unknown>> => {
		if (ids.length === 0) return emptyBucket()
		return await keys.get(type, ids)
	}

	const persist = async (updates: Record<string, Record<string, unknown>>): Promise<void> => {
		if (Object.values(updates).every(bucket => Object.keys(bucket).length === 0)) return
		await keys.set(updates)
	}

	async function readRaw(store: NativeStoreName, keysToRead: string[]): Promise<ByteResult[]> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.RAW) throw new TypeError(`${store} is not a raw store`)
		const bucket = await readBucket(route.nativeType, keysToRead)
		const output: ByteResult[] = []
		for (const key of keysToRead) {
			const value = ownValue(bucket, key)
			if (value == null) continue
			const bytes = toBytes(value)
			if (!bytes) throw new TypeError(`${store}/${key} is not stored as binary data`)
			output.push([key, bytes])
		}
		return output
	}

	async function readProjected(store: ProjectedStoreName, requested: string[]): Promise<ByteResult[]> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.PROJECTED) throw new TypeError(`${store} is not a projected store`)

		const translated = requested.map(key => [key, legacyKey(store, key)] as const)
		uniqueKeys(
			translated.map(([, key]) => key),
			`${store} legacy-key projection`
		)
		const [nativeBucket, legacyBucket] = await Promise.all([
			readBucket(route.nativeType, requested),
			readBucket(
				route.legacyType,
				translated.map(([, key]) => key)
			)
		])
		const mirrorUpdates = emptyBucket()
		const imported = new Map<string, Uint8Array | null>()

		for (const [nativeKey, translatedKey] of translated) {
			const legacyValue = ownValue(legacyBucket, translatedKey)
			const envelope = decodeNativeEnvelope(ownValue(nativeBucket, nativeKey))
			if (envelope && envelopeMatchesLegacy(envelope, legacyValue)) {
				imported.set(nativeKey, envelope.payload)
				continue
			}

			const nativeValue = legacyValue == null ? null : codecs[store].fromLegacy(nativeKey, legacyValue)
			imported.set(nativeKey, nativeValue)
			mirrorUpdates[nativeKey] = nativeValue == null ? null : encodeNativeEnvelope(nativeValue, legacyValue)
		}

		if (Object.keys(mirrorUpdates).length > 0) await persist({ [route.nativeType]: mirrorUpdates })
		return requested.flatMap(key => {
			const value = imported.get(key)
			return value ? [[key, value] as ByteResult] : []
		})
	}

	async function readDevice(requested: string[]): Promise<ByteResult[]> {
		const store = NativeStore.DEVICE
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.DEVICE) throw new TypeError('device route catalog is invalid')
		const parsed = requested.map(key => [key, parseDeviceRecordKey(key)] as const)
		const nativeBucket = await readBucket(route.nativeType, requested)
		const mirrorUpdates = emptyBucket()
		const imported = new Map<string, Uint8Array | null>()

		for (const [rawKey, deviceKey] of parsed) {
			const legacyValue = device.read(deviceKey)
			const envelope = decodeNativeEnvelope(ownValue(nativeBucket, rawKey))
			if (envelope && envelopeMatchesLegacy(envelope, legacyValue)) {
				imported.set(rawKey, envelope.payload)
				continue
			}
			imported.set(rawKey, legacyValue)
			mirrorUpdates[rawKey] = legacyValue ? encodeNativeEnvelope(legacyValue, legacyValue) : null
		}

		if (Object.keys(mirrorUpdates).length > 0) await persist({ [route.nativeType]: mirrorUpdates })
		return requested.flatMap(key => {
			const value = imported.get(key)
			return value ? [[key, value] as ByteResult] : []
		})
	}

	async function readMany(storeValue: string, requested: string[]): Promise<ByteResult[]> {
		if (requested.length === 0) return []
		uniqueKeys(requested, `${storeValue} getMany`)
		const store = parseNativeStoreName(storeValue)
		const route = resolveRoute(store)
		if (route.kind === RouteKind.RAW) return readRaw(store, requested)
		if (route.kind === RouteKind.DEVICE) return readDevice(requested)
		if (!isProjectedStoreName(store)) throw new TypeError(`${store} has no projected codec`)
		return readProjected(store, requested)
	}

	async function writeRaw(store: NativeStoreName, entries: ByteEntry[]): Promise<void> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.RAW) throw new TypeError(`${store} is not a raw store`)
		const bucket = emptyBucket()
		for (const [key, value] of entries) bucket[key] = Buffer.from(value)
		await persist({ [route.nativeType]: bucket })
	}

	async function writeProjected(store: ProjectedStoreName, entries: ByteEntry[]): Promise<void> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.PROJECTED) throw new TypeError(`${store} is not a projected store`)
		const nativeBucket = emptyBucket()
		const legacyBucket = emptyBucket()
		const projected = entries.map(([key, value]) => ({
			key,
			value,
			translatedKey: legacyKey(store, key),
			legacyValue: codecs[store].toLegacy(key, value)
		}))
		uniqueKeys(
			projected.map(({ translatedKey }) => translatedKey),
			`${store} legacy-key projection`
		)
		const nativeOnly = projected.filter(({ legacyValue }) => legacyValue === NATIVE_ONLY_PROJECTION)
		const existingLegacy =
			nativeOnly.length === 0
				? emptyBucket()
				: await readBucket(
						route.legacyType,
						nativeOnly.map(({ translatedKey }) => translatedKey)
					)

		for (const { key, value, translatedKey, legacyValue } of projected) {
			if (legacyValue === NATIVE_ONLY_PROJECTION) {
				nativeBucket[key] = encodeNativeOnlyEnvelope(value, ownValue(existingLegacy, translatedKey))
				continue
			}
			legacyBucket[translatedKey] = legacyValue
			nativeBucket[key] = encodeNativeEnvelope(value, legacyValue)
		}
		const updates = { [route.nativeType]: nativeBucket } as Record<string, Record<string, unknown>>
		if (Object.keys(legacyBucket).length > 0) updates[route.legacyType] = legacyBucket
		await persist(updates)
	}

	async function writeDevice(entries: ByteEntry[]): Promise<void> {
		const route = resolveRoute(NativeStore.DEVICE)
		if (route.kind !== RouteKind.DEVICE) throw new TypeError('device route catalog is invalid')
		const prepared: Array<[rawKey: string, key: DeviceRecordKeyName, value: Uint8Array, apply: () => void]> = []
		for (const [rawKey, value] of entries) {
			const key = parseDeviceRecordKey(rawKey)
			prepared.push([rawKey, key, value, device.prepare(key, value)])
		}
		for (const [, , , apply] of prepared) apply()

		const nativeBucket = emptyBucket()
		for (const [rawKey, key, value] of prepared) {
			const projection = device.read(key)
			nativeBucket[rawKey] = encodeNativeEnvelope(value, projection)
		}

		const writes = await Promise.allSettled([saveCreds(), persist({ [route.nativeType]: nativeBucket })])
		const failures = writes.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		if (failures.length > 0)
			throw new AggregateError(
				failures.map(result => result.reason),
				'device persistence failed'
			)
	}

	async function writeMany(storeValue: string, entries: ByteEntry[]): Promise<void> {
		if (entries.length === 0) return
		uniqueKeys(
			entries.map(([key]) => key),
			`${storeValue} setMany`
		)
		const store = parseNativeStoreName(storeValue)
		const route = resolveRoute(store)
		if (route.kind === RouteKind.RAW) return writeRaw(store, entries)
		if (route.kind === RouteKind.DEVICE) return writeDevice(entries)
		if (!isProjectedStoreName(store)) throw new TypeError(`${store} has no projected codec`)
		return writeProjected(store, entries)
	}

	async function deleteRaw(store: NativeStoreName, requested: string[]): Promise<void> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.RAW) throw new TypeError(`${store} is not a raw store`)
		const bucket = emptyBucket()
		for (const key of requested) bucket[key] = null
		await persist({ [route.nativeType]: bucket })
	}

	async function deleteProjected(store: ProjectedStoreName, requested: string[]): Promise<void> {
		const route = resolveRoute(store)
		if (route.kind !== RouteKind.PROJECTED) throw new TypeError(`${store} is not a projected store`)
		const nativeBucket = emptyBucket()
		const legacyBucket = emptyBucket()
		const translated = requested.map(key => legacyKey(store, key))
		uniqueKeys(translated, `${store} legacy-key projection`)
		for (const key of requested) nativeBucket[key] = null
		for (const key of translated) legacyBucket[key] = null
		await persist({ [route.nativeType]: nativeBucket, [route.legacyType]: legacyBucket })
	}

	async function removeMany(storeValue: string, requested: string[]): Promise<void> {
		if (requested.length === 0) return
		uniqueKeys(requested, `${storeValue} deleteMany`)
		const store = parseNativeStoreName(storeValue)
		const route = resolveRoute(store)
		if (route.kind === RouteKind.DEVICE) return
		if (route.kind === RouteKind.RAW) return deleteRaw(store, requested)
		if (!isProjectedStoreName(store)) throw new TypeError(`${store} has no projected codec`)
		return deleteProjected(store, requested)
	}

	return {
		async get(store, key) {
			try {
				return (await readMany(store, [key]))[0]?.[1] ?? null
			} catch (error) {
				warn(`GET ${store}/${key} failed`, error)
				throw error
			}
		},
		async getMany(store, requested) {
			try {
				return await readMany(store, requested)
			} catch (error) {
				warn(`GET-MANY ${store} failed`, error)
				throw error
			}
		},
		async set(store, key, value) {
			try {
				await writeMany(store, [[key, value]])
			} catch (error) {
				warn(`SET ${store}/${key} failed`, error)
				throw error
			}
		},
		async setMany(store, entries) {
			try {
				await writeMany(store, entries)
			} catch (error) {
				warn(`SET-MANY ${store} failed`, error)
				throw error
			}
		},
		async delete(store, key) {
			try {
				await removeMany(store, [key])
			} catch (error) {
				warn(`DELETE ${store}/${key} failed`, error)
				throw error
			}
		},
		async deleteMany(store, requested) {
			try {
				await removeMany(store, requested)
			} catch (error) {
				warn(`DELETE-MANY ${store} failed`, error)
				throw error
			}
		},
		capabilities: { batch: true },
		async flush() {},
		dispose() {}
	}
}
