import { exportAuthSnapshot } from './snapshot-rollback.ts'

export const nativeAtomicNamespaces: ReadonlySet<string> = new Set(['sync_version', 'mutation_mac', 'tc_token', 'meta'])
export const isNativeAtomicRecordFile = (name: string): boolean =>
	name.endsWith('.bin') && nativeAtomicNamespaces.has(name.slice(0, name.indexOf('-')))

/** Stop every auth writer and back up the directory first. On success the
 * latest atomic rows are durable in the old per-key binary layout, removed
 * records are deleted and the snapshot is archived. Do not open an older
 * adapter after a rejection; finish this offline export successfully first.
 */
export async function prepareNativeAuthRollback(folder: string, options: { offline: true }): Promise<void> {
	if (options?.offline !== true)
		throw new TypeError('native rollback requires { offline: true } after stopping every auth writer')
	await exportAuthSnapshot(
		folder,
		'bridge-atomic-v1.json',
		nativeAtomicNamespaces,
		(namespace, id) => `${namespace}-${encodeURIComponent(id)}.bin`,
		isNativeAtomicRecordFile
	)
}
