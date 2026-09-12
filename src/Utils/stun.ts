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

export interface StunAllocateShape {
	/** Length of the 0x4000 relay-token attribute, if present. */
	tokenLength?: number
	/** Whether a MESSAGE-INTEGRITY attribute (0x0008) is present. */
	hasMessageIntegrity: boolean
	/** Whether a FINGERPRINT attribute (0x8028) is present. */
	hasFingerprint: boolean
	/** IPv4 the 0x0016 endpoint attribute names, if decodable. Not secret. */
	endpointIp?: string
	/** Port the 0x0016 endpoint attribute names, if decodable. Not secret. */
	endpointPort?: number
}

/**
 * Describe the shape of a STUN allocate request without touching secrets:
 * attribute presence and the token length only, never values. An allocate
 * with no token or no integrity attribute is one the relay drops silently,
 * which reads on the wire exactly like a network failure.
 */
export const describeStunAllocate = (message: Uint8Array): StunAllocateShape | undefined => {
	if (message.length < 20) return undefined
	if (message[4] !== 0x21 || message[5] !== 0x12 || message[6] !== 0xa4 || message[7] !== 0x42) return undefined
	const type = (message[0]! << 8) | message[1]!
	if (type !== 0x0003) return undefined
	const shape: StunAllocateShape = { hasMessageIntegrity: false, hasFingerprint: false }
	let offset = 20
	while (offset + 4 <= message.length) {
		const attrType = (message[offset]! << 8) | message[offset + 1]!
		const attrLength = (message[offset + 2]! << 8) | message[offset + 3]!
		if (attrType === 0x4000) shape.tokenLength = attrLength
		if (attrType === 0x0008) shape.hasMessageIntegrity = true
		if (attrType === 0x8028) shape.hasFingerprint = true
		// The 0x0016 value is `00 01` plus the 6-byte XOR endpoint: port
		// xored with 0x2112, address xored with the magic cookie.
		if (attrType === 0x0016 && attrLength === 8 && offset + 12 <= message.length) {
			const port = ((message[offset + 6]! << 8) | message[offset + 7]!) ^ 0x2112
			const ip = [8, 9, 10, 11]
				.map((index, i) => (message[offset + index]! ^ [0x21, 0x12, 0xa4, 0x42][i]!) >>> 0)
				.join('.')
			shape.endpointPort = port
			shape.endpointIp = ip
		}
		offset += 4 + attrLength + ((4 - (attrLength % 4)) % 4)
	}
	return shape
}
