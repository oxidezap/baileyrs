import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge'

export type AtomicRows = Map<string, Uint8Array>
export const rowKey = (store: string, key: string): string => JSON.stringify([store, key])
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const decode = (value: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(value))

export const signedTimestamp = (value: string): bigint => {
	if (!/^-?(0|[1-9]\d*)$/.test(value)) throw new TypeError('timestamp must be a signed i64 decimal string')
	const result = BigInt(value)
	if (result < -(1n << 63n) || result >= 1n << 63n) throw new RangeError('timestamp is outside i64')
	return result
}

export type TokenRow = { token: number[]; token_timestamp: bigint; sender_timestamp: bigint | null }
// Quote numeric tokens before parsing. String tokens are matched first, so their
// contents cannot be rewritten. This works on every supported Node version,
// without JSON.parse reviver context or rounding i64 through a JS number.
export const decodeTokenRow = (bytes: Uint8Array): TokenRow => {
	const text = new TextDecoder().decode(bytes)
	JSON.parse(text) // Validate the original JSON grammar before rewriting tokens.
	const row = JSON.parse(
		text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token =>
			token.startsWith('"') ? token : JSON.stringify(token)
		)
	)
	if (
		!row ||
		!Array.isArray(row.token) ||
		row.token.some((n: unknown) => typeof n !== 'string' || !/^\d+$/.test(n) || Number(n) > 255)
	) {
		throw new TypeError('invalid TC token row')
	}
	return {
		token: row.token.map(Number),
		token_timestamp: signedTimestamp(row.token_timestamp),
		sender_timestamp: row.sender_timestamp == null ? null : signedTimestamp(row.sender_timestamp)
	}
}
export const encodeTokenRow = (row: TokenRow): Uint8Array =>
	new TextEncoder().encode(
		`{"token":${JSON.stringify(row.token)},"token_timestamp":${row.token_timestamp},"sender_timestamp":${row.sender_timestamp ?? 'null'}}`
	)

const readIndex = (rows: AtomicRows, key: string): Set<string> => {
	const bytes = rows.get(rowKey('meta', key))
	const value = bytes ? decode(bytes) : []
	if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`invalid ${key} index`)
	return new Set(value)
}

/** The caller supplies a real transaction covering all reads and writes. */
export const atomicCallbacks = (
	transaction: (change: (rows: AtomicRows) => void) => Promise<void>
): Pick<JsStoreCallbacks, 'commitPatch' | 'touchTcTokenSenderTimestamp' | 'storeReceivedTcToken'> => ({
	commitPatch(name, state, removed, added, maintainIndex) {
		const snapshot = Uint8Array.from(state)
		const additions = added.map(([key, bytes]) => [key, Uint8Array.from(bytes)] as const)
		const removals = [...removed]
		return transaction(rows => {
			for (const key of removals) rows.delete(rowKey('mutation_mac', key))
			for (const [key, bytes] of additions) rows.set(rowKey('mutation_mac', key), bytes)
			rows.set(rowKey('sync_version', name), snapshot)
			if (maintainIndex) {
				const index = readIndex(rows, 'mutation_mac_keys')
				for (const key of removals) index.delete(key)
				for (const [key] of additions) index.add(key)
				rows.set(rowKey('meta', 'mutation_mac_keys'), encode([...index]))
			}
		})
	},
	touchTcTokenSenderTimestamp(jid, timestamp) {
		const incoming = signedTimestamp(timestamp)
		return transaction(rows => {
			const key = rowKey('tc_token', jid)
			const bytes = rows.get(key)
			const row = bytes ? decodeTokenRow(bytes) : { token: [], token_timestamp: incoming, sender_timestamp: null }
			if (row.sender_timestamp === null || incoming > row.sender_timestamp) row.sender_timestamp = incoming
			rows.set(key, encodeTokenRow(row))
			const index = readIndex(rows, 'tc_token_jids')
			index.add(jid)
			rows.set(rowKey('meta', 'tc_token_jids'), encode([...index]))
		})
	},
	storeReceivedTcToken(jid, token, timestamp) {
		const incoming = signedTimestamp(timestamp)
		const snapshot = [...token]
		return transaction(rows => {
			const key = rowKey('tc_token', jid)
			const bytes = rows.get(key)
			const row = bytes ? decodeTokenRow(bytes) : { token: [], token_timestamp: incoming, sender_timestamp: null }
			if (row.token.length === 0 || incoming >= row.token_timestamp) {
				row.token = snapshot
				row.token_timestamp = incoming
			}
			rows.set(key, encodeTokenRow(row))
			const index = readIndex(rows, 'tc_token_jids')
			index.add(jid)
			rows.set(rowKey('meta', 'tc_token_jids'), encode([...index]))
		})
	}
})
