// Temporary synthetic-only observer: no identifiers, message bodies, keys or QR data.
import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { nodeRuntime } from '../../src/Runtime/node.ts'
const endpoint = new URL(process.env.SOCKET_URL ?? 'https://invalid')
if (
	!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
	process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
)
	throw Error('synthetic mock required')
const started = performance.now()
const rows = []
const log = (kind, fields = {}) =>
	rows.push({ sequence: rows.length + 1, elapsedMs: Math.round(performance.now() - started), kind, ...fields })
const counters = new Map()
const write = () => {
	mkdirSync('.diagnostic-legacy', { recursive: true })
	writeFileSync(
		`.diagnostic-legacy/${process.pid}.json`,
		JSON.stringify({ phase: process.argv.includes('restore') ? 'restore' : 'seed', rows, counters: [...counters] })
	)
}
process.on('exit', write)
process.on('uncaughtExceptionMonitor', error =>
	log('uncaught', { deliveryDeadline: String(error).includes('Timed out waiting for messages.upsert match') })
)
const output = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...args) => {
	if (String(chunk).startsWith('RESTART_READY ')) {
		log('ready')
		write()
	}
	return output(chunk, ...args)
}
const original = nodeRuntime.bridge
let clientSequence = 0
nodeRuntime.bridge = {
	...original,
	async createWhatsAppClient(...args) {
		const account = ++clientSequence
		const counts = { reads: 0, writes: 0, hostedReads: 0 }
		counters.set(account, counts)
		const store = args[3]
		if (store)
			args[3] = new Proxy(store, {
				get(target, key) {
					const method = target[key]
					if (typeof method !== 'function') return method
					if (!['get', 'getMany', 'set', 'setMany'].includes(key)) return method.bind(target)
					return (...input) => {
						if (key === 'get' || key === 'getMany') {
							counts.reads++
							if (typeof input[1] === 'string' && /@hosted(?:\.lid)?\./.test(input[1])) {
								counts.hostedReads++
								if (counts.hostedReads % 128 === 0) log('hosted-scan', { account, count: counts.hostedReads })
							}
						} else counts.writes++
						return method.apply(target, input)
					}
				}
			})
		const callbacks = args[2]
		args[2] = new Proxy(callbacks, {
			get(target, key) {
				const method = target[key]
				if (typeof method !== 'function') return method
				if (key !== 'onEvent') return method.bind(target)
				return (...events) => {
					const event = events[0]
					if (['connected', 'disconnected', 'connection_update'].includes(event.type))
						log('core-event', { account, event: event.type })
					if (event.type === 'raw_node') {
						const node = event.data?.node ?? event.data
						if (['stream:error', 'failure', 'stream:end'].includes(node?.tag))
							log('stream-end', { account, tag: node.tag })
					}
					return method.apply(target, events)
				}
			}
		})
		const client = await original.createWhatsAppClient(...args)
		return new Proxy(client, {
			get(target, key) {
				const method = target[key]
				if (typeof method !== 'function') return method
				if (!['disconnect', 'free', 'relayMessageBytesWithOptions'].includes(key)) return method.bind(target)
				return (...input) => {
					log('core-call', { account, method: key })
					const result = method.apply(target, input)
					if (result?.then)
						void result.then(
							() => log('core-return', { account, method: key }),
							error =>
								log('core-reject', {
									account,
									method: key,
									kind: error?.kind,
									notConnected: String(error).includes('not connected')
								})
						)
					return result
				}
			}
		})
	}
}
globalThis.__legacyTransitionSocket = (sock, account) => {
	sock.ev.on('connection.update', update =>
		log('public-connection', {
			account,
			connection: update.connection,
			pending: update.receivedPendingNotifications === true,
			qrPresent: Boolean(update.qr)
		})
	)
	for (const key of ['end', 'setAutoReconnect']) {
		const socketMethod = sock[key].bind(sock)
		sock[key] = (...args) => {
			log('public-call', { account, method: key, enabled: key === 'setAutoReconnect' ? args[0] : undefined })
			return socketMethod(...args)
		}
	}
}
