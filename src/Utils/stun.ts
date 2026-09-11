/**
 * Name a STUN packet crossing a relay channel, for logs.
 *
 * Returns undefined when the bytes are not a STUN packet (shorter than the
 * 20-byte header or missing the magic cookie). Otherwise names the relay
 * handshake: binding request/success, allocate request/success/error, or
 * the hex type for anything else the relay speaks.
 */
export const classifyStunPacket = (message: Uint8Array): string | undefined => {
	if (message.length < 20) return undefined
	if (message[4] !== 0x21 || message[5] !== 0x12 || message[6] !== 0xa4 || message[7] !== 0x42) return undefined
	const type = (message[0]! << 8) | message[1]!
	if (type === 0x0001) return 'binding request'
	if (type === 0x0101) return 'binding success'
	if (type === 0x0003) return 'allocate request'
	if (type === 0x0103) return 'allocate success'
	if (type === 0x0113) return 'allocate error'
	return `stun 0x${type.toString(16)}`
}
