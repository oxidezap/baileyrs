// Shared (runtime-neutral) surface: safe to import on any host.
//
// Everything re-exported here is free of `node:` imports and of the bare
// bridge root (host code reaches the bridge through `/host`). It covers the
// socket factory types, auth-state builders, portable byte/media helpers,
// the event pipeline and the domain types. No filesystem auth, no Node
// streams, no media processors, no `node:crypto`.
export type { BaileysRuntime, BridgeRuntime } from './Runtime/types.ts'
export { makeProtoRuntime, makeHistoryRuntime, makeSocketCryptoRuntime, makeSocketRuntime } from './Runtime/bridge.ts'
export * from './Runtime/bytes.ts'
export { createAuthenticationState, initHostAuthCreds } from './Compatibility/host-auth-state.ts'
export { generateMessageIDPortable, generateMessageIDV2Portable } from './Compatibility/message-ids.ts'
export * from './Media/core.ts'
export * from './Bridge/index.ts'
export * from './Types/index.ts'
