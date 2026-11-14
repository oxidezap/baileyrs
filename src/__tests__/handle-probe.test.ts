import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { instrumentHandleGlue, loadInstrumentedBridge } from './e2e/handle-probe.ts'

const fixture = (short: boolean) => `
var drops=0,wasm={__wbindgen_export6(){drops++}},registry=new FinalizationRegistry(${short ? 's=>wasm.__wbindgen_export6(s.a,s.b)' : '(s)=>wasm.__wbindgen_export6(s.a,s.b)'});
function make(a,b,fn){let state={a:a,b:b,cnt:1},closure=(...args)=>{state.cnt++;try{return fn(...args)}finally{closure._wbg_cb_unref()}};return closure._wbg_cb_unref=()=>{${short ? '0===--state.cnt&&(wasm.__wbindgen_export6(state.a,state.b),registry.unregister(state))' : 'if(--state.cnt===0){wasm.__wbindgen_export6(state.a,state.b);registry.unregister(state)}'}},registry.register(closure,state,state),closure}
`
for (const short of [false, true]) {
	test(`handle counter counts allocation, callback references, explicit drop and finalization (${short})`, () => {
		const held = new Map<object, object>()
		let finalize: (value: object) => void
		class Registry {
			constructor(callback: (value: object) => void) {
				finalize = callback
			}
			register(_target: object, value: object, token: object) {
				held.set(token, value)
			}
			unregister(token: object) {
				held.delete(token)
			}
		}
		const context = { FinalizationRegistry: Registry, process: { env: { HANDLE_PROBE_TRACE: '1' } } }
		runInNewContext(
			instrumentHandleGlue(fixture(short)) +
				`
var first=make(1,2,()=>42); if(first()!==42)throw Error('callback changed');
`,
			context
		)
		const counters = (
			context as typeof context & {
				__handleProbe: { made: number; freed: number; finalized: number; alive: Map<unknown, unknown> }
			}
		).__handleProbe
		assert.equal(counters.made, 1)
		assert.equal(counters.freed, 0)
		assert.equal(counters.alive.size, 1)
		runInNewContext('first._wbg_cb_unref()', context)
		assert.equal(counters.freed, 1)
		assert.equal(runInNewContext('drops', context), 1)
		assert.equal(counters.finalized, 0)
		assert.equal(held.size, 0)
		runInNewContext('var second=make(3,4,()=>7)', context)
		finalize!(held.values().next().value!)
		assert.equal(counters.made, 2)
		assert.equal(counters.freed, 2)
		assert.equal(runInNewContext('drops', context), 2)
		assert.equal(counters.finalized, 1)
		assert.equal(counters.alive.size, 0)
	})
}

test('handle recognition fails closed for missing or ambiguous hooks', () => {
	assert.throws(() => instrumentHandleGlue(''), /closure helper/)
	assert.throws(() => instrumentHandleGlue(fixture(true).replace('_wbg_cb_unref=()=>', '_unknown=()=>')), /unref hook/)
	assert.throws(() => instrumentHandleGlue(fixture(true) + fixture(true)), /ambiguous/)
	assert.throws(
		() =>
			instrumentHandleGlue(
				fixture(true).replace('new FinalizationRegistry(s=>wasm.__wbindgen_export6(s.a,s.b))', '{}')
			),
		/FinalizationRegistry/
	)
})

test('published bridge glue loads with the handle guard enabled', async () => {
	const loaded = await loadInstrumentedBridge()
	try {
		assert.equal(typeof loaded.bridge.createWhatsAppClient, 'function')
		assert.equal(loaded.probe.live, loaded.probe.made - loaded.probe.freed)
	} finally {
		loaded.cleanup()
	}
})
