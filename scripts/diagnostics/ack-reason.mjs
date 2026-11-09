// Temporary, synthetic-loopback-only categorization. Never write raw content or routing identifiers.
import { appendFileSync, mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const endpoint = new URL(process.env.SOCKET_URL ?? 'https://invalid')
if (
	!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
	process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
)
	throw Error('synthetic mock required')
mkdirSync('.diagnostic-ack', { recursive: true })
const start = performance.now()
const ids = new Map()
let accounts = 0
let sends = 0
const localId = id => {
	if (typeof id !== 'string') return null
	if (!ids.has(id)) ids.set(id, `message-${ids.size + 1}`)
	return ids.get(id)
}
const record = (event, data) =>
	appendFileSync(
		'.diagnostic-ack/client.jsonl',
		JSON.stringify({ observedAtMs: Date.now(), elapsedMs: Math.round(performance.now() - start), event, ...data }) +
			'\n'
	)
const bodyCategory = content => {
	const bytes = content instanceof Uint8Array ? content : null
	const text = bytes ? new TextDecoder().decode(bytes) : typeof content === 'string' ? content : ''
	const generics = new Map([
		['[object Uint8Array]', 'uint8array-coercion'],
		['[object ArrayBuffer]', 'arraybuffer-coercion'],
		['[object Object]', 'object-coercion'],
		['undefined', 'undefined-coercion'],
		['null', 'null-coercion']
	])
	const categories = []
	for (const [name, pattern] of [
		['decrypt', /decrypt/i],
		['mac-word', /\bmac\b/i],
		['invalid-word', /invalid/i],
		['error-word', /error/i],
		['message-word', /message/i],
		['session', /session/i],
		['message-decrypt-error-enum', /^MessageDecryptError$/],
		['mac', /bad\s*mac|mac\s+verification\s+failed|authentication failed/i],
		['missing-session', /no session|session not found/i],
		['missing-prekey', /unknown (?:signed )?prekey|prekey not found/i],
		['duplicate', /duplicate message|already (?:used|consumed)/i],
		['untrusted-identity', /untrusted identity/i],
		['invalid-protobuf', /invalid protobuf encoding/i],
		['invalid-signature', /invalid signature/i]
	])
		if (pattern.test(text)) categories.push(name)
	return {
		contentKind: bytes
			? 'bytes'
			: typeof content === 'string'
				? 'string'
				: Array.isArray(content)
					? 'children'
					: 'absent',
		byteLength: bytes?.byteLength,
		generic: generics.get(text) ?? 'none',
		categories,
		printableAscii: [...text].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) <= 126),
		routingSyntax: /\d{5,}(?::\d+)?@(?:lid|hosted|s\.whatsapp\.net|c\.us)/.test(text)
	}
}
globalThis.__ackReasonSocket = sock => {
	const account = ++accounts
	sock.ws.on('CB:ack', node =>
		record('ack', {
			account,
			message: localId(node.attrs?.id),
			class: ['message', 'error', 'receipt'].includes(node.attrs?.class) ? node.attrs.class : 'other',
			...(node.attrs?.class === 'error' ? bodyCategory(node.content) : {})
		})
	)
	sock.ev.on('connection.update', update => {
		if (['connecting', 'open', 'close'].includes(update.connection))
			record('connection', { account, state: update.connection })
	})
	sock.ev.on('messages.upsert', update => {
		for (const message of update.messages)
			record('message', { account, message: localId(message.key?.id), fromMe: message.key?.fromMe === true })
	})
	const send = sock.sendMessage.bind(sock)
	sock.sendMessage = (...args) => {
		const operation = ++sends
		record('send-start', { account, operation })
		const result = send(...args)
		void result.then(
			message => record('send-done', { account, operation, message: localId(message?.key?.id) }),
			error =>
				record('send-error', {
					account,
					operation,
					identityUnavailable: String(error).includes('device list account identity unavailable'),
					notConnected: String(error).includes('not connected')
				})
		)
		return result
	}
}

globalThis.__ackReasonStore = data => record('store-mutation-yield', data)
