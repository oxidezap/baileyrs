import makeWASocket, { proto, type WAMessage } from '@whiskeysockets/baileys'
import { generateWAMessage } from '@whiskeysockets/baileys/lib/Utils/messages.js'
import { getStream } from '@whiskeysockets/baileys/lib/Utils/messages-media.js'
import Long from 'long'
import { Buffer } from 'node:buffer'

const timestamp: Long = Long.fromNumber(1)
const message: WAMessage | null = null
const bytes: Buffer = Buffer.from(proto.Message.encode({ conversation: 'packed alias' }).finish())
void [makeWASocket, generateWAMessage, getStream, timestamp, message, bytes]
