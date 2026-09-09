import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { proto as rootProto, WAProto as rootWAProto } from '../index.ts'
import { WAProto as typesWAProto } from '../Types/index.ts'
import { proto as runtimeProto } from '../WAProto/runtime.ts'
import { expect } from './expect.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// A bundler build of the published package once failed here with
// `conflicting star exports for the name WAProto`: the WAProto shim and
// `Types/Message` each exported the name and the package root re-exported
// both by star. The root now names the binding explicitly, so there is one
// binding whatever path a consumer imports it from.
describe('bundler export surface', () => {
	it('exposes a single proto/WAProto binding from the package root', () => {
		expect(rootProto).toBe(runtimeProto)
		expect(rootWAProto).toBe(runtimeProto)
	})

	it('keeps the Types-level WAProto alias on the same binding', () => {
		expect(typesWAProto).toBe(runtimeProto)
	})

	it('re-exports WAProto from the root explicitly, never by star', () => {
		const index = readFileSync(resolve(repoRoot, 'src/index.ts'), 'utf8')
		for (const line of index.split('\n')) {
			if (line.startsWith('export *')) {
				expect(line.includes('WAProto')).toBe(false)
			}
		}
		expect(index.includes('proto as WAProto')).toBe(true)
	})

	it('declares music-metadata as an installable optional peer', () => {
		const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
			peerDependencies?: Record<string, string>
			peerDependenciesMeta?: Record<string, { optional?: boolean }>
		}
		expect(typeof manifest.peerDependencies?.['music-metadata']).toBe('string')
		expect(manifest.peerDependenciesMeta?.['music-metadata']?.optional).toBe(true)
	})

	it('keeps the music-metadata import opaque to bundlers', () => {
		// Webpack turns a statically analyzable `import('music-metadata')`
		// into a hard error when the optional peer is absent, but only warns
		// on a non-literal specifier. The `as string` cast is what keeps the
		// published build warning-only, so a change dropping it must fail here.
		const source = readFileSync(resolve(repoRoot, 'src/Utils/messages-media.ts'), 'utf8')
		expect(source.includes("import('music-metadata' as string)")).toBe(true)
		expect(source.includes("await import('music-metadata')")).toBe(false)
	})
})
