// Follow-up: aggregate callback latency only; retain the original scenario and timer values.
await import('./legacy-transition.mjs')
import { nodeRuntime } from '../../src/Runtime/node.ts'
import { performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
const bridge = nodeRuntime.bridge
const started = performance.now()
const rows = []
const accounts = []
nodeRuntime.bridge = {
	...bridge,
	async createWhatsAppClient(...args) {
		const account = accounts.length + 1
		const state = { account, started: 0, finished: 0, namespaces: {}, milestones: [] }
		accounts.push(state)
		const store = args[3]
		if (store)
			args[3] = new Proxy(store, {
				get(target, key) {
					const method = target[key]
					if (typeof method !== 'function') return method
					if (!['get', 'getMany', 'set', 'setMany', 'listKeys'].includes(key)) return method.bind(target)
					return (...input) => {
						const begin = performance.now()
						const name = `${key}/${input[0]}`
						state.started++
						const stat = (state.namespaces[name] ??= { calls: 0, sumMs: 0, maxMs: 0 })
						stat.calls++
						const result = method.apply(target, input)
						const finished = () => {
							const elapsed = performance.now() - begin
							state.finished++
							stat.sumMs += elapsed
							stat.maxMs = Math.max(stat.maxMs, elapsed)
							if (state.finished % 64 === 0)
								state.milestones.push({
									elapsedMs: Math.round(performance.now() - started),
									started: state.started,
									finished: state.finished
								})
						}
						if (result?.then) void result.then(finished, finished)
						else finished()
						return result
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
					if (event.type === 'raw_node') {
						const node = event.data?.node ?? event.data
						if (node?.tag === 'iq')
							rows.push({
								account,
								elapsedMs: Math.round(performance.now() - started),
								event: 'iq',
								type: ['result', 'error'].includes(node.attrs?.type) ? node.attrs.type : 'other',
								children: Array.isArray(node.content) ? node.content.map(child => child.tag) : []
							})
					}
					return method.apply(target, events)
				}
			}
		})
		return bridge.createWhatsAppClient(...args)
	}
}
const nativeTimeout = globalThis.setTimeout
globalThis.setTimeout = function (callback, ms, ...args) {
	const deliveryGuard = ms === 15_000 && new Error().stack.includes('/wait.ts:')
	if (!deliveryGuard) return nativeTimeout(callback, ms, ...args)
	rows.push({ elapsedMs: Math.round(performance.now() - started), event: 'delivery-guard-scheduled' })
	return nativeTimeout(
		function (...callbackArgs) {
			rows.push({ elapsedMs: Math.round(performance.now() - started), event: 'delivery-guard-fired' })
			return callback.apply(this, callbackArgs)
		},
		ms,
		...args
	)
}
process.on('exit', () => {
	mkdirSync('.diagnostic-legacy', { recursive: true })
	writeFileSync(
		`.diagnostic-legacy/latency-${process.pid}.json`,
		JSON.stringify({ phase: process.argv.includes('restore') ? 'restore' : 'seed', accounts, rows })
	)
})
