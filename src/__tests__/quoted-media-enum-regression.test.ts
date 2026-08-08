import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { decodeProto, encodeMessageWireBatch, encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'

import { makeEventHandlers } from '../Socket/events.ts'
import type { SocketContext } from '../Socket/types.ts'
import type { BaileysEventMap, WAMessage } from '../Types/index.ts'
import { generateWAMessageContent, generateWAMessageFromContent } from '../Utils/messages.ts'
import { expect } from './expect.ts'

const noopLogger = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	child() {
		return noopLogger
	}
}

const makeCtx = () => {
	const ev = new EventEmitter()
	const ctx: SocketContext = {
		ev: ev as unknown as SocketContext['ev'],
		logger: noopLogger as never,
		fullConfig: {} as never,
		ws: new EventEmitter(),
		getUser: () => undefined,
		getMe: () => undefined,
		setUser: () => {},
		reportUnexpectedError: () => {},
		getClient: () => Promise.reject(new Error('not used')),
		getClientSync: () => {
			throw new Error('not used')
		}
	}
	return { ctx, ev }
}

describe('quoted media enum regression', () => {
	it('quotes a wire-decoded extended text while sending an image without invalid int32: NaN', async () => {
		const previewType = proto.Message.ExtendedTextMessage.PreviewType.IMAGE
		const incomingBytes = encodeProto('Message', {
			extendedTextMessage: {
				text: '_toimg',
				previewType,
				contextInfo: {
					stanzaId: 'QUOTED-STICKER',
					participant: 'fixture-member@lid',
					quotedMessage: {
						stickerMessage: {
							url: 'https://example.invalid/sticker',
							directPath: '/fixture/sticker',
							mediaKey: new Uint8Array(32).fill(4),
							fileSha256: new Uint8Array(32).fill(5),
							fileEncSha256: new Uint8Array(32).fill(6),
							fileLength: 42,
							mimetype: 'image/webp'
						}
					}
				}
			}
		})

		const { ctx, ev } = makeCtx()
		let quoted: WAMessage | undefined
		ev.on('messages.upsert', (upsert: BaileysEventMap['messages.upsert']) => {
			quoted = upsert.messages[0]
		})

		makeEventHandlers(ctx).onMessageBatch?.(
			encodeMessageWireBatch([
				{
					payload: incomingBytes,
					info: {
						chat: 'fixture-group@g.us',
						sender: 'fixture-member@lid',
						isGroup: true,
						isFromMe: false,
						id: 'TOIMG-COMMAND',
						timestamp: 1_750_000_000,
						pushName: 'Fixture member',
						isViewOnce: false,
						isOffline: false
					}
				}
			])
		)

		expect(quoted).toBeDefined()
		expect(quoted?.message?.extendedTextMessage?.previewType).toBe(previewType)
		expect(typeof quoted?.message?.extendedTextMessage?.previewType).toBe('number')
		expect(quoted?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage).toBeDefined()

		const imageContent = await generateWAMessageContent(
			{ image: Buffer.from('fixture-image') },
			{
				logger: noopLogger as never,
				waClient: undefined as never,
				processMedia: async () => ({
					upload: {
						url: 'https://example.invalid/media',
						directPath: '/fixture/media',
						mediaKey: new Uint8Array(32).fill(1),
						fileSha256: new Uint8Array(32).fill(2),
						fileEncSha256: new Uint8Array(32).fill(3),
						fileLength: 13
					},
					metadata: { width: 1, height: 1 }
				})
			}
		)

		const outgoing = generateWAMessageFromContent('fixture-group@g.us', imageContent, {
			quoted,
			userJid: 'fixture-bot@lid',
			timestamp: new Date(1_750_000_100_000)
		})
		// This was the failing production boundary: the old reflected event
		// transport produced the string "IMAGE", which ts-proto coerced to NaN.
		const outgoingBytes = encodeProto('Message', outgoing.message as Record<string, unknown>)
		const decoded = decodeProto('Message', outgoingBytes) as {
			imageMessage?: {
				contextInfo?: { quotedMessage?: { extendedTextMessage?: { previewType?: number } } }
			}
		}

		expect(decoded.imageMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.previewType).toBe(previewType)
	})
})
