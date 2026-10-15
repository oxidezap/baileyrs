import { LegacyStore, MirrorStore, RawStore } from './constants.ts'

const prefixes = [...Object.values(LegacyStore), ...Object.values(MirrorStore), ...Object.values(RawStore)].map(
	type => `${type}-`
)

/** Only reserved auth-record filenames belong to the snapshot or its rollback. */
export const isLegacyAuthRecordFile = (name: string): boolean =>
	!/[\\/\0]/.test(name) && name.endsWith('.json') && prefixes.some(prefix => name.startsWith(prefix))
