import type { WAMessageKey } from '../Types/index.ts'

export type ReceiptMessageKey = { remoteJid: string; id: string; participant?: string }

/** Project public message keys to the validated receipt shape used by the transport. */
export const receiptMessageKeys = (keys: WAMessageKey[]): ReceiptMessageKey[] => {
	const result: ReceiptMessageKey[] = []
	for (const key of keys) {
		if (key.fromMe || !key.remoteJid || !key.id) continue
		result.push({
			remoteJid: key.remoteJid,
			id: key.id,
			...(key.participant ? { participant: key.participant } : {})
		})
	}
	return result
}
