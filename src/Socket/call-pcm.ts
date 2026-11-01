import type { CallPcmFormat } from '../Types/CallSession.ts'

export const CALL_PCM_FRAME_SAMPLES = 960
export const MAX_CALL_PCM_CHUNK_SAMPLES = 65536

export const validateCallPcmFormat = (format: CallPcmFormat | undefined): void => {
	if (format === undefined) return
	if (!format || format.sampleRate !== 16000 || format.channels !== 1)
		throw new TypeError('Call PCM must be Int16, 16000 Hz, mono; resampling is not implicit')
}

/** Frames are borrowed until the next read; the synchronous bridge writer copies them. */
export const createCallPcmFramer = () => {
	let chunk: Int16Array | undefined
	let offset = 0
	let scratch: Int16Array | undefined
	let pending = 0
	let ended = false
	return {
		write(input: Int16Array) {
			if (ended || chunk) throw new Error('PCM framer input is not drained')
			if (!(input instanceof Int16Array)) throw new TypeError('Call PCM chunks must be Int16Array')
			if (input.length > MAX_CALL_PCM_CHUNK_SAMPLES)
				throw new RangeError(`Call PCM chunks must contain at most ${MAX_CALL_PCM_CHUNK_SAMPLES} samples`)
			if (!input.length) return
			// Do not retain an arbitrarily large backing store through a small view.
			chunk = input.buffer.byteLength > MAX_CALL_PCM_CHUNK_SAMPLES * 2 ? new Int16Array(input) : input
			offset = 0
		},
		read(): Int16Array | undefined {
			if (chunk) {
				const remaining = chunk.length - offset
				if (!pending && remaining >= CALL_PCM_FRAME_SAMPLES) {
					const frame =
						offset === 0 && remaining === CALL_PCM_FRAME_SAMPLES
							? chunk
							: chunk.subarray(offset, offset + CALL_PCM_FRAME_SAMPLES)
					offset += CALL_PCM_FRAME_SAMPLES
					if (offset === chunk.length) chunk = undefined
					return frame
				}
				scratch ??= new Int16Array(CALL_PCM_FRAME_SAMPLES)
				const count = Math.min(CALL_PCM_FRAME_SAMPLES - pending, remaining)
				scratch.set(chunk.subarray(offset, offset + count), pending)
				pending += count
				offset += count
				if (offset === chunk.length) chunk = undefined
				if (pending === CALL_PCM_FRAME_SAMPLES) {
					pending = 0
					return scratch
				}
			}
			if (ended && pending) {
				scratch!.fill(0, pending)
				pending = 0
				return scratch
			}
			return undefined
		},
		end() {
			ended = true
		},
		get done() {
			return ended && !chunk && !pending
		},
		get bufferedSamples() {
			return pending
		}
	}
}
