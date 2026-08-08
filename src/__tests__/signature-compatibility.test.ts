/**
 * The auditor compares signature strings, which mixes three unrelated things:
 * a parameter renamed, a shape that is merely different, and a shape that
 * breaks the caller. Only the third is a bug, and the tests here cover the two
 * of those that could be fixed in this layer.
 *
 * Both are about argument counts, which a type test alone would not catch: a
 * call with upstream's number of arguments has to reach the right place at
 * runtime, not merely compile.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import makeWASocket from '../Socket/index.ts'
import type { proto } from '../WAProto/runtime.ts'
import { downloadMediaMessage } from '../Utils/messages.ts'
import type { WAMessage } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import { useMultiFileAuthState } from '../Utils/use-multi-file-auth-state.ts'
import { expect } from './expect.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as unknown as ILogger

const IMAGE_MESSAGE = {
	key: { remoteJid: '5511@s.whatsapp.net', id: 'M1', fromMe: false },
	message: {
		imageMessage: {
			url: 'https://mmg.whatsapp.net/x',
			directPath: '/x',
			mediaKey: new Uint8Array(32),
			fileEncSha256: new Uint8Array(32),
			fileSha256: new Uint8Array(32),
			fileLength: 10,
			mimetype: 'image/jpeg'
		}
	}
} as unknown as WAMessage

/**
 * Upstream takes the context optionally and downloads over its own HTTP; here
 * the download, its CDN failover and its decryption are the engine's, so the
 * client has to arrive somehow. Required was the wrong way to say that: it
 * turned an upstream three-argument call into a compile error rather than an
 * explanation.
 */
describe('downloadMediaMessage takes upstream three arguments and says what is missing', () => {
	it('a call without the context rejects naming what it needs and where to get it', async () => {
		await expect(downloadMediaMessage(IMAGE_MESSAGE, 'buffer', {})).rejects.toThrow(/bridge client is required/)
	})

	it('the rejection points at the socket method that supplies it', async () => {
		await expect(downloadMediaMessage(IMAGE_MESSAGE, 'buffer', {})).rejects.toThrow(/sock\.downloadMedia/)
	})

	it('a context without a client is refused the same way, not dereferenced', async () => {
		await expect(downloadMediaMessage(IMAGE_MESSAGE, 'buffer', {}, {} as never)).rejects.toThrow(
			/bridge client is required/
		)
	})

	it('a context carrying the client runs rather than being refused', async () => {
		const downloaded: unknown[][] = []
		const waClient = {
			downloadMedia: async (...args: unknown[]) => {
				downloaded.push(args)
				return new Uint8Array([1, 2, 3])
			}
		} as unknown as WasmWhatsAppClient

		const result = await downloadMediaMessage(IMAGE_MESSAGE, 'buffer', {}, { waClient } as never)

		expect(downloaded.length).toBe(1)
		expect(Buffer.from(result).length).toBe(3)
	})
})

/**
 * Upstream's fourth argument selects a different plaintext to encrypt for the
 * caller's own other devices. The engine encrypts one payload for every
 * recipient, so accepting it and dropping it would send those devices the wrong
 * message, which is worse than the parameter being absent.
 *
 * The refusal runs before the client is reached, which is why this can be
 * driven through a socket that never connects.
 */
describe('createParticipantNodes refuses the device-sent message rather than ignoring it', () => {
	it('a fourth argument rejects, naming why the engine cannot honour it', async () => {
		const authFolder = await mkdtemp(join(tmpdir(), 'baileyrs-dsm-'))
		try {
			const { state } = await useMultiFileAuthState(authFolder)
			const sock = makeWASocket({ auth: state, logger: silentLogger, waWebSocketUrl: 'ws://127.0.0.1:1' })
			try {
				await expect(
					sock.createParticipantNodes(['a@s.whatsapp.net'], { conversation: 'oi' } as proto.IMessage, {}, {
						conversation: 'to my own devices'
					} as proto.IMessage)
				).rejects.toThrow(/dsmMessage is not supported/)
			} finally {
				await (sock as unknown as { [Symbol.asyncDispose](): Promise<void> })[Symbol.asyncDispose]()
			}
		} finally {
			await rm(authFolder, { recursive: true, force: true })
		}
	})
})
