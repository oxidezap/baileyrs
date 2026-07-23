import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
	Jid as NativeJid,
	UsyncQuery as NativeUsyncQuery,
	UsyncResponse as NativeUsyncResponse
} from 'whatsapp-rust-bridge'
import type { BinaryNode } from '../Types/index.ts'
import type { USyncQueryProtocol } from '../Types/USync.ts'
import { makeUSyncMethods } from '../Socket/usync.ts'
import { USyncQuery, USyncUser } from '../WAUSync/index.ts'

const nativeJid = (user = '5511', server = 's.whatsapp.net'): NativeJid => ({
	user,
	server,
	agent: 0,
	device: 0,
	integrator: 0
})

const emptyTypedResponse = (): NativeUsyncResponse => ({ protocol_states: [], users: [] })

const rawResponse = (protocolNode: BinaryNode): BinaryNode => ({
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
					content: [{ tag: 'user', attrs: { jid: '5511@s.whatsapp.net' }, content: [protocolNode] }]
				}
			]
		}
	]
})

describe('socket USync compatibility', () => {
	it('rejects an empty protocol set before issuing either request kind', async () => {
		let rawCalls = 0
		let typedCalls = 0
		const methods = makeUSyncMethods({
			queryNode: async node => {
				rawCalls += 1
				return node
			},
			queryUsync: async () => {
				typedCalls += 1
				return emptyTypedResponse()
			}
		})

		await assert.rejects(methods.executeUSyncQuery(new USyncQuery()), /must have at least one protocol/)
		assert.equal(rawCalls, 0)
		assert.equal(typedCalls, 0)
	})

	it('uses the generated typed boundary for a built-in status query', async () => {
		let request: NativeUsyncQuery | undefined
		let rawCalls = 0
		const methods = makeUSyncMethods({
			queryNode: async node => {
				rawCalls += 1
				return node
			},
			queryUsync: async query => {
				request = query
				return {
					protocol_states: [],
					users: [
						{
							id: nativeJid(),
							protocols: [
								{
									type: 'status',
									data: { type: 'value', data: { status: 'Available', timestamp: 100 } }
								}
							]
						}
					]
				}
			}
		})

		assert.deepEqual(await methods.fetchStatus('5511@s.whatsapp.net'), [
			{
				id: '5511@s.whatsapp.net',
				status: { status: 'Available', setAt: new Date(100_000) }
			}
		])
		assert.equal(rawCalls, 0)
		assert.deepEqual(request, {
			mode: 'query',
			context: 'interactive',
			protocols: [{ type: 'status' }],
			users: [{ id: nativeJid() }]
		})
	})

	it('preserves disappearing-mode fields and typed mode/context', async () => {
		let request: NativeUsyncQuery | undefined
		const methods = makeUSyncMethods({
			queryNode: async () => assert.fail('built-in query must not use raw nodes'),
			queryUsync: async query => {
				request = query
				return {
					protocol_states: [],
					users: [
						{
							id: nativeJid(),
							protocols: [
								{
									type: 'disappearing_mode',
									data: {
										type: 'value',
										data: {
											duration_seconds: 86_400,
											setting_timestamp: 200,
											ephemerality_disabled: false
										}
									}
								}
							]
						}
					]
				}
			}
		})

		const custom = new USyncQuery()
			.withContext('background')
			.withMode('full')
			.withDisappearingModeProtocol()
			.withUser(new USyncUser().withId('5511@s.whatsapp.net'))
		assert.deepEqual(await methods.executeUSyncQuery(custom), {
			list: [
				{
					id: '5511@s.whatsapp.net',
					disappearing_mode: { duration: 86_400, setAt: new Date(200_000) }
				}
			],
			sideList: []
		})
		assert.equal(request?.context, 'background')
		assert.equal(request?.mode, 'full')
	})

	it('keeps caller-defined protocols on the raw-node escape hatch', async () => {
		let rawRequest: BinaryNode | undefined
		let typedCalls = 0
		const customProtocol: USyncQueryProtocol = {
			name: 'custom',
			getQueryElement: () => ({ tag: 'custom', attrs: { version: '1' } }),
			getUserElement: () => ({ tag: 'custom', attrs: { input: 'yes' } }),
			parser: node => node.attrs.value
		}
		const methods = makeUSyncMethods({
			queryNode: async node => {
				rawRequest = node
				return rawResponse({ tag: 'custom', attrs: { value: 'ok' } })
			},
			queryUsync: async () => {
				typedCalls += 1
				return emptyTypedResponse()
			}
		})
		const query = new USyncQuery().withUser(new USyncUser().withId('5511@s.whatsapp.net'))
		query.protocols.push(customProtocol)

		assert.deepEqual(await methods.executeUSyncQuery(query), {
			list: [{ id: '5511@s.whatsapp.net', custom: 'ok' }],
			sideList: []
		})
		assert.equal(typedCalls, 0)
		assert.ok(rawRequest)
		assert.equal(rawRequest.tag, 'iq')
		const usync = (rawRequest.content as BinaryNode[])[0]!
		const [queryNode, listNode] = usync.content as BinaryNode[]
		assert.deepEqual(queryNode?.content, [{ tag: 'custom', attrs: { version: '1' } }])
		assert.deepEqual(listNode?.content, [
			{
				tag: 'user',
				attrs: { jid: '5511@s.whatsapp.net' },
				content: [{ tag: 'custom', attrs: { input: 'yes' } }]
			}
		])
	})
})
