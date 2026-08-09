/**
 * Single source of truth for the native-store/legacy-store boundary.
 * Types, routing and runtime validation are all derived from this catalog.
 */

export const RouteKind = Object.freeze({
	DEVICE: 'device',
	PROJECTED: 'projected',
	RAW: 'raw'
} as const)

export const NativeStore = Object.freeze({
	IDENTITY: 'identity',
	SESSION: 'session',
	PREKEY: 'prekey',
	SIGNED_PREKEY: 'signed_prekey',
	SENDER_KEY: 'sender_key',
	SYNC_KEY: 'sync_key',
	SYNC_VERSION: 'sync_version',
	MUTATION_MAC: 'mutation_mac',
	DEVICE: 'device',
	SENDER_KEY_DEVICES: 'sender_key_devices',
	LID_MAPPING: 'lid_mapping',
	BASE_KEY: 'base_key',
	DEVICE_LIST: 'device_list',
	TC_TOKEN: 'tc_token',
	SENT_MESSAGE: 'sent_message',
	MSG_SECRET: 'msg_secret',
	META: 'meta'
} as const)

export type NativeStoreName = (typeof NativeStore)[keyof typeof NativeStore]

export const LegacyStore = Object.freeze({
	IDENTITY: 'identity-key',
	SESSION: 'session',
	PREKEY: 'pre-key',
	SENDER_KEY: 'sender-key',
	SYNC_KEY: 'app-state-sync-key',
	SYNC_VERSION: 'app-state-sync-version',
	TC_TOKEN: 'tctoken',
	DEVICE_LIST: 'device-list',
	LID_MAPPING: 'lid-mapping'
} as const)

export const MirrorStore = Object.freeze({
	IDENTITY: 'bridge-native-identity',
	SESSION: 'bridge-native-session',
	PREKEY: 'bridge-native-prekey',
	SENDER_KEY: 'bridge-native-sender-key',
	SYNC_KEY: 'bridge-native-sync-key',
	SYNC_VERSION: 'bridge-native-sync-version',
	TC_TOKEN: 'bridge-native-tc-token',
	DEVICE_LIST: 'bridge-native-device-list',
	LID_MAPPING: 'bridge-native-lid-mapping',
	DEVICE: 'bridge-native-device'
} as const)

export const RawStore = Object.freeze({
	SIGNED_PREKEY: 'bridge-signed-prekey',
	SENDER_KEY_DEVICES: 'bridge-sender-key-devices',
	BASE_KEY: 'bridge-base-key',
	SENT_MESSAGE: 'bridge-sent-message',
	MSG_SECRET: 'bridge-msg-secret',
	MUTATION_MAC: 'bridge-mutation-mac',
	META: 'bridge-meta'
} as const)

export const DeviceRecordKey = Object.freeze({
	DEVICE: 'device',
	ACCOUNT: 'account'
} as const)

export type DeviceRecordKeyName = (typeof DeviceRecordKey)[keyof typeof DeviceRecordKey]

export const SignalDomainType = Object.freeze({
	PN: 0,
	LID: 1,
	HOSTED: 128,
	HOSTED_LID: 129
} as const)

export const SignalDomain = Object.freeze({
	C_US: 'c.us',
	PN: 's.whatsapp.net',
	GROUP: 'g.us',
	LID: 'lid',
	HOSTED: 'hosted',
	HOSTED_LID: 'hosted.lid'
} as const)

export const SignalAddressSyntax = Object.freeze({
	DOMAIN: '@',
	JID_DEVICE: ':',
	SIGNAL_DEVICE: '.',
	DOMAIN_TYPE: '_',
	SENDER_KEY_PART: '::'
} as const)

export const LidMapping = Object.freeze({
	PN_DIRECTION: 'pn',
	LID_DIRECTION: 'lid',
	LEGACY_REVERSE_SUFFIX: '_reverse',
	IMPORT_SOURCE: 'legacy-store-adapter'
} as const)

export const MirrorEnvelope = Object.freeze({
	MAGIC: 'BRSNAT01',
	NATIVE_ONLY_MAGIC: 'BRSNAT02',
	HASH: 'sha256'
} as const)

export const CanonicalTag = Object.freeze({
	BIGINT: '$bigint',
	BYTES: '$bytes',
	DATE: '$date',
	NUMBER: '$number',
	UNDEFINED: '$undefined',
	UNSUPPORTED: '$unsupported'
} as const)

export const NumericEncoding = Object.freeze({
	BASE_10: 10
} as const)

export const SignalKeyLength = Object.freeze({
	CURVE_PUBLIC_PREFIX: 0x05,
	CURVE_PUBLIC_PREFIXED: 33,
	CURVE_PRIVATE: 32,
	KEY_PAIR: 64,
	SIGNATURE: 64,
	ADV_SECRET: 32
} as const)

export const AppState = Object.freeze({
	HASH_LENGTH: 128
} as const)

// Container-recognition vocabulary only; role/counter/version semantics are
// owned by the core's legacy-session interop.
export const LegacySession = Object.freeze({
	VERSION: 'v1',
	OPEN: -1,
	CHAIN_SENDING: 1,
	CHAIN_RECEIVING: 2,
	BASE_KEY_THEIRS: 2
} as const)

export const TimeValue = Object.freeze({
	UNKNOWN_SECONDS: 0,
	UNKNOWN_MILLISECONDS: 0
} as const)

export const JsonByteEncoding = Object.freeze({
	UTF8: 'utf-8',
	BASE64: 'base64',
	HEX: 'hex'
} as const)

export const LegacyMultiFile = Object.freeze({
	CREDS_FILE: 'creds.json',
	EXTENSION: '.json',
	TYPE_SEPARATOR: '-',
	PATH_SEPARATOR_REPLACEMENT: '__',
	COLON_REPLACEMENT: '-'
} as const)

export const StoreCatalog = Object.freeze({
	[NativeStore.IDENTITY]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.IDENTITY,
		nativeType: MirrorStore.IDENTITY
	},
	[NativeStore.SESSION]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.SESSION,
		nativeType: MirrorStore.SESSION
	},
	[NativeStore.PREKEY]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.PREKEY,
		nativeType: MirrorStore.PREKEY
	},
	[NativeStore.SENDER_KEY]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.SENDER_KEY,
		nativeType: MirrorStore.SENDER_KEY
	},
	[NativeStore.SYNC_KEY]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.SYNC_KEY,
		nativeType: MirrorStore.SYNC_KEY
	},
	[NativeStore.SYNC_VERSION]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.SYNC_VERSION,
		nativeType: MirrorStore.SYNC_VERSION
	},
	[NativeStore.TC_TOKEN]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.TC_TOKEN,
		nativeType: MirrorStore.TC_TOKEN
	},
	[NativeStore.DEVICE_LIST]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.DEVICE_LIST,
		nativeType: MirrorStore.DEVICE_LIST
	},
	[NativeStore.LID_MAPPING]: {
		kind: RouteKind.PROJECTED,
		legacyType: LegacyStore.LID_MAPPING,
		nativeType: MirrorStore.LID_MAPPING
	},
	[NativeStore.DEVICE]: { kind: RouteKind.DEVICE, nativeType: MirrorStore.DEVICE },
	[NativeStore.SIGNED_PREKEY]: { kind: RouteKind.RAW, nativeType: RawStore.SIGNED_PREKEY },
	[NativeStore.SENDER_KEY_DEVICES]: { kind: RouteKind.RAW, nativeType: RawStore.SENDER_KEY_DEVICES },
	[NativeStore.BASE_KEY]: { kind: RouteKind.RAW, nativeType: RawStore.BASE_KEY },
	[NativeStore.SENT_MESSAGE]: { kind: RouteKind.RAW, nativeType: RawStore.SENT_MESSAGE },
	[NativeStore.MSG_SECRET]: { kind: RouteKind.RAW, nativeType: RawStore.MSG_SECRET },
	[NativeStore.MUTATION_MAC]: { kind: RouteKind.RAW, nativeType: RawStore.MUTATION_MAC },
	[NativeStore.META]: { kind: RouteKind.RAW, nativeType: RawStore.META }
} as const satisfies Record<NativeStoreName, { kind: string; nativeType: string; legacyType?: string }>)

export type ProjectedStoreName = {
	[K in NativeStoreName]: (typeof StoreCatalog)[K]['kind'] extends typeof RouteKind.PROJECTED ? K : never
}[NativeStoreName]
