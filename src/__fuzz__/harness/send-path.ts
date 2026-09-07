import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
/**
 * The real send path, with a bridge client that captures instead of sending.
 *
 * `scripts/compatibility/wire-fidelity-core.ts` does the same thing for its fixed
 * case list. This is a separate, self-contained copy rather than an import
 * because `src/**` is its own TypeScript project with `rootDir: ./src` — reaching
 * into `scripts/` from here would not compile, and `check-layer-boundaries`
 * exists to keep exactly this kind of reach from creeping in.
 *
 * What it gives the fuzzers is the thing no unit test can: the bytes
 * `relayMessage` actually hands the bridge, for a message nobody wrote by hand.
 */

import { EventEmitter } from 'node:events'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeMessageMethods } from '../../Socket/messages.ts'
import type { WithClientSocketContext as SocketContext } from '../../Socket/types.ts'
import type { WAProto } from '../../Types/index.ts'
import type { ILogger } from '../../Utils/logger.ts'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as unknown as ILogger

const capturingContext = (captured: Uint8Array[]): SocketContext => {
	// `relayMessage` dispatches on a relay plan: a normal send, a retransmission,
	// or a status broadcast. The generator produces `status@broadcast` jids, so a
	// client with only the first method would fail with "not a function" instead
	// of yielding bytes — a harness gap that reads exactly like a send-path bug.
	const client = {
		relayMessageBytesWithOptions: async (_jid: string, bytes: Uint8Array, messageId: string) => {
			captured.push(bytes)
			return messageId
		},
		sendStatusMessageBytesWithOptions: async (bytes: Uint8Array, _recipients: unknown, messageId: string) => {
			captured.push(bytes)
			return messageId
		},
		retransmitMessageBytes: async (_jid: string, bytes: Uint8Array, messageId?: string) => {
			captured.push(bytes)
			return messageId
		}
	} as unknown as WasmWhatsAppClient

	return {
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		}),
		logger: silentLogger,
		fullConfig: { options: {}, emitOwnEvents: false },
		getUser: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		getMe: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) => operation((await client) as MockClient)
	} as unknown as SocketContext
}

export interface RelayOptions {
	readonly jid?: string
	readonly messageId?: string
}

/** Pushes a message through `relayMessage` and returns the bytes the bridge received. */
export const relayedBytes = async (
	message: Record<string, unknown>,
	options: RelayOptions = {}
): Promise<Uint8Array> => {
	const captured: Uint8Array[] = []
	const context = capturingContext(captured)
	await makeMessageMethods(context).relayMessage(
		options.jid ?? '120363000000000000@g.us',
		structuredClone(message) as WAProto.IMessage,
		{ messageId: options.messageId ?? '3EB0FUZZ0000000000' }
	)
	// Exactly one, not the first of however many. Returning `captured[0]` and
	// ignoring the rest means a regression that sends the same message twice —
	// or sends a second, malformed one after a valid first — passes all three
	// wire-fidelity targets while users receive duplicates.
	if (captured.length === 0) throw new Error('the send path handed no bytes to the bridge')
	if (captured.length > 1) {
		throw new Error(`the send path made ${captured.length} bridge calls for one message; expected exactly one`)
	}
	return captured[0]!
}
