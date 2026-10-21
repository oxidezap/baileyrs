import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256, generateKeyPair, calculateAgreement } from '@oxidezap/whatsapp-rust-bridge'
import { proto, useMultiFileAuthState } from '../lib/index.js'

/** Uses real bridge and file-store operations, without constructing a socket. */
export const runOfflineSmoke = async () => {
	const input = randomBytes(32)
	if (!Buffer.from(sha256(input)).equals(createHash('sha256').update(input).digest())) {
		throw new Error('bridge SHA-256 differs from node:crypto')
	}
	const alice = generateKeyPair()
	const bob = generateKeyPair()
	if (
		!Buffer.from(calculateAgreement(bob.pubKey, alice.privKey)).equals(
			Buffer.from(calculateAgreement(alice.pubKey, bob.privKey))
		)
	) {
		throw new Error('bridge key agreement differs')
	}
	const message = { conversation: 'scriptc offline fixture' }
	const decoded = proto.Message.decode(proto.Message.encode(message).finish())
	if (decoded.conversation !== message.conversation) throw new Error('protobuf round trip failed')
	const folder = await mkdtemp(join(tmpdir(), 'baileyrs-scriptc-'))
	try {
		const first = await useMultiFileAuthState(folder)
		if (!first.state.store) throw new Error('file store missing')
		// session uses ordinary files; meta also exercises snapshot transactions
		// and the real fs-native-extensions kernel lock.
		const namespaces = ['session', 'meta']
		for (const namespace of namespaces) await first.state.store.set(namespace, 'synthetic-offline-fixture', input)
		await first.state.store.flush?.()
		const second = await useMultiFileAuthState(folder)
		if (!second.state.store) throw new Error('reopened file store missing')
		for (const namespace of namespaces) {
			const saved = await second.state.store.get(namespace, 'synthetic-offline-fixture')
			if (!saved || !Buffer.from(saved).equals(input)) throw new Error(`${namespace} persistent round trip failed`)
			await second.state.store.delete(namespace, 'synthetic-offline-fixture')
		}
		await second.state.store.flush?.()
		const third = await useMultiFileAuthState(folder)
		if (!third.state.store) throw new Error('deleted file store missing')
		for (const namespace of namespaces) {
			if (await third.state.store.get(namespace, 'synthetic-offline-fixture')) {
				throw new Error(`${namespace} deletion did not persist`)
			}
		}
		await third.state.store.flush?.()
	} finally {
		await rm(folder, { recursive: true, force: true })
	}
	console.log(
		'BAILEYRS_OFFLINE_SMOKE_OK bridge crypto protobuf persistence (session and atomic meta); no socket created'
	)
}
