import { AsyncMutex } from './async-primitives.ts'

export const makeMutex = () => {
	const mutex = new AsyncMutex()
	return {
		mutex<T>(code: () => Promise<T> | T): Promise<T> {
			return mutex.runExclusive(code)
		}
	}
}

export const makeKeyedMutex = () => {
	const entries = new Map<string, { mutex: AsyncMutex; references: number }>()
	return {
		async mutex<T>(key: string, task: () => Promise<T> | T): Promise<T> {
			let entry = entries.get(key)
			if (!entry) {
				entry = { mutex: new AsyncMutex(), references: 0 }
				entries.set(key, entry)
			}
			entry.references++
			try {
				return await entry.mutex.runExclusive(task)
			} finally {
				entry.references--
				if (entry.references === 0 && entries.get(key) === entry) entries.delete(key)
			}
		}
	}
}
