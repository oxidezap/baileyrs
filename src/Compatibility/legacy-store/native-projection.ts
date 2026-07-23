// Native byte-store projection onto the public legacy key-store contract.
import type { JsStoreCallbacks } from 'whatsapp-rust-bridge'
import type { SignalCreds, SignalDataSet, SignalDataTypeMap, SignalKeyStore } from '../../Types/index.ts'
import { LegacyStore, type ProjectedStoreName } from './constants.ts'
import { createLegacyCodecs } from './codecs/index.ts'
import { nativeKey, projectedStoreForLegacyType } from './routing.ts'

type NativeMutation = {
	sets: Map<string, Uint8Array>
	deletes: Set<string>
}

const projectedStores = [...new Set(Object.values(LegacyStore).map(projectedStoreForLegacyType))].filter(
	(store): store is ProjectedStoreName => store !== null
)

const readMany = async (store: JsStoreCallbacks, namespace: string, keys: string[]) => {
	if (keys.length === 0) return []
	if (store.getMany) return store.getMany(namespace, keys)
	const values = await Promise.all(keys.map(async key => [key, await store.get(namespace, key)] as const))
	return values.flatMap(([key, value]) => (value ? [[key, value] as [string, Uint8Array]] : []))
}

const writeMany = async (store: JsStoreCallbacks, namespace: string, mutation: NativeMutation): Promise<void> => {
	const sets = [...mutation.sets]
	const deletes = [...mutation.deletes]
	await Promise.all([
		sets.length
			? store.setMany
				? store.setMany(namespace, sets)
				: Promise.all(sets.map(([key, value]) => store.set(namespace, key, value))).then(() => undefined)
			: undefined,
		deletes.length
			? store.deleteMany
				? store.deleteMany(namespace, deletes)
				: Promise.all(deletes.map(key => store.delete(namespace, key))).then(() => undefined)
			: undefined
	])
}

/**
 * Project a neutral native byte store as the public legacy key store. Values
 * and key names reuse the same codecs/routing table as `wrapLegacyStore`.
 */
export const projectNativeStore = (store: JsStoreCallbacks, creds?: SignalCreds): SignalKeyStore => {
	const codecs = createLegacyCodecs(
		creds
			? {
					localIdentityPublic: creds.signedIdentityKey.public,
					localRegistrationId: creds.registrationId
				}
			: undefined
	)
	return {
		get: async <T extends keyof SignalDataTypeMap>(
			type: T,
			ids: string[]
		): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
			const namespace = projectedStoreForLegacyType(type)
			if (!namespace) throw new RangeError(`unsupported legacy key namespace: ${type}`)
			const uniqueIds = [...new Set(ids)]
			const translated = uniqueIds.map(id => [id, nativeKey(namespace, id)] as const)
			const native = new Map(
				await readMany(
					store,
					namespace,
					translated.map(([, key]) => key)
				)
			)
			const output: Record<string, SignalDataTypeMap[T]> = {}
			for (const [id, key] of translated) {
				const value = native.get(key)
				if (value) output[id] = codecs[namespace].toLegacy(key, value) as SignalDataTypeMap[T]
			}
			return output
		},
		set: async (data: SignalDataSet): Promise<void> => {
			const mutations = new Map<ProjectedStoreName, NativeMutation>()
			for (const [type, values] of Object.entries(data)) {
				if (!values) continue
				const namespace = projectedStoreForLegacyType(type)
				if (!namespace) throw new RangeError(`unsupported legacy key namespace: ${type}`)
				let mutation = mutations.get(namespace)
				if (!mutation) {
					mutation = { sets: new Map(), deletes: new Set() }
					mutations.set(namespace, mutation)
				}
				for (const [id, value] of Object.entries(values)) {
					const key = nativeKey(namespace, id)
					if (value == null) {
						mutation.sets.delete(key)
						mutation.deletes.add(key)
						continue
					}
					const encoded = codecs[namespace].fromLegacy(key, value)
					if (!encoded) {
						mutation.sets.delete(key)
						mutation.deletes.add(key)
					} else {
						mutation.deletes.delete(key)
						mutation.sets.set(key, encoded)
					}
				}
			}
			await Promise.all([...mutations].map(([namespace, mutation]) => writeMany(store, namespace, mutation)))
		},
		clear: async (): Promise<void> => {
			await Promise.all(
				projectedStores.map(async namespace => {
					if (store.deletePrefix) {
						await store.deletePrefix(namespace, '')
						return
					}
					if (!store.listKeys) {
						throw new Error(`cannot clear ${namespace}: native store does not support enumeration`)
					}
					const keys = await store.listKeys(namespace)
					if (keys.length === 0) return
					if (store.deleteMany) await store.deleteMany(namespace, keys)
					else await Promise.all(keys.map(key => store.delete(namespace, key)))
				})
			)
		}
	}
}
