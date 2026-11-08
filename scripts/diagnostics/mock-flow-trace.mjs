// Temporary loopback-only tracing. All identifiers become process-local labels; no keys, hashes, QR data or plaintext are published.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { nodeRuntime } from '../../src/Runtime/node.ts'

const url = new URL(process.env.SOCKET_URL ?? 'https://invalid')
if (
	!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
	process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
) {
	throw new Error('Diagnostic tracing requires the synthetic loopback mock')
}
let sequence = 0
let nextClient = 0
let printed = 0
const rows = []
const push = (kind, data) => {
	rows.push({ seq: ++sequence, pid: process.pid, kind, ...data })
	if (rows.length > 12000) rows.shift()
}
const localLabels = new Map()
const opaque = (kind, value) => {
	const key = `${kind}:${value}`
	if (!localLabels.has(key)) localLabels.set(key, `${kind}#${localLabels.size + 1}`)
	return localLabels.get(key)
}
// All correlation labels are process-local counters, never key hashes or stable identifiers.
export const redactTraceRow = (value, key = '') => {
	if (ArrayBuffer.isView(value)) return { byteLength: value.byteLength }
	if (typeof value === 'string') {
		if (key === 'id') return opaque('message', value)
		return value.replace(/[0-9a-fA-F]{8,}/g, token => opaque('local', token))
	}
	if (Array.isArray(value))
		return value.every(item => typeof item === 'number')
			? { count: value.length }
			: value.map(item => redactTraceRow(item, key))
	if (value && typeof value === 'object')
		return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactTraceRow(item, name)]))
	return value
}
const digest = value => (value == null ? null : { length: value.byteLength })
const previousRows = new Map()
const attrs = input =>
	Object.fromEntries(
		Object.entries(input ?? {}).filter(
			([key, value]) =>
				[
					'id',
					'type',
					'from',
					'to',
					'recipient',
					'participant',
					'jid',
					'lid',
					'pn',
					'val',
					'device',
					'device_id',
					'class',
					't',
					'xmlns',
					'index',
					'key-index',
					'version',
					'reason',
					'error',
					'addressing_mode'
				].includes(key) && typeof value === 'string'
		)
	)
const node = (value, depth = 0) =>
	value && typeof value === 'object'
		? {
				tag: value.tag,
				attrs: attrs(value.attrs),
				...(Array.isArray(value.content) && depth < 6
					? { children: value.content.map(child => node(child, depth + 1)) }
					: {}),
				...(value.content instanceof Uint8Array ? { bytes: digest(value.content) } : {}),
				...(value.tag === 'ack' && value.attrs?.class === 'error' && value.content instanceof Uint8Array
					? {
							errorWords: new TextDecoder()
								.decode(value.content)
								.toLowerCase()
								.split(/[^a-z]+/)
								.filter(word =>
									[
										'invalid',
										'recipient',
										'sender',
										'unknown',
										'jid',
										'device',
										'devices',
										'no',
										'session',
										'identity',
										'not',
										'found',
										'malformed',
										'encryption',
										'participant',
										'payload',
										'error',
										'bad',
										'request',
										'routing',
										'failed',
										'missing',
										'mac',
										'to',
										'message',
										'signature',
										'cert',
										'certificate',
										'stale',
										'decrypt',
										'primary',
										'companion',
										'linked'
									].includes(word)
								)
						}
					: {})
			}
		: null
const mapping = value => {
	if (value == null) return null
	const parsed = value instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(value)) : value
	if (Array.isArray(parsed)) return parsed.map(mapping)
	if (typeof parsed !== 'object') return parsed
	return Object.fromEntries(
		Object.entries(parsed)
			.filter(([key]) =>
				[
					'pn',
					'lid',
					'phone_number',
					'phoneNumber',
					'lid_user',
					'user',
					'jid',
					'created_at',
					'updated_at',
					'learning_source',
					'source'
				].includes(key)
			)
			.map(([key, item]) => [key, mapping(item)])
	)
}
const sourceInfo = source =>
	source &&
	Object.fromEntries(
		['chat', 'sender', 'sender_alt', 'recipient_alt', 'is_from_me', 'is_group'].map(key => [key, source[key]])
	)
const traceFolder = join(process.cwd(), '.diagnostic-traces')
mkdirSync(traceFolder, { recursive: true })
const tracePath = join(traceFolder, `flow-${process.pid}.jsonl`)
const dump = () => {
	const pending = rows.filter(row => row.seq > printed)
	if (pending.length)
		appendFileSync(tracePath, pending.map(row => JSON.stringify(redactTraceRow(row))).join('\n') + '\n', {
			mode: 0o600
		})
	printed = sequence
}
process.on('exit', dump)
process.on('uncaughtExceptionMonitor', dump)
const output = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...args) => {
	if (String(chunk).startsWith('RESTART_READY ')) dump()
	return output(chunk, ...args)
}
const describe = (namespace, key, value) => {
	const previousKey = JSON.stringify([namespace, key])
	const previous = previousRows.get(previousKey)
	const info = {
		namespace,
		key,
		value: digest(value),
		equalsPrevious: previous && value ? Buffer.from(previous).equals(value) : null
	}
	if (value) previousRows.set(previousKey, Uint8Array.from(value))
	if (namespace === 'lid_mapping' && value) {
		try {
			info.mapping = mapping(value)
		} catch {
			info.mapping = 'undecodable'
		}
	}
	return info
}
const bridge = nodeRuntime.bridge
nodeRuntime.bridge = {
	...bridge,
	async createWhatsAppClient(...args) {
		const clientId = ++nextClient
		const store = args[3]
		push('client/create', { client: clientId, enumerate: store?.capabilities?.enumerate ?? false })
		if (store) {
			const traced = ['identity', 'session', 'lid_mapping', 'device', 'device_list']
			const watched = namespace => traced.includes(namespace)
			args[3] = new Proxy(store, {
				get(target, key) {
					const original = target[key]
					if (typeof original !== 'function') return original
					if (!['get', 'getMany', 'set', 'setMany', 'delete', 'deleteMany', 'deletePrefix', 'listKeys'].includes(key))
						return original.bind(target)
					return (...callArgs) => {
						const [namespace, id, bytes] = callArgs
						if (watched(namespace)) {
							if (key === 'set') push('store/set/start', { client: clientId, ...describe(namespace, id, bytes) })
							else if (key === 'setMany')
								for (const [item, data] of id)
									push('store/setMany/start', { client: clientId, ...describe(namespace, item, data) })
							else push(`store/${key}/start`, { client: clientId, namespace, key: id })
						}
						const result = original.apply(target, callArgs)
						return Promise.resolve(result).then(value => {
							if (watched(namespace)) {
								if (key === 'get') push('store/get/done', { client: clientId, ...describe(namespace, id, value) })
								else if (key === 'getMany')
									for (const [item, data] of value)
										push('store/getMany/done', { client: clientId, ...describe(namespace, item, data) })
								else
									push(`store/${key}/done`, {
										client: clientId,
										namespace,
										key: key === 'setMany' ? id.map(([item]) => item) : id,
										...(key === 'listKeys' ? { keys: value } : {})
									})
							}
							return value
						})
					}
				}
			})
		}
		const callbacks = args[2]
		args[2] = new Proxy(callbacks, {
			get(target, key) {
				const original = target[key]
				if (typeof original !== 'function') return original
				return (...events) => {
					if (key === 'onEvent') {
						const event = events[0]
						if (event.type === 'raw_node')
							push('wire/in', { client: clientId, node: node(event.data?.node ?? event.data) })
						else if (
							[
								'message',
								'undecryptable_message',
								'lid_mapping_update',
								'identity_change',
								'connected',
								'disconnected',
								'server_ack'
							].includes(event.type)
						) {
							const data = event.data
							push('bridge/event', {
								client: clientId,
								event: event.type,
								attrs: attrs(data),
								id: data?.info?.id,
								source: sourceInfo(data?.info?.source),
								...(event.type === 'lid_mapping_update' ? { mapping: mapping(data) } : {})
							})
						}
					} else if (key === 'onMessageBatch') {
						// The decoder advances a stream dictionary: only the real handler may decode.
						push('bridge/messages', { client: clientId, bytes: events[0].byteLength })
					}
					return original.apply(target, events)
				}
			}
		})
		const client = await bridge.createWhatsAppClient(...args)
		const seenJids = new Set()
		const snapshotAliases = async (stage, jids) => {
			try {
				const aliases = await Promise.all(
					[...jids].map(async jid => ({ jid, lid: await client.lidForPn(jid), pn: await client.pnForLid(jid) }))
				)
				push('alias/snapshot', { client: clientId, stage, aliases })
				for (const alias of aliases) {
					const primaryRows = new Map()
					for (const jid of [alias.jid, alias.lid, alias.pn].filter(Boolean)) {
						const address = client.jidToSignalProtocolAddress(jid.replace(/:\d+@/, '@'))
						const value = await store.get('identity', address)
						primaryRows.set(address, value)
						push('identity/snapshot', { client: clientId, stage, jid, address, value: digest(value) })
					}
					const values = [...primaryRows.values()]
					push('identity/alias-equality', {
						client: clientId,
						stage,
						present: values.map(Boolean),
						equal: values.length === 2 && values.every(Boolean) ? Buffer.from(values[0]).equals(values[1]) : null
					})
				}
			} catch (error) {
				push('alias/snapshot-error', { client: clientId, stage, error: String(error) })
			}
		}
		const methods = new Map()
		return new Proxy(client, {
			get(target, key) {
				const original = target[key]
				if (typeof original !== 'function') return original
				if (methods.has(key)) return methods.get(key)
				const wrapped = (...callArgs) => {
					const observed =
						typeof key === 'string' &&
						/^(send|relay|signal|lidForPn|pnForLid|getJid|getLid|getAccount|disconnect|free)/.test(key)
					if (observed)
						push('call/start', {
							client: clientId,
							method: key,
							args: callArgs
								.filter(arg => typeof arg === 'string' && /@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(arg))
								.slice(0, 4)
						})
					for (const arg of callArgs)
						if (typeof arg === 'string' && /@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(arg)) seenJids.add(arg)
					const result = original.apply(target, callArgs)
					if (!result?.then) return result
					return result.then(
						async value => {
							if (key === 'disconnect') await snapshotAliases('after-disconnect', seenJids)
							if (observed)
								push('call/done', {
									client: clientId,
									method: key,
									...(typeof value === 'string' && value.includes('@') ? { jid: value } : {}),
									...(key === 'getAccount' ? { accountPresent: Boolean(value) } : {})
								})
							return value
						},
						async error => {
							push('call/error', { client: clientId, method: key, error: String(error) })
							if (typeof key === 'string' && /^(send|relay|signal|getUSync)/.test(key)) {
								await snapshotAliases(
									'after-error',
									callArgs
										.filter(arg => typeof arg === 'string' && /@(s\.whatsapp\.net|lid|hosted|hosted\.lid)$/.test(arg))
										.slice(0, 4)
								)
							}
							throw error
						}
					)
				}
				methods.set(key, wrapped)
				return wrapped
			}
		})
	}
}
globalThis.__bridgeTraceSocket = (sock, label) => {
	for (const tag of ['message', 'ack', 'receipt', 'notification', 'iq'])
		sock.ws.on(`CB:${tag}`, value => push('public/wire', { label, node: node(value) }))
	sock.ev.on('connection.update', update =>
		push('public/connection', { label, connection: update.connection, pending: update.receivedPendingNotifications })
	)
	sock.ev.on('messages.upsert', batch => {
		for (const message of batch.messages) {
			const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text
			push('public/message', {
				label,
				key: message.key,
				stub: message.messageStubType,
				textLabel: text ? opaque('text', text) : null
			})
		}
	})
	const send = sock.sendMessage.bind(sock)
	sock.sendMessage = async (jid, content, ...args) => {
		push('public/send/start', { label, jid, textLabel: content?.text ? opaque('text', content.text) : null })
		try {
			const result = await send(jid, content, ...args)
			push('public/send/done', { label, key: result?.key })
			return result
		} catch (error) {
			push('public/send/error', { label, error: String(error) })
			throw error
		}
	}
}
