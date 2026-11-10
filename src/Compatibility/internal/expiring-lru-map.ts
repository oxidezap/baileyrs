type TimerHandle = ReturnType<typeof setTimeout>

type Entry<V> = {
	value: V
	expiresAt: number
	timer?: TimerHandle
}

export type ExpiringLruMapOptions<K, V> = {
	ttl: number
	max?: number
	updateAgeOnGet?: boolean
	dispose?: (value: V, key: K) => void
}

/**
 * Small LRU+TTL map used only by the standalone Baileys-compatible retry
 * manager. The connected client's retry cache remains entirely in Rust.
 */
export class ExpiringLruMap<K, V> {
	private readonly entries = new Map<K, Entry<V>>()
	private readonly options: ExpiringLruMapOptions<K, V>

	constructor(options: ExpiringLruMapOptions<K, V>) {
		this.options = options
	}

	set(key: K, value: V): void {
		this.delete(key)
		const entry: Entry<V> = {
			value,
			expiresAt: Date.now() + this.options.ttl
		}
		entry.timer = setTimeout(() => {
			if (this.entries.get(key) === entry) this.delete(key)
		}, this.options.ttl)
		entry.timer.unref?.()
		this.entries.set(key, entry)

		const max = this.options.max
		if (max !== undefined && this.entries.size > max) {
			const oldest = this.entries.keys().next()
			if (!oldest.done) this.delete(oldest.value)
		}
	}

	get(key: K): V | undefined {
		const entry = this.entries.get(key)
		if (!entry) return undefined
		if (entry.expiresAt <= Date.now()) {
			this.delete(key)
			return undefined
		}

		this.entries.delete(key)
		this.entries.set(key, entry)
		if (this.options.updateAgeOnGet) this.refreshTimer(key, entry)
		return entry.value
	}

	delete(key: K): boolean {
		const entry = this.entries.get(key)
		if (!entry) return false
		this.entries.delete(key)
		if (entry.timer) clearTimeout(entry.timer)
		this.options.dispose?.(entry.value, key)
		return true
	}

	clear(): void {
		for (const key of this.entries.keys()) this.delete(key)
	}

	private refreshTimer(key: K, entry: Entry<V>): void {
		if (entry.timer) clearTimeout(entry.timer)
		entry.expiresAt = Date.now() + this.options.ttl
		entry.timer = setTimeout(() => {
			if (this.entries.get(key) === entry) this.delete(key)
		}, this.options.ttl)
		entry.timer.unref?.()
	}
}
