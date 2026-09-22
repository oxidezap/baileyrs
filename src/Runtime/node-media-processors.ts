import type * as musicMetadataTypes from 'music-metadata'

/** Node-only optional media processors. This module is never imported by /host. */
export const loadImageProcessingLibrary = async (): Promise<unknown> => {
	// @ts-ignore Optional peer dependencies are intentionally runtime-discovered.
	const [jimp, sharp] = await Promise.all([import('jimp').catch(() => {}), import('sharp').catch(() => {})])
	if (sharp) return { sharp }
	if (jimp) return { jimp }
	return {}
}

export const getAudioDuration = async (input: unknown): Promise<number | undefined> => {
	let musicMetadata: typeof musicMetadataTypes
	try {
		musicMetadata = await import('music-metadata')
	} catch {
		return undefined
	}
	const options = { duration: true }
	let metadata: musicMetadataTypes.IAudioMetadata
	if (input instanceof Uint8Array) metadata = await musicMetadata.parseBuffer(input, undefined, options)
	else if (typeof input === 'string') metadata = await musicMetadata.parseFile(input, options)
	else metadata = await musicMetadata.parseStream(input as never, undefined, options)
	return metadata.format.duration
}
