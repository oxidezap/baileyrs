// Types private to the legacy-store compatibility adapter.
import type { JsStoreCallbacks } from '@oxidezap/whatsapp-rust-bridge'
import type { RouteKind } from './constants.ts'

export type LegacyStoreLogger = {
	warn(obj: unknown, msg?: string): void
}

export type Warn = (message: string, error?: unknown) => void

/** A canonical value whose state cannot be projected into the legacy model. */
export const NATIVE_ONLY_PROJECTION: unique symbol = Symbol('native-only-projection')

type Awaitable<T> = T | PromiseLike<T>

/** The deliberately widened shape behind Baileys' SignalKeyStore. */
export type LegacyKeysStore = {
	get(type: string, ids: string[]): Awaitable<Record<string, unknown>>
	set(data: Record<string, Record<string, unknown>>): Awaitable<void>
}

export interface WrappedLegacyStore extends JsStoreCallbacks {
	/** Kept for socket lifecycle compatibility. All key writes are already durable. */
	flush(): Promise<void>
	/** Kept for socket lifecycle compatibility. The adapter owns no background resources. */
	dispose(): void
}

/** Converts between one Rust-native byte record and its Baileys projection. */
export interface LegacyCodec {
	fromLegacy(key: string, value: unknown): Uint8Array | null
	toLegacy(key: string, value: Uint8Array): unknown | typeof NATIVE_ONLY_PROJECTION
}

export type ProjectedRoute = {
	kind: typeof RouteKind.PROJECTED
	legacyType: string
	nativeType: string
}

export type RawRoute = {
	kind: typeof RouteKind.RAW
	nativeType: string
}

export type DeviceRoute = {
	kind: typeof RouteKind.DEVICE
	nativeType: string
}

export type StoreRoute = ProjectedRoute | RawRoute | DeviceRoute
