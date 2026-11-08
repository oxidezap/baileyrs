// Published-artifact attribution, aligned after CodSpeed's existing full-GC boundary.
import { nodeRuntime } from '../../src/Runtime/node.ts'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'
const endpoint = new URL(process.env.SOCKET_URL ?? 'https://invalid')
if (
	!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
	process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
)
	throw Error('synthetic mock required')
const observed = process.env.DIAGNOSTIC_OBSERVE === '1'
const label = process.env.DIAGNOSTIC_LABEL ?? 'unlabelled'
const variant = process.env.DIAGNOSTIC_VARIANT ?? 'npm'
const nativeSnapshots = process.env.DIAGNOSTIC_NATIVE === '1'
let bridge = nodeRuntime.bridge
if (variant !== 'npm') {
	if (!['rebuilt', 'profiled'].includes(variant)) throw Error('unknown diagnostic variant')
	const root = resolve('.diagnostic-build', variant)
	const diagnostic = await import(pathToFileURL(resolve(root, 'whatsapp_rust_bridge.js')).href)
	diagnostic.initSync({ module: readFileSync(resolve(root, 'whatsapp_rust_bridge_bg.wasm')) })
	bridge = { ...bridge, ...diagnostic }
}
nodeRuntime.bridge = bridge
const results = []
let armed = false
let active = false
let before
let current
let events = []
const snapshot = () => ({
	wasmBytes: bridge.getWasmMemoryBytes(),
	...(nativeSnapshots ? { native: bridge.getWasmAllocationSnapshot() } : {}),
	spaces: getHeapSpaceStatistics(),
	heap: getHeapStatistics(),
	host: process.memoryUsage()
})
const record = (kind, fields) => {
	if (active) events.push({ kind, wasmBytes: bridge.getWasmMemoryBytes(), ...fields })
}
if (observed) {
	const create = bridge.createWhatsAppClient.bind(bridge)
	nodeRuntime.bridge = {
		...bridge,
		createWhatsAppClient: async (...args) => {
			const store = args[3]
			if (store)
				args[3] = new Proxy(store, {
					get(target, key) {
						const method = target[key]
						if (typeof method !== 'function') return method
						if (!['get', 'getMany', 'set', 'setMany', 'delete', 'listKeys'].includes(key)) return method.bind(target)
						return (...input) => {
							record('storage', {
								method: key,
								namespace: input[0],
								byteLength:
									key === 'set' && input[2] instanceof Uint8Array
										? input[2].byteLength
										: key === 'setMany' && Array.isArray(input[1])
											? input[1].reduce((sum, entry) => sum + (entry[1]?.byteLength ?? 0), 0)
											: undefined
							})
							return method.apply(target, input)
						}
					}
				})
			return create(...args)
		}
	}
	const NativeWebSocket = globalThis.WebSocket
	globalThis.WebSocket = class extends NativeWebSocket {
		send(data) {
			record('send', { bytes: data.byteLength })
			return super.send(data)
		}
	}
}
const traceBuffers = process.env.DIAGNOSTIC_BUFFER_LIFETIME === '1'
const finalized = []
if (observed && traceBuffers) {
	const labels = new WeakMap()
	let nextLabel = 0
	const registry = new FinalizationRegistry(bufferLabel => finalized.push(bufferLabel))
	for (const method of ['from', 'alloc', 'allocUnsafe', 'allocUnsafeSlow']) {
		const original = Buffer[method]
		Buffer[method] = function (...args) {
			const result = Reflect.apply(original, this, args)
			if (active && result.byteLength >= 32_768) {
				if (!labels.has(result.buffer)) {
					labels.set(result.buffer, ++nextLabel)
					registry.register(result.buffer, nextLabel)
				}
				const stack = new Error().stack
				const site = stack.includes('snapshot-transactions.ts')
					? 'snapshot'
					: stack.includes('internal/fs')
						? 'fs'
						: stack.includes('internal/deps/undici')
							? 'undici'
							: 'other'
				record('large-buffer', {
					method,
					label: labels.get(result.buffer),
					bytes: result.byteLength,
					backingBytes: result.buffer.byteLength,
					site
				})
			}
			return result
		}
	}
}
const nativeGc = globalThis.gc
if (typeof nativeGc !== 'function') throw Error('CodSpeed exposed GC required')
globalThis.gc = (...args) => {
	const result = nativeGc(...args)
	if (armed && observed) {
		events = []
		before = snapshot()
		if (nativeSnapshots) bridge.beginWasmAllocationProfile()
		active = true
		armed = false
	}
	return result
}
globalThis.__memoryLifetimes = {
	begin() {
		before = undefined
		current = undefined
		active = false
		armed = observed
	},
	end() {
		active = false
		armed = false
		if (observed && before) {
			current = { label, afterForcedGc: true, before, after: snapshot(), events }
			results.push(current)
		}
	},
	async cleaned() {
		if (current) {
			current.afterCleanup = snapshot()
			if (traceBuffers) {
				nativeGc()
				await new Promise(done => setImmediate(done))
				nativeGc()
				await new Promise(done => setImmediate(done))
				current.afterCleanupGc = snapshot()
				current.finalizedBufferLabels = [...finalized]
			}
			mkdirSync('.diagnostic-published', { recursive: true })
			writeFileSync(`.diagnostic-published/${label}-${process.pid}.json`, JSON.stringify([current]))
			console.log('DIA_LIFETIME ' + JSON.stringify(current))
		}
	}
}
process.on('exit', () => {
	if (!observed) return
	mkdirSync('.diagnostic-published', { recursive: true })
	writeFileSync(`.diagnostic-published/${label}-${process.pid}.json`, JSON.stringify(results))
})
console.log(
	JSON.stringify({ publishedDiagnostic: label, observed, allocatorEnabled: bridge.getWasmAllocationSnapshot().enabled })
)
