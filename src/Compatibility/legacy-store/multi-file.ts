import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { proto } from 'whatsapp-rust-bridge/proto-types'
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
	folder: string
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

	const removeData = async (file: string): Promise<void> => {
		try {
			await unlink(join(folder, safeLegacyFileName(file)))
		} catch (error) {
			if (!isMissingFile(error)) throw error
		}
	}

	const creds = (await readData(LegacyMultiFile.CREDS_FILE)) as AuthenticationCreds | null
	if (!creds) {
		throw new Error(`no ${LegacyMultiFile.CREDS_FILE} found in legacy auth directory: ${folder}`)
	}

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const entries = await Promise.all(
						ids.map(async id => {
							let value = await readData(keyFile(type, id))
							if (type === LegacyStore.SYNC_KEY && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
							}
							return [id, value] as const
						})
					)
					return Object.fromEntries(entries) as { [id: string]: SignalDataTypeMap[typeof type] }
				},
				set: async data => {
					const writes: Promise<void>[] = []
					for (const [type, values] of Object.entries(data)) {
						for (const [id, value] of Object.entries(values ?? {})) {
							const file = keyFile(type, id)
							writes.push(value == null ? removeData(file) : writeData(value, file))
						}
					}
					await Promise.all(writes)
				}
			}
		},
		saveCreds: () => writeData(creds, LegacyMultiFile.CREDS_FILE)
	}
}
