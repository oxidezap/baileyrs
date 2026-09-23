import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as hostBridge from '@oxidezap/whatsapp-rust-bridge/host'
import type { HostBridgeRuntime } from '../../host-types.ts'
import { proto } from '../../WAProto/runtime.ts'
import { makeMediaCryptoRuntime } from '../../Runtime/bridge.ts'
import { decryptMediaRetryData, encryptMediaRetryRequest, getMediaKeys } from '../core.ts'

const makeCustomCryptoRuntime = (calls: string[]) => {
	const bridge: HostBridgeRuntime = {
		...hostBridge,
		hkdf: (_input, length, options) => {
			calls.push(`hkdf:${options.info}`)
			return new Uint8Array(length).fill(0x2a)
		},
		sha256: () => {
			calls.push('sha256')
			return new Uint8Array(32).fill(0x33)
		},
		aesGcm256Encrypt: (_key, nonce, aad, plaintext) => {
			calls.push(`aes-encrypt:${nonce[0]}:${new TextDecoder().decode(aad)}`)
			return plaintext
		},
		aesGcm256Decrypt: (_key, nonce, aad, ciphertext) => {
			calls.push(`aes-decrypt:${nonce[0]}:${new TextDecoder().decode(aad)}:${ciphertext.length}`)
			return proto.MediaRetryNotification.encode({
				result: proto.MediaRetryNotification.ResultType.SUCCESS,
				directPath: '/runtime-specific'
			}).finish()
		}
	}
	return makeMediaCryptoRuntime({
		bridge,
		randomBytes: length => new Uint8Array(length).fill(0x5a)
	})
}

describe('runtime-injected media crypto', () => {
	it('routes HKDF, SHA, AES-GCM, and retry randomness through the selected runtime', async () => {
		const calls: string[] = []
		const runtime = makeCustomCryptoRuntime(calls)
		const mediaKey = new Uint8Array(32).fill(0x11)

		const keys = await getMediaKeys(mediaKey, 'image', runtime)
		assert.equal(keys.iv.length, 16)
		assert.equal(keys.cipherKey.length, 32)
		assert.equal(keys.macKey?.length, 32)
		assert.deepEqual(runtime.sha256(mediaKey), new Uint8Array(32).fill(0x33))

		const request = encryptMediaRetryRequest(
			{ id: 'MSG1', remoteJid: '5511@s.whatsapp.net', fromMe: true },
			mediaKey,
			'me@s.whatsapp.net',
			runtime
		)
		const requestNodes = request.content as { content?: { content: Uint8Array }[] }[]
		const encrypted = requestNodes[0]!.content!
		assert.deepEqual(encrypted[0]?.content, proto.ServerErrorReceipt.encode({ stanzaId: 'MSG1' }).finish())
		assert.deepEqual(encrypted[1]?.content, new Uint8Array(12).fill(0x5a))

		const notification = decryptMediaRetryData(
			{ ciphertext: new Uint8Array([1, 2, 3]), iv: new Uint8Array(12).fill(0x44) },
			mediaKey,
			'MSG2',
			runtime
		)
		assert.equal(notification.directPath, '/runtime-specific')
		assert.deepEqual(calls, [
			'hkdf:WhatsApp Image Keys',
			'sha256',
			'hkdf:WhatsApp Media Retry Notification',
			'aes-encrypt:90:MSG1',
			'hkdf:WhatsApp Media Retry Notification',
			'aes-decrypt:68:MSG2:3'
		])
	})
})
