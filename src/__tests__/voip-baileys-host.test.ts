import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { createBaileysCallHost, type BaileysCallSocket } from '../Voip/baileys-host.ts'
import type { BinaryNode } from '../Types/BinaryNode.ts'

const peer = '222222222222222@lid'
const device = '222222222222222:1@lid'
const acknowledgement = (id: string): BinaryNode => ({ tag: 'ack', attrs: { id, class: 'call', error: '503' } })
const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}

const harness = (ackTimeoutMs = 1000) => {
	const ws = Object.assign(new EventEmitter(), { isOpen: true })
	ws.setMaxListeners(0)
	const calls: unknown[] = []
	const identity = new Uint8Array([9, 8, 7])
	const socket: BaileysCallSocket & { issuePrivacyTokens(jids: string[]): Promise<void> } = {
		ws,
		authState: {
			creds: { me: { id: '11111111111@s.whatsapp.net', lid: '111111111111111@lid' }, account: {} },
			keys: { get: async () => ({}) }
		},
		signalRepository: {
			lidMapping: { getLIDForPN: async () => peer },
			getSessionInfo: async () => ({ baseKey: new Uint8Array([1]), registrationId: 7 }),
			encryptMessage: async options => {
				calls.push(['encrypt', options])
				return { type: 'pkmsg', ciphertext: new Uint8Array([4, 5]) }
			},
			decryptMessage: async options => {
				calls.push(['decrypt', options])
				return new Uint8Array([6, 7])
			}
		},
		getUSyncDevices: async (...args) => {
			calls.push(['devices', ...args])
			return [
				{ jid: peer, device: 0 },
				{ jid: device, device: 1 }
			]
		},
		assertSessions: async (...args) => {
			calls.push(['sessions', ...args])
			return true
		},
		issuePrivacyTokens: async (...args) => {
			calls.push(['token', ...args])
		},
		generateMessageTag: () => 'DIRECT-1',
		sendNode: async node => {
			calls.push(['send', node])
			ws.emit(`TAG:${node.attrs.id}`, acknowledgement(node.attrs.id!))
		}
	}
	const adapter = createBaileysCallHost(socket, {
		encodeDeviceIdentity: (account, include) => {
			calls.push(['identity', account, include])
			return identity
		},
		ackTimeoutMs
	})
	return { ...adapter, socket, ws, calls, identity }
}

describe('upstream Baileys direct-call host', () => {
	it('uses live identity and resolves PN through the authoritative mapping', async () => {
		const h = harness()
		assert.equal(h.host.ownLid(), '111111111111111@lid')
		assert.equal(h.host.ownPn(), '11111111111@s.whatsapp.net')
		h.socket.authState.creds.me!.lid = '333333333333333@lid'
		assert.equal(h.host.ownLid(), '333333333333333@lid')
		let lookups = 0
		h.socket.signalRepository.lidMapping.getLIDForPN = async () => (++lookups === 1 ? null : peer)
		assert.equal(await h.host.resolvePeer('22222222222@s.whatsapp.net'), peer)
		assert.deepEqual(h.calls, [['devices', ['22222222222@s.whatsapp.net'], true, false]])
		h.dispose()
	})
	it('uses only persisted trusted namespace aliases and preserves companion device ids', async () => {
		const h = harness()
		h.socket.signalRepository.lidMapping.getLIDForPN = async () => {
			throw new Error('network lookup is forbidden for identity checks')
		}
		h.socket.authState.keys.get = async (type, ids) => {
			assert.equal(type, 'lid-mapping')
			if (ids[0] === '222222222222222_reverse') return { '222222222222222_reverse': '22222222222' }
			if (ids[0] === '22222222222') return { '22222222222': '222222222222222' }
			return {}
		}
		assert.equal(await h.host.namespaceAlias(device), '22222222222:1@s.whatsapp.net')
		assert.equal(await h.host.namespaceAlias('22222222222:7@s.whatsapp.net'), '222222222222222:7@lid')
		assert.equal(await h.host.namespaceAlias('444444444444444:7@lid'), undefined)
		assert.equal(await h.host.namespaceAlias('123@g.us'), undefined)
		assert.deepEqual(h.calls, [])
		h.dispose()
	})
	it('refuses identity alias storage failures instead of treating them as an absent mapping', async () => {
		const h = harness(),
			failure = new Error('synthetic mapping read failed')
		h.socket.authState.keys.get = async () => {
			throw failure
		}
		await assert.rejects(h.host.namespaceAlias(device), cause => cause === failure)
		assert.deepEqual(h.calls, [])
		h.dispose()
	})
	it('accepts an already trusted identity pair and rejects unknown or conflicting migration', async () => {
		const h = harness()
		h.socket.authState.keys.get = async () => ({ '222222222222222_reverse': '22222222222' })
		await h.host.learnIdentity(device, '22222222222@s.whatsapp.net', false, false)
		await assert.rejects(h.host.learnIdentity(device, '33333333333@s.whatsapp.net', false, false), /first-contact/)
		h.socket.authState.keys.get = async () => ({})
		await assert.rejects(h.host.learnIdentity(device, '22222222222@s.whatsapp.net', true, true), /first-contact/)
		assert.deepEqual(h.calls, [])
		h.dispose()
	})
	it('checks and encodes identity before session mutation and awaits repository persistence', async () => {
		const h = harness(),
			committed = deferred<{ type: 'pkmsg'; ciphertext: Uint8Array }>()
		h.socket.signalRepository.encryptMessage = async options => {
			h.calls.push(['encrypt', options])
			return committed.promise
		}
		const plaintext = new Uint8Array([1, 2, 3])
		let settled = false
		const preparing = h.host.prepareKeys(peer, plaintext).then(result => {
			settled = true
			return result
		})
		await new Promise(resolve => setImmediate(resolve))
		assert.equal(settled, false)
		assert.deepEqual(h.calls.slice(0, 3), [
			['identity', h.socket.authState.creds.account, true],
			['devices', [peer], true, false],
			['sessions', [peer, device]]
		])
		committed.resolve({ type: 'pkmsg', ciphertext: new Uint8Array([4, 5]) })
		const result = await preparing
		assert.deepEqual(result.ringDevices, [peer, device])
		assert.deepEqual(
			result.deviceKeys.map(key => key.deviceJid),
			[peer, device]
		)
		assert.equal(result.deviceIdentity, h.identity)
		assert.equal((h.calls[3] as [string, { data: Uint8Array }])[1].data, plaintext)
		h.dispose()
	})
	it('refuses missing or invalid identity before discovery or ratchet changes', async () => {
		const h = harness()
		delete h.socket.authState.creds.account
		await assert.rejects(h.host.prepareKeys(peer, new Uint8Array([1])), /linked device identity/)
		assert.deepEqual(h.calls, [])
		h.socket.authState.creds.account = {}
		const invalid = createBaileysCallHost(h.socket, { encodeDeviceIdentity: () => new Uint8Array() })
		await assert.rejects(invalid.host.prepareKeys(peer, new Uint8Array([1])), /non-empty bytes/)
		assert.deepEqual(h.calls, [])
		invalid.dispose()
		h.dispose()
	})
	it('filters unsupported hosted devices and does not mutate duplicate ratchets twice', async () => {
		const h = harness()
		h.socket.getUSyncDevices = async () => [
			{ jid: peer, device: 0 },
			{ jid: peer, device: 0 },
			{ jid: '222222222222222:99@lid', device: 99 },
			{ jid: '22222222222@hosted' },
			{ jid: '222222222222222@hosted.lid' }
		]
		h.socket.signalRepository.encryptMessage = async options => {
			h.calls.push(['encrypt', options])
			return { type: 'msg', ciphertext: new Uint8Array([1]) }
		}
		const result = await h.host.prepareKeys(peer, new Uint8Array([2]))
		assert.deepEqual(result.ringDevices, [peer])
		assert.equal(result.deviceKeys.length, 1)
		assert.equal(result.deviceIdentity, undefined)
		h.dispose()
	})
	it('skips a missing primary session without removing that device from the full ring set', async () => {
		const h = harness(),
			metadataReads: string[] = []
		h.socket.signalRepository.getSessionInfo = async jid => {
			metadataReads.push(jid)
			return jid === peer ? null : { baseKey: new Uint8Array([1]), registrationId: 7 }
		}
		const result = await h.host.prepareKeys(peer, new Uint8Array([2]))
		assert.deepEqual(metadataReads, [peer, device])
		assert.deepEqual(result.ringDevices, [peer, device])
		assert.deepEqual(
			result.deviceKeys.map(key => key.deviceJid),
			[device]
		)
		assert.deepEqual(
			h.calls
				.filter(call => (call as unknown[])[0] === 'encrypt')
				.map(call => (call as [string, { jid: string }])[1].jid),
			[device]
		)
		h.dispose()
	})
	it('refuses an all-missing session set without encrypting or sending an offer', async () => {
		const h = harness()
		h.socket.signalRepository.getSessionInfo = async () => null
		await assert.rejects(h.host.prepareKeys(peer, new Uint8Array([2])), /no established Signal sessions/)
		assert.ok(h.calls.every(call => !['encrypt', 'send'].includes((call as string[])[0]!)))
		h.dispose()
	})
	it('propagates session metadata storage errors before crypto instead of treating them as misses', async () => {
		const h = harness(),
			failure = new Error('synthetic session storage failure')
		h.socket.signalRepository.getSessionInfo = async () => {
			throw failure
		}
		await assert.rejects(h.host.prepareKeys(peer, new Uint8Array([2])), error => error === failure)
		assert.ok(h.calls.every(call => !['encrypt', 'send'].includes((call as string[])[0]!)))
		h.dispose()
	})
	it('rechecks connection ownership after a pending metadata read and before encryption', async () => {
		const h = harness(),
			metadata = deferred<{ baseKey: Uint8Array; registrationId: number }>(),
			entered = deferred<void>()
		h.socket.signalRepository.getSessionInfo = async () => {
			entered.resolve()
			return metadata.promise
		}
		const preparing = h.host.prepareKeys(peer, new Uint8Array([2]))
		await entered.promise
		h.dispose()
		metadata.resolve({ baseKey: new Uint8Array([1]), registrationId: 7 })
		await assert.rejects(preparing, /connection closed/)
		assert.ok(h.calls.every(call => !['encrypt', 'send'].includes((call as string[])[0]!)))
	})
	it('propagates repository and token-store failure rather than sending partial signaling', async () => {
		const h = harness(),
			failure = new Error('synthetic durable write failed')
		h.socket.signalRepository.encryptMessage = async () => {
			throw failure
		}
		await assert.rejects(h.host.prepareKeys(peer, new Uint8Array([1])), error => error === failure)
		h.socket.signalRepository.decryptMessage = async () => {
			throw failure
		}
		await assert.rejects(h.host.decrypt(device, 'msg', new Uint8Array([2])), error => error === failure)
		h.socket.authState.keys.get = async () => {
			throw failure
		}
		await assert.rejects(h.host.readToken(peer), error => error === failure)
		assert.equal(
			h.calls.some(call => (call as unknown[])[0] === 'send'),
			false
		)
		h.dispose()
	})
	it('uses the existing repository for decryption without changing the padded envelope', async () => {
		const h = harness(),
			ciphertext = new Uint8Array([3, 4, 5]),
			plaintext = new Uint8Array([1, 2, 2])
		h.socket.signalRepository.decryptMessage = async options => {
			assert.deepEqual(options, { jid: device, type: 'pkmsg', ciphertext })
			assert.equal(options.ciphertext, ciphertext)
			return plaintext
		}
		assert.equal(await h.host.decrypt(device, 'pkmsg', ciphertext), plaintext)
		assert.deepEqual(h.calls, [])
		h.dispose()
	})
	it('reads tokens without replacing store methods or dropping metadata', async () => {
		const h = harness(),
			token = new Uint8Array([3]),
			record = { token, timestamp: '100', senderTimestamp: 90 }
		const read = (h.socket.authState.keys.get = async (type, ids) => {
			assert.equal(type, 'tctoken')
			assert.deepEqual(ids, [peer])
			return { [peer]: record }
		})
		assert.equal(await h.host.readToken(peer), record)
		await h.host.issueToken(peer)
		assert.equal(h.socket.authState.keys.get, read)
		assert.deepEqual(record, { token, timestamp: '100', senderTimestamp: 90 })
		assert.deepEqual(h.calls, [], 'the public raw issuance helper must not bypass upstream token lifecycle')
		h.dispose()
	})
	it('passes expired or missing timestamps to shared Rust policy without inventing freshness', async () => {
		const h = harness(),
			token = new Uint8Array([3]),
			expired = { token, timestamp: '1', senderTimestamp: 90 }
		h.socket.authState.keys.get = async () => ({ [peer]: expired })
		assert.equal(await h.host.readToken(peer), expired)
		const untimed = { token, senderTimestamp: 90 }
		h.socket.authState.keys.get = async () => ({ [peer]: untimed })
		assert.equal(await h.host.readToken(peer), untimed)
		h.socket.authState.keys.get = async () => ({})
		assert.equal(await h.host.readToken(peer), undefined)
		assert.deepEqual(h.calls, [])
		h.dispose()
	})
	it('registers correlation synchronously before sending and preserves raw ACK errors', async () => {
		const h = harness(),
			id = h.host.generateRequestId()
		const pending = h.host.watchAck(id)
		assert.equal(h.ws.listenerCount(`TAG:${id}`), 1)
		await h.host.sendNode({ tag: 'call', attrs: { id } })
		assert.deepEqual(await pending.promise, acknowledgement(id))
		assert.equal(h.ws.listenerCount(`TAG:${id}`), 0)
		assert.equal(h.ws.listenerCount('close'), 0)
		assert.equal(h.ws.listenerCount('error'), 0)
		pending.cancel()
		h.dispose()
	})
	it('ignores unrelated same-id nodes and leaves preexisting listeners intact', async () => {
		const h = harness(),
			original = () => {}
		h.ws.on('TAG:SAME', original)
		const pending = h.host.watchAck('SAME')
		assert.throws(() => h.host.watchAck('SAME'), /Duplicate/)
		h.ws.emit('TAG:SAME', { tag: 'iq', attrs: { id: 'SAME' } })
		assert.equal(h.ws.listenerCount('TAG:SAME'), 2)
		h.ws.emit('TAG:SAME', acknowledgement('SAME'))
		await pending.promise
		assert.deepEqual(h.ws.listeners('TAG:SAME'), [original])
		h.dispose()
	})
	it('cancellation owns only its registration even if the request id is reused', async () => {
		const h = harness(),
			first = h.host.watchAck('REUSED')
		first.cancel()
		await assert.rejects(first.promise, { name: 'AbortError' })
		const second = h.host.watchAck('REUSED')
		first.cancel()
		assert.equal(h.ws.listenerCount('TAG:REUSED'), 1)
		h.ws.emit('TAG:REUSED', acknowledgement('REUSED'))
		await second.promise
		h.dispose()
	})
	it('bounds outstanding correlations and releases all listeners on disposal', async () => {
		const h = harness(),
			pending = Array.from({ length: 256 }, (_, index) => h.host.watchAck(`BOUND-${index}`))
		assert.throws(() => h.host.watchAck('OVERFLOW'), /Too many/)
		h.dispose()
		h.dispose()
		const results = await Promise.allSettled(pending.map(item => item.promise))
		assert.ok(results.every(item => item.status === 'rejected' && item.reason.name === 'AbortError'))
		assert.deepEqual(h.ws.eventNames(), [])
		assert.throws(() => h.host.watchAck('CLOSED'), /closed/)
		await assert.rejects(h.host.sendNode({ tag: 'call', attrs: {} }), /closed/)
	})
	it('rejects and cleans up on close, error and deadline', async () => {
		const h = harness(5),
			close = h.host.watchAck('CLOSE')
		h.ws.emit('close')
		await assert.rejects(close.promise, /closed/)
		const error = h.host.watchAck('ERROR'),
			failure = new Error('synthetic socket error')
		h.ws.emit('error', failure)
		await assert.rejects(error.promise, cause => cause === failure)
		const timeout = h.host.watchAck('TIMEOUT')
		await assert.rejects(timeout.promise, /timed out/)
		assert.deepEqual(h.ws.eventNames(), [])
		h.dispose()
	})
	it('stops encryption after disposal wins a pending discovery', async () => {
		const h = harness(),
			devices = deferred<{ jid: string }[]>()
		h.socket.getUSyncDevices = () => devices.promise
		const preparing = h.host.prepareKeys(peer, new Uint8Array([1]))
		h.dispose()
		devices.resolve([{ jid: peer }])
		await assert.rejects(preparing, /closed/)
		assert.equal(
			h.calls.some(call => (call as unknown[])[0] === 'encrypt'),
			false
		)
	})
})
