import type { AuthenticationState, SocketConfig, WAVersion } from '../Types/index'
import { Browsers } from '../Utils/browser-utils'
import logger from '../Utils/logger'

const version = [2, 3000, 1035194821]

export const CALL_VIDEO_PREFIX = 'https://call.whatsapp.com/video/'
export const CALL_AUDIO_PREFIX = 'https://call.whatsapp.com/voice/'

export const WA_DEFAULT_EPHEMERAL = 7 * 24 * 60 * 60

export const URL_REGEX = /https:\/\/(?![^:@/\s]+:[^:@/\s]+@)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?/g

export type MediaType =
	| 'image'
	| 'video'
	| 'audio'
	| 'document'
	| 'sticker'
	| 'thumbnail-link'
	| 'product-catalog-image'
	| 'md-app-state'
	| 'md-msg-hist'

export const MEDIA_KEYS: MediaType[] = [
	'image',
	'video',
	'document',
	'audio',
	'sticker',
	'thumbnail-link',
	'product-catalog-image',
	'md-app-state',
	'md-msg-hist'
]

export const DEFAULT_CONNECTION_CONFIG: SocketConfig = {
	version: version as WAVersion,
	browser: Browsers.macOS('Chrome'),
	waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
	connectTimeoutMs: 20_000,
	keepAliveIntervalMs: 30_000,
	logger: logger.child({ class: 'baileys' }),
	emitOwnEvents: true,
	defaultQueryTimeoutMs: 60_000,
	auth: undefined as unknown as AuthenticationState,
	shouldIgnoreJid: () => false,
	options: {}
}
