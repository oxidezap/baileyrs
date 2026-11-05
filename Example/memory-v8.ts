const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MiB'
const numFmt = (value: number) => new Intl.NumberFormat('en-US').format(value)

function numericField(value: unknown, key: string): number {
	if (typeof value !== 'object' || value === null) throw new Error('invalid V8 memory statistics')
	const field: unknown = Reflect.get(value, key)
	if (typeof field !== 'number' || !Number.isFinite(field) || field < 0)
		throw new Error(`invalid V8 memory field: ${key}`)
	return field
}

/** V8 data is optional. A native runtime's allocator estimates must not be
 * presented as V8 heap spaces, contexts, handles or malloc statistics. */
export function v8MemoryLines(version: string | undefined, loadBuiltin: (name: string) => unknown): string[] {
	if (!version) return ['── V8 diagnostics ──', '  Unavailable: this runtime does not expose V8.']
	const builtin = loadBuiltin('v8')
	if (
		typeof builtin !== 'object' ||
		builtin === null ||
		!('getHeapStatistics' in builtin) ||
		typeof builtin.getHeapStatistics !== 'function' ||
		!('getHeapSpaceStatistics' in builtin) ||
		typeof builtin.getHeapSpaceStatistics !== 'function'
	)
		throw new Error('V8 memory diagnostics unavailable: required methods are missing')
	const heap: unknown = builtin.getHeapStatistics()
	const spaces: unknown = builtin.getHeapSpaceStatistics()
	if (!Array.isArray(spaces)) throw new Error('invalid V8 heap spaces')
	const rawSpaces: unknown[] = spaces
	const extracted: { name: string; used: number }[] = []
	for (const space of rawSpaces) {
		if (typeof space !== 'object' || space === null) throw new Error('invalid V8 heap space')
		const name: unknown = Reflect.get(space, 'space_name')
		if (typeof name !== 'string') throw new Error('invalid V8 heap space name')
		extracted.push({ name, used: numericField(space, 'space_used_size') })
	}
	const usedSpaces = extracted.filter(space => space.used > 0).toSorted((a, b) => b.used - a.used)
	return [
		'── V8 Heap Spaces ──',
		...usedSpaces.map(space => `  ${space.name.replace('_space', '').padEnd(20)} ${mib(space.used).padStart(10)}`),
		'',
		'── V8 Stats ──',
		`  Native contexts:   ${numericField(heap, 'number_of_native_contexts')}`,
		`  Global handles:    ${numFmt(numericField(heap, 'used_global_handles_size'))} / ${numFmt(numericField(heap, 'total_global_handles_size'))}`,
		`  Malloced:          ${mib(numericField(heap, 'malloced_memory'))}`,
		`  Peak malloced:     ${mib(numericField(heap, 'peak_malloced_memory'))}`
	]
}

/** An unavailable V8 provider must not discard the report's portable sections. */
export function optionalV8MemoryLines(version: string | undefined, loadBuiltin: (name: string) => unknown): string[] {
	try {
		return v8MemoryLines(version, loadBuiltin)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		return ['── V8 diagnostics ──', `  Unavailable: ${reason}`]
	}
}
