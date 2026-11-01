/** Optional calling integration for an existing Baileys socket. */
export { createBaileysVoip } from './Voip/baileys.ts'
export type {
	BaileysCallControl,
	BaileysVoip,
	BaileysVoipOptions,
	BaileysVoipRuntime,
	BaileysVoipSocket
} from './Voip/baileys.ts'
export type { BaileysCallHostOptions, BaileysDeviceIdentity } from './Voip/baileys-host.ts'
export type {
	CallSession,
	CallSessionAudio,
	CallSessionClose,
	CallSessionOptions,
	CallAudioInputOptions,
	CallAudioOutputOptions,
	VoipApi
} from './Types/CallSession.ts'
