/**
 * A caller's `<biz>` on an interactive message, which upstream Baileys requires
 * and this engine derives for itself.
 *
 * Upstream attaches no stanza children of its own, so every payment recipe in
 * that ecosystem tells the caller to supply one. The engine here derives it
 * from the message content, and from bridge 0.11.0 refuses the caller's rather
 * than putting two on one `<message>` — which is the shape a client silently
 * declines to render, measured on a live account.
 *
 * Refusing is right, and this is not undoing it. What is tested here is the
 * promise this library makes: that Baileys code runs unchanged. The retry has
 * to be narrow enough that a rejection meaning anything else still reaches the
 * caller, because a blanket retry sends the message twice.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { derivedNodeConflictTag, withoutDerivedNode } from '../Compatibility/derived-stanza-nodes.ts'
import { makeMessageMethods } from '../Socket/messages.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BinaryNode, WAProto } from '../Types/index.ts'

/** The rejection the engine raises, as the bridge hands it to JavaScript. */
const conflict = (tag: string) => ({
	kind: 'invalid-argument',
	field: 'extra_stanza_nodes',
	reason: `extra stanza child <${tag}> conflicts with the one this send derives from the message`
})

const biz: BinaryNode = { tag: 'biz', attrs: { native_flow_name: 'payment_info' } }
const bot: BinaryNode = { tag: 'bot', attrs: { biz_bot: '1' } }
const unrelated: BinaryNode = { tag: 'meta', attrs: { thing: '1' } }

describe('a stanza node the engine derives for itself', () => {
	it('names the tag the engine refused', () => {
		assert.equal(derivedNodeConflictTag(conflict('biz')), 'biz')
		assert.equal(derivedNodeConflictTag(conflict('bot')), 'bot')
	})

	it('reads the tag off an Error as well as off a plain rejection', () => {
		// The bridge throws an Error carrying `kind`; a plain object is what a
		// test double hands over. Both have to be understood, or the retry works
		// in one of the two and not the other.
		const error = Object.assign(new Error(conflict('biz').reason), { kind: 'invalid-argument' })
		assert.equal(derivedNodeConflictTag(error), 'biz')
	})

	it('ignores an invalid-argument that means something else', () => {
		// The one that matters: a malformed JID is also `invalid-argument`, and
		// retrying it would send nothing the first time and nothing the second,
		// or worse, send twice on a rejection that had already been delivered.
		assert.equal(
			derivedNodeConflictTag({ kind: 'invalid-argument', field: 'jid', reason: 'jid is not addressable' }),
			undefined
		)
	})

	it('ignores every other rejection shape', () => {
		for (const other of [
			{ kind: 'not-connected' },
			{ kind: 'timeout' },
			{ kind: 'internal', message: 'conflicts with the one this send derives' },
			new Error('conflicts with the one this send derives'),
			null,
			undefined,
			'a string'
		]) {
			assert.equal(derivedNodeConflictTag(other), undefined, `${JSON.stringify(other)} should not be retried`)
		}
	})

	it('drops only the refused tag, keeping the caller nodes around it', () => {
		assert.deepEqual(withoutDerivedNode([biz], 'biz'), [])
		assert.deepEqual(withoutDerivedNode([unrelated, biz], 'biz'), [unrelated])
		assert.deepEqual(withoutDerivedNode([biz, bot], 'bot'), [biz])
	})

	it('reports nothing to retry when the refused tag is not among the caller nodes', () => {
		// Then the rejection is about something this cannot fix, and returning an
		// unchanged list would retry an identical send.
		assert.equal(withoutDerivedNode([unrelated], 'biz'), undefined)
		assert.equal(withoutDerivedNode([], 'biz'), undefined)
	})
})

/**
 * A relay whose first attempt is refused for `refusedTag`, recording the nodes
 * of every attempt so the retry can be told apart from the original.
 */
const relayRefusing = (refusedTag: string | undefined) => {
	const attempts: BinaryNode[][] = []
	const logger = {
		level: 'silent',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined
	}
	const client = {
		relayMessageBytesWithOptions: async (_jid: string, _bytes: Uint8Array, messageId: string, nodes: BinaryNode[]) => {
			attempts.push(nodes)
			if (attempts.length === 1 && refusedTag) throw conflict(refusedTag)
			return messageId
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
	return { attempts, relay: makeMessageMethods(ctx).relayMessage }
}

const INTERACTIVE = {
	interactiveMessage: { nativeFlowMessage: { buttons: [{ name: 'payment_info', buttonParamsJson: '{}' }] } }
} as unknown as WAProto.IMessage

describe('relayMessage against an engine that derives its own stanza children', () => {
	it('resends without the refused node, so Baileys code sends once and works', async () => {
		const { attempts, relay } = relayRefusing('biz')
		const id = await relay('120363000000000000@g.us', INTERACTIVE, {
			messageId: '3EB0DERIVED0001',
			additionalNodes: [biz]
		})

		assert.equal(id, '3EB0DERIVED0001')
		assert.equal(attempts.length, 2)
		assert.deepEqual(attempts[0], [biz], 'the first attempt sends what the caller asked for')
		assert.deepEqual(attempts[1], [], 'the retry drops only the node the engine derives')
	})

	it('keeps the caller nodes the engine did not derive', async () => {
		const { attempts, relay } = relayRefusing('biz')
		await relay('120363000000000000@g.us', INTERACTIVE, {
			messageId: '3EB0DERIVED0002',
			additionalNodes: [unrelated, biz]
		})
		assert.deepEqual(attempts[1], [unrelated])
	})

	it('sends once when nothing is refused', async () => {
		const { attempts, relay } = relayRefusing(undefined)
		await relay('120363000000000000@g.us', INTERACTIVE, {
			messageId: '3EB0DERIVED0003',
			additionalNodes: [biz]
		})
		assert.equal(attempts.length, 1)
	})

	it('propagates a rejection that is not this one, without a second send', async () => {
		// The failure mode that matters: retrying an unrelated error is how one
		// send becomes two messages.
		const { attempts } = relayRefusing('biz')
		const boom = { kind: 'not-connected' }
		const client = { relayMessageBytesWithOptions: async () => Promise.reject(boom) }
		const logger = {
			level: 'silent',
			child: () => logger,
			trace: () => undefined,
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined
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
		await assert.rejects(
			() =>
				makeMessageMethods(ctx).relayMessage('120363000000000000@g.us', INTERACTIVE, {
					messageId: '3EB0DERIVED0004',
					additionalNodes: [biz]
				}),
			(error: unknown) => error === boom
		)
		assert.equal(attempts.length, 0)
	})
})
