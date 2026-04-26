/**
 * E2E: Cross-impl session compatibility (baileyrs ↔ upstream baileys).
 *
 * Why: baileyrs ships as a drop-in replacement for `@whiskeysockets/baileys`,
 * meaning a user must be able to swap libraries on a running install without
 * losing their Signal session ratchets OR sender keys. We hit a regression
 * where sessions written by Rust libsignal could not be deserialized by JS
 * libsignal (and vice-versa), surfacing as `Bad MAC` on every send/decrypt
 * after swap. This test pins down byte-format compatibility from a real wire
 * roundtrip — for both **pairwise sessions** AND **sender keys** (the group
 * codepath) — so the regression cannot reappear silently.
 *
 * Shape:
 *
 *   1. Pair Alice + Bob + Charlie, all on baileyrs, against the mock server.
 *      Each uses upstream-baileys's `useMultiFileAuthState` so the on-disk
 *      format is JSON the JS side can read directly. baileyrs auto-wraps
 *      the resulting `{creds, keys}` via `wrapLegacyStore`.
 *
 *   2. **1:1 phase** — Alice ↔ Bob exchange messages. Establishes pairwise
 *      Signal sessions on disk (PreKey signal → ratchet step on both sides).
 *
 *   3. **Group phase** — Alice creates a group with Bob + Charlie. All three
 *      send into it. This populates **sender keys** on every member: each
 *      one stores its OWN sending sender key + RECEIVING sender keys for
 *      the two peers.
 *
 *   4. **Swap** — Disconnect Bob and reconstruct him with **upstream
 *      baileys** pointing at the same auth folder. Re-connect against the
 *      mock.
 *
 *   5. **Post-swap 1:1** — Alice (bridge) → Bob (upstream) and reverse.
 *      Validates pairwise session bytes round-trip across libsignal
 *      implementations.
 *
 *   6. **Post-swap group** — Alice (bridge) → group, Charlie (bridge) →
 *      group, Bob (upstream) → group. Crucially, alice's bridge has cached
 *      the fact that bob already received her sender key (from step 3), so
 *      her post-swap group send does NOT include a fresh SKDM — bob's
 *      upstream JS libsignal MUST decrypt from the on-disk sender key bytes
 *      that bridge wrote. Same logic for Charlie. This is the actual
 *      sender-key-bytes-cross-impl test.
 *
 * Either direction or path failing means the on-disk bytes are incompatible
 * between the two libsignal implementations, which would break every
 * baileyrs ↔ baileys migration.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import * as upstreamBaileys from 'baileys'
import P from 'pino'
import { Boom, DisconnectReason, jidNormalizedUser, makeWASocket, type proto } from '../../index.ts'
import { expect } from '../expect.ts'
import { attachQrAutoresponder } from './qr-autoresponder.ts'
import { waitForEvent, waitForMessage } from './wait.ts'

type WASocket = ReturnType<typeof makeWASocket>
type UpstreamSocket = ReturnType<typeof upstreamBaileys.makeWASocket>

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })
const socketUrl = process.env.SOCKET_URL ?? 'wss://127.0.0.1:8080/ws/chat'

interface BridgeClient {
	kind: 'bridge'
	sock: WASocket
	jid: string
	lid?: string
	authFolder: string
	label: string
}

interface UpstreamClient {
	kind: 'upstream'
	sock: UpstreamSocket
	jid: string
	lid?: string
	authFolder: string
	label: string
}

type AnyClient = BridgeClient | UpstreamClient

/** Mock-server JIDs include a device suffix `phone:N@s.whatsapp.net`; strip it. */
function plainPnJid(jid: string): string {
	return jid.replace(/:\d+@/, '@')
}

/**
 * The LID-form JID the mock publishes for a paired client (group
 * notifications + group message `participant` field carry @lid form when
 * the group is LID-addressed, which is the mock's default).
 */
function lidJid(client: AnyClient): string {
	if (!client.lid) throw new Error(`${client.label} has no LID — was it paired?`)
	return plainPnJid(client.lid)
}

/** Drill into messages.upsert (upstream-baileys flavour) for the swapped
 * client. The upstream `WAMessage` type comes from a different proto build,
 * so we widen to `proto.IWebMessageInfo` (the bridge's flavour) at the
 * predicate boundary — both shapes have the fields the test predicates read. */
function waitForUpstreamMessage(
	sock: UpstreamSocket,
	predicate: (msg: proto.IWebMessageInfo) => boolean,
	timeoutMs = 15_000
): Promise<proto.IWebMessageInfo> {
	return new Promise((resolve, reject) => {
		const listener = (data: { messages: proto.IWebMessageInfo[] }) => {
			const msg = data.messages.find(predicate)
			if (!msg) return
			// @ts-expect-error -- listener type mismatch (WAMessage vs proto.IWebMessageInfo); same wire shape
			sock.ev.off('messages.upsert', listener)
			clearTimeout(tid)
			resolve(msg)
		}
		const tid = setTimeout(() => {
			// @ts-expect-error -- same nominal mismatch as above
			sock.ev.off('messages.upsert', listener)
			reject(new Error('Timed out waiting for upstream messages.upsert match'))
		}, timeoutMs)
		// @ts-expect-error -- listener type mismatch (WAMessage vs proto.IWebMessageInfo); same wire shape
		sock.ev.on('messages.upsert', listener)
	})
}

/** Pair a client on baileyrs with an upstream-baileys auth folder so the
 * on-disk format is the JSON layout both libraries can read. The two
 * `AuthenticationState` types are structurally identical at the field level
 * but come from different proto builds, hence the cast at the boundary. */
async function createBridgeClient(label: string, authFolder?: string): Promise<BridgeClient> {
	const folder = authFolder ?? mkdtempSync(join(tmpdir(), `handoff-bridge-${label}-`))
	const { state, saveCreds } = await upstreamBaileys.useMultiFileAuthState(folder)

	const sock = makeWASocket({
		// upstream's AuthenticationCreds is the same shape as the bridge's
		// (both ship from a forked WAProto), but TS treats them as distinct
		// nominal types. Runtime is fine; the bridge reads only fields that
		// exist in both.
		// @ts-expect-error -- nominal mismatch between two forked WAProto builds
		auth: state,
		waWebSocketUrl: socketUrl,
		logger: logger.child({ user: label, impl: 'bridge' })
	})

	// Persist as keys/creds advance — without this the swap reads stale state.
	sock.ev.on('creds.update', saveCreds)

	// Bartender mock-server is scan-driven; an external "phone" must POST
	// the QR for pair-success to flow.
	attachQrAutoresponder(sock, socketUrl)

	const jid = await new Promise<string>((resolve, reject) => {
		const tid = setTimeout(() => reject(new Error(`${label}: connect timeout (bridge)`)), 30_000)
		sock.ev.on('connection.update', update => {
			if (update.connection === 'open') {
				clearTimeout(tid)
				resolve(jidNormalizedUser(sock.user?.id))
			} else if (update.connection === 'close') {
				const reason = (update.lastDisconnect?.error as Boom)?.output?.statusCode
				if (reason === DisconnectReason.loggedOut) {
					clearTimeout(tid)
					reject(new Error(`${label}: Logged out (bridge)`))
				}
			}
		})
	})

	return { kind: 'bridge', sock, jid, lid: sock.user?.lid, authFolder: folder, label }
}

/** Bring a client up on upstream baileys with the same auth folder. The
 * mock server's TLS uses a self-signed cert, so the test:e2e script sets
 * NODE_TLS_REJECT_UNAUTHORIZED=0 — we rely on that here too. */
async function createUpstreamClient(label: string, authFolder: string): Promise<UpstreamClient> {
	const { state, saveCreds } = await upstreamBaileys.useMultiFileAuthState(authFolder)

	const sock = upstreamBaileys.makeWASocket({
		auth: state,
		waWebSocketUrl: socketUrl,
		logger: logger.child({ user: label, impl: 'upstream' }) as never,
		// Match the bridge client's browser identity so the mock keeps the
		// device record continuous after the swap.
		browser: upstreamBaileys.Browsers.appropriate('Chrome'),
		// Upstream needs a getMessage to handle retry receipts; we won't
		// receive any in this test, so a no-op is fine.
		getMessage: async () => undefined
	})

	sock.ev.on('creds.update', saveCreds)

	const jid = await new Promise<string>((resolve, reject) => {
		const tid = setTimeout(() => reject(new Error(`${label}: connect timeout (upstream)`)), 30_000)
		sock.ev.on('connection.update', update => {
			if (update.connection === 'open') {
				clearTimeout(tid)
				resolve(upstreamBaileys.jidNormalizedUser(sock.user?.id))
			} else if (update.connection === 'close') {
				// Upstream doesn't re-export Boom; we only need the statusCode
				// shape to match upstream's own DisconnectReason enum.
				const reason = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
					?.statusCode
				if (reason === upstreamBaileys.DisconnectReason.loggedOut) {
					clearTimeout(tid)
					reject(new Error(`${label}: Logged out (upstream)`))
				}
			}
		})
	})

	return { kind: 'upstream', sock, jid, lid: sock.user?.lid, authFolder, label }
}

async function destroyClient(client: AnyClient, removeFolder: boolean) {
	try {
		if (client.kind === 'bridge') {
			client.sock.setAutoReconnect(false)
			await client.sock.end()
		} else {
			// Upstream's `end()` is void and its background workers
			// (`commitWithRetry`) keep firing after teardown. Wait for the
			// connection-close event (bounded) and give the per-id mutex
			// queue a beat to drain BEFORE rmSync — otherwise the ENOENT
			// retry/backoff loop fires for ~30s post-teardown and contends
			// for the host with the next suite's WebSocket handshake.
			const closed = new Promise<void>(resolve => {
				const on = (u: { connection?: string }) => {
					if (u.connection === 'close') {
						client.sock.ev.off('connection.update', on)
						resolve()
					}
				}
				client.sock.ev.on('connection.update', on)
			})
			client.sock.end(undefined)
			await Promise.race([closed, new Promise<void>(r => setTimeout(r, 1000).unref())])
			await new Promise<void>(r => setTimeout(r, 100).unref())
		}
	} catch {
		/* ignore */
	}
	if (removeFolder) {
		try {
			rmSync(client.authFolder, { recursive: true, force: true })
		} catch {
			/* ignore */
		}
	}
}

function getTextContent(msg: proto.IWebMessageInfo): string | undefined {
	return msg.message?.extendedTextMessage?.text || msg.message?.conversation || undefined
}

/** Strip the device suffix (`:DEVICE@`) so we compare LID/PN identities by
 * `user@server` only. Bridge keeps the device, upstream drops it — same
 * identity, different surface representation. */
const stripDeviceSuffix = (jid: string | undefined) => jid?.replace(/:\d+@/, '@')

/**
 * Read every `session-*.json` in `authFolder`, parse, and return a map
 * from session-file address → set of base64 baseKeys present (open OR
 * closed) under that address.
 *
 * Why: a Signal session's `baseKey` is fixed at creation (it's the alice
 * base key from the original PreKey handshake). It cannot change unless a
 * new handshake produces a brand-new session. So if a peer's pre-swap
 * baseKey is still present after the swap (even if archived as `closed`),
 * the session bytes were preserved — no re-handshake. If the baseKey is
 * GONE entirely (deleted), the library tossed the old session and a
 * `pkmsg` (PreKey signal) re-handshake fired as fallback for that peer.
 */
function snapshotAllSessionBaseKeys(authFolder: string): Map<string, Set<string>> {
	return snapshotSessionBaseKeysImpl(authFolder, false)
}

/** Same as `snapshotAllSessionBaseKeys` but only counts entries with
 * `indexInfo.closed === -1` (currently OPEN). Used pre-swap so we don't
 * snapshot already-archived sessions whose presence post-swap is
 * meaningless. */
function snapshotOpenSessionBaseKeys(authFolder: string): Map<string, Set<string>> {
	return snapshotSessionBaseKeysImpl(authFolder, true)
}

function snapshotSessionBaseKeysImpl(authFolder: string, openOnly: boolean): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>()
	let entries: string[]
	try {
		entries = readdirSync(authFolder)
	} catch {
		return out
	}
	for (const file of entries) {
		if (!file.startsWith('session-') || !file.endsWith('.json')) continue
		try {
			const raw = readFileSync(join(authFolder, file), 'utf-8')
			const parsed = JSON.parse(raw) as
				| { _sessions?: Record<string, { indexInfo?: { closed?: number; baseKey?: string } }> }
				| { type?: 'Buffer' }
			// Bridge-only legacy format: a `{type:'Buffer', data:base64}`
			// wrapper instead of a JS object. Skip — represents bytes the
			// converter no longer writes (and which upstream cannot read
			// either way), so it can't host an open session.
			if ((parsed as { type?: string }).type === 'Buffer') continue
			const sessions = (parsed as { _sessions?: Record<string, { indexInfo?: { closed?: number; baseKey?: string } }> })
				._sessions
			if (!sessions) continue
			const addr = file.slice('session-'.length, -'.json'.length)
			const set = out.get(addr) ?? new Set<string>()
			for (const [k, entry] of Object.entries(sessions)) {
				if (openOnly && entry?.indexInfo?.closed !== -1) continue
				set.add(entry?.indexInfo?.baseKey ?? k)
			}
			if (set.size > 0) out.set(addr, set)
		} catch {
			// malformed file — ignore
		}
	}
	return out
}

/**
 * Send-and-await primitive: assert the target receives a freshly-sent message
 * and that the on-the-wire identity (id, remoteJid, fromMe, participant for
 * groups) matches the sender's outgoing key. Returns the received message so
 * callers can chain extra assertions.
 *
 * `recvWaiter` is wired by the caller to use the right waiter helper for the
 * destination client's library flavour.
 */
async function assertDelivery(opts: {
	sender: AnyClient
	to: string
	text: string
	recvWaiter: (predicate: (m: proto.IWebMessageInfo) => boolean) => Promise<proto.IWebMessageInfo>
	expectedRemoteJid: string
	expectedParticipant?: string
}): Promise<proto.IWebMessageInfo> {
	const { sender, to, text, recvWaiter, expectedRemoteJid, expectedParticipant } = opts

	const recvPromise = recvWaiter(m => getTextContent(m) === text && !m.key?.fromMe)
	const sent = await sender.sock.sendMessage(to, { text })
	expect(sent).toBeDefined()
	expect(sent!.key.id).toBeTruthy()

	const received = await recvPromise

	// Body — exact text, not substring. A drift here means the wire flow
	// stripped/altered content.
	expect(getTextContent(received)).toBe(text)

	// Direction — must NOT be `fromMe` on the recipient side; would indicate
	// a self-echo bug or the wrong client got matched.
	expect(received.key?.fromMe).toBe(false)

	// Identity — id is the strongest cross-side correlator. If this matches,
	// we know the recipient consumed the same envelope the sender produced,
	// not some unrelated message that happened to share the body.
	expect(received.key?.id).toBe(sent!.key.id)

	// Routing — for 1:1 the recipient sees the sender's JID; for groups the
	// recipient sees the group JID.
	expect(received.key?.remoteJid).toBe(expectedRemoteJid)

	if (expectedParticipant !== undefined) {
		// In a group the recipient also sees `participant` set to the
		// sender's LID/JID. Asserting this catches off-by-one fan-out bugs
		// where the wrong participant gets credited.
		expect(received.key?.participant).toBe(expectedParticipant)
	}

	return received
}

describe(
	'E2E: baileys ↔ baileyrs handoff (session + sender-key byte-format compatibility)',
	{ timeout: 180_000 },
	() => {
		let alice: BridgeClient
		let bob: BridgeClient | UpstreamClient
		let charlie: BridgeClient
		let bobJidBeforeSwap: string
		let bobLidBeforeSwap: string | undefined
		let bobSessionBaseKeysBeforeSwap: Map<string, Set<string>>
		let groupJid: string

		before(async () => {
			;[alice, bob, charlie] = await Promise.all([
				createBridgeClient('alice'),
				createBridgeClient('bob'),
				createBridgeClient('charlie')
			])
			logger.info({ alice: alice.jid, bob: bob.jid, charlie: charlie.jid }, 'Trio paired on baileyrs')
		})

		after(async () => {
			await Promise.all([destroyClient(alice, true), destroyClient(bob, true), destroyClient(charlie, true)])
		})

		// ── Pre-swap: 1:1 ────────────────────────────────────────────────────────

		test('Phase 1 — pre-swap 1:1: alice ↔ bob exchange establishes pairwise Signal sessions on disk', async () => {
			// Forward (alice → bob) — first send forces the PreKey signal handshake.
			await assertDelivery({
				sender: alice,
				to: bob.jid,
				text: `phase1-a2b-${Date.now()}`,
				recvWaiter: pred => waitForMessage((bob as BridgeClient).sock, pred),
				expectedRemoteJid: alice.jid
			})

			// Reverse (bob → alice) — completes the handshake and advances both
			// ratchet states so the next disk write contains real chain keys.
			await assertDelivery({
				sender: bob,
				to: alice.jid,
				text: `phase1-b2a-${Date.now()}`,
				recvWaiter: pred => waitForMessage(alice.sock, pred),
				expectedRemoteJid: bob.jid
			})
		})

		// ── Pre-swap: Group (sender keys) ────────────────────────────────────────

		test('Phase 2 — pre-swap group setup: alice creates group with bob+charlie', async () => {
			// Register waiters BEFORE groupCreate — the mock fans the create
			// notification immediately on accept, racing any post-await wiring.
			const subject = `Handoff trio ${Date.now()}`
			const aliceUpdate = waitForEvent(alice.sock, 'groups.update')
			const bobUpdate = waitForEvent((bob as BridgeClient).sock, 'groups.update')
			const charlieUpdate = waitForEvent(charlie.sock, 'groups.update')

			const result = await alice.sock.groupCreate(subject, [bob.jid, charlie.jid])
			expect(result).toBeDefined()
			expect(result.gid.endsWith('@g.us')).toBe(true)
			groupJid = result.gid

			const [a, b, c] = await Promise.all([aliceUpdate, bobUpdate, charlieUpdate])
			expect(a[0]?.id).toBe(groupJid)
			expect(b[0]?.id).toBe(groupJid)
			expect(c[0]?.id).toBe(groupJid)
		})

		test('Phase 3 — pre-swap group: every member sends → other two receive (populates 3 sender keys per client)', async () => {
			// alice → group: populates bob's + charlie's "alice receive" sender key
			const t1 = `phase3-a-${Date.now()}`
			const bobGetsT1 = waitForMessage((bob as BridgeClient).sock, m => getTextContent(m) === t1 && !m.key?.fromMe)
			const charlieGetsT1 = waitForMessage(charlie.sock, m => getTextContent(m) === t1 && !m.key?.fromMe)
			const sentT1 = await alice.sock.sendMessage(groupJid, { text: t1 })
			expect(sentT1).toBeDefined()
			const [bobMsg1, charlieMsg1] = await Promise.all([bobGetsT1, charlieGetsT1])
			expect(getTextContent(bobMsg1)).toBe(t1)
			expect(getTextContent(charlieMsg1)).toBe(t1)
			expect(bobMsg1.key?.id).toBe(sentT1!.key.id)
			expect(charlieMsg1.key?.id).toBe(sentT1!.key.id)
			expect(bobMsg1.key?.remoteJid).toBe(groupJid)
			expect(charlieMsg1.key?.remoteJid).toBe(groupJid)
			expect(bobMsg1.key?.participant).toBe(lidJid(alice))
			expect(charlieMsg1.key?.participant).toBe(lidJid(alice))

			// bob → group: populates alice's + charlie's "bob receive" sender key
			const t2 = `phase3-b-${Date.now()}`
			const aliceGetsT2 = waitForMessage(alice.sock, m => getTextContent(m) === t2 && !m.key?.fromMe)
			const charlieGetsT2 = waitForMessage(charlie.sock, m => getTextContent(m) === t2 && !m.key?.fromMe)
			const sentT2 = await (bob as BridgeClient).sock.sendMessage(groupJid, { text: t2 })
			const [aliceMsg2, charlieMsg2] = await Promise.all([aliceGetsT2, charlieGetsT2])
			expect(getTextContent(aliceMsg2)).toBe(t2)
			expect(getTextContent(charlieMsg2)).toBe(t2)
			expect(aliceMsg2.key?.id).toBe(sentT2!.key.id)
			expect(charlieMsg2.key?.id).toBe(sentT2!.key.id)
			expect(aliceMsg2.key?.participant).toBe(lidJid(bob))
			expect(charlieMsg2.key?.participant).toBe(lidJid(bob))

			// charlie → group: populates alice's + bob's "charlie receive" sender key
			const t3 = `phase3-c-${Date.now()}`
			const aliceGetsT3 = waitForMessage(alice.sock, m => getTextContent(m) === t3 && !m.key?.fromMe)
			const bobGetsT3 = waitForMessage((bob as BridgeClient).sock, m => getTextContent(m) === t3 && !m.key?.fromMe)
			const sentT3 = await charlie.sock.sendMessage(groupJid, { text: t3 })
			const [aliceMsg3, bobMsg3] = await Promise.all([aliceGetsT3, bobGetsT3])
			expect(getTextContent(aliceMsg3)).toBe(t3)
			expect(getTextContent(bobMsg3)).toBe(t3)
			expect(aliceMsg3.key?.id).toBe(sentT3!.key.id)
			expect(bobMsg3.key?.id).toBe(sentT3!.key.id)
			expect(aliceMsg3.key?.participant).toBe(lidJid(charlie))
			expect(bobMsg3.key?.participant).toBe(lidJid(charlie))
		})

		test('Phase 4 — second alice → group send: cached sender key path (no SKDM resend) — bridge-only baseline', async () => {
			// Why this exists: in Phase 6 we'll do the same thing again, but with
			// bob on upstream. If THAT phase fails while THIS one succeeds, we
			// know the regression is specifically in the cross-impl read of
			// sender-key bytes — not in the cached-send codepath itself.
			await assertDelivery({
				sender: alice,
				to: groupJid,
				text: `phase4-a2g-cached-${Date.now()}`,
				recvWaiter: pred => waitForMessage((bob as BridgeClient).sock, pred),
				expectedRemoteJid: groupJid,
				expectedParticipant: lidJid(alice)
			})
		})

		// ── Swap ────────────────────────────────────────────────────────────────

		test('Phase 5 — disconnect bob (bridge) and re-bring-up under upstream baileys with the same auth folder', async () => {
			bobJidBeforeSwap = bob.jid
			bobLidBeforeSwap = bob.lid
			const folder = bob.authFolder

			// destroyClient with removeFolder=false — we keep the on-disk auth so
			// the upstream rebuild can read sessions + sender keys that bridge
			// wrote in Phases 1–4.
			await destroyClient(bob, false)

			// Snapshot every OPEN session baseKey on bob's disk RIGHT NOW
			// (after bridge has flushed its writes via destroyClient's `end()`,
			// before upstream reconnects). If post-swap traffic triggers a
			// silent re-handshake on any peer, the corresponding baseKey will
			// vanish and a new one will appear — Phase 8b uses this snapshot
			// to detect that.
			bobSessionBaseKeysBeforeSwap = snapshotOpenSessionBaseKeys(folder)
			expect(bobSessionBaseKeysBeforeSwap.size).toBeGreaterThan(0)
			logger.info(
				{ addresses: Array.from(bobSessionBaseKeysBeforeSwap.keys()) },
				'Phase 5: pre-swap session addresses on bob disk'
			)

			// Tiny breath to let the mock drop the prior socket before reconnect.
			await new Promise(r => setTimeout(r, 250))

			bob = await createUpstreamClient('bob', folder)

			// Identity must be preserved across the swap. If the upstream reload
			// produces a different JID/LID, the auth folder didn't actually
			// transfer — the rest of the test would silently exercise a brand
			// new identity instead of the cross-impl readback we care about.
			// Compare only the `user@server` portion via stripDeviceSuffix —
			// bridge represents the LID as `100000…:DEVICE@lid` while upstream
			// strips the device, returning `100000…@lid` (same identity).
			expect(bob.kind).toBe('upstream')
			expect(stripDeviceSuffix(bob.jid)).toBe(stripDeviceSuffix(bobJidBeforeSwap))
			if (bobLidBeforeSwap) {
				expect(stripDeviceSuffix(bob.lid)).toBe(stripDeviceSuffix(bobLidBeforeSwap))
			}
		})

		// ── Post-swap: 1:1 ──────────────────────────────────────────────────────

		test('Phase 6 — post-swap 1:1: alice (bridge) → bob (upstream) — JS libsignal must decrypt a session Rust libsignal wrote', async () => {
			// If the on-disk session bytes were incompatible, upstream would
			// throw `Bad MAC` here and the recv waiter would time out instead of
			// producing the plaintext.
			await assertDelivery({
				sender: alice,
				to: bob.jid,
				text: `phase6-a2b-${Date.now()}`,
				recvWaiter: pred => waitForUpstreamMessage((bob as UpstreamClient).sock, pred),
				expectedRemoteJid: alice.jid
			})
		})

		test('Phase 7 — post-swap 1:1: bob (upstream) → alice (bridge) — Rust libsignal must decrypt a session JS libsignal advanced', async () => {
			await assertDelivery({
				sender: bob,
				to: alice.jid,
				text: `phase7-b2a-${Date.now()}`,
				recvWaiter: pred => waitForMessage(alice.sock, pred),
				expectedRemoteJid: bob.jid
			})
		})

		test('Phase 8 — post-swap 1:1 second roundtrip: alice ↔ bob still decrypt after the cross-impl ratchet step', async () => {
			// Forward once more — confirms the ratchet didn't desync after the
			// previous step. A one-shot success could just be a freshly-resent
			// PreKey signal hiding a corrupt session; this catches that.
			await assertDelivery({
				sender: alice,
				to: bob.jid,
				text: `phase8-a2b-${Date.now()}`,
				recvWaiter: pred => waitForUpstreamMessage((bob as UpstreamClient).sock, pred),
				expectedRemoteJid: alice.jid
			})

			await assertDelivery({
				sender: bob,
				to: alice.jid,
				text: `phase8-b2a-${Date.now()}`,
				recvWaiter: pred => waitForMessage(alice.sock, pred),
				expectedRemoteJid: bob.jid
			})
		})

		test('Phase 8b — no silent re-handshake: bob disk session for alice has the SAME baseKey as before the swap', async () => {
			// What this proves: in Phases 6-8, bob (upstream) decrypted alice's
			// real Signal message using the on-disk session bytes that bridge
			// wrote pre-swap, NOT a freshly-handshaked replacement triggered
			// by a `pkmsg` retry. That distinction is invisible from the
			// message-level assertions (both paths deliver plaintext) but
			// matters operationally: re-handshakes cost extra wire roundtrips
			// per peer pair and reset out-of-order tolerance.
			//
			// Mechanism: a session's `baseKey` (alice base key) is fixed at
			// session creation. The post-swap snapshot must INCLUDE every
			// baseKey present pre-swap; if any vanished, that session was
			// closed and replaced by a re-handshake.
			//
			// We give the upstream a beat to flush its post-receive writes
			// before reading the file (`useMultiFileAuthState` does mutex
			// + writeFile sequentially per id, no debounce, but we want the
			// chain advance from Phase 8's exchange to be on disk).
			await new Promise(r => setTimeout(r, 200))
			const afterSnapshot = snapshotAllSessionBaseKeys(bob.authFolder)
			// A re-handshake means the old open baseKey is GONE from the
			// session file entirely (deleted), or replaced. Mere rotation
			// where the old session is kept (`closed > 0`) and a new one
			// opens at a different device variant doesn't count as a
			// re-handshake on the path we exercised.
			const rotated: Array<{ addr: string; pre: string[]; post: string[] }> = []
			for (const [addr, preSet] of bobSessionBaseKeysBeforeSwap) {
				const postSet = afterSnapshot.get(addr) ?? new Set<string>()
				const missing = Array.from(preSet).filter(k => !postSet.has(k))
				if (missing.length > 0) {
					rotated.push({ addr, pre: Array.from(preSet), post: Array.from(postSet) })
				}
			}
			if (rotated.length > 0) {
				logger.warn(
					{ rotated },
					'Phase 8b: re-handshake detected — pre-swap baseKey(s) missing from post-swap (open OR closed) for some peer addresses'
				)
			}
			expect(rotated.length).toBe(0)
		})

		// ── Post-swap: Group (sender keys cross-impl) ───────────────────────────

		test('Phase 9 — post-swap group: alice (bridge) → group; bob (upstream) decrypts using on-disk sender key bytes Rust wrote', async () => {
			// alice's bridge has cached "bob already has my sender key" (from
			// Phase 3+4), so this send omits the SKDM. Bob's upstream JS
			// libsignal therefore CANNOT fall back to a fresh handshake — it
			// MUST deserialize the sender key bytes that bridge wrote to
			// `sender_key/<groupId>::<aliceLid>::<deviceId>` on disk. If the
			// byte format diverges, this times out and the regression is
			// exposed.
			const text = `phase9-a2g-${Date.now()}`
			const bobGetsIt = waitForUpstreamMessage(
				(bob as UpstreamClient).sock,
				m => getTextContent(m) === text && !m.key?.fromMe
			)
			const charlieGetsIt = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)
			const sent = await alice.sock.sendMessage(groupJid, { text })
			expect(sent).toBeDefined()

			const [bobMsg, charlieMsg] = await Promise.all([bobGetsIt, charlieGetsIt])
			expect(getTextContent(bobMsg)).toBe(text)
			expect(getTextContent(charlieMsg)).toBe(text)
			expect(bobMsg.key?.id).toBe(sent!.key.id)
			expect(charlieMsg.key?.id).toBe(sent!.key.id)
			expect(bobMsg.key?.remoteJid).toBe(groupJid)
			expect(charlieMsg.key?.remoteJid).toBe(groupJid)
			expect(bobMsg.key?.participant).toBe(lidJid(alice))
			expect(charlieMsg.key?.participant).toBe(lidJid(alice))
		})

		test('Phase 10 — post-swap group: charlie (bridge) → group; bob (upstream) decrypts charlie sender key bytes Rust wrote', async () => {
			// Same shape as Phase 9 but exercising charlie's sender key — this
			// catches regressions that only break for non-creator senders (e.g.
			// if alice's gid had any privileged bookkeeping).
			const text = `phase10-c2g-${Date.now()}`
			const aliceGetsIt = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
			const bobGetsIt = waitForUpstreamMessage(
				(bob as UpstreamClient).sock,
				m => getTextContent(m) === text && !m.key?.fromMe
			)
			const sent = await charlie.sock.sendMessage(groupJid, { text })
			expect(sent).toBeDefined()

			const [aliceMsg, bobMsg] = await Promise.all([aliceGetsIt, bobGetsIt])
			expect(getTextContent(aliceMsg)).toBe(text)
			expect(getTextContent(bobMsg)).toBe(text)
			expect(aliceMsg.key?.id).toBe(sent!.key.id)
			expect(bobMsg.key?.id).toBe(sent!.key.id)
			expect(aliceMsg.key?.participant).toBe(lidJid(charlie))
			expect(bobMsg.key?.participant).toBe(lidJid(charlie))
		})

		test('Phase 11 — post-swap group: bob (upstream) → group; alice + charlie (bridge) decrypt bob NEW sender key (JS-written, Rust-read)', async () => {
			// The reverse cross-impl direction. Bob's previous send chain was
			// rotated by the swap (different libsignal impl creates a fresh
			// sending sender key), so this send embeds a brand-new SKDM.
			// alice + charlie (bridge) must:
			//   (a) decrypt bob's SKDM via their pairwise session with bob —
			//       same path Phase 7 validated.
			//   (b) install the new sender key (JS-format bytes) into their
			//       Rust libsignal store via wrapLegacyStore.
			//   (c) decrypt the message body with that sender key.
			// Failing means either (b) writes an unreadable format or (c) can't
			// re-load it inside the same connection.
			const text = `phase11-b2g-${Date.now()}`
			const aliceGetsIt = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
			const charlieGetsIt = waitForMessage(charlie.sock, m => getTextContent(m) === text && !m.key?.fromMe)
			const sent = await (bob as UpstreamClient).sock.sendMessage(groupJid, { text })
			expect(sent).toBeDefined()

			const [aliceMsg, charlieMsg] = await Promise.all([aliceGetsIt, charlieGetsIt])
			expect(getTextContent(aliceMsg)).toBe(text)
			expect(getTextContent(charlieMsg)).toBe(text)
			expect(aliceMsg.key?.remoteJid).toBe(groupJid)
			expect(charlieMsg.key?.remoteJid).toBe(groupJid)
			expect(aliceMsg.key?.participant).toBe(lidJid(bob))
			expect(charlieMsg.key?.participant).toBe(lidJid(bob))
			// sent!.key.id may differ in shape between libs; assert presence at minimum.
			expect(aliceMsg.key?.id).toBeTruthy()
			expect(charlieMsg.key?.id).toBeTruthy()
			if (sent?.key?.id) {
				expect(aliceMsg.key?.id).toBe(sent.key.id)
				expect(charlieMsg.key?.id).toBe(sent.key.id)
			}
		})

		test('Phase 12 — post-swap group second roundtrip: bob → group again, then alice → group again; both still decrypt', async () => {
			// Catches a sender-key chain desync that survives the first send but
			// breaks on the second — symmetric to Phase 8 for the group
			// codepath.
			const t1 = `phase12-b2g-${Date.now()}`
			const aliceGetsT1 = waitForMessage(alice.sock, m => getTextContent(m) === t1 && !m.key?.fromMe)
			const charlieGetsT1 = waitForMessage(charlie.sock, m => getTextContent(m) === t1 && !m.key?.fromMe)
			await (bob as UpstreamClient).sock.sendMessage(groupJid, { text: t1 })
			const [aliceM1, charlieM1] = await Promise.all([aliceGetsT1, charlieGetsT1])
			expect(getTextContent(aliceM1)).toBe(t1)
			expect(getTextContent(charlieM1)).toBe(t1)

			const t2 = `phase12-a2g-${Date.now()}`
			const bobGetsT2 = waitForUpstreamMessage(
				(bob as UpstreamClient).sock,
				m => getTextContent(m) === t2 && !m.key?.fromMe
			)
			const charlieGetsT2 = waitForMessage(charlie.sock, m => getTextContent(m) === t2 && !m.key?.fromMe)
			await alice.sock.sendMessage(groupJid, { text: t2 })
			const [bobM2, charlieM2] = await Promise.all([bobGetsT2, charlieGetsT2])
			expect(getTextContent(bobM2)).toBe(t2)
			expect(getTextContent(charlieM2)).toBe(t2)
		})
	}
)
