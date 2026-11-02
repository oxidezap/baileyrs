import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { createCallMediaScope } from '../Socket/call-media-streams.ts'

describe('call media wait lifetime', () => {
	it('does not retain completed wait results until call closure', () => {
		const moduleUrl = new URL('../Socket/call-media-streams.ts', import.meta.url).href
		const child = spawnSync(
			process.execPath,
			[
				'--expose-gc',
				'--input-type=module',
				'-e',
				`
			import { createCallMediaScope } from ${JSON.stringify(moduleUrl)};
			const scope = createCallMediaScope(new AbortController().signal, () => {}, () => {});
			globalThis.scope = scope;
			const refs = [];
			for (let index = 0; index < 3000; index++) {
				const value = await scope.wait(Promise.resolve({ index }));
				refs.push(new WeakRef(value));
			}
			for (let index = 0; index < 5; index++) {
				await new Promise(resolve => setImmediate(resolve));
				global.gc();
			}
			const retained = refs.filter(ref => ref.deref()).length;
			await scope.close();
			console.log(JSON.stringify({ retained }));
		`
			],
			{ encoding: 'utf8', timeout: 15000 }
		)
		assert.equal(child.status, 0, child.stderr)
		assert.ok(JSON.parse(child.stdout).retained < 20, child.stdout)
	})
	it('observes an operation rejection even when its scope already closed', async () => {
		const scope = createCallMediaScope(
			new AbortController().signal,
			() => {},
			() => {}
		)
		await scope.close()
		await assert.rejects(scope.wait(Promise.reject(new Error('late failure'))), { name: 'AbortError' })
	})
	it('cancels all pending waits on close without unhandled rejection', async () => {
		const scope = createCallMediaScope(
			new AbortController().signal,
			() => {},
			() => {}
		)
		const rejectLate: Array<(error: Error) => void> = []
		const waits = Array.from({ length: 4 }, () =>
			scope.wait(
				new Promise<void>((_, reject) => {
					rejectLate.push(reject)
				})
			)
		)
		const results = Promise.allSettled(waits)
		await scope.close()
		for (const reject of rejectLate) reject(new Error('late operation failure'))
		await new Promise<void>(resolve => setImmediate(resolve))
		for (const result of await results) {
			assert.equal(result.status, 'rejected')
			if (result.status === 'rejected') assert.equal(result.reason.name, 'AbortError')
		}
	})
})
