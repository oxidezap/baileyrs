import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const rollbackProofName = (snapshotName: string): string => `.${snapshotName}.rollback-proof.json`
export const snapshotDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** A new snapshot generation must never reuse proof from an older rollback. */
export async function clearRollbackProof(
	folder: string,
	snapshotName: string,
	syncDir: (path: string) => Promise<void>
) {
	try {
		await unlink(join(folder, rollbackProofName(snapshotName)))
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
		throw error
	}
	await syncDir(folder)
}

/** Missing active state is not success unless this exact archived generation
 * has a durable completion record. Never infer success from an older archive.
 */
export async function verifyRollbackProof(folder: string, snapshotName: string): Promise<void> {
	try {
		const proof: unknown = JSON.parse(await readFile(join(folder, rollbackProofName(snapshotName)), 'utf8'))
		if (
			!proof ||
			typeof proof !== 'object' ||
			!('version' in proof) ||
			proof.version !== 1 ||
			!('archive' in proof) ||
			typeof proof.archive !== 'string' ||
			/[\\/\0]/.test(proof.archive) ||
			!proof.archive.startsWith(`${snapshotName}.rollback-`) ||
			!('sha256' in proof) ||
			typeof proof.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/.test(proof.sha256)
		)
			throw new Error('invalid rollback proof')
		if (snapshotDigest(await readFile(join(folder, proof.archive))) !== proof.sha256)
			throw new Error('rollback archive does not match its proof')
	} catch (error) {
		throw new Error(
			'cannot verify rollback: authoritative snapshot or valid completion proof is missing; a never-migrated directory needs no export, otherwise restore its backup',
			{ cause: error }
		)
	}
}
