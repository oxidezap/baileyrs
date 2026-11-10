/**
 * Create a fixed-length sparse array without initializing every slot.
 *
 * History-sync decoders fill a contiguous prefix and truncate malformed or
 * absent entries before exposing the result. Keeping this operation explicit
 * avoids repeated array growth without paying `Array.from`'s O(length) fill.
 */
export function createSparseArray<T>(length: number): T[] {
	// oxlint-disable-next-line unicorn/no-new-array -- sparse allocation is intentional; callers fill and truncate the prefix
	return new Array<T>(length)
}
