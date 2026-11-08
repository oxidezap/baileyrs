// Explicit diagnostic overlay; the installed npm artifact is never overwritten.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { nodeRuntime } from '../../src/Runtime/node.ts'
const url = new URL(process.env.SOCKET_URL ?? 'https://invalid')
if (
	!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
	process.env.ADV_SECRET_KEY !== 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
)
	throw Error('synthetic mock required')
const variant = process.env.DIAGNOSTIC_VARIANT ?? 'npm'
const observed = process.env.DIAGNOSTIC_OBSERVE === '1'
let bridge = nodeRuntime.bridge
if (variant !== 'npm') {
	if (!['rebuilt', 'profiled'].includes(variant)) throw Error('unknown diagnostic variant')
	const root = resolve('.diagnostic-build', variant)
	const diagnostic = await import(pathToFileURL(resolve(root, 'whatsapp_rust_bridge.js')).href)
	diagnostic.initSync({ module: readFileSync(resolve(root, 'whatsapp_rust_bridge_bg.wasm')) })
	bridge = { ...bridge, ...diagnostic }
}
const events = []
let active = false
let calls = 0
const sample = (kind, fields = {}) => {
	if (active) events.push({ kind, wasmBytes: bridge.getWasmMemoryBytes(), ...fields })
}
const create = bridge.createWhatsAppClient.bind(bridge)
nodeRuntime.bridge = {
	...bridge,
	createWhatsAppClient: async (...args) => {
		const store = args[3]
		if (observed && store)
			args[3] = new Proxy(store, {
				get(target, key) {
					const method = target[key]
					if (typeof method !== 'function') return method
					if (!['get', 'getMany', 'set', 'setMany', 'delete', 'listKeys'].includes(key)) return method.bind(target)
					return (...input) => {
						calls++
						const byteLength = key === 'set' && input[2] instanceof Uint8Array ? input[2].byteLength : undefined
						sample('storage', { method: key, namespace: input[0], byteLength })
						return method.apply(target, input)
					}
				}
			})
		return create(...args)
	}
}
const results = []
let before
const snapshot = () => ({ host: process.memoryUsage(), wasm: bridge.getWasmAllocationSnapshot() })
globalThis.__memoryLifetimes = {
	begin() {
		calls = 0
		events.length = 0
		if (observed) {
			bridge.beginWasmAllocationProfile()
			before = snapshot()
		}
		active = observed
	},
	end() {
		active = false
		if (observed) results.push({ variant, before, after: snapshot(), storageCalls: calls, events: [...events] })
	},
	cleaned() {
		if (observed && results.length) results.at(-1).afterCleanup = snapshot()
	}
}
process.on('exit', () => {
	if (!observed) return
	mkdirSync('.diagnostic-memory', { recursive: true })
	writeFileSync(`.diagnostic-memory/${variant}-${process.pid}.json`, JSON.stringify(results))
})
console.log(
	JSON.stringify({
		diagnosticVariant: variant,
		observed,
		allocationProfilerEnabled: bridge.getWasmAllocationSnapshot().enabled
	})
)
