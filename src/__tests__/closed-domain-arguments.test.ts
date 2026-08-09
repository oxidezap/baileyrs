/**
 * An argument outside a closed set is the caller's mistake, and the report of
 * it has to reach the caller.
 *
 * Reported from production: `groupParticipantsUpdate(from, [id], '☠️')`, called
 * from a `setTimeout` with neither `await` nor `.catch`. The value crossed into
 * the bridge untouched and the core's deserializer rejected it, so the consumer
 * got an `unhandledRejection` whose every frame is `wasm://wasm/<hash>` and
 * whose text is the Rust variant error. Nothing in it points at the line that
 * made the call, and that line is a one-word fix once you can find it.
 *
 * So the contract pinned here is: the rejection names the parameter, lists the
 * accepted values, shows what arrived, and carries a stack with the call site
 * in it. The last one is only possible if the check runs in the synchronous
 * prefix of the method, before the first `await`: a fire-and-forget call has no
 * awaiting frame for V8 to stitch an async stack onto, so anything thrown after
 * the boundary reports frames the consumer never wrote.
 *
 * Everything here drives the real public socket, pointed at a port nothing
 * listens on. A value that passes validation fails downstream as "not
 * connected" rather than reaching a server, which is the distinction these
 * tests need: rejected-by-us versus not-rejected-by-us.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import P from 'pino'

import makeWASocket from '../Socket/index.ts'
import { downloadMediaMessage } from '../Utils/messages.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { bridgeStringUnion, loadBridgeDts } from './bridge-dts.ts'
import { expect } from './expect.ts'

type Socket = ReturnType<typeof makeWASocket>

/** Pass an off-union value through a typed parameter, the way plain JS does. */
const arg = <T>(value: unknown): T => value as T

const GROUP = '120363000000000000@g.us'
const USER = '15550000000@s.whatsapp.net'
const NEWSLETTER = '120363000000000001@newsletter'

/** Every media type upstream names, which is what `waUploadToServer` takes. */
const MEDIA_TYPES = [
	'audio',
	'document',
	'gif',
	'image',
	'ppic',
	'product',
	'ptt',
	'sticker',
	'video',
	'thumbnail-document',
	'thumbnail-image',
	'thumbnail-video',
	'thumbnail-link',
	'md-msg-hist',
	'md-app-state',
	'product-catalog-image',
	'payment-bg-image',
	'ptv',
	'biz-cover-photo'
]

const RECEIPT_TYPES = ['read', 'read-self', 'hist_sync', 'peer_msg', 'sender', 'inactive', 'played', undefined]

const PRIVACY_VALUES = ['all', 'contacts', 'contact_blacklist', 'none']

interface DomainCase {
	/** The name the message uses, which is the method a consumer called. */
	label: string
	parameter: string
	/** Every value the method accepts, as the message must list them. */
	values: ReadonlyArray<string | undefined>
	call: (sock: Socket, value: unknown) => Promise<unknown>
	/** `file.ts:method:parameter`, as the source scan below spells it. */
	source?: string
	/** The parameter has a default, so omitting it is not passing a value. */
	defaulted?: boolean
}

const CASES: DomainCase[] = [
	{
		label: 'groupParticipantsUpdate',
		parameter: 'action',
		values: ['add', 'remove', 'promote', 'demote', 'modify'],
		call: (sock, value) => sock.groupParticipantsUpdate(GROUP, [USER], arg(value)),
		source: 'groups.ts:groupParticipantsUpdate:action'
	},
	{
		label: 'communityParticipantsUpdate',
		parameter: 'action',
		values: ['add', 'remove', 'promote', 'demote', 'modify'],
		call: (sock, value) => sock.communityParticipantsUpdate(GROUP, [USER], arg(value)),
		source: 'communities.ts:communityParticipantsUpdate:action'
	},
	{
		label: 'groupRequestParticipantsUpdate',
		parameter: 'action',
		values: ['approve', 'reject'],
		call: (sock, value) => sock.groupRequestParticipantsUpdate(GROUP, [USER], arg(value)),
		source: 'groups.ts:groupRequestParticipantsUpdate:action'
	},
	{
		label: 'groupSettingUpdate',
		parameter: 'setting',
		values: ['announcement', 'not_announcement', 'locked', 'unlocked'],
		call: (sock, value) => sock.groupSettingUpdate(GROUP, arg(value)),
		source: 'groups.ts:groupSettingUpdate:setting'
	},
	{
		label: 'groupMemberAddMode',
		parameter: 'mode',
		values: ['admin_add', 'all_member_add'],
		call: (sock, value) => sock.groupMemberAddMode(GROUP, arg(value)),
		source: 'groups.ts:groupMemberAddMode:mode'
	},
	{
		label: 'groupJoinApprovalMode',
		parameter: 'mode',
		values: ['on', 'off'],
		call: (sock, value) => sock.groupJoinApprovalMode(GROUP, arg(value)),
		source: 'groups.ts:groupJoinApprovalMode:mode'
	},
	{
		label: 'updateLastSeenPrivacy',
		parameter: 'value',
		values: PRIVACY_VALUES,
		call: (sock, value) => sock.updateLastSeenPrivacy(arg(value)),
		source: 'privacy.ts:updateLastSeenPrivacy:value'
	},
	{
		label: 'updateProfilePicturePrivacy',
		parameter: 'value',
		values: PRIVACY_VALUES,
		call: (sock, value) => sock.updateProfilePicturePrivacy(arg(value)),
		source: 'privacy.ts:updateProfilePicturePrivacy:value'
	},
	{
		label: 'updateStatusPrivacy',
		parameter: 'value',
		values: PRIVACY_VALUES,
		call: (sock, value) => sock.updateStatusPrivacy(arg(value)),
		source: 'privacy.ts:updateStatusPrivacy:value'
	},
	{
		label: 'updateOnlinePrivacy',
		parameter: 'value',
		values: ['all', 'match_last_seen'],
		call: (sock, value) => sock.updateOnlinePrivacy(arg(value)),
		source: 'privacy.ts:updateOnlinePrivacy:value'
	},
	{
		label: 'updateReadReceiptsPrivacy',
		parameter: 'value',
		values: ['all', 'none'],
		call: (sock, value) => sock.updateReadReceiptsPrivacy(arg(value)),
		source: 'privacy.ts:updateReadReceiptsPrivacy:value'
	},
	{
		label: 'updateGroupsAddPrivacy',
		parameter: 'value',
		values: ['all', 'contacts', 'contact_blacklist'],
		call: (sock, value) => sock.updateGroupsAddPrivacy(arg(value)),
		source: 'privacy.ts:updateGroupsAddPrivacy:value'
	},
	{
		label: 'updateCallPrivacy',
		parameter: 'value',
		values: ['all', 'known'],
		call: (sock, value) => sock.updateCallPrivacy(arg(value)),
		source: 'privacy.ts:updateCallPrivacy:value'
	},
	{
		label: 'updateMessagesPrivacy',
		parameter: 'value',
		values: ['all', 'contacts'],
		call: (sock, value) => sock.updateMessagesPrivacy(arg(value)),
		source: 'privacy.ts:updateMessagesPrivacy:value'
	},
	{
		label: 'updateBlockStatus',
		parameter: 'action',
		values: ['block', 'unblock'],
		call: (sock, value) => sock.updateBlockStatus(USER, arg(value)),
		source: 'blocking.ts:updateBlockStatus:action'
	},
	{
		label: 'sendPresence',
		parameter: 'status',
		values: ['available', 'unavailable'],
		call: (sock, value) => sock.sendPresence(arg(value)),
		source: 'presence.ts:sendPresence:status'
	},
	{
		label: 'sendChatState',
		parameter: 'state',
		values: ['composing', 'recording', 'paused'],
		call: (sock, value) => sock.sendChatState(USER, arg(value)),
		source: 'presence.ts:sendChatState:state'
	},
	{
		label: 'sendPresenceUpdate',
		parameter: 'type',
		values: ['available', 'unavailable', 'composing', 'recording', 'paused'],
		call: (sock, value) => sock.sendPresenceUpdate(arg(value), USER),
		source: 'index.ts:sendPresenceUpdate:type'
	},
	{
		label: 'profilePictureUrl',
		parameter: 'type',
		values: ['preview', 'image'],
		call: (sock, value) => sock.profilePictureUrl(USER, arg(value)),
		source: 'contacts.ts:profilePictureUrl:type',
		defaulted: true
	},
	{
		label: 'newsletterMetadata',
		parameter: 'type',
		values: ['invite', 'jid'],
		call: (sock, value) => sock.newsletterMetadata(arg(value), NEWSLETTER),
		source: 'newsletter.ts:newsletterMetadata:type'
	},
	{
		label: 'cleanDirtyBits',
		parameter: 'type',
		values: ['account_sync', 'groups'],
		call: (sock, value) => sock.cleanDirtyBits(arg(value)),
		source: 'server-queries.ts:cleanDirtyBits:type'
	},
	{
		label: 'waUploadToServer',
		parameter: 'mediaType',
		values: MEDIA_TYPES,
		call: (sock, value) => sock.waUploadToServer(new Uint8Array([1, 2, 3]), { mediaType: arg(value) }),
		source: 'index.ts:waUploadToServer:mediaType'
	},
	{
		label: 'sendReceipt',
		parameter: 'type',
		values: RECEIPT_TYPES,
		call: (sock, value) => sock.sendReceipt(USER, undefined, ['3EB0'], arg(value)),
		source: 'messages.ts:sendReceipt:type'
	},
	{
		label: 'sendReceipts',
		parameter: 'type',
		values: RECEIPT_TYPES,
		call: (sock, value) => sock.sendReceipts([{ remoteJid: USER, id: '3EB0' }], arg(value)),
		source: 'messages.ts:sendReceipts:type'
	},
	{
		label: 'downloadMedia',
		parameter: 'type',
		values: ['buffer', 'stream'],
		call: (sock, value) =>
			sock.downloadMedia({ key: { remoteJid: USER, id: '3EB0' }, message: {} }, arg<'buffer'>(value), {})
	},
	{
		// The socket method delegates to this one, which is also exported on its
		// own, so both entry points check and each reports its own name.
		label: 'downloadMediaMessage',
		parameter: 'type',
		values: ['buffer', 'stream'],
		call: (_sock, value) =>
			downloadMediaMessage({ key: { remoteJid: USER, id: '3EB0' }, message: {} }, arg<'buffer'>(value), {})
	},
	{
		label: 'communityRequestParticipantsUpdate',
		parameter: 'action',
		values: ['approve', 'reject'],
		call: (sock, value) => sock.communityRequestParticipantsUpdate(GROUP, [USER], arg(value)),
		source: 'communities.ts:communityRequestParticipantsUpdate:action'
	},
	{
		label: 'communitySettingUpdate',
		parameter: 'setting',
		values: ['announcement', 'not_announcement', 'locked', 'unlocked'],
		call: (sock, value) => sock.communitySettingUpdate(GROUP, arg(value)),
		source: 'communities.ts:communitySettingUpdate:setting'
	},
	{
		label: 'communityMemberAddMode',
		parameter: 'mode',
		values: ['admin_add', 'all_member_add'],
		call: (sock, value) => sock.communityMemberAddMode(GROUP, arg(value)),
		source: 'communities.ts:communityMemberAddMode:mode'
	},
	{
		label: 'communityJoinApprovalMode',
		parameter: 'mode',
		values: ['on', 'off'],
		call: (sock, value) => sock.communityJoinApprovalMode(GROUP, arg(value)),
		source: 'communities.ts:communityJoinApprovalMode:mode'
	}
]

/**
 * Closed-domain parameters the scan finds that no case covers, each with the
 * reason it is not validated. An entry here is a decision, not a backlog item.
 */
const EXEMPT: Record<string, string> = {
	'groups.ts:<module>:setting': 'a value in the alias table, not a parameter',
	'business.ts:minutesPastMidnight:which': 'a module-internal helper, called with a literal at both call sites',
	'internals.ts:resyncAppState:collections': 'a no-op wrapper: nothing is forwarded to the bridge',
	'server-queries.ts:createCallLink:_type': 'refused with a 501 whatever the value is',
	'internals.ts:upsertMessage:type': 'published on the event bus, so the value comes back to the caller unchanged'
}

/** A type declared as a set of string literals, however it is spelled. */
const CLOSED_DOMAIN_TYPE =
	/type (?<name>[A-Za-z_$][\w$]*) =\s*(?:\(typeof [\w$]+\)\[number\]|keyof typeof [\w$]+|\|?\s*'[^']*'(?:\s*\|\s*'[^']*')+)/gu

/** `parameter: 'a' | 'b'`, or a parameter typed by one of the above. */
const ANNOTATED_PARAMETER =
	/(?<declarator>(?:const|let|var)\s+)?(?<parameter>[A-Za-z_$][\w$]*)\??:\s*(?:readonly )?\(?(?<type>'[^']*'(?:\s*\|\s*'[^']*')+|[A-Za-z_$][\w$]*)/gu

/**
 * Every closed-domain type name in the package, so the scan follows a signature
 * that names its domain instead of spelling it out. Resolved rather than
 * listed: a list would go stale the first time one of them is renamed, which is
 * the same failure the scan exists to prevent.
 */
const closedDomainTypeNames = async (): Promise<Set<string>> => {
	const names = new Set<string>()
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === '__tests__' || entry.name === 'WAProto') continue
			const full = path.join(directory, entry.name)
			if (entry.isDirectory()) await visit(full)
			else if (entry.name.endsWith('.ts')) {
				for (const match of (await readFile(full, 'utf8')).matchAll(CLOSED_DOMAIN_TYPE)) {
					names.add(match.groups!.name!)
				}
			}
		}
	}
	await visit(path.resolve(import.meta.dirname, '..'))
	return names
}

/** The method whose parameter list the match sits in. */
const enclosingName = (text: string, index: number): string => {
	const opener =
		/(?:(?<assigned>[A-Za-z_$][\w$]*)\s*=\s*|(?<keyed>[A-Za-z_$][\w$]*)\s*:\s*)(?:[\w$.]+\s*\(\s*)?(?:async\s*)?(?:<[^<>]*>\s*)?\(/gu
	let name = '<module>'
	for (const match of text.slice(0, index).matchAll(opener)) {
		name = match.groups?.assigned ?? match.groups?.keyed ?? name
	}
	return name
}

/** The bridge's own union for a name, as the core deserializes it. */
const bridgeDts = loadBridgeDts()

const bridgeUnion = (name: string): string[] => bridgeStringUnion(bridgeDts, name)

const isDomainRejection = (error: unknown): boolean => error instanceof Error && / must be one of /u.test(error.message)

const statusCodeOf = (error: unknown): number | undefined =>
	(error as { output?: { statusCode?: number } })?.output?.statusCode

/** Settle a call, reporting a wait that never ends rather than hanging on it. */
const settle = async (run: () => Promise<unknown>): Promise<unknown> => {
	let timer: NodeJS.Timeout | undefined
	const pending = new Promise(resolve => {
		timer = setTimeout(() => resolve(new Error('the call never settled')), 10_000)
	})
	const outcome = await Promise.race([
		run().then(
			() => undefined,
			(error: unknown) => error
		),
		pending
	])
	clearTimeout(timer)
	return outcome
}

/** How the message renders a value it received, or one it accepts. */
const shown = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : String(value))

const assertNamesTheMistake = (error: unknown, { label, parameter, values }: DomainCase, received: unknown): void => {
	// Reported in full: what a consumer gets today is exactly what makes this
	// fail, so the failure has to show it.
	const got = error instanceof Error ? `${error.message}\n${error.stack}` : `no rejection, got ${String(error)}`
	assert.ok(error instanceof Error, `${label}(${shown(received)}) had to reject, ${got}`)

	const message = error.message
	const missing = [label, JSON.stringify(parameter), shown(received), ...values.map(shown)].filter(
		text => !message.includes(text)
	)
	assert.deepStrictEqual(
		missing,
		[],
		`the rejection has to name the method, the parameter, what arrived and every accepted value, and these are missing.\n${got}`
	)
	// A caller error, not a fault of ours: the status the socket already uses
	// for a malformed argument.
	assert.strictEqual(statusCodeOf(error), 400, `a caller mistake is a 400.\n${got}`)
}

describe('a closed-domain argument is rejected before it reaches the bridge', { timeout: 180_000 }, () => {
	let folder: string
	let sock: Socket

	before(async () => {
		folder = await mkdtemp(path.join(tmpdir(), 'baileyrs-domains-'))
		const { state } = await useMultiFileAuthState(folder)
		sock = makeWASocket({
			auth: state,
			logger: P({ level: 'silent' }),
			waWebSocketUrl: 'ws://127.0.0.1:1'
		})
	})

	after(async () => {
		await sock.end(undefined)
		await rm(folder, { recursive: true, force: true })
	})

	it('the reported call rejects with the call site in the stack', async () => {
		const reported = CASES[0]!
		// The reported shape exactly: created inside a timer, never awaited, so
		// there is no caller frame for V8 to stitch an async stack onto.
		const error = await new Promise<unknown>(resolve => {
			setTimeout(() => {
				const pending = sock.groupParticipantsUpdate(GROUP, [USER], arg('☠️'))
				pending.then(() => resolve(new Error('expected a rejection')), resolve)
			}, 0)
		})

		assertNamesTheMistake(error, reported, '☠️')
		const stack = (error as Error).stack ?? ''
		// The whole point: the consumer's own file is in there, and none of the
		// frames belong to the bridge.
		expect(stack).toContain('closed-domain-arguments.test.ts')
		expect(stack.includes('wasm://')).toBe(false)
	})

	for (const testCase of CASES) {
		const { label, parameter, values } = testCase
		const probes: unknown[] = ['☠️', 'bogus', '']
		const spelled = values.find(value => typeof value === 'string')!
		if (spelled.toUpperCase() !== spelled) probes.push(spelled.toUpperCase())
		// `undefined` is a value only where the domain has it or the parameter
		// has a default, and there it means "not passed" rather than a mistake.
		// `null` never does: it is a value the caller chose.
		if (!values.includes(undefined) && !testCase.defaulted) probes.push(undefined)
		if (!values.includes(undefined)) probes.push(null)

		it(`${label} rejects an off-domain ${parameter}`, async () => {
			for (const probe of probes) {
				const error = await settle(() => testCase.call(sock, probe))
				assertNamesTheMistake(error, testCase, probe)
			}
		})

		it(`${label} still accepts every value of ${parameter}`, async () => {
			for (const value of values) {
				const error = await settle(() => testCase.call(sock, value))
				// Offline, so most of these fail downstream. What must not
				// happen is this layer rejecting a value it documents.
				expect(isDomainRejection(error)).toBe(false)
			}
		})
	}

	it('an omitted optional argument takes its default instead of being rejected', async () => {
		const error = await settle(() => sock.profilePictureUrl(USER))
		expect(isDomainRejection(error)).toBe(false)
	})

	it('a value that cannot be turned into a string is still reported as a bad argument', async () => {
		// Rendering the value is part of the message, so a value that throws on
		// conversion could replace the 400 with a TypeError from our own report.
		// A revoked proxy throws on any read at all, `Object.prototype.toString`
		// included, so the fallback cannot read the value either.
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()
		const hostileValues: unknown[] = [
			Object.create(null),
			{ toString: () => JSON.parse('nope') },
			revocable.proxy,
			new Proxy({}, { get: () => JSON.parse('nope') })
		]

		for (const hostile of hostileValues) {
			const error = await settle(() => sock.groupParticipantsUpdate(GROUP, [USER], arg(hostile)))
			expect(statusCodeOf(error)).toBe(400)
			expect(isDomainRejection(error)).toBe(true)
			expect((error as Error).message).toContain('[object')
		}
	})

	it('every closed-domain parameter on the socket is covered or exempt', async () => {
		const directory = path.resolve(import.meta.dirname, '../Socket')
		const covered = new Set(CASES.flatMap(entry => (entry.source ? [entry.source] : [])))
		const domainTypes = await closedDomainTypeNames()
		const found: string[] = []

		for (const file of (await readdir(directory)).filter(name => name.endsWith('.ts'))) {
			const text = await readFile(path.join(directory, file), 'utf8')
			for (const match of text.matchAll(ANNOTATED_PARAMETER)) {
				const { declarator, parameter, type } = match.groups!
				if (declarator) continue
				if (!type!.startsWith("'") && !domainTypes.has(type!)) continue
				found.push(`${file}:${enclosingName(text, match.index)}:${parameter}`)
			}
		}

		// A new method taking one of these lands here: give it a case above, or
		// an EXEMPT entry saying why the value is safe to pass through.
		const uncovered = [...new Set(found)].filter(key => !covered.has(key) && !(key in EXEMPT)).toSorted()
		expect(uncovered).toEqual([])

		const stale = [...covered].filter(key => !found.includes(key)).toSorted()
		expect(stale).toEqual([])
	})

	describe('the accepted values match what the core deserializes', () => {
		const valuesOf = (label: string): string[] =>
			(CASES.find(entry => entry.label === label)!.values as string[]).toSorted()

		for (const [label, union] of [
			['groupParticipantsUpdate', 'GroupParticipantAction'],
			['communityParticipantsUpdate', 'GroupParticipantAction'],
			['groupRequestParticipantsUpdate', 'GroupRequestAction'],
			['groupMemberAddMode', 'MemberAddMode'],
			['updateBlockStatus', 'BlockAction'],
			['sendPresence', 'PresenceStatus'],
			['sendChatState', 'ChatState'],
			['profilePictureUrl', 'PictureType']
		] as const) {
			it(`${label} accepts exactly the bridge's ${union}`, () => {
				expect(valuesOf(label)).toEqual(bridgeUnion(union).toSorted())
			})
		}

		it('the privacy wrappers stay inside the values the core knows', () => {
			const known = new Set(bridgeUnion('PrivacyValue'))
			const values = CASES.filter(entry => entry.parameter === 'value').flatMap(entry => entry.values as string[])
			expect([...new Set(values)].filter(value => !known.has(value))).toEqual([])
		})

		it('the settings the group wrappers map onto are all bridge settings', () => {
			const known = new Set(bridgeUnion('GroupSetting'))
			expect(['locked', 'announce', 'membership_approval'].filter(setting => !known.has(setting))).toEqual([])
		})

		it('cleanDirtyBits stays inside the dirty types the core knows', () => {
			const known = new Set(bridgeUnion('DirtyType'))
			expect(valuesOf('cleanDirtyBits').filter(type => !known.has(type))).toEqual([])
		})

		it('every media type the bridge uploads is one waUploadToServer accepts', () => {
			const accepted = new Set(valuesOf('waUploadToServer'))
			expect(bridgeUnion('MediaType').filter(type => !accepted.has(type))).toEqual([])
		})
	})
})
