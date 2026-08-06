import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Jid as NativeJid, UsyncResponse as NativeUsyncResponse } from '@oxidezap/whatsapp-rust-bridge'
import { fromTypedUSyncResponse, toTypedUSyncQuery } from '../usync/adapter.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { USyncQuery, USyncUser } from '../../WAUSync/index.ts'
import { USyncStatusProtocol } from '../../WAUSync/Protocols/USyncStatusProtocol.ts'

const jid = (user: string, server = 's.whatsapp.net'): NativeJid => ({
	user,
	server,
	agent: 0,
	device: 0,
	integrator: 0
})

const publicProtocols = (query: USyncQuery): USyncQuery =>
	query
		.withContactProtocol()
		.withDeviceProtocol()
		.withStatusProtocol()
		.withDisappearingModeProtocol()
		.withLIDProtocol()
		.withUsernameProtocol()

describe('typed USync compatibility adapter', () => {
	it('projects every public built-in protocol and preserves user-field precedence', () => {
		const query = publicProtocols(new USyncQuery().withMode('delta').withContext('voip'))
			.withBotProfileProtocol()
			.withUser(
				new USyncUser()
					.withId('ignored@s.whatsapp.net')
					.withPhone('+551100000001')
					.withUsername('ignored-by-phone')
					.withType('ignored-by-phone')
					.withLid('1001@lid')
					.withPersonaId('persona-1')
			)
			.withUser(
				new USyncUser().withId('551100000002@c.us').withUsername('alice').withUsernameKey('pin-2').withLid('1002@lid')
			)

		assert.deepEqual(toTypedUSyncQuery(query), {
			mode: 'delta',
			context: 'voip',
			protocols: [
				{ type: 'contact', data: { addressing_mode: 'pn' } },
				{ type: 'devices' },
				{ type: 'status' },
				{ type: 'disappearing_mode' },
				{ type: 'lid' },
				{ type: 'username' },
				{ type: 'bot' }
			],
			users: [
				{
					phone: '+551100000001',
					known_lid: jid('1001', 'lid'),
					persona_id: 'persona-1'
				},
				{
					id: jid('551100000002'),
					username: 'alice',
					username_pin: 'pin-2',
					known_lid: jid('1002', 'lid')
				}
			]
		})
	})

	it('does not mistake custom subclasses or unsupported identities for built-ins', () => {
		class CustomStatusProtocol extends USyncStatusProtocol {
			override getQueryElement(): BinaryNode {
				return { tag: 'status', attrs: { custom: 'true' } }
			}
		}
		const subclass = new USyncQuery().withUser(new USyncUser().withId('5511@s.whatsapp.net'))
		subclass.protocols.push(new CustomStatusProtocol())
		assert.equal(toTypedUSyncQuery(subclass), undefined)

		const groupIdentity = new USyncQuery().withStatusProtocol().withUser(new USyncUser().withId('120363@g.us'))
		assert.equal(toTypedUSyncQuery(groupIdentity), undefined)
	})

	it('maps the neutral response exactly like the upstream public parsers', async () => {
		const upstream = await import('baileys')
		const localQuery = publicProtocols(new USyncQuery())
		const upstreamQuery = new upstream.USyncQuery()
			.withContactProtocol()
			.withDeviceProtocol()
			.withStatusProtocol()
			.withDisappearingModeProtocol()
			.withLIDProtocol()
			.withUsernameProtocol()
		const signedKey = Uint8Array.of(1, 2, 3)
		const response: NativeUsyncResponse = {
			protocol_states: [],
			users: [
				{
					id: jid('5511'),
					pn_jid: jid('5511'),
					protocols: [
						{
							type: 'contact',
							data: { type: 'value', data: { contact_type: 'in', username: 'alice' } }
						},
						{
							type: 'devices',
							data: {
								type: 'value',
								data: {
									device_list: { devices: [{ id: 7, is_hosted: true }] },
									key_index: {
										timestamp: '101',
										signed_key_index_bytes: signedKey,
										expected_timestamp: 102
									}
								}
							}
						},
						{
							type: 'status',
							data: { type: 'value', data: { status: 'Available', timestamp: 103 } }
						},
						{
							type: 'disappearing_mode',
							data: {
								type: 'value',
								data: {
									duration_seconds: 86_400,
									setting_timestamp: 104,
									ephemerality_disabled: false
								}
							}
						},
						{ type: 'lid', data: { type: 'value', data: jid('1001', 'lid') } },
						{ type: 'username', data: { type: 'value', data: 'alice' } }
					]
				}
			]
		}
		const raw: BinaryNode = {
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
									attrs: { jid: '5511@s.whatsapp.net', pn_jid: '5511@s.whatsapp.net' },
									content: [
										{ tag: 'contact', attrs: { type: 'in', username: 'alice' } },
										{
											tag: 'devices',
											attrs: {},
											content: [
												{
													tag: 'device-list',
													attrs: {},
													content: [{ tag: 'device', attrs: { id: '7', is_hosted: 'true' } }]
												},
												{
													tag: 'key-index-list',
													attrs: { ts: '101', expected_ts: '102' },
													content: signedKey
												}
											]
										},
										{ tag: 'status', attrs: { t: '103' }, content: 'Available' },
										{ tag: 'disappearing_mode', attrs: { duration: '86400', t: '104' } },
										{ tag: 'lid', attrs: { val: '1001@lid' } },
										{ tag: 'username', attrs: {}, content: 'alice' }
									]
								}
							]
						}
					]
				}
			]
		}

		assert.deepEqual(fromTypedUSyncResponse(localQuery, response), upstreamQuery.parseUSyncQueryResult(raw))
	})

	it('projects bot profiles to the exact public field set', async () => {
		const upstream = await import('baileys')
		const localQuery = new USyncQuery().withBotProfileProtocol()
		const upstreamQuery = new upstream.USyncQuery().withBotProfileProtocol()
		const response: NativeUsyncResponse = {
			protocol_states: [],
			users: [
				{
					id: jid('5511'),
					protocols: [
						{
							type: 'bot',
							data: {
								type: 'value',
								data: {
									name: 'Helper',
									attributes: 'fast',
									description: 'A helpful bot',
									category: 'utility',
									is_default: true,
									prompts: [{ emoji: '👋', text: 'Hello' }],
									persona_id: 'persona-1',
									commands: [{ name: 'help', description: 'Show help' }],
									commands_description: 'Available commands',
									is_meta_created: true,
									creator_name: 'Meta',
									creator_profile_url: 'https://example.test/meta',
									posing_as_professional: 'yes'
								}
							}
						}
					]
				}
			]
		}
		const profile: BinaryNode = {
			tag: 'profile',
			attrs: { persona_id: 'persona-1' },
			content: [
				{ tag: 'name', attrs: {}, content: 'Helper' },
				{ tag: 'attributes', attrs: {}, content: 'fast' },
				{ tag: 'description', attrs: {}, content: 'A helpful bot' },
				{ tag: 'category', attrs: {}, content: 'utility' },
				{ tag: 'default', attrs: {}, content: 'true' },
				{
					tag: 'prompts',
					attrs: {},
					content: [
						{
							tag: 'prompt',
							attrs: {},
							content: [
								{ tag: 'emoji', attrs: {}, content: '👋' },
								{ tag: 'text', attrs: {}, content: 'Hello' }
							]
						}
					]
				},
				{
					tag: 'commands',
					attrs: {},
					content: [
						{ tag: 'description', attrs: {}, content: 'Available commands' },
						{
							tag: 'command',
							attrs: {},
							content: [
								{ tag: 'name', attrs: {}, content: 'help' },
								{ tag: 'description', attrs: {}, content: 'Show help' }
							]
						}
					]
				}
			]
		}
		const raw: BinaryNode = {
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
									attrs: { jid: '5511@s.whatsapp.net' },
									content: [
										{
											tag: 'bot',
											attrs: { jid: '5511@s.whatsapp.net' },
											content: [{ tag: 'bot', attrs: {}, content: [profile] }]
										}
									]
								}
							]
						}
					]
				}
			]
		}

		assert.deepEqual(fromTypedUSyncResponse(localQuery, response), upstreamQuery.parseUSyncQueryResult(raw))
	})

	it('preserves typed errors as Boom failures instead of silently losing them', () => {
		const query = new USyncQuery().withStatusProtocol()
		const response: NativeUsyncResponse = {
			protocol_states: [],
			users: [
				{
					id: jid('5511'),
					protocols: [
						{
							type: 'status',
							data: { type: 'error', data: { code: 401, text: 'not authorized', backoff: 30 } }
						}
					]
				}
			]
		}

		assert.throws(
			() => fromTypedUSyncResponse(query, response),
			(error: unknown) =>
				error instanceof Error &&
				error.message === 'not authorized' &&
				'output' in error &&
				(error.output as { statusCode?: number }).statusCode === 401
		)
	})
})
