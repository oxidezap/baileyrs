import { bench, describe } from 'vitest'
import { encodeWAMessage } from '../src/Utils/index.ts'
import { proto } from '../src/WAProto/runtime.ts'

const textMessage: proto.IMessage = {
	extendedTextMessage: {
		text: 'Hello from the benchmark! https://example.com'.repeat(4),
		contextInfo: {
			stanzaId: '3EB0C0FFEE0123456789',
			participant: '5511999990000@s.whatsapp.net',
			quotedMessage: { conversation: 'quoted text' },
			mentionedJid: Array.from({ length: 16 }, (_, i) => `${5_511_900_000_000 + i}@s.whatsapp.net`)
		}
	}
}

const imageMessage: proto.IMessage = {
	imageMessage: {
		url: 'https://mmg.whatsapp.net/v/t62.7118-24/example.enc',
		mimetype: 'image/jpeg',
		caption: 'An image',
		fileSha256: new Uint8Array(32).fill(1),
		fileEncSha256: new Uint8Array(32).fill(2),
		mediaKey: new Uint8Array(32).fill(3),
		fileLength: 123_456,
		height: 1080,
		width: 1920,
		directPath: '/v/t62.7118-24/example.enc',
		mediaKeyTimestamp: 1_734_000_000,
		jpegThumbnail: new Uint8Array(4096).map((_, i) => i & 0xff)
	}
}

const webMessageInfo: proto.IWebMessageInfo = {
	key: { remoteJid: '120363040237990503@g.us', fromMe: false, id: '3EB0C0FFEE0123456789', participant: '1@lid' },
	message: textMessage,
	messageTimestamp: 1_734_000_000,
	pushName: 'alice',
	status: 2
}

const encodedText = proto.Message.encode(textMessage).finish()
const encodedImage = proto.Message.encode(imageMessage).finish()
const encodedInfo = proto.WebMessageInfo.encode(webMessageInfo).finish()

describe('proto codec', () => {
	bench('Message.encode (extended text)', () => {
		proto.Message.encode(textMessage).finish()
	})

	bench('Message.decode (extended text)', () => {
		proto.Message.decode(encodedText)
	})

	bench('Message.decode (image)', () => {
		proto.Message.decode(encodedImage)
	})

	bench('WebMessageInfo.decode + toJSON', () => {
		proto.WebMessageInfo.decode(encodedInfo).toJSON()
	})

	bench('Message.encode (image)', () => {
		proto.Message.encode(imageMessage).finish()
	})

	bench('encodeWAMessage (padded)', () => {
		encodeWAMessage(textMessage)
	})
})
