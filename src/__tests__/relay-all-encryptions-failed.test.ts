/**
 * A send that reached nobody.
 *
 * Upstream Baileys drops a device it cannot encrypt for and, once that leaves
 * no ciphertext at all, throws `Boom('All encryptions failed', { statusCode:
 * 500 })`. The engine used to return a message id for that same send, so a
 * caller recorded a delivery that never happened; from bridge 0.13.0 it
 * rejects with `no-recipient-device`.
 *
 * The condition matches, so what is tested here is the spelling: Baileys code
 * branching on the status code or the message has to keep working, and every
 * other rejection has to reach the caller untouched.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { asAllEncryptionsFailed } from '../Compatibility/all-encryptions-failed.ts'
import { makeMessageMethods } from '../Socket/messages.ts'
import type { SocketContext } from '../Socket/types.ts'
import { isBoom } from '../Utils/boom.ts'
import type { WAProto } from '../Types/index.ts'

/** The rejection the engine raises, as the bridge hands it to JavaScript. */
const noRecipientDevice = (attempted: number) => ({ kind: 'no-recipient-device', attempted })

const TEXT = { conversation: 'oi' } as unknown as WAProto.IMessage

describe('a send that produced no ciphertext for its recipient', () => {
	it('is spelled the way upstream spells it', () => {
		const translated = asAllEncryptionsFailed(noRecipientDevice(3))
		assert.ok(isBoom(translated))
		assert.equal(translated.message, 'All encryptions failed')
		assert.equal(translated.output.statusCode, 500)
	})

	it('carries the device count upstream has no way to carry', () => {
		const translated = asAllEncryptionsFailed(noRecipientDevice(3)) as { data: { attempted: number } }
		assert.equal(translated.data.attempted, 3)
	})

	it('reports no count rather than zero when the engine did not say', () => {
		// Zero is a real answer here — the fan-out held no device to try — so it
		// must not double as "the engine was silent".
		const translated = asAllEncryptionsFailed({ kind: 'no-recipient-device' }) as {
			data: { attempted?: number }
		}
		assert.equal(translated.data.attempted, undefined)
		const none = asAllEncryptionsFailed(noRecipientDevice(0)) as { data: { attempted?: number } }
		assert.equal(none.data.attempted, 0)
	})

	it('leaves every other rejection exactly as it was', () => {
		// The one that matters: rewriting an unrelated failure would hide the
		// kind a caller branches on, and invent a 500 for something that is not.
		for (const other of [
			{ kind: 'not-connected' },
			{ kind: 'timeout' },
			{ kind: 'invalid-argument', field: 'jid', reason: 'jid is not addressable' },
			new Error('All encryptions failed'),
			null,
			undefined,
			'a string'
		]) {
			assert.equal(asAllEncryptionsFailed(other), other, `${JSON.stringify(other)} must pass through`)
		}
	})
})

/** A relay whose send rejects with `rejection`, recording how many attempts it took. */
const relayRejecting = (rejection: unknown) => {
	const attempts = { count: 0 }
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
		relayMessageBytesWithOptions: async () => {
			attempts.count++
			throw rejection
		},
		sendStatusMessageBytesWithOptions: async () => {
			attempts.count++
			throw rejection
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

describe('relayMessage against an engine that reports a send reaching nobody', () => {
	it('rejects a chat send the way Baileys code catches it', async () => {
		const { attempts, relay } = relayRejecting(noRecipientDevice(2))
		await assert.rejects(
			() => relay('15550000001@s.whatsapp.net', TEXT, { messageId: '3EB0NOENC0001' }),
			(error: unknown) => isBoom(error) && error.output.statusCode === 500
		)
		// Once: a send that reached nobody is reported, never retried, or one
		// failure becomes two messages the day it starts succeeding.
		assert.equal(attempts.count, 1)
	})

	it('rejects a status send the same way', async () => {
		const { relay } = relayRejecting(noRecipientDevice(1))
		await assert.rejects(
			() =>
				relay('status@broadcast', TEXT, {
					messageId: '3EB0NOENC0002',
					statusJidList: ['15550000002@s.whatsapp.net']
				}),
			(error: unknown) => isBoom(error) && error.output.statusCode === 500
		)
	})

	it('propagates an unrelated rejection untranslated', async () => {
		const boom = { kind: 'not-connected' }
		const { relay } = relayRejecting(boom)
		await assert.rejects(
			() => relay('15550000001@s.whatsapp.net', TEXT, { messageId: '3EB0NOENC0003' }),
			(error: unknown) => error === boom
		)
	})
})
