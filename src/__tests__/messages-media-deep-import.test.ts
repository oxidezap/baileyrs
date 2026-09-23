import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

describe('Node media deep imports', () => {
	it('initializes local-file media from messages-media without importing the package root', () => {
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

	it('initializes local-file media from messages without importing the package root', () => {
		const script = `
			const { prepareWAMessageMedia } = await import('./src/Utils/messages.ts')
			const upload = {
				url: 'https://example.invalid/media',
				directPath: '/media',
				mediaKey: new Uint8Array(32),
				fileSha256: new Uint8Array(32),
				fileEncSha256: new Uint8Array(32),
				fileLength: 1
			}
			const message = await prepareWAMessageMedia(
				{ image: { url: new URL('./package.json', import.meta.url).pathname } },
				{
					waClient: {},
					processMedia: async bytes => {
						if (!bytes.byteLength) throw new Error('local file was not read')
						return { upload }
					}
				}
			)
			if (!message.imageMessage) throw new Error('media message was not prepared')
		`
		const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		})
		assert.equal(child.status, 0, child.stderr)
	})
})
