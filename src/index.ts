import makeWASocket from './Socket/index.ts'

// The runtime stays backed by the bridge codec; only its public declaration is
// pinned to upstream WAProto for source-level drop-in compatibility.
export { proto, proto as WAProto } from './WAProto/runtime.ts'
export * from './Utils/index.ts'
export * from './Types/index.ts'
export * from './Defaults/index.ts'
export * from './WABinary/index.ts'
export * from './WAUSync/index.ts'

export type WASocket = ReturnType<typeof makeWASocket>
export { makeWASocket }
// Named, not starred: the call-audio helpers consumers reach for by name,
// without pulling the socket internals the module also holds.
export {
	depacketizeOpusFromMlow,
	makeFileCallAudioSource,
	makeSilenceCallAudioSource,
	MLOW_SILENCE_PACKET,
	openFilePacketReader,
	packetizeOpusForMlow,
	startCallAudioPump
} from './Socket/calls.ts'
export default makeWASocket
