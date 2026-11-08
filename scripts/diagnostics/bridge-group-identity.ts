import assert from 'node:assert/strict'
import { createTestClient, destroyTestClient, type TestClient } from '../../src/__tests__/e2e/test-client.ts'
import { waitForMessage } from '../../src/__tests__/e2e/wait.ts'

assert.equal(process.env.ADV_SECRET_KEY, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
assert.match(process.env.SOCKET_URL ?? '', /^wss:\/\/127\.0\.0\.1:8080\//)
const traces: unknown[] = []
const record = (event: unknown) => {
	traces.push(event)
	if (traces.length > 1000) traces.shift()
}

const summarize = (namespace: unknown, bytes: unknown) => {
	if (!(bytes instanceof Uint8Array)) return { present: false }
	if (namespace !== 'device') return { present: true, length: bytes.length }
	try {
		const data = JSON.parse(new TextDecoder().decode(bytes))
		return {
			present: true,
			inlineAccount: Array.isArray(data.account) ? data.account.length : data.account,
			paired: Boolean(data.pn),
			hasLid: Boolean(data.lid)
		}
	} catch {
		return { present: true, length: bytes.length }
	}
}

const onSocket: NonNullable<Parameters<typeof createTestClient>[0]['onSocket']> = socket => {
	const store = socket.authState.store!
	for (const method of ['get', 'getMany', 'set', 'setMany', 'delete', 'deleteMany', 'listKeys'] as const) {
		const original = store[method]
		if (!original) continue
		Object.defineProperty(store, method, {
			configurable: true,
			value: async (...args: unknown[]) => {
				const [namespace, key, value] = args
				const relevant =
					namespace === 'identity' || namespace === 'session' || namespace === 'device' || namespace === 'lid_mapping'
				if (relevant && ['set', 'delete', 'deleteMany'].includes(method))
					record({ method, namespace, key, ...(method === 'set' ? summarize(namespace, value) : {}) })
				const result = await Reflect.apply(original, store, args)
				if (relevant && method === 'get') record({ method, namespace, key, ...summarize(namespace, result) })
				if (relevant && method === 'getMany')
					record({
						method,
						namespace,
						requested: key,
						results: result.map(([id, bytes]: [string, Uint8Array]) => ({ id, ...summarize(namespace, bytes) }))
					})
				if (relevant && method === 'listKeys') record({ method, namespace, prefix: key, keys: result })
				return result
			}
		})
	}
}

for (const parallel of [false, true]) {
	const clients: TestClient[] = []
	try {
		const create = (label: string) => createTestClient({ label: `diag-${parallel}-${label}`, onSocket })
		if (parallel) clients.push(...(await Promise.all(['alice', 'bob', 'charlie'].map(create))))
		else for (const label of ['alice', 'bob', 'charlie']) clients.push(await create(label))
		const group = await clients[0]!.sock.groupCreate(
			'Synthetic bridge version comparison',
			clients.slice(1).map(c => c.jid)
		)
		for (const sender of clients) {
			const account = await sender.sock.waClient!.getAccount()
			record({
				beforeSend: sender.label,
				ownAccount: Boolean(account),
				ownAccountKeyLength: account?.accountSignatureKey?.length
			})
			const text = `group-probe-${sender.label}`
			const received = clients
				.filter(c => c !== sender)
				.map(c =>
					waitForMessage(
						c.sock,
						m => (m.message?.conversation ?? m.message?.extendedTextMessage?.text) === text && !m.key.fromMe
					)
				)
			await sender.sock.sendMessage(group.id, { text })
			await Promise.all(received)
		}
		console.log(`PASS: all three native members send and receive, parallel=${parallel}`)
	} catch (error) {
		console.log('Synthetic storage metadata trace', JSON.stringify(traces))
		throw error
	} finally {
		await Promise.all(clients.map(destroyTestClient))
	}
}
