// Shared host-safe surface. Keep every emitted declaration free of Node built-ins.
export * from './Runtime/bytes.ts'
export { createAuthenticationState, initHostAuthCreds } from './Compatibility/host-auth-state.ts'
export { generateMessageIDPortable, generateMessageIDV2Portable } from './Compatibility/message-ids.ts'
export * from './host-shared.ts'
