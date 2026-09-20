/**
 * Central bridge access for the runtime-neutral graph.
 *
 * Every consumer that needs a real bridge function (encode/decode, wire
 * batches, payload decryption, client construction, wasm init) takes it from
 * `runtime.bridge` — or from one of the derived factories below — instead of
 * importing `@oxidezap/whatsapp-rust-bridge` (Node) or
 * `@oxidezap/whatsapp-rust-bridge/host` (hosts) directly. The two entrypoints
 * export identical function identities, so the factories are thin; their job
 * is to keep the `foo(runtime, …)` sprawl in one place.
 */

import type { BaileysRuntime, BridgeRuntime } from './types.ts'

/** The codec surface used by the proto facade and the send path. */
export const makeProtoRuntime = (runtime: BaileysRuntime) => {
	const bridge = runtime.bridge
	return {
		encodeProto: bridge.encodeProto.bind(bridge),
		decodeProto: bridge.decodeProto.bind(bridge),
		BinaryReader: bridge.BinaryReader
	}
}

/** Wire-batch decoders used by the event pipeline. */
export const makeHistoryRuntime = (runtime: BaileysRuntime) => {
	const bridge = runtime.bridge
	return {
		inflateZlib: bridge.inflateZlib.bind(bridge),
		decodeMessageWireBatch: bridge.decodeMessageWireBatch.bind(bridge),
		decodeReceiptWireBatch: bridge.decodeReceiptWireBatch.bind(bridge),
		decodeServerAckWireBatch: bridge.decodeServerAckWireBatch.bind(bridge)
	}
}

/** Crypto payload helpers used by message processing. */
export const makeSocketCryptoRuntime = (runtime: BaileysRuntime) => {
	const bridge = runtime.bridge
	return {
		decryptPollVotePayload: bridge.decryptPollVotePayload.bind(bridge),
		decryptEventResponsePayload: bridge.decryptEventResponsePayload.bind(bridge)
	}
}

/** Client construction + engine init, used by the socket factory. */
export const makeSocketRuntime = (runtime: BaileysRuntime) => {
	const bridge = runtime.bridge
	return {
		createWhatsAppClient: bridge.createWhatsAppClient.bind(bridge),
		initWasmEngine: bridge.initWasmEngine.bind(bridge)
	}
}

export type ProtoRuntime = ReturnType<typeof makeProtoRuntime>
export type HistoryRuntime = ReturnType<typeof makeHistoryRuntime>
export type SocketCryptoRuntime = ReturnType<typeof makeSocketCryptoRuntime>
export type SocketRuntime = ReturnType<typeof makeSocketRuntime>

/** Narrow check used by tests: every bridge member the core needs exists. */
export const BRIDGE_RUNTIME_KEYS = [
	'createWhatsAppClient',
	'initWasmEngine',
	'encodeProto',
	'decodeProto',
	'inflateZlib',
	'BinaryReader',
	'decodeMessageWireBatch',
	'decodeReceiptWireBatch',
	'decodeServerAckWireBatch',
	'decryptPollVotePayload',
	'decryptEventResponsePayload'
] as const satisfies ReadonlyArray<keyof BridgeRuntime>
