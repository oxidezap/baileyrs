import makeWASocket from './Socket/index.ts'

// Re-export the bridge's protobufjs-style namespace under both `proto` and
// `WAProto` so consumers migrating from upstream Baileys (which exposes
// `proto`) and from older baileyrs (which exposed `WAProto`) keep working.
export { proto, proto as WAProto } from 'whatsapp-rust-bridge/proto-types'
export * from './Utils/index.ts'
export * from './Types/index.ts'
export * from './Defaults/index.ts'
export * from './WABinary/index.ts'

export type WASocket = ReturnType<typeof makeWASocket>
export { makeWASocket }
export default makeWASocket
