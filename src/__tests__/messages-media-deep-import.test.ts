import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

describe('messages-media Node deep import', () => {
	it('initializes local-file media without importing the package root', () => {
		const script = `
			const { getStream } = await import('./src/Utils/messages-media.ts')
			const result = await getStream({ url: new URL('./package.json', import.meta.url).pathname })
			if (result.type !== 'file') throw new Error('expected file stream')
			result.stream.destroy()
		`
		const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
		assert.equal(child.status, 0, child.stderr)
	})
})
