// Key-name routing belongs to the Baileys legacy-store adapter.
import { Buffer } from 'node:buffer'
import {
	JsonByteEncoding,
	LidMapping,
	NativeStore,
	RouteKind,
	SenderKeyDomains,
	SignalAddressSyntax,
	SignalDomain,
	SignalDomainType,
	StoreCatalog,
	type NativeStoreName
} from './constants.ts'
import type { ProjectedStoreName } from './constants.ts'
import type { StoreRoute } from './types.ts'
import { parseUnsignedDecimal } from './validation.ts'

const nativeStoreNames = new Set<NativeStoreName>(Object.values(NativeStore))

export function parseNativeStoreName(value: string): NativeStoreName {
	if (nativeStoreNames.has(value as NativeStoreName)) return value as NativeStoreName
	throw new RangeError(`unsupported native store namespace: ${value}`)
}

export function resolveRoute(store: NativeStoreName): StoreRoute {
	return StoreCatalog[store]
}

const domainTypes = Object.freeze({
	[SignalDomain.C_US]: SignalDomainType.PN,
	[SignalDomain.PN]: SignalDomainType.PN,
	[SignalDomain.LID]: SignalDomainType.LID,
	[SignalDomain.HOSTED]: SignalDomainType.HOSTED,
	[SignalDomain.HOSTED_LID]: SignalDomainType.HOSTED_LID
} as const)

type ParsedSignalAddress = {
	user: string
	domainType: number
	device: string
}

const HEXADECIMAL = /^(?:[\da-fA-F]{2})+$/

function parseBridgeSignalAddress(address: string): ParsedSignalAddress {
	const signalSeparator = address.lastIndexOf(SignalAddressSyntax.SIGNAL_DEVICE)
	const domainSeparator = address.lastIndexOf(SignalAddressSyntax.DOMAIN, signalSeparator)
	if (signalSeparator <= domainSeparator || domainSeparator <= 0) {
		throw new TypeError(`invalid native Signal address: ${address}`)
	}

	const signalDevice = address.slice(signalSeparator + SignalAddressSyntax.SIGNAL_DEVICE.length)
	const domain = address.slice(domainSeparator + SignalAddressSyntax.DOMAIN.length, signalSeparator)
	const domainType = domainTypes[domain as keyof typeof domainTypes]
	if (domainType === undefined) {
		throw new TypeError(`invalid native Signal address: ${address}`)
	}
	parseUnsignedDecimal(signalDevice, 'Signal device')

	const userAndDevice = address.slice(0, domainSeparator)
	const jidDeviceSeparator = userAndDevice.lastIndexOf(SignalAddressSyntax.JID_DEVICE)
	const user = jidDeviceSeparator < 0 ? userAndDevice : userAndDevice.slice(0, jidDeviceSeparator)
	const jidDevice = jidDeviceSeparator < 0 ? null : userAndDevice.slice(jidDeviceSeparator + 1)
	parseUnsignedDecimal(user, 'Signal user')
	if (jidDevice !== null) parseUnsignedDecimal(jidDevice, 'JID device')

	return { user, domainType, device: jidDevice ?? signalDevice }
}

function legacySignalAddress(address: string): string {
	const parsed = parseBridgeSignalAddress(address)
	const user =
		parsed.domainType === SignalDomainType.PN
			? parsed.user
			: `${parsed.user}${SignalAddressSyntax.DOMAIN_TYPE}${parsed.domainType}`
	return `${user}${SignalAddressSyntax.SIGNAL_DEVICE}${parsed.device}`
}

function legacySenderKey(key: string): string {
	// A sender key is `<chatJid>:<signalAddress>`, and the chat is not always a
	// group: status updates and broadcast lists fan out through the very same
	// mechanism, so `status@broadcast:<address>` is a legitimate address that
	// reaches this translator. Anchoring only on `@g.us:` made every one of them
	// throw, and because the throw happens inside a storage operation it takes
	// down whatever triggered it — a `sendMessage` to an unrelated group, for
	// instance.
	for (const domain of SenderKeyDomains) {
		const terminator = `${SignalAddressSyntax.DOMAIN}${domain}${SignalAddressSyntax.JID_DEVICE}`
		const chatEnd = key.indexOf(terminator)
		if (chatEnd < 0) continue
		const addressStart = chatEnd + terminator.length
		const chat = key.slice(0, addressStart - SignalAddressSyntax.JID_DEVICE.length)
		const address = legacySignalAddress(key.slice(addressStart))
		const deviceSeparator = address.lastIndexOf(SignalAddressSyntax.SIGNAL_DEVICE)
		return [chat, address.slice(0, deviceSeparator), address.slice(deviceSeparator + 1)].join(
			SignalAddressSyntax.SENDER_KEY_PART
		)
	}

	throw new TypeError(`invalid native sender-key address: ${key}`)
}

const passthroughKey = (_store: ProjectedStoreName, key: string): string => key

const keyTranslators = Object.freeze({
	[NativeStore.IDENTITY]: (_store: ProjectedStoreName, key: string) => legacySignalAddress(key),
	[NativeStore.SESSION]: (_store: ProjectedStoreName, key: string) => legacySignalAddress(key),
	[NativeStore.PREKEY]: passthroughKey,
	[NativeStore.SENDER_KEY]: (_store: ProjectedStoreName, key: string) => legacySenderKey(key),
	[NativeStore.SYNC_KEY]: (_store: ProjectedStoreName, key: string) => {
		if (!HEXADECIMAL.test(key)) throw new TypeError(`invalid hexadecimal sync-key id: ${key}`)
		return Buffer.from(key, JsonByteEncoding.HEX).toString(JsonByteEncoding.BASE64)
	},
	[NativeStore.SYNC_VERSION]: passthroughKey,
	[NativeStore.TC_TOKEN]: passthroughKey,
	[NativeStore.DEVICE_LIST]: passthroughKey,
	[NativeStore.LID_MAPPING]: (_store: ProjectedStoreName, key: string) => {
		const parsed = parseLidMappingKey(key)
		return parsed.direction === LidMapping.PN_DIRECTION
			? parsed.user
			: `${parsed.user}${LidMapping.LEGACY_REVERSE_SUFFIX}`
	}
} satisfies Record<ProjectedStoreName, (store: ProjectedStoreName, key: string) => string>)

const legacyStoreRoutes = new Map<string, ProjectedStoreName>()
for (const store of Object.values(NativeStore)) {
	const route = StoreCatalog[store]
	if (route.kind === RouteKind.PROJECTED) legacyStoreRoutes.set(route.legacyType, store as ProjectedStoreName)
}

const nativeDomains: Readonly<Record<number, string>> = Object.freeze({
	[SignalDomainType.PN]: SignalDomain.C_US,
	[SignalDomainType.LID]: SignalDomain.LID,
	[SignalDomainType.HOSTED]: SignalDomain.HOSTED,
	[SignalDomainType.HOSTED_LID]: SignalDomain.HOSTED_LID
})

function nativeSignalAddress(address: string): string {
	const separator = address.lastIndexOf(SignalAddressSyntax.SIGNAL_DEVICE)
	if (separator <= 0) throw new TypeError(`invalid legacy Signal address: ${address}`)
	const signalUser = address.slice(0, separator)
	const device = address.slice(separator + SignalAddressSyntax.SIGNAL_DEVICE.length)
	parseUnsignedDecimal(device, 'Signal device')

	const domainSeparator = signalUser.lastIndexOf(SignalAddressSyntax.DOMAIN_TYPE)
	const hasDomain = domainSeparator > 0
	const user = hasDomain ? signalUser.slice(0, domainSeparator) : signalUser
	const domainType = hasDomain
		? parseUnsignedDecimal(signalUser.slice(domainSeparator + 1), 'Signal domain type')
		: SignalDomainType.PN
	parseUnsignedDecimal(user, 'Signal user')
	const domain = nativeDomains[domainType]
	if (!domain) throw new TypeError(`unsupported legacy Signal domain type: ${domainType}`)
	const jidDevice = device === '0' ? '' : `${SignalAddressSyntax.JID_DEVICE}${device}`
	return `${user}${jidDevice}${SignalAddressSyntax.DOMAIN}${domain}${SignalAddressSyntax.SIGNAL_DEVICE}0`
}

function nativeSenderKey(key: string): string {
	const parts = key.split(SignalAddressSyntax.SENDER_KEY_PART)
	if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
		throw new TypeError(`invalid legacy sender-key address: ${key}`)
	}
	return `${parts[0]}${SignalAddressSyntax.JID_DEVICE}${nativeSignalAddress(`${parts[1]}.${parts[2]}`)}`
}

const inverseKeyTranslators = Object.freeze({
	[NativeStore.IDENTITY]: (_store: ProjectedStoreName, key: string) => nativeSignalAddress(key),
	[NativeStore.SESSION]: (_store: ProjectedStoreName, key: string) => nativeSignalAddress(key),
	[NativeStore.PREKEY]: passthroughKey,
	[NativeStore.SENDER_KEY]: (_store: ProjectedStoreName, key: string) => nativeSenderKey(key),
	[NativeStore.SYNC_KEY]: (_store: ProjectedStoreName, key: string) =>
		Buffer.from(key, JsonByteEncoding.BASE64).toString(JsonByteEncoding.HEX),
	[NativeStore.SYNC_VERSION]: passthroughKey,
	[NativeStore.TC_TOKEN]: passthroughKey,
	[NativeStore.DEVICE_LIST]: passthroughKey,
	[NativeStore.LID_MAPPING]: (_store: ProjectedStoreName, key: string) =>
		key.endsWith(LidMapping.LEGACY_REVERSE_SUFFIX)
			? `${LidMapping.LID_DIRECTION}:${key.slice(0, -LidMapping.LEGACY_REVERSE_SUFFIX.length)}`
			: `${LidMapping.PN_DIRECTION}:${key}`
} satisfies Record<ProjectedStoreName, (store: ProjectedStoreName, key: string) => string>)

export function legacyKey(store: ProjectedStoreName, key: string): string {
	return keyTranslators[store](store, key)
}

export function nativeKey(store: ProjectedStoreName, key: string): string {
	return inverseKeyTranslators[store](store, key)
}

export function projectedStoreForLegacyType(type: string): ProjectedStoreName | null {
	return legacyStoreRoutes.get(type) ?? null
}

export function isProjectedStoreName(store: NativeStoreName): store is ProjectedStoreName {
	return StoreCatalog[store].kind === RouteKind.PROJECTED
}

export type ParsedLidMappingKey = {
	direction: typeof LidMapping.PN_DIRECTION | typeof LidMapping.LID_DIRECTION
	user: string
}

export function parseLidMappingKey(key: string): ParsedLidMappingKey {
	const separator = key.indexOf(SignalAddressSyntax.JID_DEVICE)
	if (separator <= 0) throw new TypeError(`invalid native LID mapping key: ${key}`)
	const direction = key.slice(0, separator)
	const user = key.slice(separator + SignalAddressSyntax.JID_DEVICE.length)
	parseUnsignedDecimal(user, 'LID mapping user')
	if (direction !== LidMapping.PN_DIRECTION && direction !== LidMapping.LID_DIRECTION) {
		throw new TypeError(`invalid native LID mapping direction: ${direction}`)
	}
	return { direction, user }
}

export function isProjectedRoute(
	route: StoreRoute
): route is Extract<StoreRoute, { kind: typeof RouteKind.PROJECTED }> {
	return route.kind === RouteKind.PROJECTED
}
