import { bench, describe } from 'vitest'
import { areJidsSameUser, jidDecode, jidEncode, jidNormalizedUser, transferDevice } from '../src/WABinary/index.ts'
import { makeJids } from './fixtures.ts'

const jids = makeJids(1000)
const decoded = jids.map(jid => jidDecode(jid)!)

describe('jid utils (1000 jids)', () => {
	bench('jidDecode', () => {
		for (const jid of jids) jidDecode(jid)
	})

	bench('jidEncode', () => {
		for (const { user, server, device } of decoded) jidEncode(user, server, device)
	})

	bench('jidNormalizedUser', () => {
		for (const jid of jids) jidNormalizedUser(jid)
	})

	bench('areJidsSameUser', () => {
		for (let i = 1; i < jids.length; i++) areJidsSameUser(jids[i - 1], jids[i])
	})

	bench('transferDevice', () => {
		for (let i = 1; i < jids.length; i++) transferDevice(jids[i - 1]!, jids[i]!)
	})
})
