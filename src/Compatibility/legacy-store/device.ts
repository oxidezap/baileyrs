// Device credential projection for legacy Baileys authentication states.
import { Buffer } from 'node:buffer'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import { WA_DEFAULT_VERSION } from '../../Defaults/index.ts'
import type { AuthenticationCreds } from '../../Types/index.ts'
import { jidDecode, jidEncode, type JidServer } from '../../WABinary/jid-utils.ts'
import {
	DeviceRecordKey,
	JsonByteEncoding,
	SignalDomain,
	SignalKeyLength,
	TimeValue,
	type DeviceRecordKeyName
} from './constants.ts'
import { bytesToNumbers, fromJsonBytes, toJsonBytes } from './common.ts'
import { isAllZero, requireByteArray, requireSafeUnsignedInteger } from './validation.ts'

const signedDeviceIdentityCodec = proto.ADVSignedDeviceIdentity

const AD_DOMAINS = new Set<string>([
	SignalDomain.C_US,
	SignalDomain.PN,
	SignalDomain.LID,
	SignalDomain.HOSTED,
	SignalDomain.HOSTED_LID
])
const [APP_VERSION_PRIMARY, APP_VERSION_SECONDARY, APP_VERSION_TERTIARY] = WA_DEFAULT_VERSION

const copyOptionalBytes = (value: Uint8Array | null | undefined): Uint8Array | undefined =>
	value ? new Uint8Array(value) : undefined

interface NativeJid {
	user: string
	server: string
	device?: number
	agent?: number
	integrator?: number
}

interface NativeDevice {
	pn?: NativeJid | null
	lid?: NativeJid | null
	registration_id?: number
	push_name?: string
	next_pre_key_id?: number
	props_hash?: string | null
	platform?: string
	adv_secret_key?: number[]
	noise_key?: number[]
	identity_key?: number[]
	signed_pre_key?: number[]
	signed_pre_key_id?: number
	signed_pre_key_signature?: number[]
	edge_routing_info?: number[] | null
}

function keyPairToNumbers(pair: { public: Uint8Array; private: Uint8Array } | undefined): number[] {
	if (!pair) return Array<number>(SignalKeyLength.KEY_PAIR).fill(0)
	if (pair.private.length !== SignalKeyLength.CURVE_PRIVATE || pair.public.length !== SignalKeyLength.CURVE_PRIVATE) {
		throw new TypeError('legacy key pair must contain two 32-byte keys')
	}
	return [...bytesToNumbers(pair.private), ...bytesToNumbers(pair.public)]
}

function numbersToKeyPair(
	value: number[] | undefined,
	label: string
): { public: Uint8Array; private: Uint8Array } | undefined {
	if (value === undefined) return undefined
	const bytes = requireByteArray(value, label)
	if (bytes.length !== SignalKeyLength.KEY_PAIR) throw new TypeError(`${label} must contain 64 bytes`)
	if (bytes.every(byte => byte === 0)) return undefined
	return {
		private: new Uint8Array(bytes.slice(0, SignalKeyLength.CURVE_PRIVATE)),
		public: new Uint8Array(bytes.slice(SignalKeyLength.CURVE_PRIVATE))
	}
}

function nativeJidToString(value: NativeJid | null | undefined): string | null {
	if (!value?.user || !value.server) return null
	return jidEncode(value.user, value.server as JidServer, value.device ?? TimeValue.UNKNOWN_SECONDS)
}

function legacyJidToNative(value: string | undefined): NativeJid | null {
	const decoded = jidDecode(value)
	if (!decoded) return null
	return {
		user: decoded.user,
		server: decoded.server,
		device: decoded.device ?? TimeValue.UNKNOWN_SECONDS,
		agent: AD_DOMAINS.has(decoded.server)
			? TimeValue.UNKNOWN_SECONDS
			: (decoded.domainType ?? TimeValue.UNKNOWN_SECONDS),
		integrator: TimeValue.UNKNOWN_SECONDS
	}
}

function deviceFromCreds(creds: AuthenticationCreds): Uint8Array | null {
	if (!creds.me?.id || isAllZero(creds.noiseKey?.private) || isAllZero(creds.signedIdentityKey?.private)) return null
	const pn = legacyJidToNative(creds.me.id)
	const lid = legacyJidToNative(creds.me.lid)
	return toJsonBytes({
		pn,
		lid,
		registration_id: creds.registrationId ?? TimeValue.UNKNOWN_SECONDS,
		noise_key: keyPairToNumbers(creds.noiseKey),
		identity_key: keyPairToNumbers(creds.signedIdentityKey),
		signed_pre_key: keyPairToNumbers(creds.signedPreKey?.keyPair),
		signed_pre_key_id: creds.signedPreKey?.keyId ?? TimeValue.UNKNOWN_SECONDS,
		signed_pre_key_signature: creds.signedPreKey?.signature
			? bytesToNumbers(creds.signedPreKey.signature)
			: Array<number>(SignalKeyLength.SIGNATURE).fill(0),
		adv_secret_key: creds.advSecretKey
			? bytesToNumbers(Buffer.from(creds.advSecretKey, JsonByteEncoding.BASE64))
			: Array<number>(SignalKeyLength.ADV_SECRET).fill(0),
		account: null,
		push_name: creds.me.name ?? '',
		app_version_primary: APP_VERSION_PRIMARY,
		app_version_secondary: APP_VERSION_SECONDARY,
		app_version_tertiary: APP_VERSION_TERTIARY,
		app_version_last_fetched_ms: TimeValue.UNKNOWN_MILLISECONDS,
		edge_routing_info: creds.routingInfo ? bytesToNumbers(creds.routingInfo) : null,
		props_hash: creds.lastPropHash ?? null,
		next_pre_key_id: creds.nextPreKeyId ?? TimeValue.UNKNOWN_SECONDS
	})
}

const accountBytes = (creds: AuthenticationCreds): Uint8Array | null => {
	if (!creds.account) return null
	return signedDeviceIdentityCodec
		.encode({
			details: copyOptionalBytes(creds.account.details),
			accountSignatureKey: copyOptionalBytes(creds.account.accountSignatureKey),
			accountSignature: copyOptionalBytes(creds.account.accountSignature),
			deviceSignature: copyOptionalBytes(creds.account.deviceSignature)
		})
		.finish()
}

function prepareNativeDevice(payload: Uint8Array): (creds: AuthenticationCreds) => void {
	const native = fromJsonBytes(payload) as NativeDevice
	const pn = nativeJidToString(native.pn)
	const lid = nativeJidToString(native.lid)
	const registrationId =
		native.registration_id === undefined
			? undefined
			: requireSafeUnsignedInteger(native.registration_id, 'device registration id')
	const nextPreKeyId =
		native.next_pre_key_id === undefined
			? undefined
			: requireSafeUnsignedInteger(native.next_pre_key_id, 'next pre-key id')
	const noiseKey = numbersToKeyPair(native.noise_key, 'noise key pair')
	const identityKey = numbersToKeyPair(native.identity_key, 'identity key pair')
	const signedPreKey = numbersToKeyPair(native.signed_pre_key, 'signed pre-key pair')
	const signature =
		native.signed_pre_key_signature === undefined
			? undefined
			: requireByteArray(native.signed_pre_key_signature, 'signed pre-key signature')
	if (signature && signature.length !== SignalKeyLength.SIGNATURE) {
		throw new TypeError('signed pre-key signature must contain 64 bytes')
	}
	const advSecret =
		native.adv_secret_key === undefined ? undefined : requireByteArray(native.adv_secret_key, 'adv secret key')
	if (advSecret && advSecret.length !== SignalKeyLength.ADV_SECRET) {
		throw new TypeError('adv secret key must contain 32 bytes')
	}
	const routingInfo =
		native.edge_routing_info == null
			? native.edge_routing_info
			: requireByteArray(native.edge_routing_info, 'routing info')

	return creds => {
		// Upstream marks the initial Signal material readonly on the public
		// credential contract. Native-state hydration is the one internal owner
		// allowed to replace that material after reading Rust's persisted device.
		const mutableCreds = creds as { -readonly [K in keyof AuthenticationCreds]: AuthenticationCreds[K] }
		if (pn) {
			mutableCreds.me = { ...creds.me, id: pn }
			mutableCreds.registered = true
		}
		if (lid && creds.me) creds.me.lid = lid
		if (typeof native.push_name === 'string' && creds.me) creds.me.name = native.push_name
		if (registrationId !== undefined) mutableCreds.registrationId = registrationId
		if (nextPreKeyId !== undefined) {
			creds.nextPreKeyId = nextPreKeyId
			creds.firstUnuploadedPreKeyId = nextPreKeyId
		}
		if (native.props_hash !== undefined) creds.lastPropHash = native.props_hash ?? undefined
		if (typeof native.platform === 'string') creds.platform = native.platform
		if (noiseKey) mutableCreds.noiseKey = noiseKey
		if (identityKey) mutableCreds.signedIdentityKey = identityKey
		if (signedPreKey && signature?.some(byte => byte !== 0)) {
			mutableCreds.signedPreKey = {
				keyPair: signedPreKey,
				keyId: native.signed_pre_key_id ?? TimeValue.UNKNOWN_SECONDS,
				signature: new Uint8Array(signature)
			}
		}
		if (advSecret?.some(byte => byte !== 0)) {
			creds.advSecretKey = Buffer.from(advSecret).toString(JsonByteEncoding.BASE64)
		}
		if (routingInfo === null) creds.routingInfo = undefined
		else if (routingInfo) creds.routingInfo = Buffer.from(routingInfo)
	}
}

export type DeviceProjection = {
	read(key: DeviceRecordKeyName): Uint8Array | null
	prepare(key: DeviceRecordKeyName, payload: Uint8Array): () => void
}

export function parseDeviceRecordKey(value: string): DeviceRecordKeyName {
	if (value === DeviceRecordKey.DEVICE || value === DeviceRecordKey.ACCOUNT) return value
	throw new RangeError(`unsupported device record key: ${value}`)
}

export function createDeviceProjection(creds: AuthenticationCreds): DeviceProjection {
	return {
		read(key) {
			return key === DeviceRecordKey.DEVICE ? deviceFromCreds(creds) : accountBytes(creds)
		},
		prepare(key, payload) {
			if (key === DeviceRecordKey.DEVICE) {
				const apply = prepareNativeDevice(payload)
				return () => apply(creds)
			}
			const account = signedDeviceIdentityCodec.decode(payload)
			return () => {
				creds.account = account
			}
		}
	}
}
