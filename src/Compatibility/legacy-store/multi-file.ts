import type { LegacyKeysStore } from './types.ts'
import type { StoreMigrationOptions } from '../../Utils/store-migration.ts'
import { legacySnapshotKeys } from './snapshot.ts'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { proto } from '@oxidezap/whatsapp-rust-bridge/proto-types'
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../../Types/index.ts'
import { BufferJSON } from '../../Utils/generics.ts'
import { JsonByteEncoding, LegacyMultiFile, LegacyStore } from './constants.ts'

const PATH_SEPARATOR = /[\\/]/g
const COLON = /:/g

function safeLegacyFileName(file: string): string {
	if (file.includes('\0')) throw new TypeError('legacy auth filename contains a null byte')
	return file
		.replace(PATH_SEPARATOR, LegacyMultiFile.PATH_SEPARATOR_REPLACEMENT)
		.replace(COLON, LegacyMultiFile.COLON_REPLACEMENT)
}

const keyFile = (type: string, id: string): string =>
	`${type}${LegacyMultiFile.TYPE_SEPARATOR}${id}${LegacyMultiFile.EXTENSION}`

const isMissingFile = (error: unknown): boolean =>
	error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'

export async function useLegacyMultiFileAuthState(
	folder: string,
	options: StoreMigrationOptions = {}
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
	const folderInfo = await stat(folder).catch(error => {
		if (isMissingFile(error)) return null
		throw error
	})
	if (folderInfo && !folderInfo.isDirectory()) {
		throw new TypeError(`legacy auth path is not a directory: ${folder}`)
	}
	if (!folderInfo) await mkdir(folder, { recursive: true })

	const readData = async (file: string): Promise<unknown | null> => {
		try {
			const data = await readFile(join(folder, safeLegacyFileName(file)), JsonByteEncoding.UTF8)
			return JSON.parse(data, BufferJSON.reviver) as unknown
		} catch (error) {
			if (isMissingFile(error)) return null
			throw error
		}
	}

	const writeData = async (data: unknown, file: string): Promise<void> => {
		await writeFile(join(folder, safeLegacyFileName(file)), JSON.stringify(data, BufferJSON.replacer))
	}

	const creds = (await readData(LegacyMultiFile.CREDS_FILE)) as AuthenticationCreds | null
	if (!creds) {
		throw new Error(`no ${LegacyMultiFile.CREDS_FILE} found in legacy auth directory: ${folder}`)
	}

	const rawSnapshot = await legacySnapshotKeys(folder, (type, id) => safeLegacyFileName(keyFile(type, id)), options)

	// The transaction view must use the same protobuf revival as ordinary
	// reads. Persisted protobuf toJSON bytes are base64 strings, not Buffers.
	const normalizeKeys = (backend: LegacyKeysStore): LegacyKeysStore => ({
		get: async (type, ids) => {
			const values = await backend.get(type, ids)
			if (type !== LegacyStore.SYNC_KEY) return values
			return Object.fromEntries(
				Object.entries(values).map(([id, value]) => [
					id,
					value ? proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>) : value
				])
			)
		},
		set: data => backend.set(data),
		...(backend.bridgeTransaction
			? {
					bridgeTransaction: <T>(work: (keys: LegacyKeysStore) => Promise<T>) =>
						backend.bridgeTransaction!(keys => work(normalizeKeys(keys)))
				}
			: {})
	})
	const snapshot = normalizeKeys(rawSnapshot)

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const entries = await Promise.all(
						ids.map(async id => {
							const value = (await snapshot.get(type, [id]))[id]
							return [id, value] as const
						})
					)
					return Object.fromEntries(entries) as { [id: string]: SignalDataTypeMap[typeof type] }
				},
				set: async data => await snapshot.set(data as Record<string, Record<string, unknown>>),
				bridgeTransaction: snapshot.bridgeTransaction
			}
		},
		saveCreds: () => writeData(creds, LegacyMultiFile.CREDS_FILE)
	}
}
