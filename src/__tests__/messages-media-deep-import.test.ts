import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

describe('Node media deep imports', () => {
	it('initializes local-file media from messages-media without importing the package root', () => {
		const script = `
			const { getStream } = await import('./src/Utils/messages-media.ts')
			const result = await getStream({ url: new URL('./package.json', import.meta.url).pathname })
			if (result.type !== 'file') throw new Error('expected file stream')
			result.stream.destroy()
		`
		const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
		assert.equal(child.status, 0, child.stderr)
	})

	it('routes retry AES for messages-media-core without importing the package root', () => {
		const script = `
			const { encryptMediaRetryRequest, decryptMediaRetryData } = await import('./src/Utils/messages-media-core.ts')
			const { nodeMedia } = await import('./src/Runtime/node-media.ts')
			const { proto } = await import('./src/WAProto/runtime.ts')
			const mediaKey = new Uint8Array(32).fill(7)
			const request = encryptMediaRetryRequest(
				{ id: 'MSG1', remoteJid: '1@s.whatsapp.net', fromMe: true },
				mediaKey,
				'2@s.whatsapp.net'
			)
			if (!request.content?.length) throw new Error('media retry request was not encrypted')

			const msgId = 'MSG2'
			const iv = new Uint8Array(12).fill(9)
			const retryKey = nodeMedia.hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })
			const plaintext = proto.MediaRetryNotification.encode({
				result: proto.MediaRetryNotification.ResultType.SUCCESS,
				directPath: '/deep-import'
			}).finish()
			const ciphertext = nodeMedia.aesGcm256Encrypt(retryKey, iv, new TextEncoder().encode(msgId), plaintext)
			const notification = decryptMediaRetryData({ ciphertext, iv }, mediaKey, msgId)
			if (notification.directPath !== '/deep-import') throw new Error('media retry AES did not round-trip')
		`
		const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
		assert.equal(child.status, 0, child.stderr)
	})

	it('initializes local-file media from messages without importing the package root', () => {
		const script = `
			const { prepareWAMessageMedia } = await import('./src/Utils/messages.ts')
			const upload = {
				url: 'https://example.invalid/media',
				directPath: '/media',
				mediaKey: new Uint8Array(32),
				fileSha256: new Uint8Array(32),
				fileEncSha256: new Uint8Array(32),
				fileLength: 1
			}
			const message = await prepareWAMessageMedia(
				{ image: { url: new URL('./package.json', import.meta.url).pathname } },
				{
					waClient: {},
					processMedia: async bytes => {
						if (!bytes.byteLength) throw new Error('local file was not read')
						return { upload }
					}
				}
			)
			if (!message.imageMessage) throw new Error('media message was not prepared')
		`
		const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
		assert.equal(child.status, 0, child.stderr)
	})
})
