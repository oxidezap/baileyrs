// Node-only surface: filesystem auth, legacy stores, Node streams/media,
// link previews and the default socket entrypoint.
//
// Importing this module (directly or through the package root) pulls
// `node:fs`, `node:crypto` and friends — it never loads in a host bundle.
// Hosts import `../host-surface.ts` (or `@oxidezap/baileyrs/host`) instead.
export { useMultiFileAuthState } from './Utils/use-multi-file-auth-state.ts'
export { useBridgeStore } from './Utils/use-bridge-store.ts'
export { useLegacyMultiFileAuthState } from './Utils/wrap-legacy-store.ts'
export * from './Utils/messages-media.ts'
export { getUrlInfo } from './Utils/link-preview.ts'
export { makeNativeCryptoProvider } from './Utils/native-crypto-provider.ts'
export { nodeRuntime } from './Runtime/node.ts'
export { default, makeNodeWASocket, createWASocketFactory, createWASocketFactoryFor } from './Socket/index.ts'
