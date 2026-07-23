import type { MediaType as BridgeMediaType } from 'whatsapp-rust-bridge'
import type { MediaType } from '../Defaults/index.ts'

const DIRECT_BRIDGE_MEDIA_TYPES = new Set<MediaType>([
	'image',
	'video',
	'audio',
	'document',
	'sticker',
	'thumbnail-link',
	'md-msg-hist',
	'md-app-state',
	'product-catalog-image'
])

const BRIDGE_MEDIA_ALIASES: Partial<Record<MediaType, BridgeMediaType>> = {
	gif: 'video',
	ptt: 'audio',
	ptv: 'video'
}

/**
 * Narrow upstream's semantic media names to the protocol-neutral modes the
 * bridge can execute today. Aliases are accepted only when both HKDF material
 * and upload path are identical; unsupported modes fail explicitly instead of
 * silently encrypting/uploading with the wrong key family.
 */
export const toBridgeMediaType = (mediaType: MediaType): BridgeMediaType => {
	if (DIRECT_BRIDGE_MEDIA_TYPES.has(mediaType)) return mediaType as BridgeMediaType
	const alias = BRIDGE_MEDIA_ALIASES[mediaType]
	if (alias) return alias
	throw new RangeError(`Media type "${mediaType}" is not supported by the current bridge codec`)
}
