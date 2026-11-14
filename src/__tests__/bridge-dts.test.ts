import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bridgeEventTypes, bridgeStringUnion, formatBridgeDts } from './bridge-dts.ts'

for (const text of [
	'export type Action="add"|"remove";export type WhatsAppEvent={type:"connected";data:{type:"nested"}}|{type:"disconnected"};export class WasmWhatsAppClient{addChatLabel(label_id:string,chat_jid:string):Promise<void>;}',
	'export type Action = "add" | "remove";\nexport type WhatsAppEvent = { type: "connected"; data: { type: "nested" } } | { type: "disconnected" };\nexport class WasmWhatsAppClient {\n    addChatLabel(label_id: string, chat_jid: string): Promise<void>;\n}'
]) {
	test(`bridge declaration checks preserve contracts across whitespace (${text.includes('\n') ? 'formatted' : 'compact'})`, () => {
		const dts = formatBridgeDts(text)
		assert.deepEqual(bridgeEventTypes(dts), ['connected', 'disconnected'])
		assert.deepEqual(bridgeStringUnion(dts, 'Action'), ['add', 'remove'])
		assert.match(dts, /^ {4}addChatLabel\(label_id: string, chat_jid: string\): Promise<void>;/mu)
	})
}

test('event reader fails for missing unions and malformed discriminators', () => {
	assert.throws(() => bridgeEventTypes('export type Other = string;'), /union not found/)
	assert.throws(
		() => bridgeEventTypes('export type WhatsAppEvent = { type: string } | { type: "closed" };'),
		/string discriminator/
	)
	assert.throws(() => bridgeEventTypes('export type WhatsAppEvent = string | { type: "closed" };'), /object type/)
})
