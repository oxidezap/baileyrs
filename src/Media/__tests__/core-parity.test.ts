import { describe, it } from 'node:test'
import { Buffer } from 'node:buffer'
import { hkdf as _bridgeEngineSmoke, initWasmEngine } from '@oxidezap/whatsapp-rust-bridge'
import {
	decodeMediaRetryNode,
	decryptMediaRetryData,
	encodeBase64EncodedStringForUpload,
	encryptMediaRetryRequest,
	extensionForMediaMessage,
	getMediaKeys,
	getStatusCodeForMediaRetry,
	getUrlFromDirectPath,
	hkdfInfoKey,
	mediaMessageSHA256B64
} from '../core.ts'
import {
	decodeMediaRetryNode as nodeDecode,
	decryptMediaRetryData as nodeDecrypt,
	encodeBase64EncodedStringForUpload as nodeB64Up,
	encryptMediaRetryRequest as nodeEncrypt,
	extensionForMediaMessage as nodeExt,
	getMediaKeys as nodeKeys,
	getStatusCodeForMediaRetry as nodeCode,
	getUrlFromDirectPath as nodeUrl,
	hkdfInfoKey as nodeHkdf,
	mediaMessageSHA256B64 as nodeSha
} from '../../Utils/messages-media.ts'
import type { MediaType } from '../../Defaults/index.ts'
import { expect } from '../../__tests__/expect.ts'

// Buffer.toJSON fires before a stringify replacer sees the value, so
// normalize Buffers up front instead of in the replacer.
const preNorm = (value: unknown): unknown => {
	if (Buffer.isBuffer(value)) return `BYTES:${value.length}`
	if (value instanceof Uint8Array) return `BYTES:${value.length}`
	if (Array.isArray(value)) return value.map(preNorm)
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, preNorm(v)]))
	}
	return value
}

const norm = (value: unknown): string => JSON.stringify(preNorm(value))

describe('media core parity with the Node implementation', () => {
	it('keeps pure helpers identical', () => {
		const types: MediaType[] = ['image', 'video', 'audio', 'document', 'sticker', 'ptt', 'thumbnail-image']
		for (const type of types) expect(hkdfInfoKey(type)).toBe(nodeHkdf(type))
		for (const b64 of ['a+b/c==', 'SGVsbG8=', 'x'.repeat(100)]) {
			expect(encodeBase64EncodedStringForUpload(b64)).toBe(nodeB64Up(b64))
		}
		expect(getUrlFromDirectPath('/x', 'h.test')).toBe(nodeUrl('/x', 'h.test'))
		for (const code of [0, 1, 2, 3]) expect(getStatusCodeForMediaRetry(code)).toBe(nodeCode(code))
	})

	it('shares the initialized bridge engine with the bare root', () => {
		// The bare root auto-initializes the wasm from disk; calling hkdf
		// through it proves the engine is live for this harness. AES-GCM provider
		// setup is owned by the caller/socket lifecycle, not the media helper.
		expect(_bridgeEngineSmoke(new Uint8Array(32), 8, { info: 'smoke' })).toHaveLength(8)
		initWasmEngine()
	})

	it('derives identical media keys', async () => {
		const key = new Uint8Array(32).fill(3)
		const [core, node] = await Promise.all([getMediaKeys(key, 'image'), nodeKeys(key, 'image')])
		expect(Array.from(core.iv!)).toEqual(Array.from(node.iv!))
		expect(Array.from(core.cipherKey!)).toEqual(Array.from(node.cipherKey!))
		expect(Array.from(core.macKey!)).toEqual(Array.from(node.macKey!))
	})

	it('builds structurally identical retry nodes and decrypts them', async () => {
		const key = { id: 'MSG1', remoteJid: '5511@s.whatsapp.net', fromMe: true }
		const mediaKey = new Uint8Array(32).fill(9)
		const coreNode = encryptMediaRetryRequest(key, mediaKey, 'me@s.whatsapp.net')
		// Random IV per call: compare structure, then decrypt deterministically.
		const nodeNode = await nodeEncrypt(key, Buffer.from(mediaKey), 'me@s.whatsapp.net')
		expect(norm(coreNode)).toBe(norm(nodeNode))
		const coreEnc = coreNode.content![0] as { content: { content: Uint8Array }[] }
		const mediaKeyBytes = new Uint8Array(32).fill(9)
		const coreDec = decryptMediaRetryData(
			{ ciphertext: coreEnc.content[0]!.content, iv: coreEnc.content[1]!.content },
			mediaKeyBytes,
			'MSG1'
		)
		const nodeDec = await nodeDecrypt(
			{ ciphertext: coreEnc.content[0]!.content, iv: coreEnc.content[1]!.content },
			Buffer.from(mediaKeyBytes),
			'MSG1'
		)
		expect(coreDec.stanzaId).toBe(nodeDec.stanzaId)
		expect(norm(decodeMediaRetryNode(coreNode))).toBe(norm(nodeDecode(coreNode)))
	})

	it('reads sha digests and extensions identically', () => {
		const msg = { imageMessage: { fileSha256: new Uint8Array([1, 2, 3]) } }
		expect(mediaMessageSHA256B64(msg as never)).toBe(nodeSha(msg as never))
		expect(mediaMessageSHA256B64({ imageMessage: {} } as never)).toBe(nodeSha({ imageMessage: {} } as never))
		expect(extensionForMediaMessage({ imageMessage: { mimetype: 'image/jpeg' } } as never)).toBe(
			nodeExt({ imageMessage: { mimetype: 'image/jpeg' } } as never)
		)
	})
})
