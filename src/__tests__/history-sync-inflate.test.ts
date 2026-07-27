import { describe, it } from 'node:test'
import { deflateSync } from 'node:zlib'
import type { WasmWhatsAppClient } from 'whatsapp-rust-bridge'
import { proto } from '../WAProto/runtime.ts'
import { _registerActiveBridgeClient } from '../Utils/messages.ts'
import { downloadAndProcessHistorySyncNotification, downloadHistory } from '../Utils/process-history-message.ts'
import { expect } from './expect.ts'

const historySync = (pushnames: number): Uint8Array =>
	proto.HistorySync.encode({
		syncType: proto.HistorySync.HistorySyncType.PUSH_NAME,
		pushnames: Array.from({ length: pushnames }, (_, index) => ({
			id: `55119999${String(index).padStart(5, '0')}@s.whatsapp.net`,
			pushname: `Contact ${index}`
		}))
	}).finish()

/** Serves `bytes` split into `chunkSize` pieces, so the concat path is exercised. */
const clientStreaming = (bytes: Uint8Array, chunkSize: number): WasmWhatsAppClient =>
	({
		downloadMediaStream: () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (let offset = 0; offset < bytes.length; offset += chunkSize) {
						controller.enqueue(bytes.subarray(offset, offset + chunkSize))
					}
					controller.close()
				}
			})
	}) as unknown as WasmWhatsAppClient

const mediaNotification = {
	directPath: '/v/history',
	mediaKey: new Uint8Array(32),
	fileSha256: new Uint8Array(32),
	fileEncSha256: new Uint8Array(32),
	fileLength: 1
}

describe('history-sync inflate through the bridge', () => {
	it('decodes an inline compressed payload', async () => {
		const result = await downloadAndProcessHistorySyncNotification(
			{ initialHistBootstrapInlinePayload: deflateSync(historySync(1)) },
			{}
		)
		expect(result.contacts).toEqual([{ id: '5511999900000@s.whatsapp.net', notify: 'Contact 0' }])
	})

	it('decodes a payload larger than the inflater scratch buffer', async () => {
		const result = await downloadAndProcessHistorySyncNotification(
			{ initialHistBootstrapInlinePayload: deflateSync(historySync(5000)) },
			{}
		)
		expect(result.contacts).toHaveLength(5000)
		expect(result.contacts[4999]).toEqual({ id: '5511999904999@s.whatsapp.net', notify: 'Contact 4999' })
	})

	it('reassembles a chunked download before inflating', async () => {
		const compressed = deflateSync(historySync(300))
		_registerActiveBridgeClient(clientStreaming(compressed, 64))
		const history = await downloadHistory(mediaNotification, {})
		expect(history.pushnames).toHaveLength(300)
		expect(history.syncType).toBe(proto.HistorySync.HistorySyncType.PUSH_NAME)
	})

	it('survives a download delivered as a single chunk', async () => {
		const compressed = deflateSync(historySync(10))
		_registerActiveBridgeClient(clientStreaming(compressed, compressed.length))
		const history = await downloadHistory(mediaNotification, {})
		expect(history.pushnames).toHaveLength(10)
	})

	it('rejects a payload that is not a zlib stream', async () => {
		await expect(
			downloadAndProcessHistorySyncNotification({ initialHistBootstrapInlinePayload: Buffer.from('not zlib') }, {})
		).rejects.toThrow()
	})

	it('rejects a truncated compressed payload', async () => {
		const truncated = deflateSync(historySync(50)).subarray(0, 20)
		_registerActiveBridgeClient(clientStreaming(truncated, 8))
		await expect(downloadHistory(mediaNotification, {})).rejects.toThrow()
	})
})
