import type {
	Jid as NativeJid,
	UsyncOutcome as NativeUsyncOutcome,
	UsyncProtocol as NativeUsyncProtocol,
	UsyncProtocolResult as NativeUsyncProtocolResult,
	UsyncQuery as NativeUsyncQuery,
	UsyncResponse as NativeUsyncResponse,
	UsyncSubprotocolError as NativeUsyncSubprotocolError,
	UsyncUser as NativeUsyncUser
} from '@oxidezap/whatsapp-rust-bridge'
import type { BinaryNode } from '../../Types/index.ts'
import type { USyncQueryProtocol } from '../../Types/USync.ts'
import { Boom } from '../../Utils/boom.ts'
import { USyncBotProfileProtocol } from '../../WAUSync/Protocols/USyncBotProfileProtocol.ts'
import { USyncContactProtocol } from '../../WAUSync/Protocols/USyncContactProtocol.ts'
import { USyncDeviceProtocol } from '../../WAUSync/Protocols/USyncDeviceProtocol.ts'
import { USyncDisappearingModeProtocol } from '../../WAUSync/Protocols/USyncDisappearingModeProtocol.ts'
import { USyncLIDProtocol } from '../../WAUSync/Protocols/USyncLIDProtocol.ts'
import { USyncStatusProtocol } from '../../WAUSync/Protocols/USyncStatusProtocol.ts'
import { USyncUsernameProtocol } from '../../WAUSync/Protocols/USyncUsernameProtocol.ts'
import { type USyncQuery, type USyncQueryResult, type USyncQueryResultList } from '../../WAUSync/USyncQuery.ts'
import type { USyncUser } from '../../WAUSync/USyncUser.ts'
import { bridgeJidToString } from '../../Bridge/primitives.ts'
import { jidDecode } from '../../WABinary/jid-utils.ts'

export type RawUSyncQuery = (node: BinaryNode, timeoutMs?: number) => Promise<BinaryNode>
export type TypedUSyncQuery = (query: NativeUsyncQuery) => Promise<NativeUsyncResponse>

const isUSyncMode = (value: string): value is NativeUsyncQuery['mode'] =>
	value === 'query' || value === 'full' || value === 'delta'

const isUSyncContext = (value: string): value is NativeUsyncQuery['context'] =>
	value === 'interactive' || value === 'background' || value === 'message' || value === 'voip'

const isExactProtocol = <Protocol extends object>(
	value: object,
	protocolClass: { prototype: Protocol }
): value is Protocol => Object.getPrototypeOf(value) === protocolClass.prototype

const toNativeProtocol = (protocol: USyncQueryProtocol): NativeUsyncProtocol | undefined => {
	if (isExactProtocol(protocol, USyncContactProtocol)) {
		return { type: 'contact', data: { addressing_mode: 'pn' } }
	}
	if (isExactProtocol(protocol, USyncDeviceProtocol)) return { type: 'devices' }
	if (isExactProtocol(protocol, USyncStatusProtocol)) return { type: 'status' }
	if (isExactProtocol(protocol, USyncDisappearingModeProtocol)) return { type: 'disappearing_mode' }
	if (isExactProtocol(protocol, USyncBotProfileProtocol)) return { type: 'bot' }
	if (isExactProtocol(protocol, USyncLIDProtocol)) return { type: 'lid' }
	if (isExactProtocol(protocol, USyncUsernameProtocol)) return { type: 'username' }
	return undefined
}

const supportedUSyncServers = new Set(['s.whatsapp.net', 'lid', 'hosted', 'hosted.lid', 'msgr', 'interop', 'bot'])

const toNativeJid = (value: string): NativeJid | undefined => {
	const decoded = jidDecode(value)
	if (!decoded?.user) return undefined
	const decodedServer = decoded.server as string
	const server = decodedServer === 'c.us' ? 's.whatsapp.net' : decodedServer
	if (!supportedUSyncServers.has(server)) return undefined
	return {
		user: decoded.user,
		server,
		agent: 0,
		device: decoded.device ?? 0,
		integrator: 0
	}
}

interface SelectedProtocols {
	contact: boolean
	lid: boolean
	bot: boolean
}

const toNativeUser = (user: USyncUser, selected: SelectedProtocols): NativeUsyncUser | undefined => {
	const native: NativeUsyncUser = {}

	// Preserve the public protocol's precedence: a phone query suppresses the
	// user-level JID, then contact username/type inputs are mutually exclusive.
	if (user.phone) native.phone = user.phone
	else if (user.id) {
		const id = toNativeJid(user.id)
		if (!id) return undefined
		native.id = id
	}

	if (selected.contact) {
		if (!user.phone && user.username) {
			native.username = user.username
			if (user.usernameKey) native.username_pin = user.usernameKey
		} else if (!user.phone && user.type) {
			native.contact_type = user.type
		}
	}

	const contactUsesUsername = selected.contact && !user.phone && !!user.username
	if (user.lid && (selected.lid || contactUsesUsername)) {
		const lid = toNativeJid(user.lid)
		if (!lid || (lid.server !== 'lid' && lid.server !== 'hosted.lid')) return undefined
		native.known_lid = lid
	}

	if (selected.bot && user.personaId) native.persona_id = user.personaId

	// The neutral core requires an actual query identity. Inputs that rely on
	// custom/legacy raw-node behavior stay on the explicit fallback path.
	if (!native.id && !native.phone && !native.username) return undefined
	return native
}

/**
 * Project the known public USync builders into the generated neutral schema.
 * `undefined` deliberately means “use the raw compatibility escape hatch”.
 */
export const toTypedUSyncQuery = (query: USyncQuery): NativeUsyncQuery | undefined => {
	if (!isUSyncMode(query.mode) || !isUSyncContext(query.context) || query.users.length === 0) return undefined

	const protocols: NativeUsyncProtocol[] = []
	const protocolTypes = new Set<NativeUsyncProtocol['type']>()
	for (const protocol of query.protocols) {
		const native = toNativeProtocol(protocol)
		if (!native || protocolTypes.has(native.type)) return undefined
		protocolTypes.add(native.type)
		protocols.push(native)
	}
	if (protocols.length === 0) return undefined

	const selected: SelectedProtocols = {
		contact: protocolTypes.has('contact'),
		lid: protocolTypes.has('lid'),
		bot: protocolTypes.has('bot')
	}
	const users: NativeUsyncUser[] = []
	for (const user of query.users) {
		const native = toNativeUser(user, selected)
		if (!native) return undefined
		users.push(native)
	}

	return {
		mode: query.mode,
		context: query.context,
		protocols,
		users
	}
}

const throwSubprotocolError = (error: NativeUsyncSubprotocolError): never => {
	throw new Boom(error.text || 'Unknown error', {
		statusCode: error.code ?? 500,
		data: error.code
	})
}

const unwrapOutcome = <Value>(outcome: NativeUsyncOutcome<Value>): Value => {
	if (outcome.type === 'error') return throwSubprotocolError(outcome.data)
	return outcome.data
}

const numberValue = (value: number | string): number => Number(value)

const publicProtocolName = (result: NativeUsyncProtocolResult): string => {
	switch (result.type) {
		case 'contact':
		case 'devices':
		case 'status':
		case 'text_status':
		case 'disappearing_mode':
		case 'business':
		case 'picture':
		case 'lid':
		case 'username':
		case 'bot':
		case 'feature':
			return result.type
		default:
			return result satisfies never
	}
}

const mapProtocolResult = (
	result: NativeUsyncProtocolResult,
	id: string,
	requested: ReadonlySet<string>
): readonly [string, unknown] | undefined => {
	const protocolName = publicProtocolName(result)
	if (!requested.has(protocolName)) return undefined

	switch (result.type) {
		case 'contact': {
			const value = unwrapOutcome(result.data)
			return ['contact', value.contact_type === 'in']
		}
		case 'devices': {
			const value = unwrapOutcome(result.data)
			const deviceList = (value.device_list?.devices ?? []).map(device => ({
				id: device.id,
				// The public parser always materializes this property and obtains
				// NaN when the wire attribute is absent.
				keyIndex: device.key_index ?? Number.NaN,
				isHosted: device.is_hosted
			}))
			const keyIndex = value.key_index
				? {
						timestamp: numberValue(value.key_index.timestamp),
						signedKeyIndex: value.key_index.signed_key_index_bytes ?? undefined,
						expectedTimestamp:
							value.key_index.expected_timestamp === null || value.key_index.expected_timestamp === undefined
								? undefined
								: numberValue(value.key_index.expected_timestamp)
					}
				: undefined
			return ['devices', { deviceList, keyIndex }]
		}
		case 'status': {
			const value = unwrapOutcome(result.data)
			return [
				'status',
				{
					status: value.status ?? null,
					setAt: new Date(numberValue(value.timestamp ?? 0) * 1000)
				}
			]
		}
		case 'disappearing_mode': {
			const value = unwrapOutcome(result.data)
			return [
				'disappearing_mode',
				{
					duration: value.duration_seconds,
					setAt: new Date(numberValue(value.setting_timestamp) * 1000)
				}
			]
		}
		case 'lid': {
			// The public LID parser does not inspect the protocol error child;
			// an absent `val` therefore becomes an included `undefined` value.
			if (result.data.type === 'error') return ['lid', undefined]
			return ['lid', result.data.data ? bridgeJidToString(result.data.data) : undefined]
		}
		case 'username': {
			const value = unwrapOutcome(result.data)
			// The public result reducer removes a parser result equal to null.
			return value === null ? undefined : ['username', value]
		}
		case 'bot': {
			const value = unwrapOutcome(result.data)
			return [
				'bot',
				{
					jid: id,
					name: value.name,
					attributes: value.attributes,
					description: value.description,
					category: value.category,
					isDefault: value.is_default,
					prompts: value.prompts.map(prompt => `${prompt.emoji} ${prompt.text}`),
					personaId: value.persona_id,
					commands: value.commands,
					commandsDescription: value.commands_description
				}
			]
		}
		// No public builder/parser exists for these neutral variants. If the
		// server adds one unsolicited, the public parser ignores it too.
		case 'text_status':
		case 'business':
		case 'picture':
		case 'feature':
			return undefined
		default:
			return result satisfies never
	}
}

export const fromTypedUSyncResponse = (query: USyncQuery, response: NativeUsyncResponse): USyncQueryResult => {
	const requested = new Set(query.protocols.map(protocol => protocol.name))
	const list: USyncQueryResultList[] = []
	for (const user of response.users) {
		if (!user.id) continue
		const id = bridgeJidToString(user.id)
		const entry: USyncQueryResultList = { id }
		for (const result of user.protocols) {
			const mapped = mapProtocolResult(result, id, requested)
			if (mapped) entry[mapped[0]] = mapped[1]
		}
		list.push(entry)
	}
	return { list, sideList: [] }
}

/** Build only the caller-defined/raw compatibility request. Official paths use the typed operation. */
const buildRawUSyncNode = (query: USyncQuery): BinaryNode => {
	const users: BinaryNode[] = query.users.map(user => {
		const content: BinaryNode[] = []
		const attrs: BinaryNode['attrs'] = {}
		if (!user.phone && user.id) attrs.jid = user.id
		for (const protocol of query.protocols) {
			const element = protocol.getUserElement(user)
			if (element) content.push(element)
		}
		return { tag: 'user', attrs, content }
	})

	return {
		tag: 'iq',
		attrs: { to: 's.whatsapp.net', type: 'get', xmlns: 'usync' },
		content: [
			{
				tag: 'usync',
				attrs: { context: query.context, mode: query.mode, last: 'true', index: '0' },
				content: [
					{ tag: 'query', attrs: {}, content: query.protocols.map(protocol => protocol.getQueryElement()) },
					{ tag: 'list', attrs: {}, content: users }
				]
			}
		]
	}
}

export const executeRawUSyncQuery = async (
	query: USyncQuery,
	send: RawUSyncQuery
): Promise<USyncQueryResult | undefined> => query.parseUSyncQueryResult(await send(buildRawUSyncNode(query)))
