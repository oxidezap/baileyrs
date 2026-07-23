import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BinaryNode } from '../Types/index.ts'
import {
	USyncContactProtocol,
	USyncDeviceProtocol,
	USyncDisappearingModeProtocol,
	USyncQuery,
	USyncStatusProtocol,
	USyncUser,
	USyncUsernameProtocol
} from '../WAUSync/index.ts'

describe('WAUSync drop-in surface', () => {
	it('keeps fluent user/query builders equivalent to upstream', async () => {
		const upstream = await import('baileys')
		const localUser = new USyncUser()
			.withId('5511999999999@s.whatsapp.net')
			.withLid('123@lid')
			.withPhone('+5511999999999')
			.withUsername('compat')
			.withUsernameKey('pin')
			.withType('in')
			.withPersonaId('persona')
		const upstreamUser = new upstream.USyncUser()
			.withId('5511999999999@s.whatsapp.net')
			.withLid('123@lid')
			.withPhone('+5511999999999')
			.withUsername('compat')
			.withUsernameKey('pin')
			.withType('in')
			.withPersonaId('persona')
		assert.deepEqual({ ...localUser }, { ...upstreamUser })

		const local = new USyncQuery()
			.withMode('full')
			.withContext('background')
			.withUser(localUser)
			.withContactProtocol()
			.withDeviceProtocol()
			.withStatusProtocol()
			.withDisappearingModeProtocol()
			.withUsernameProtocol()
		const remote = new upstream.USyncQuery()
			.withMode('full')
			.withContext('background')
			.withUser(upstreamUser)
			.withContactProtocol()
			.withDeviceProtocol()
			.withStatusProtocol()
			.withDisappearingModeProtocol()
			.withUsernameProtocol()
		assert.deepEqual(
			{
				mode: local.mode,
				context: local.context,
				protocolNames: local.protocols.map(protocol => protocol.name)
			},
			{
				mode: remote.mode,
				context: remote.context,
				protocolNames: remote.protocols.map(protocol => protocol.name)
			}
		)
	})

	it('matches individual query/user elements and parser values', async () => {
		const upstream = await import('baileys')
		const user = new USyncUser().withUsername('compat').withUsernameKey('pin').withLid('123@lid')
		assert.deepEqual(
			new USyncContactProtocol().getUserElement(user),
			new upstream.USyncContactProtocol().getUserElement(user)
		)
		assert.deepEqual(new USyncDeviceProtocol().getQueryElement(), new upstream.USyncDeviceProtocol().getQueryElement())
		assert.deepEqual(
			new USyncDisappearingModeProtocol().parser({
				tag: 'disappearing_mode',
				attrs: { duration: '86400', t: '100' }
			}),
			new upstream.USyncDisappearingModeProtocol().parser({
				tag: 'disappearing_mode',
				attrs: { duration: '86400', t: '100' }
			})
		)
		assert.deepEqual(
			new USyncStatusProtocol().parser({ tag: 'status', attrs: { t: '100' }, content: 'online' }),
			new upstream.USyncStatusProtocol().parser({ tag: 'status', attrs: { t: '100' }, content: 'online' })
		)
		assert.equal(new USyncUsernameProtocol().parser({ tag: 'username', attrs: {}, content: 'user' }), 'user')
	})

	it('parses a complete result tree exactly like upstream', async () => {
		const upstream = await import('baileys')
		const result: BinaryNode = {
			tag: 'iq',
			attrs: { type: 'result' },
			content: [
				{
					tag: 'usync',
					attrs: {},
					content: [
						{
							tag: 'list',
							attrs: {},
							content: [
								{
									tag: 'user',
									attrs: { jid: '5511999999999@s.whatsapp.net' },
									content: [
										{ tag: 'contact', attrs: { type: 'in' } },
										{ tag: 'status', attrs: { t: '100' }, content: 'hello' },
										{ tag: 'username', attrs: {}, content: 'compat' }
									]
								}
							]
						}
					]
				}
			]
		}
		const local = new USyncQuery().withContactProtocol().withStatusProtocol().withUsernameProtocol()
		const remote = new upstream.USyncQuery().withContactProtocol().withStatusProtocol().withUsernameProtocol()
		assert.deepEqual(local.parseUSyncQueryResult(result), remote.parseUSyncQueryResult(result))
	})
})
