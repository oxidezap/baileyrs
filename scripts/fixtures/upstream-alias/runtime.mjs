import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import Long from 'long'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import makeWASocket, { proto } from '@whiskeysockets/baileys'
import { generateWAMessage } from '@whiskeysockets/baileys/lib/Utils/messages.js'
import { getStream } from '@whiskeysockets/baileys/lib/Utils/messages-media.js'

assert.equal(typeof makeWASocket, 'function')
assert.equal(typeof generateWAMessage, 'function')
assert.equal(typeof getStream, 'function')
const timestamp = Long.fromNumber(123)
const history = proto.HistorySync.create({ timestamp })
assert.equal(history.timestamp, timestamp)
assert.equal(history.timestamp.constructor, Long)
const secret = Buffer.from([1])
const message = proto.Message.create({ conversation: 'installed package', messageContextInfo: { messageSecret: secret } })
assert.equal(Buffer.isBuffer(message.messageContextInfo.messageSecret), true)
assert.equal(message.messageContextInfo.messageSecret, secret)
assert.equal(Long.isLong(timestamp), true)
const manifest = JSON.parse(readFileSync(new URL('./node_modules/@whiskeysockets/baileys/package.json', import.meta.url), 'utf8'))
const wasmExport = fileURLToPath(import.meta.resolve('@whiskeysockets/baileys/wasm'))
assert.equal(wasmExport, fileURLToPath(new URL('./node_modules/@whiskeysockets/baileys/lib/wasm.js', import.meta.url)))
assert.match(readFileSync(wasmExport, 'utf8'), /@oxidezap\/whatsapp-rust-bridge\/wasm/)
for (const peer of Object.keys(manifest.peerDependencies)) {
	assert.equal(manifest.peerDependenciesMeta[peer]?.optional, true, `${peer} must remain optional`)
}
console.log('upstream alias package smoke passed')
