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
		await first.state.store.set('session', 'synthetic-offline-fixture', input)
		await first.state.store.flush?.()
		const second = await useMultiFileAuthState(folder)
		const saved = await second.state.store?.get('session', 'synthetic-offline-fixture')
		if (!saved || !Buffer.from(saved).equals(input)) throw new Error('persistent store round trip failed')
		await second.state.store?.delete('session', 'synthetic-offline-fixture')
		await second.state.store?.flush?.()
	} finally {
		await rm(folder, { recursive: true, force: true })
	}
	console.log('BAILEYRS_OFFLINE_SMOKE_OK bridge crypto protobuf persistence; no socket created')
}
