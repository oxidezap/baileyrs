import { describe, it } from 'node:test'
import { proto } from 'whatsapp-rust-bridge/proto-types'
import { expect } from './expect.ts'

/**
 * Smoke tests asserting that the runtime `proto` namespace (sourced from the
 * bridge's auto-assembled ts-proto wrapper at `whatsapp-rust-bridge/proto-types`)
 * keeps matching the protobufjs-style surface its `.d.ts` declares to consumers.
 *
 * These guard against drift in two directions:
 *  1. Types listed in `.d.ts` whose runtime counterpart silently disappears
 *     (e.g. wacore proto removes a message → bridge regenerates → `proto.X`
 *     becomes `undefined` while `.d.ts` still pretends it exists).
 *  2. Method shape regressions on the wrapper (encode returning a writer with
 *     `.finish()`, decode accepting a `Uint8Array`, fromObject staying
 *     idempotent for plain inputs, etc.).
 *
 * Coverage is intentionally narrow: the hot-path types every bot touches plus
 * a handful of nested namespaces and enum values whose presence implies the
 * underscore-split namespace assembly is still working. Adding more is cheap
 * if a regression slips through.
 */
describe('proto namespace alignment', () => {
	const requirePath = (path: string) => {
		const node = path.split('.').reduce<unknown>((cursor, segment) => {
			if (cursor === undefined || cursor === null) return cursor
			return (cursor as Record<string, unknown>)[segment]
		}, proto)
		expect(node).toBeDefined()
		return node
	}

	const requireMessageMethods = (path: string) => {
		const node = requirePath(path) as Record<string, unknown>
		for (const method of ['encode', 'decode', 'fromObject', 'create', 'toObject'] as const) {
			expect(typeof node[method]).toBe('function')
		}
	}

	it('exposes the top-level message types bots send', () => {
		requireMessageMethods('Message')
		requireMessageMethods('WebMessageInfo')
		requireMessageMethods('SyncActionValue')
		requireMessageMethods('SyncActionData')
		requireMessageMethods('HistorySync')
		requireMessageMethods('ClientPayload')
		requireMessageMethods('HandshakeMessage')
		requireMessageMethods('SenderKeyDistributionMessage')
		requireMessageMethods('SenderKeyMessage')
	})

	it('exposes nested message types via underscore-split namespacing', () => {
		// `Message_VideoMessage` → `proto.Message.VideoMessage`
		requireMessageMethods('Message.VideoMessage')
		requireMessageMethods('Message.ImageMessage')
		requireMessageMethods('Message.AudioMessage')
		requireMessageMethods('Message.DocumentMessage')
		requireMessageMethods('Message.ProtocolMessage')
		requireMessageMethods('Message.ExtendedTextMessage')
	})

	it('exposes deeply nested enums with their wire values', () => {
		// `Message_ProtocolMessage_Type` → `proto.Message.ProtocolMessage.Type`
		const protocolType = requirePath('Message.ProtocolMessage.Type') as Record<string, number>
		expect(protocolType.REVOKE).toBe(0)
		expect(protocolType.MESSAGE_EDIT).toBe(14)
		expect(protocolType.PEER_DATA_OPERATION_REQUEST_MESSAGE).toBe(16)

		const status = requirePath('WebMessageInfo.Status') as Record<string, number>
		expect(status.SERVER_ACK).toBe(2)

		const stubType = requirePath('WebMessageInfo.StubType') as Record<string, number>
		expect(typeof stubType.GROUP_CREATE).toBe('number')
	})

	it('encode().finish() round-trips through the bridge', () => {
		const buffer = proto.WebMessageInfo.encode({
			key: { remoteJid: '123@s.whatsapp.net', id: 'ABC', fromMe: false },
			messageTimestamp: 1
		}).finish()
		expect(buffer).toBeInstanceOf(Uint8Array)
		expect(buffer.length).toBeGreaterThan(0)

		const decoded = proto.WebMessageInfo.decode(buffer) as {
			key?: { remoteJid?: string; id?: string }
			messageTimestamp?: number
		}
		expect(decoded.key?.remoteJid).toBe('123@s.whatsapp.net')
		expect(decoded.key?.id).toBe('ABC')
	})

	it('lazy-synthesizes unknown sub-properties on Message for forward-compat', () => {
		// The Proxy on `proto.Message` should hand back a passthrough for any
		// capitalized accessor we don't have a real type for, so bot code that
		// compiled against a newer .d.ts than the runtime knows about doesn't
		// crash with `cannot read property 'fromObject' of undefined`.
		const synthesized = (proto.Message as unknown as Record<string, unknown>).SomeNonexistentFutureSubmessageType as {
			fromObject?: (o: unknown) => unknown
		}
		expect(synthesized).toBeDefined()
		expect(typeof synthesized.fromObject).toBe('function')
		// Round-trip: passthrough returns the input unchanged.
		const input = { foo: 'bar' }
		expect(synthesized.fromObject!(input)).toEqual(input)
	})

	it('aliases historical names callers still import (ADVKeyIndexList)', () => {
		// Some upstream Baileys code references `ADVKeyIndexList` even though the
		// canonical name is `ADVSignedKeyIndexList`. Both must resolve.
		requireMessageMethods('ADVSignedKeyIndexList')
		requireMessageMethods('ADVKeyIndexList')
	})
})
