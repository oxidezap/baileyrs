/**
 * WASM asset entry: `@oxidezap/baileyrs/wasm`.
 *
 * Re-exports the bridge's compiled WASM **by reference** — the ~6MB binary
 * ships once (inside `@oxidezap/whatsapp-rust-bridge`), never duplicated
 * into this package. `src/host.ts` documents the `initSync({ module })`
 * handshake; this module is the `module` side of it on hosts whose
 * bundler resolves `.wasm` imports to `SyncInitInput`.
 *
 * NOTE (Node): bare-Node ESM cannot `import` a `.wasm` file — the bridge's
 * own `./wasm` subpath has the same constraint (its `default` condition
 * points at the raw `.wasm`). On Node, read the bytes and pass them:
 *
 * ```ts
 * import { readFileSync } from 'node:fs'
 * import { fileURLToPath } from 'node:url'
 * import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'
 * const wasmUrl = await import.meta.resolve('@oxidezap/whatsapp-rust-bridge/wasm')
 * initSync({ module: readFileSync(fileURLToPath(wasmUrl)) })
 * ```
 *
 * The static `export ... from` below keeps the subpath working on bundlers
 * and hosts that *can* resolve `.wasm`; it intentionally does no runtime
 * work so importing it on Node fails only when actually evaluated.
 */
export { default } from '@oxidezap/whatsapp-rust-bridge/wasm'
