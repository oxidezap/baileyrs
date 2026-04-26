import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { after, before, describe, test } from 'node:test'
import P from 'pino'
import {
	downloadMediaMessage,
	type DownloadMediaMessageContext,
	makeWASocket,
	proto,
	type WAMessage
} from '../../index.ts'
import { expect } from '../expect.ts'
import { createTestClient, destroyTestClient } from './test-client.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WASocket = ReturnType<typeof makeWASocket>

const logger = P({ level: process.env.LOG_LEVEL ?? 'warn' })

function waitForMessage(
	sock: WASocket,
	predicate: (msg: proto.IWebMessageInfo) => boolean,
	timeoutMs = 15_000
): Promise<proto.IWebMessageInfo> {
	return new Promise((resolve, reject) => {
		const listener = (data: { messages: proto.IWebMessageInfo[] }) => {
			const msg = data.messages.find(predicate)
			if (msg) {
				sock.ev.off('messages.upsert', listener)
				clearTimeout(tid)
				resolve(msg)
			}
		}

		sock.ev.on('messages.upsert', listener)
		const tid = setTimeout(() => {
			sock.ev.off('messages.upsert', listener)
			reject(new Error('Timed out waiting for message'))
		}, timeoutMs)
	})
}

function getTextContent(msg: proto.IWebMessageInfo): string | undefined {
	return msg.message?.extendedTextMessage?.text || msg.message?.conversation || undefined
}

function downloadCtx(sock: WASocket): DownloadMediaMessageContext {
	return {
		logger: sock.logger,
		reuploadRequest: m => sock.updateMediaMessage(m),
		waClient: sock.waClient!
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: Two-user messaging', { timeout: 60_000 }, () => {
	let alice: Awaited<ReturnType<typeof createTestClient>>
	let bob: Awaited<ReturnType<typeof createTestClient>>

	before(async () => {
		;[alice, bob] = await Promise.all([createTestClient({ label: 'alice' }), createTestClient({ label: 'bob' })])
		logger.info({ alice: alice.jid, bob: bob.jid }, 'Both users connected')
	})

	after(async () => {
		await Promise.all([destroyTestClient(alice), destroyTestClient(bob)])
	})

	// ── Text messages ──

	test('Alice sends text → Bob receives it', async () => {
		const text = `Hello Bob! ${Date.now()}`

		const bobReceived = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await alice.sock.sendMessage(bob.jid, { text })
		const received = await bobReceived

		// Sender side
		expect(sent).toBeDefined()
		expect(sent!.key.id).toBeTruthy()

		// Receiver side: correct text, not fromMe, remoteJid matches sender
		expect(getTextContent(received)).toBe(text)
		expect(received.key?.fromMe).toBe(false)
		expect(received.key?.remoteJid).toBe(alice.jid)

		// Message ID should match between sender and receiver
		expect(received.key?.id).toBe(sent!.key.id)
	})

	test('Bob sends text → Alice receives it', async () => {
		const text = `Hi Alice! ${Date.now()}`

		const aliceReceived = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		const sent = await bob.sock.sendMessage(alice.jid, { text })
		const received = await aliceReceived

		expect(getTextContent(received)).toBe(text)
		expect(received.key?.fromMe).toBe(false)
		expect(received.key?.remoteJid).toBe(bob.jid)
		expect(received.key?.id).toBe(sent!.key.id)
	})

	// ── Edit ──

	test('Alice sends → edits → sender returns correct edit proto', async () => {
		const original = `Original ${Date.now()}`
		const edited = `Edited ${Date.now()}`

		const bobGotOriginal = waitForMessage(bob.sock, m => getTextContent(m) === original && !m.key?.fromMe)
		const sent = await alice.sock.sendMessage(bob.jid, { text: original })
		const originalReceived = await bobGotOriginal

		// Verify original was received correctly
		expect(originalReceived.key?.id).toBe(sent!.key.id)

		const editResult = await alice.sock.sendMessage(bob.jid, { text: edited, edit: sent!.key })
		expect(editResult).toBeDefined()
		expect(editResult!.message?.protocolMessage?.type).toBe(proto.Message.ProtocolMessage.Type.MESSAGE_EDIT)
		expect(editResult!.message?.protocolMessage?.key?.id).toBe(sent!.key.id)

		const editedContent = editResult!.message?.protocolMessage?.editedMessage
		expect(editedContent?.extendedTextMessage?.text || editedContent?.conversation).toBe(edited)
	})

	// ── Delete ──

	test('Alice sends → deletes → sender returns correct revoke proto', async () => {
		const text = `Delete me ${Date.now()}`

		const bobGotIt = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		const sent = await alice.sock.sendMessage(bob.jid, { text })
		await bobGotIt

		const deleted = await alice.sock.sendMessage(bob.jid, { delete: sent!.key })
		expect(deleted).toBeDefined()
		expect(deleted!.message?.protocolMessage?.type).toBe(proto.Message.ProtocolMessage.Type.REVOKE)
		expect(deleted!.message?.protocolMessage?.key?.id).toBe(sent!.key.id)
	})

	// ── Reactions ──

	test('Alice sends → Bob reacts with correct key reference', async () => {
		const text = `React to me ${Date.now()}`

		const bobGotIt = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await alice.sock.sendMessage(bob.jid, { text })
		const received = await bobGotIt

		const reaction = await bob.sock.sendMessage(alice.jid, {
			react: { text: '❤️', key: received.key as proto.IMessageKey }
		})

		expect(reaction).toBeDefined()
		expect(reaction!.message?.reactionMessage?.text).toBe('❤️')
		// Reaction should reference the original message
		expect(reaction!.message?.reactionMessage?.key?.id).toBe(received.key?.id)
	})

	// ── Reply with quote ──

	test('Alice sends → Bob replies → Alice gets reply with quoted original', async () => {
		const question = `Question ${Date.now()}`
		const answer = `Answer ${Date.now()}`

		const bobGotQuestion = waitForMessage(bob.sock, m => getTextContent(m) === question && !m.key?.fromMe)
		const sentQuestion = await alice.sock.sendMessage(bob.jid, { text: question })
		const questionMsg = await bobGotQuestion

		const aliceGotReply = waitForMessage(alice.sock, m => getTextContent(m) === answer && !m.key?.fromMe)
		await bob.sock.sendMessage(alice.jid, { text: answer }, { quoted: questionMsg as WAMessage })
		const reply = await aliceGotReply

		// Reply text correct
		expect(getTextContent(reply)).toBe(answer)
		expect(reply.key?.fromMe).toBe(false)

		// Context info has the quoted message
		const ctx = reply.message?.extendedTextMessage?.contextInfo
		expect(ctx).toBeDefined()
		expect(ctx?.quotedMessage).toBeDefined()
		// Quoted message ID references the original
		expect(ctx?.stanzaId).toBe(sentQuestion!.key.id)
	})

	// ── Media: image ──

	test('Alice sends image → Bob receives, verifies metadata, and downloads', async () => {
		const image = readFileSync('./Media/cat.jpeg')
		const caption = `DM cat ${Date.now()}`

		const bobGotImage = waitForMessage(bob.sock, m => m.message?.imageMessage?.caption === caption && !m.key?.fromMe)

		await alice.sock.sendMessage(bob.jid, { image, caption })
		const received = await bobGotImage

		// Verify image message structure
		const imgMsg = received.message?.imageMessage
		expect(imgMsg).toBeDefined()
		expect(imgMsg?.caption).toBe(caption)
		expect(imgMsg?.mimetype).toContain('image')
		expect(imgMsg?.mediaKey).toBeDefined()
		expect(imgMsg?.fileLength).toBeGreaterThan(0)
		expect(imgMsg?.fileSha256).toBeDefined()

		// Download as buffer (via Rust bridge)
		const buffer = await downloadMediaMessage(received as WAMessage, 'buffer', {}, downloadCtx(bob.sock))

		expect(Buffer.isBuffer(buffer)).toBe(true)
		expect(buffer.length).toBeGreaterThan(0)
		// Downloaded content should match original size (approximately — encryption adds padding)
		expect(buffer.length).toBeGreaterThanOrEqual(image.length * 0.9)
	})

	// ── Media: image stream ──

	test('Alice sends image → Bob downloads as stream', async () => {
		const image = readFileSync('./Media/cat.jpeg')
		const caption = `Stream cat ${Date.now()}`

		const bobGotImage = waitForMessage(bob.sock, m => m.message?.imageMessage?.caption === caption && !m.key?.fromMe)

		await alice.sock.sendMessage(bob.jid, { image, caption })
		const received = await bobGotImage

		// Download as stream (via Rust bridge → Web ReadableStream → Node.js Readable)
		const stream = await downloadMediaMessage(received as WAMessage, 'stream', {}, downloadCtx(bob.sock))

		const chunks: Buffer[] = []
		for await (const chunk of stream) {
			chunks.push(Buffer.from(chunk))
		}

		const buffer = Buffer.concat(chunks)
		expect(buffer.length).toBeGreaterThan(0)
		expect(buffer.length).toBeGreaterThanOrEqual(image.length * 0.9)
	})

	// ── Media: video ──

	test('Bob sends video → Alice receives and verifies metadata', async () => {
		const video = readFileSync('./Media/ma_gif.mp4')
		const caption = `DM video ${Date.now()}`

		const aliceGotVideo = waitForMessage(
			alice.sock,
			m => m.message?.videoMessage?.caption === caption && !m.key?.fromMe
		)

		await bob.sock.sendMessage(alice.jid, { video, caption })
		const received = await aliceGotVideo

		const vidMsg = received.message?.videoMessage
		expect(vidMsg).toBeDefined()
		expect(vidMsg?.caption).toBe(caption)
		expect(vidMsg?.mimetype).toContain('video')
		expect(vidMsg?.mediaKey).toBeDefined()
		expect(vidMsg?.fileLength).toBeGreaterThan(0)

		// Download as buffer
		const buffer = await downloadMediaMessage(received as WAMessage, 'buffer', {}, downloadCtx(alice.sock))

		expect(Buffer.isBuffer(buffer)).toBe(true)
		expect(buffer.length).toBeGreaterThan(0)
	})

	// ── Media: image with streaming processMedia hook ──

	test('Full streaming roundtrip: streaming encrypt → upload → streaming download → file compare', async () => {
		const image = readFileSync('./Media/cat.jpeg')
		const caption = `Full streaming roundtrip ${Date.now()}`
		const nodeFs = await import('node:fs')
		const nodePath = await import('node:path')
		const nodeOs = await import('node:os')
		const { Writable: NodeWritable } = await import('node:stream')

		const tmpDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'e2e-stream-'))

		const bobGotImage = waitForMessage(bob.sock, m => m.message?.imageMessage?.caption === caption && !m.key?.fromMe)

		// ── UPLOAD: streaming encrypt → temp file → streaming upload ──
		await alice.sock.sendMessage(
			bob.jid,
			{ image, caption },
			{
				processMedia: async (buffer, mediaType, waClient) => {
					const tmpEnc = nodePath.join(tmpDir, 'encrypted.bin')

					// Streaming encrypt: buffer → ReadableStream → Rust AES → file WritableStream
					const inputStream = new Blob([new Uint8Array(buffer)]).stream()
					const fileWriteStream = nodeFs.createWriteStream(tmpEnc)
					const outputStream = NodeWritable.toWeb(fileWriteStream) as WritableStream<Uint8Array>

					const encResult = await waClient.encryptMediaStream(inputStream, outputStream, mediaType)

					// Verify encrypted file exists and has data
					const encStat = await nodeFs.promises.stat(tmpEnc)
					expect(encStat.size).toBeGreaterThan(0)

					// Upload from temp file
					const encData = await nodeFs.promises.readFile(tmpEnc)
					await nodeFs.promises.unlink(tmpEnc)

					const uploadResult = await waClient.uploadEncryptedMediaStream(
						() => new Blob([new Uint8Array(encData)]).stream(),
						encResult.mediaKey,
						encResult.fileSha256,
						encResult.fileEncSha256,
						encResult.fileLength,
						mediaType
					)

					return { upload: { ...uploadResult, ...encResult } }
				}
			}
		)

		const received = await bobGotImage
		const imgMsg = received.message?.imageMessage
		expect(imgMsg).toBeDefined()
		expect(imgMsg?.caption).toBe(caption)

		// ── DOWNLOAD: buffer mode → save to file ──
		const downloadedBuffer = await downloadMediaMessage(received as WAMessage, 'buffer', {}, downloadCtx(bob.sock))
		const tmpDownloadedBuffer = nodePath.join(tmpDir, 'downloaded-buffer.bin')
		await nodeFs.promises.writeFile(tmpDownloadedBuffer, downloadedBuffer)

		// ── DOWNLOAD: stream mode → save to file ──
		const downloadedStream = await downloadMediaMessage(received as WAMessage, 'stream', {}, downloadCtx(bob.sock))
		const tmpDownloadedStream = nodePath.join(tmpDir, 'downloaded-stream.bin')
		const chunks: Buffer[] = []
		for await (const chunk of downloadedStream) {
			chunks.push(Buffer.from(chunk))
		}

		const streamBuffer = Buffer.concat(chunks)
		await nodeFs.promises.writeFile(tmpDownloadedStream, streamBuffer)

		// ── ASSERTIONS ──

		// Both downloads should produce identical content
		expect(downloadedBuffer.length).toBe(streamBuffer.length)
		expect(downloadedBuffer.equals(streamBuffer)).toBe(true)

		// Downloaded content should match original
		expect(downloadedBuffer.length).toBe(image.length)
		expect(downloadedBuffer.equals(image)).toBe(true)

		// Files on disk should match
		const fileBuffer = await nodeFs.promises.readFile(tmpDownloadedBuffer)
		const fileStream = await nodeFs.promises.readFile(tmpDownloadedStream)
		expect(fileBuffer.equals(fileStream)).toBe(true)
		expect(fileBuffer.equals(image)).toBe(true)

		// Cleanup
		await nodeFs.promises.rm(tmpDir, { recursive: true, force: true })
	})

	// ── Read receipts ──

	test('Bob sends → Alice reads → readMessages completes without error', async () => {
		const text = `Read me ${Date.now()}`

		const aliceGotIt = waitForMessage(alice.sock, m => getTextContent(m) === text && !m.key?.fromMe)
		await bob.sock.sendMessage(alice.jid, { text })
		const received = await aliceGotIt

		// Verify we have the required fields for read receipt
		expect(received.key?.remoteJid).toBeTruthy()
		expect(received.key?.id).toBeTruthy()

		// Should not throw
		await expect(
			alice.sock.readMessages([
				{
					remoteJid: received.key!.remoteJid!,
					id: received.key!.id!,
					participant: received.key!.participant ?? undefined
				}
			])
		).resolves.toBeUndefined()
	})

	// ── Forward ──

	test('Alice sends to self → forwards to Bob → Bob gets forwarded content', async () => {
		const text = `Forward me ${Date.now()}`
		const sent = await alice.sock.sendMessage(alice.jid, { text })
		expect(sent).toBeDefined()

		const bobGotForward = waitForMessage(bob.sock, m => getTextContent(m) === text && !m.key?.fromMe)

		await alice.sock.sendMessage(bob.jid, { forward: sent! })
		const forwarded = await bobGotForward

		// Content matches
		expect(getTextContent(forwarded)).toBe(text)
		// Different message ID (it's a new message, not the same one)
		expect(forwarded.key!.id).not.toBe(sent!.key.id)
		// Sender is Alice
		expect(forwarded.key?.remoteJid).toBe(alice.jid)
	})

	// ── Contact card ──

	test('Alice sends vCard → Bob receives it with correct fields', async () => {
		const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Test Contact\nTEL;type=CELL:+1234567890\nEND:VCARD'

		const bobGotContact = waitForMessage(bob.sock, m => !!m.message?.contactMessage?.vcard && !m.key?.fromMe)

		await alice.sock.sendMessage(bob.jid, {
			contacts: { displayName: 'Test Contact', contacts: [{ vcard }] }
		})

		const received = await bobGotContact

		expect(received.message?.contactMessage).toBeDefined()
		expect(received.message?.contactMessage?.vcard).toContain('FN:Test Contact')
		expect(received.message?.contactMessage?.vcard).toContain('+1234567890')
		expect(received.key?.fromMe).toBe(false)
		expect(received.key?.remoteJid).toBe(alice.jid)
	})
})
