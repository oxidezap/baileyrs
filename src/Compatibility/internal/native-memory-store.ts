import type { AuthenticationState } from '../../Types/index.ts'

type BridgeStore = NonNullable<AuthenticationState['store']>

// A WeakSet keeps the native-backend hint private to the compatibility
// boundary: it neither changes the public store object nor crosses into WASM.
const nativeMemoryStores = new WeakSet<BridgeStore>()

export const markNativeMemoryStore = (store: BridgeStore): void => {
	nativeMemoryStores.add(store)
}

export const isNativeMemoryStore = (store: BridgeStore): boolean => nativeMemoryStores.has(store)
