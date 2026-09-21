/** Node-only optional media processors. This module is never imported by /host. */
export const loadImageProcessingLibrary = async (): Promise<unknown> => {
	// @ts-ignore Optional peer dependencies are intentionally runtime-discovered.
	const [jimp, sharp] = await Promise.all([import('jimp').catch(() => {}), import('sharp').catch(() => {})])
	if (sharp) return { sharp }
	if (jimp) return { jimp }
	return {}
}
