import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWASocketFactory } from '../Socket/core.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import { createAuthenticationState } from '../Compatibility/auth-state.ts'
import { useMemoryStore } from '../Utils/use-memory-store.ts'
import type { ClientPolicies } from '@oxidezap/whatsapp-rust-bridge'
import type { HostSocketConfig } from '../host-types.ts'

const configuredHosts = ['cdn.example:8443'] as const
const hostConfig: Pick<HostSocketConfig, 'additionalStaticMediaHosts'> = { additionalStaticMediaHosts: configuredHosts }

test(
	'socket passes static media authorities alongside history admission to the installed bridge',
	{ timeout: 10_000 },
	async () => {
		let observed: ClientPolicies | null | undefined
		let resolveConstructed!: () => void
		const constructed = new Promise<void>(resolve => {
			resolveConstructed = resolve
		})
		const makeSocket = createWASocketFactory({
			...nodeRuntime,
			bridge: {
				...nodeRuntime.bridge,
				async createWhatsAppClient(_transport, http, events, store, cache, version, count, skip, policies) {
					observed = policies
					const client = await nodeRuntime.bridge.createWhatsAppClient(
						{ connect() {}, send() {}, disconnect() {} },
						http,
						events,
						store,
						cache,
						version,
						count,
						skip,
						policies
					)
					resolveConstructed()
					return client
				}
			}
		})
		const socket = makeSocket({ auth: await createAuthenticationState(useMemoryStore()), ...hostConfig })
		try {
			await constructed
			assert.deepEqual(observed?.additionalStaticMediaHosts, configuredHosts)
			assert.equal(typeof observed?.historySyncAdmission, 'function')
		} finally {
			await socket[Symbol.asyncDispose]()
		}
	}
)
