/**
 * `messageId` is a documented upstream option: "override the message ID with a
 * custom provided string". Upstream honours it on every send. Here it was
 * accepted, typed, and thrown away: `sendMessage` never handed it to the
 * bridge, so a caller using it for idempotency got a different id back with no
 * error and no warning.
 *
 * What is tested here is that the id a caller passes is the id on the wire and
 * the id returned, that both `sendMessage` and `relayMessage` resolve it
 * through the same place, and that the two paths that cannot carry a caller id
 * today (edit and revoke) say so instead of staying silent.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { makeMessageMethods } from '../Socket/messages.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BinaryNode, WAProto } from '../Types/index.ts'

const CALLER_ID = '3EB0CALLERPROVIDED'
const ENGINE_ID = '3EB0ENGINEASSIGNED'

type RecordedCall = {
	method: string
	jid?: string
	messageId?: string | null
	targetId?: string
	recipients?: string[]
	nodes?: BinaryNode[]
	/** Whether a stanza id was passed at all, which `undefined` alone cannot say. */
	argCount?: number
}

/** 4 when the edit carried a stanza id, 3 when it did not. */
const arguments_of = (stanzaId?: string) => (stanzaId === undefined ? 3 : 4)

/**
 * A bridge double that echoes the id it was given, the way the engine does,
 * and answers with its own id on every call that carries none. Under the old
 * code the id-less calls are the ones `sendMessage` makes, so every assertion
 * on the caller's id fails against ENGINE_ID.
 */
const sendRecording = () => {
	const calls: RecordedCall[] = []
	const warns: string[] = []
	const logger = {
		level: 'silent',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: (_obj: unknown, msg?: string) => {
			warns.push(msg ?? String(_obj))
		},
		error: () => undefined
	}
	const client = {
		relayMessageBytesWithOptions: async (
			jid: string,
			_bytes: Uint8Array,
			messageId: string | null | undefined,
			nodes: BinaryNode[]
		) => {
			calls.push({ method: 'relayMessageBytesWithOptions', jid, messageId, nodes })
			return messageId || ENGINE_ID
		},
		sendStatusMessageBytesWithOptions: async (
			_bytes: Uint8Array,
			recipients: string[],
			messageId: string | null | undefined,
			nodes: BinaryNode[]
		) => {
			calls.push({ method: 'sendStatusMessageBytesWithOptions', messageId, recipients, nodes })
			return messageId || ENGINE_ID
		},
		sendMessageBytes: async (jid: string) => {
			calls.push({ method: 'sendMessageBytes', jid, messageId: undefined })
			return ENGINE_ID
		},
		sendStatusMessageBytes: async (_bytes: Uint8Array, recipients: string[]) => {
			calls.push({ method: 'sendStatusMessageBytes', messageId: undefined, recipients })
			return ENGINE_ID
		},
		revokeMessage: async (jid: string, targetId: string) => {
			calls.push({ method: 'revokeMessage', jid, targetId })
		},
		editMessageBytes: async (jid: string, targetId: string, _bytes: Uint8Array, stanzaId?: string) => {
			calls.push({ method: 'editMessageBytes', jid, targetId, messageId: stanzaId, argCount: arguments_of(stanzaId) })
			return stanzaId || ENGINE_ID
		}
	}
	const ctx = {
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <A extends unknown[], R>(work: (...a: A) => Promise<R>) => work
		}),
		logger,
		fullConfig: { options: {}, emitOwnEvents: false },
		getUser: () => ({ id: '15550000000@s.whatsapp.net' }),
		getMe: () => ({ id: '15550000000@s.whatsapp.net' }),
		getClient: async () => client
	} as unknown as SocketContext
	const methods = makeMessageMethods(ctx)
	return { calls, warns, send: methods.sendMessage, relay: methods.relayMessage }
}

const DM = '15550000001@s.whatsapp.net'

describe('sendMessage with a caller-provided messageId', () => {
	it('puts the caller id on the stanza and returns it', async () => {
		const { calls, send } = sendRecording()
		const sent = await send(DM, { text: 'oi' }, { messageId: CALLER_ID })

		assert.equal(calls.length, 1)
		assert.equal(calls[0]?.messageId, CALLER_ID, 'the bridge must receive the id the caller asked for')
		assert.equal(sent.key.id, CALLER_ID, 'the returned key must be the id actually used')
	})

	it('sends the same caller id twice when asked twice, which is what idempotent resend means', async () => {
		const { calls, send } = sendRecording()
		await send(DM, { text: 'oi' }, { messageId: CALLER_ID })
		await send(DM, { text: 'oi' }, { messageId: CALLER_ID })
		assert.equal(calls[0]?.messageId, CALLER_ID)
		assert.equal(calls[1]?.messageId, CALLER_ID)
	})

	it('carries the caller id to a status send as well', async () => {
		const { calls, send } = sendRecording()
		const sent = await send(
			'status@broadcast',
			{ text: 'oi' },
			{ messageId: CALLER_ID, statusJidList: ['15550000002@s.whatsapp.net'] }
		)
		assert.equal(calls[0]?.method, 'sendStatusMessageBytesWithOptions')
		assert.equal(calls[0]?.messageId, CALLER_ID)
		assert.deepEqual(calls[0]?.recipients, ['15550000002@s.whatsapp.net'])
		assert.equal(sent.key.id, CALLER_ID)
	})
})

describe('sendMessage without the option', () => {
	it('still generates an id, and two sends do not collide', async () => {
		const { calls, send } = sendRecording()
		const first = await send(DM, { text: 'oi' })
		const second = await send(DM, { text: 'oi' })

		assert.match(first.key.id!, /^3EB0[0-9A-F]{18}$/)
		assert.match(second.key.id!, /^3EB0[0-9A-F]{18}$/)
		assert.notEqual(first.key.id, second.key.id)
		// The generated id is decided before the bridge call, not by the double's
		// fallback: the id on the wire and the id returned are the same string.
		assert.equal(calls[0]?.messageId, first.key.id)
		assert.equal(calls[1]?.messageId, second.key.id)
	})
})

describe('one resolution for both send paths', () => {
	it('hands the bridge the same id whether the caller went through sendMessage or relayMessage', async () => {
		// The proof that the resolution is a single place: the same option on
		// either path reaches the bridge as the same string. A reintroduced
		// second generator in either path overrides the caller and fails here.
		const { calls, send, relay } = sendRecording()
		await send(DM, { text: 'oi' }, { messageId: CALLER_ID })
		await relay(DM, { conversation: 'oi' } as WAProto.IMessage, { messageId: CALLER_ID })

		assert.equal(calls.length, 2)
		assert.equal(calls[0]?.messageId, CALLER_ID)
		assert.equal(calls[1]?.messageId, CALLER_ID)
		assert.equal(calls[0]?.messageId, calls[1]?.messageId)
	})
})

describe('revoke, which still cannot carry a caller id', () => {
	const targetKey = { remoteJid: DM, fromMe: true, id: '3EB0TARGETMESSAGE0' }

	it('revoke: warns instead of silently dropping the option, and still revokes the target', async () => {
		const { calls, warns, send } = sendRecording()
		await send(DM, { delete: targetKey }, { messageId: CALLER_ID })

		assert.equal(calls[0]?.method, 'revokeMessage')
		assert.equal(calls[0]?.targetId, targetKey.id, 'the target of the revoke is untouched')
		assert.equal(warns.length, 1)
		assert.match(warns[0]!, /messageId/, 'the warning must name the option it cannot honour')
	})

	it('revoke: stays quiet when the option was not passed', async () => {
		const { warns, send } = sendRecording()
		await send(DM, { delete: targetKey })
		assert.equal(warns.length, 0)
	})
})

/**
 * The edit counterpart, which the bridge could not carry until 0.15.0 exposed a
 * fourth argument on `editMessageBytes`. Pinning an edit to an existing id is
 * how a caller re-renders a slot the server refuses to revoke, so the id has to
 * reach the bridge, and absent has to stay absent: the engine treats any
 * supplied id as borrowed and binds no retry-cache entry or outbound secret to
 * it, which is a cost an edit nobody asked to pin must not pay.
 */
describe('edit with a caller-provided messageId', () => {
	const targetKey = { remoteJid: DM, fromMe: true, id: '3EB0TARGETMESSAGE0' }

	it('forwards the caller id as the stanza id, leaving the edit target alone', async () => {
		const { calls, send } = sendRecording()
		const sent = await send(DM, { text: 'edited', edit: targetKey }, { messageId: CALLER_ID })

		assert.equal(calls[0]?.method, 'editMessageBytes')
		assert.equal(calls[0]?.targetId, targetKey.id, 'the third argument still names the message being edited')
		assert.equal(calls[0]?.messageId, CALLER_ID, 'the fourth argument is the stanza the edit goes out under')
		assert.equal(sent.key.id, CALLER_ID, 'the returned key is the id actually used')
	})

	it('passes no stanza id when the caller asked for none', async () => {
		const { calls, send } = sendRecording()
		const sent = await send(DM, { text: 'edited', edit: targetKey })

		assert.equal(calls[0]?.argCount, 3, 'an unasked edit must not borrow an id and lose its id-keyed state')
		assert.equal(calls[0]?.messageId, undefined)
		assert.equal(sent.key.id, ENGINE_ID, 'the engine still assigns it')
	})

	it('treats an empty messageId as unspecified', async () => {
		// Every other id path in this API falls back on falsy, so '' must not
		// reach the wire as a stanza id.
		const { calls, send } = sendRecording()
		await send(DM, { text: 'edited', edit: targetKey }, { messageId: '' })

		assert.equal(calls[0]?.argCount, 3)
		assert.equal(calls[0]?.messageId, undefined)
	})

	it('stays quiet: the option is honoured now, so there is nothing to warn about', async () => {
		const { warns, send } = sendRecording()
		await send(DM, { text: 'edited', edit: targetKey }, { messageId: CALLER_ID })
		assert.equal(warns.length, 0)
	})
})
