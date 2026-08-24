// Basic value codecs for the Baileys legacy-store projection.
import { Buffer } from 'node:buffer'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { LTHashState } from '../../../Types/index.ts'
import { AppState, JsonByteEncoding, LidMapping, NativeStore, TimeValue } from '../constants.ts'
import { bytesToNumbers, fromJsonBytes, toBytes, toJsonBytes } from '../common.ts'
import { parseLidMappingKey } from '../routing.ts'
import type { LegacyCodec } from '../types.ts'
import {
	parseUnsignedDecimal,
	requireByteArray,
	requireBytes,
	requireSafeUnsignedInteger,
	serializeSignalPublicKey
} from '../validation.ts'

type BasicCodecStore =
	| typeof NativeStore.PREKEY
	| typeof NativeStore.SYNC_KEY
	| typeof NativeStore.SYNC_VERSION
	| typeof NativeStore.TC_TOKEN
	| typeof NativeStore.DEVICE_LIST
	| typeof NativeStore.IDENTITY
	| typeof NativeStore.LID_MAPPING

function prekeyCodec(): LegacyCodec {
	return {
		fromLegacy(key, value) {
			const bytes = toBytes(value)
			if (bytes) return bytes
			const pair = value as { public?: unknown; private?: unknown }
			const publicKey = requireBytes(pair?.public, 'legacy pre-key public key')
			const privateKey = requireBytes(pair?.private, 'legacy pre-key private key')
			return proto.PreKeyRecordStructure.encode(
				proto.PreKeyRecordStructure.create({ id: parseUnsignedDecimal(key, 'pre-key id'), publicKey, privateKey })
			).finish()
		},
		toLegacy(_key, value) {
			const record = proto.PreKeyRecordStructure.decode(value)
			if (!record.publicKey || !record.privateKey) throw new TypeError('native pre-key record is missing key material')
			return { public: Buffer.from(record.publicKey), private: Buffer.from(record.privateKey) }
		}
	}
}

function syncKeyCodec(): LegacyCodec {
	return {
		fromLegacy(_key, value) {
			const bytes = toBytes(value)
			if (bytes) return bytes
			const message = value as proto.Message.IAppStateSyncKeyData
			const fingerprint = message.fingerprint
				? proto.Message.AppStateSyncKeyFingerprint.encode(
						proto.Message.AppStateSyncKeyFingerprint.create(message.fingerprint)
					).finish()
				: new Uint8Array()
			return toJsonBytes({
				key_data: message.keyData ? bytesToNumbers(message.keyData) : [],
				fingerprint: bytesToNumbers(fingerprint),
				timestamp: Number(message.timestamp ?? TimeValue.UNKNOWN_SECONDS)
			})
		},
		toLegacy(_key, value) {
			const native = fromJsonBytes(value) as Record<string, unknown>
			const keyData = requireByteArray(native.key_data, 'sync-key key_data')
			const fingerprintBytes = requireByteArray(native.fingerprint, 'sync-key fingerprint')
			const fingerprint =
				fingerprintBytes.length > 0
					? proto.Message.AppStateSyncKeyFingerprint.decode(Buffer.from(fingerprintBytes))
					: undefined
			return proto.Message.AppStateSyncKeyData.fromObject({
				keyData: Buffer.from(keyData),
				fingerprint,
				timestamp: Number(native.timestamp ?? TimeValue.UNKNOWN_SECONDS)
			})
		}
	}
}

function syncVersionCodec(): LegacyCodec {
	return {
		fromLegacy(_key, value) {
			const bytes = toBytes(value)
			if (bytes) return bytes
			const state = value as LTHashState
			const indexValueMap: Record<string, number[]> = {}
			for (const [index, entry] of Object.entries(state.indexValueMap ?? {}).toSorted(([a], [b]) =>
				a.localeCompare(b)
			)) {
				indexValueMap[index] = bytesToNumbers(entry.valueMac)
			}
			return toJsonBytes({
				version: state.version ?? TimeValue.UNKNOWN_SECONDS,
				hash: state.hash ? bytesToNumbers(state.hash) : Array<number>(AppState.HASH_LENGTH).fill(0),
				index_value_map: indexValueMap
			})
		},
		toLegacy(_key, value) {
			const native = fromJsonBytes(value) as {
				version?: number
				hash?: unknown
				index_value_map?: Record<string, unknown>
			}
			const indexValueMap: LTHashState['indexValueMap'] = {}
			for (const [index, mac] of Object.entries(native.index_value_map ?? {})) {
				indexValueMap[index] = { valueMac: Buffer.from(requireByteArray(mac, `sync-version ${index}`)) }
			}
			return {
				version: native.version ?? TimeValue.UNKNOWN_SECONDS,
				hash: Buffer.from(requireByteArray(native.hash, 'sync-version hash')),
				indexValueMap
			} satisfies LTHashState
		}
	}
}

function tcTokenCodec(): LegacyCodec {
	return {
		fromLegacy(_key, value) {
			const token = value as { token?: unknown; timestamp?: string; senderTimestamp?: string }
			return toJsonBytes({
				token: bytesToNumbers(requireBytes(token.token, 'TC token')),
				token_timestamp: token.timestamp
					? parseUnsignedDecimal(token.timestamp, 'TC token timestamp')
					: TimeValue.UNKNOWN_SECONDS,
				sender_timestamp: token.senderTimestamp
					? parseUnsignedDecimal(token.senderTimestamp, 'TC token sender timestamp')
					: null
			})
		},
		toLegacy(_key, value) {
			const native = fromJsonBytes(value) as {
				token?: unknown
				token_timestamp?: number
				sender_timestamp?: number | null
			}
			// Added rather than set to `undefined`, matching upstream, which
			// only carries the field when it has a value. An undefined-valued
			// key survives in memory but not through a store, and the mirror
			// fingerprint is taken on both sides of that boundary — see the
			// note in `canonicalize`.
			const legacy: { token: Buffer; timestamp: string; senderTimestamp?: string } = {
				token: Buffer.from(requireByteArray(native.token, 'native TC token')),
				timestamp: (native.token_timestamp ?? TimeValue.UNKNOWN_SECONDS).toString()
			}
			if (native.sender_timestamp != null) legacy.senderTimestamp = native.sender_timestamp.toString()
			return legacy
		}
	}
}

function deviceListCodec(): LegacyCodec {
	return {
		fromLegacy(key, value) {
			if (!Array.isArray(value) || value.some(device => typeof device !== 'string')) {
				throw new TypeError('legacy device list must be an array of decimal strings')
			}
			return toJsonBytes({
				user: key,
				devices: value.map(device => ({ device_id: parseUnsignedDecimal(device, 'device id') })),
				timestamp: TimeValue.UNKNOWN_SECONDS
			})
		},
		toLegacy(_key, value) {
			const native = fromJsonBytes(value) as { devices?: Array<{ device_id?: number }> }
			return (native.devices ?? []).map(device => {
				return requireSafeUnsignedInteger(device.device_id, 'native device id').toString()
			})
		}
	}
}

function identityCodec(): LegacyCodec {
	return {
		fromLegacy(_key, value) {
			return serializeSignalPublicKey(value, 'legacy identity key').slice(1)
		},
		toLegacy(_key, value) {
			return Buffer.from(serializeSignalPublicKey(value, 'native identity key'))
		}
	}
}

function lidMappingCodec(): LegacyCodec {
	return {
		fromLegacy(key, value) {
			const mapping =
				typeof value === 'string'
					? value
					: Buffer.from(requireBytes(value, 'legacy LID mapping')).toString(JsonByteEncoding.UTF8)
			if (mapping.length === 0) return null
			const parsed = parseLidMappingKey(key)
			if (parsed.direction === LidMapping.PN_DIRECTION) return new TextEncoder().encode(mapping)
			return toJsonBytes({
				lid: parsed.user,
				phone_number: mapping,
				created_at: TimeValue.UNKNOWN_SECONDS,
				updated_at: TimeValue.UNKNOWN_SECONDS,
				learning_source: LidMapping.IMPORT_SOURCE
			})
		},
		toLegacy(key, value) {
			const parsed = parseLidMappingKey(key)
			if (parsed.direction === LidMapping.PN_DIRECTION) return Buffer.from(value).toString(JsonByteEncoding.UTF8)
			const native = fromJsonBytes(value) as { phone_number?: unknown }
			if (typeof native.phone_number !== 'string') throw new TypeError('native LID mapping has no phone number')
			return native.phone_number
		}
	}
}

export function createBasicCodecs(): Record<BasicCodecStore, LegacyCodec> {
	return {
		[NativeStore.PREKEY]: prekeyCodec(),
		[NativeStore.SYNC_KEY]: syncKeyCodec(),
		[NativeStore.SYNC_VERSION]: syncVersionCodec(),
		[NativeStore.TC_TOKEN]: tcTokenCodec(),
		[NativeStore.DEVICE_LIST]: deviceListCodec(),
		[NativeStore.IDENTITY]: identityCodec(),
		[NativeStore.LID_MAPPING]: lidMappingCodec()
	}
}
