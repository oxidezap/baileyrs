import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { loadOptionalPeer, type PeerLoader } from '../Utils/optional-peer.ts'
import { expect } from './expect.ts'

const absent = (): PeerLoader => ({
	resolveSpecifier: () => {
		throw Object.assign(new Error('Cannot find module missing-peer/package.json'), { code: 'MODULE_NOT_FOUND' })
	},
	requireSpecifier: () => {
		throw new Error('must not be called')
	}
})

const broken = (failure: unknown): PeerLoader => ({
	resolveSpecifier: () => '/node_modules/broken-peer/package.json',
	requireSpecifier: () => {
		throw failure
	}
})

const present = (module: unknown): PeerLoader => ({
	resolveSpecifier: () => '/node_modules/peer/package.json',
	requireSpecifier: () => module
})

describe('optional peer loading', () => {
	it('falls back when a bundled host has no module URL', () => {
		const source = readFileSync(new URL('../Utils/optional-peer.ts', import.meta.url), 'utf8')
		const bundled = stripTypeScriptTypes(source.replaceAll('import.meta.url', 'undefined')).replaceAll(
			'export const ',
			'const '
		)
		const exports = {} as { loadOptionalPeer: (specifier: string) => unknown }
		runInNewContext(`${bundled}\nexports.loadOptionalPeer = loadOptionalPeer`, {
			exports,
			process: {
				getBuiltinModule: () => ({
					createRequire: () => {
						throw new Error('missing URL')
					}
				})
			}
		})
		expect(exports.loadOptionalPeer('peer')).toBeUndefined()
	})
	it('falls back only when the package manifest is missing', () => {
		expect(loadOptionalPeer('missing-peer', absent())).toBeUndefined()
	})

	it('rethrows resolution failures that are not absence', () => {
		const permission: PeerLoader = {
			resolveSpecifier: () => {
				throw Object.assign(new Error('denied'), { code: 'EACCES' })
			},
			requireSpecifier: () => {
				throw new Error('must not be called')
			}
		}
		expect(() => loadOptionalPeer('peer', permission)).toThrow(/denied/)
	})

	it('surfaces a broken entry point instead of silently falling back', () => {
		const nested = Object.assign(new Error("Cannot find module './missing'"), { code: 'MODULE_NOT_FOUND' })
		let caught: unknown
		try {
			loadOptionalPeer('broken-peer', broken(nested))
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(Error)
		expect((caught as Error).message).toBe(
			"Failed to load optional peer 'broken-peer': it is installed but broken. " +
				'Reinstall it, or remove it to use the built-in fallback.'
		)
		expect((caught as Error & { cause?: unknown }).cause).toBe(nested)
	})

	it('returns the peer module when it loads', () => {
		const module = { version: 'peer' }
		expect(loadOptionalPeer('peer', present(module))).toBe(module)
	})
})
