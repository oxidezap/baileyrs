/**
 * The call-audio helpers the README points consumers at are importable from
 * the package root, not just by deep import.
 */

import { describe, it } from 'node:test'

import {
	depacketizeOpusFromMlow,
	makeFileCallAudioSource,
	makeSilenceCallAudioSource,
	MLOW_SILENCE_PACKET,
	openFilePacketReader,
	packetizeOpusForMlow,
	startCallAudioPump
} from '../index.ts'
import { expect } from './expect.ts'

describe('call audio root exports', () => {
	it('exposes the sources, the silence packet and the pump', () => {
		expect(typeof makeSilenceCallAudioSource).toBe('function')
		expect(typeof makeFileCallAudioSource).toBe('function')
		expect(typeof openFilePacketReader).toBe('function')
		expect(typeof startCallAudioPump).toBe('function')
		expect(MLOW_SILENCE_PACKET).toEqual(new Uint8Array([0x90]))
	})

	it('exposes the opus escape helpers', () => {
		expect(typeof packetizeOpusForMlow).toBe('function')
		expect(typeof depacketizeOpusFromMlow).toBe('function')
	})
})
