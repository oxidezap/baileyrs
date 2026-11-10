import { options as benchmarkOptions } from '../benchmarks/options.ts'
import { test, describe } from 'vitest'
import { areJidsSameUser, jidDecode, jidEncode, jidNormalizedUser, transferDevice } from '../src/WABinary/index.ts'
import { makeJids } from './fixtures.ts'

const jids = makeJids(1000)
const decoded = jids.map(jid => jidDecode(jid)!)

describe('jid utils (1000 jids)', () => {
	test('jidDecode', async ({ bench }) => {
		await bench('jidDecode', () => {
			for (const jid of jids) jidDecode(jid)
		}).run(benchmarkOptions)
	})

	test('jidEncode', async ({ bench }) => {
		await bench('jidEncode', () => {
			for (const { user, server, device } of decoded) jidEncode(user, server, device)
		}).run(benchmarkOptions)
	})

	test('jidNormalizedUser', async ({ bench }) => {
		await bench('jidNormalizedUser', () => {
			for (const jid of jids) jidNormalizedUser(jid)
		}).run(benchmarkOptions)
	})

	test('areJidsSameUser', async ({ bench }) => {
		await bench('areJidsSameUser', () => {
			for (let i = 1; i < jids.length; i++) areJidsSameUser(jids[i - 1], jids[i])
		}).run(benchmarkOptions)
	})

	test('transferDevice', async ({ bench }) => {
		await bench('transferDevice', () => {
			for (let i = 1; i < jids.length; i++) transferDevice(jids[i - 1]!, jids[i]!)
		}).run(benchmarkOptions)
	})
})
