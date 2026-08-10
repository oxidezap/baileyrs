/**
 * The public argument boundary, fuzzed.
 *
 * `src/__tests__/closed-domain-arguments.test.ts` documents why this boundary
 * exists, from a production report: `groupParticipantsUpdate(from, [id], '☠️')`
 * called fire-and-forget, the value crossing into the bridge untouched, and the
 * consumer getting an `unhandledRejection` whose every frame reads
 * `wasm://wasm/<hash>`. Nothing in it points at the line that made the call.
 *
 * That test checks the contract for values somebody chose. This one generates
 * them — every off-domain shape a JavaScript caller can produce, not just the
 * near-misses — and asserts the same contract on all of them:
 *
 *   - the rejection is a Boom carrying statusCode 400
 *   - it names the parameter and lists what is accepted, in `data`
 *   - its message shows what actually arrived
 *   - **its stack contains no `wasm://` frames**
 *
 * The last is the one that matters and the one only a real socket can answer, so
 * these drive the real public socket pointed at a port nothing listens on: a
 * value that passes validation fails downstream as "not connected" rather than
 * reaching a server, which is exactly the distinction being tested —
 * rejected-by-us versus not-rejected-by-us.
 *
 * A source scan keeps the table honest: every `assertArgumentDomain` call site in
 * `src/` must appear below, so guarding a new parameter without fuzzing it fails
 * the suite.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import makeWASocket from '../Socket/index.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import type { Divergence } from './harness/divergence.ts'
import { fuzz } from './harness/runner.ts'
import type { Random } from './harness/random.ts'
import { generateNumber, generateString } from './generators/values.ts'

type Socket = ReturnType<typeof makeWASocket>

/** Pass an off-union value through a typed parameter, the way plain JS does. */
const off = <T>(value: unknown): T => value as T

const GROUP = '120363000000000000@g.us'
const USER = '15550000000@s.whatsapp.net'

interface BoundaryCase {
	/** The method name the rejection must use. */
	readonly method: string
	/** The parameter name the rejection must name. */
	readonly parameter: string
	/** `file.ts:method:parameter`, matching how the source scan spells it. */
	readonly source: string
	readonly call: (socket: Socket, value: unknown) => Promise<unknown>
}

const CASES: readonly BoundaryCase[] = [
	{
		method: 'updateBlockStatus',
		parameter: 'action',
		source: 'blocking.ts:updateBlockStatus:action',
		call: (s, v) => s.updateBlockStatus(USER, off(v))
	},
	{
		method: 'sendPresenceUpdate',
		parameter: 'type',
		source: 'index.ts:sendPresenceUpdate:type',
		call: (s, v) => s.sendPresenceUpdate(off(v), USER)
	},
	{
		method: 'waUploadToServer',
		parameter: 'mediaType',
		source: 'index.ts:waUploadToServer:mediaType',
		call: (s, v) =>
			s.waUploadToServer(off(Buffer.from('x')), off({ mediaType: v, fileEncSha256B64: '', mediaType2: undefined }))
	},
	{
		method: 'groupSettingUpdate',
		parameter: 'setting',
		source: 'groups.ts:groupSettingUpdate:setting',
		call: (s, v) => s.groupSettingUpdate(GROUP, off(v))
	},
	{
		method: 'groupRequestParticipantsUpdate',
		parameter: 'action',
		source: 'groups.ts:groupRequestParticipantsUpdate:action',
		call: (s, v) => s.groupRequestParticipantsUpdate(GROUP, [USER], off(v))
	},
	{
		method: 'groupParticipantsUpdate',
		parameter: 'action',
		source: 'groups.ts:groupParticipantsUpdate:action',
		call: (s, v) => s.groupParticipantsUpdate(GROUP, [USER], off(v))
	},
	{
		method: 'groupMemberAddMode',
		parameter: 'mode',
		source: 'groups.ts:groupMemberAddMode:mode',
		call: (s, v) => s.groupMemberAddMode(GROUP, off(v))
	},
	{
		method: 'groupJoinApprovalMode',
		parameter: 'mode',
		source: 'groups.ts:groupJoinApprovalMode:mode',
		call: (s, v) => s.groupJoinApprovalMode(GROUP, off(v))
	},
	{
		method: 'sendReceipt',
		parameter: 'type',
		source: 'messages.ts:sendReceipt:type',
		call: (s, v) => s.sendReceipt(USER, undefined, ['ABC'], off(v))
	},
	{
		method: 'sendReceipts',
		parameter: 'type',
		source: 'messages.ts:sendReceipts:type',
		call: (s, v) => s.sendReceipts([{ remoteJid: USER, id: 'ABC', fromMe: false }], off(v))
	},
	{
		method: 'newsletterMetadata',
		parameter: 'type',
		source: 'newsletter.ts:newsletterMetadata:type',
		call: (s, v) => s.newsletterMetadata(off(v), 'key')
	},
	{
		method: 'cleanDirtyBits',
		parameter: 'type',
		source: 'server-queries.ts:cleanDirtyBits:type',
		call: (s, v) => s.cleanDirtyBits(off(v))
	},
	{
		method: 'sendPresence',
		parameter: 'status',
		source: 'presence.ts:sendPresence:status',
		call: (s, v) => s.sendPresence(off(v))
	},
	{
		method: 'sendChatState',
		parameter: 'state',
		source: 'presence.ts:sendChatState:state',
		call: (s, v) => s.sendChatState(USER, off(v))
	},
	{
		method: 'updateLastSeenPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateLastSeenPrivacy:value',
		call: (s, v) => s.updateLastSeenPrivacy(off(v))
	},
	{
		method: 'updateOnlinePrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateOnlinePrivacy:value',
		call: (s, v) => s.updateOnlinePrivacy(off(v))
	},
	{
		method: 'updateProfilePicturePrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateProfilePicturePrivacy:value',
		call: (s, v) => s.updateProfilePicturePrivacy(off(v))
	},
	{
		method: 'updateStatusPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateStatusPrivacy:value',
		call: (s, v) => s.updateStatusPrivacy(off(v))
	},
	{
		method: 'updateReadReceiptsPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateReadReceiptsPrivacy:value',
		call: (s, v) => s.updateReadReceiptsPrivacy(off(v))
	},
	{
		method: 'updateGroupsAddPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateGroupsAddPrivacy:value',
		call: (s, v) => s.updateGroupsAddPrivacy(off(v))
	},
	{
		method: 'updateCallPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateCallPrivacy:value',
		call: (s, v) => s.updateCallPrivacy(off(v))
	},
	{
		method: 'updateMessagesPrivacy',
		parameter: 'value',
		source: 'privacy.ts:updateMessagesPrivacy:value',
		call: (s, v) => s.updateMessagesPrivacy(off(v))
	},
	{
		method: 'profilePictureUrl',
		parameter: 'type',
		source: 'contacts.ts:profilePictureUrl:type',
		call: (s, v) => s.profilePictureUrl(USER, off(v))
	},
	{
		method: 'communityRequestParticipantsUpdate',
		parameter: 'action',
		source: 'communities.ts:communityRequestParticipantsUpdate:action',
		call: (s, v) => s.communityRequestParticipantsUpdate(GROUP, [USER], off(v))
	},
	{
		method: 'communityParticipantsUpdate',
		parameter: 'action',
		source: 'communities.ts:communityParticipantsUpdate:action',
		call: (s, v) => s.communityParticipantsUpdate(GROUP, [USER], off(v))
	},
	{
		method: 'communitySettingUpdate',
		parameter: 'setting',
		source: 'communities.ts:communitySettingUpdate:setting',
		call: (s, v) => s.communitySettingUpdate(GROUP, off(v))
	},
	{
		method: 'communityMemberAddMode',
		parameter: 'mode',
		source: 'communities.ts:communityMemberAddMode:mode',
		call: (s, v) => s.communityMemberAddMode(GROUP, off(v))
	},
	{
		method: 'communityJoinApprovalMode',
		parameter: 'mode',
		source: 'communities.ts:communityJoinApprovalMode:mode',
		call: (s, v) => s.communityJoinApprovalMode(GROUP, off(v))
	},
	{
		method: 'downloadMedia',
		parameter: 'type',
		source: 'index.ts:downloadMedia:type',
		call: (s, v) =>
			s.downloadMedia(
				off({
					url: 'https://example.invalid/x',
					mediaKey: new Uint8Array(32),
					directPath: '/x',
					mimetype: 'image/jpeg'
				}),
				off<'buffer' | 'stream'>(v)
			)
	}
]

/**
 * Values a JavaScript caller can actually put in a closed-domain parameter.
 *
 * The near-misses matter most: a valid value with different casing or a trailing
 * space is the mistake people really make, and it must be rejected as loudly as
 * an emoji.
 */
const generateOffDomainValue = (random: Random): unknown =>
	random.weighted<unknown>([
		[4, random.pick(['☠️', 'ADD', 'Add', 'add ', ' add', 'add\n', 'remove;', 'aDd', 'true', 'null', 'undefined', '0'])],
		[3, generateString(random)],
		[2, generateNumber(random)],
		// `undefined` is deliberately absent: it means the argument was omitted, so
		// for a defaulted or optional parameter it is not an off-domain *value* at
		// all. Optionality is closed-domain-arguments.test.ts's subject.
		[2, random.pick([null, true, false])],
		[1, {}],
		[1, []],
		[1, () => undefined],
		[1, Symbol('off-domain')],
		[1, 'x'.repeat(4_096)],
		[1, Object.create(null)],
		[
			1,
			new Proxy(
				{},
				{
					get: () => {
						throw new Error('hostile getter')
					}
				}
			)
		]
	])

interface BoundaryFinding {
	readonly ok: boolean
	readonly detail?: string
	readonly observed?: unknown
}

/** Everything the rejection contract requires, checked in one place. */
const inspectRejection = (error: unknown, testCase: BoundaryCase): BoundaryFinding => {
	if (!(error instanceof Error)) {
		return { ok: false, detail: 'the rejection is not an Error', observed: String(error) }
	}

	const boom = error as Error & { isBoom?: boolean; output?: { statusCode?: number }; data?: Record<string, unknown> }

	// The stack is the whole point: a wasm-only stack is the production bug this
	// boundary was built to prevent, and it is invisible to a type checker.
	const stack = String(error.stack ?? '')
	if (stack.includes('wasm://')) {
		return {
			ok: false,
			detail: 'the rejection stack contains wasm frames',
			observed: stack.split('\n').slice(0, 4).join(' | ')
		}
	}

	if (boom.isBoom !== true) {
		return {
			ok: false,
			detail: 'the rejection is not a Boom',
			observed: `${error.name}: ${error.message.slice(0, 120)}`
		}
	}
	if (boom.output?.statusCode !== 400) {
		return { ok: false, detail: 'the rejection does not carry statusCode 400', observed: boom.output?.statusCode }
	}
	if (boom.data?.parameter !== testCase.parameter) {
		return { ok: false, detail: 'the rejection names the wrong parameter', observed: boom.data?.parameter }
	}
	if (!Array.isArray(boom.data?.accepted) || boom.data.accepted.length === 0) {
		return { ok: false, detail: 'the rejection does not list the accepted values', observed: boom.data?.accepted }
	}
	if (!error.message.startsWith(`${testCase.method}: `)) {
		return {
			ok: false,
			detail: 'the message does not open with the method the consumer called',
			observed: error.message.slice(0, 120)
		}
	}
	return { ok: true }
}

/**
 * The values each guard accepts, read from the guard itself.
 *
 * Asking the boundary what it accepts — by provoking one rejection and reading
 * `data.accepted` — beats writing the domains out here a second time. A hand-kept
 * copy drifts, and when it does the fuzzer starts calling a *valid* value
 * off-domain and reporting the resulting "not connected" failure as a bug. Which
 * is exactly what happened before this existed.
 */
const acceptedValues = new Map<string, readonly unknown[]>()

const learnDomain = async (socket: Socket, testCase: BoundaryCase): Promise<void> => {
	try {
		await testCase.call(socket, '\u2620\uFE0F-definitely-not-a-member')
	} catch (error) {
		const accepted = (error as { data?: { accepted?: unknown } })?.data?.accepted
		if (Array.isArray(accepted)) acceptedValues.set(testCase.source, accepted)
	}
}

describe('closed-domain argument boundary, fuzzed', () => {
	let socket: Socket
	let folder: string

	before(async () => {
		folder = await mkdtemp(path.join(tmpdir(), 'baileyrs-fuzz-domains-'))
		const { state } = await useMultiFileAuthState(folder)
		// Self-referencing rather than closing over `socket`: `makeWASocket` calls
		// `logger.child(...)` during construction, before the assignment below has
		// happened, so a closure would dereference `undefined`.
		const silentLogger: Record<string, unknown> = {
			level: 'silent',
			trace: () => {},
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {}
		}
		silentLogger.child = () => silentLogger

		socket = makeWASocket({
			auth: state,
			logger: silentLogger as never,
			// Nothing listens here, so a value that survives validation fails as
			// "not connected" instead of reaching a server.
			waWebSocketUrl: 'ws://127.0.0.1:1'
		})
		for (const testCase of CASES) await learnDomain(socket, testCase)
	})

	after(async () => {
		try {
			// Awaited: teardown flushes the auth stores asynchronously, and removing
			// the folder underneath an in-flight write recreates it or throws after
			// the test has already reported success.
			await socket.end(undefined)
		} catch {
			// The socket never connected; ending it is best-effort cleanup.
		}
		await rm(folder, { recursive: true, force: true })
	})

	it('guards every assertArgumentDomain call site in the source', async () => {
		// Auto-discovery, so a new guarded parameter cannot be added without also
		// being fuzzed — the same ledger discipline as the pure-helper coverage test.
		// The whole of `src`, recursively, and all three quote styles: the claim in
		// this file's header is "every call site in src/", and a scan of two
		// directories' immediate children would let a guard in a new subdirectory
		// pass without a fuzz case — the exact gap this test exists to close.
		const sourceRoot = path.join(import.meta.dirname, '..')
		const scanned: string[] = []
		for (const entry of await readdir(sourceRoot, { withFileTypes: true, recursive: true })) {
			if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
			if (entry.parentPath.includes('__fuzz__') || entry.parentPath.includes('__tests__')) continue
			const source = await readFile(path.join(entry.parentPath, entry.name), 'utf8')
			for (const match of source.matchAll(/assertArgumentDomain\(\s*['"`]([^'"`]+)['"`],\s*['"`]([^'"`]+)['"`]/gu)) {
				scanned.push(`${entry.name}:${match[1]}:${match[2]}`)
			}
		}

		assert.ok(
			scanned.length > 20,
			`the source scan found only ${scanned.length} guarded parameters — has the pattern changed?`
		)

		const covered = new Set(CASES.map(testCase => testCase.source))
		// downloadMediaMessage is a standalone helper rather than a socket method;
		// closed-domain-arguments.test.ts drives it directly.
		const exempt = new Set(['messages.ts:downloadMediaMessage:type'])
		const missing = scanned.filter(entry => !covered.has(entry) && !exempt.has(entry))
		assert.deepEqual(missing, [], `guarded parameters with no fuzz case: ${missing.join(', ')}`)

		const stale = [...covered].filter(entry => !scanned.includes(entry))
		assert.deepEqual(stale, [], `fuzz cases for guards that no longer exist: ${stale.join(', ')}`)
	})

	for (const testCase of CASES) {
		it(`${testCase.method}(${testCase.parameter})`, async () => {
			await fuzz<unknown>({
				target: `args:${testCase.method}`,
				runs: 60,
				shrinkFailures: false,
				generate: generateOffDomainValue,
				check: async value => {
					const findings: Divergence[] = []
					// A generated value that happens to be in the domain (`undefined` for
					// an optional or defaulted parameter) is not off-domain, and what it
					// does downstream is not this test's subject.
					if ((acceptedValues.get(testCase.source) ?? []).includes(value)) return findings
					try {
						await testCase.call(socket, value)
						// Reaching here means the value was accepted. It cannot have been
						// valid — everything generated is off-domain — so the guard let it
						// through and it is on its way to the bridge.
						findings.push({
							target: `args:${testCase.method}`,
							input: value,
							local: '<accepted>',
							upstream: '<Boom 400 naming the parameter>',
							detail: 'an off-domain value passed the guard'
						})
					} catch (error) {
						const verdict = inspectRejection(error, testCase)
						if (!verdict.ok) {
							findings.push({
								target: `args:${testCase.method}`,
								input: value,
								local: verdict.observed,
								upstream: '<Boom 400 naming the parameter, with a wasm-free stack>',
								detail: verdict.detail
							})
						}
					}
					return findings
				}
			})
		})
	}
})
