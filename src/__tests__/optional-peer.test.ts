import { describe, it } from 'node:test'
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
