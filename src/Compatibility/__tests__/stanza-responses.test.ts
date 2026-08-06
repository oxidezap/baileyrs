import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { BinaryNode } from '../../Types/index.ts'
import { makeStanzaResponseMethods } from '../stanza-responses.ts'

const messageNode: BinaryNode = {
	tag: 'message',
	attrs: {
		id: 'message-id',
		from: '15550000001@s.whatsapp.net',
		t: '1'
	}
}

const methodsFor = (client: Partial<WasmWhatsAppClient>) =>
	makeStanzaResponseMethods({ getClient: async () => client as WasmWhatsAppClient })

describe('stanza response compatibility adapter', () => {
	it('routes a normal acknowledgement to the core operation', async () => {
		const calls: unknown[][] = []
		const methods = methodsFor({
			acknowledgeStanza: async (...args) => {
				calls.push(['ack', ...args])
			},
			rejectStanza: async (...args) => {
				calls.push(['reject', ...args])
			}
		})

		await methods.sendMessageAck(messageNode)
		await methods.sendMessageAck(messageNode, 0)
		assert.deepEqual(calls, [
			['ack', messageNode],
			['ack', messageNode]
		])
	})

	it('routes a non-zero error code to the typed rejection operation', async () => {
		const calls: unknown[][] = []
		const methods = methodsFor({
			rejectStanza: async (...args) => {
				calls.push(args)
			}
		})

		await methods.sendMessageAck(messageNode, 491)
		assert.deepEqual(calls, [[messageNode, 491]])
	})

	it('forwards the force-keys flag without acknowledging the stanza', async () => {
		const calls: unknown[][] = []
		const methods = methodsFor({
			requestMessageRetry: async (...args) => {
				calls.push(args)
			}
		})

		await methods.sendRetryRequest(messageNode)
		await methods.sendRetryRequest(messageNode, true)
		assert.deepEqual(calls, [
			[messageNode, false],
			[messageNode, true]
		])
	})

	it('preserves bridge failures for the caller', async () => {
		const expected = new Error('transport unavailable')
		const methods = methodsFor({
			acknowledgeStanza: async () => Promise.reject(expected)
		})

		await assert.rejects(methods.sendMessageAck(messageNode), error => error === expected)
	})
})
