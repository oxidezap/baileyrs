/** The file backend uses only the non-blocking, descriptor-owned lock API.
 * Internal declarations do not expose this addon through the public API. */
declare module 'fs-native-extensions' {
	export function tryLock(fd: number): boolean
}
