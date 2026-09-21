/** Small path capabilities used only by optional Node media processing. */
export const runtimeTempDir = (): string => '/tmp'

export const runtimeJoinPath = (...parts: string[]): string =>
	parts
		.join('/')
		.replace(/\/+/gu, '/')
		.replace(/(^|[^/])\/\.\//gu, '$1/')
