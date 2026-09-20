/**
 * Portable AES-GCM + byte helpers for the runtime-neutral graph.
 *
 * `Platform/crypto.ts` is the OpenSSL fast path (`node:crypto`); this
 * module is the same contract on `Uint8Array` with no `node:` imports, so
 * `Media/core.ts` (and later the message send path) can encrypt retry
 * payloads on any host. Runtime selection stays where it belongs:
 * `Runtime/node.ts` hands the bridge the native provider, `hostRuntime`
 * passes `undefined` and the engine uses WASM soft AES — but JS-side retry
 * crypto here never branches on runtimes, it just runs.
 */

import { concatBytes } from './bytes.ts'

const GCM_TAG_BYTES = 16

// --- AES-128/192/256 software core (FIPS-197) ---
const SBOX = new Uint8Array([
	0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76, 0xca, 0x82,
	0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0, 0xb7, 0xfd, 0x93,
	0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15, 0x04, 0xc7, 0x23, 0xc3,
	0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75, 0x09, 0x83, 0x2c, 0x1a, 0x1b,
	0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84, 0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc,
	0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf, 0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33,
	0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8, 0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5,
	0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2, 0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4,
	0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73, 0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee,
	0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb, 0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac,
	0x62, 0x91, 0x95, 0xe4, 0x79, 0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea,
	0x65, 0x7a, 0xae, 0x08, 0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b,
	0xbd, 0x8b, 0x8a, 0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1,
	0x1d, 0x9e, 0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28,
	0xdf, 0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
])

const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36])

const xtime = (value: number): number => ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff

const expandKey = (key: Uint8Array): { rounds: number; schedule: Uint32Array } => {
	const nk = key.length / 4
	const rounds = nk + 6
	const schedule = new Uint32Array(4 * (rounds + 1))
	for (let i = 0; i < nk; i++) {
		schedule[i] = (key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!
	}
	for (let i = nk; i < schedule.length; i++) {
		let temp = schedule[i - 1]!
		if (i % nk === 0) {
			temp = (SBOX[(temp >>> 16) & 0xff]! << 24) | (SBOX[(temp >>> 8) & 0xff]! << 16) | (SBOX[temp & 0xff]! << 8) | SBOX[(temp >>> 24) & 0xff]!
			temp ^= RCON[(i / nk - 1) | 0]! << 24
		} else if (nk > 6 && i % nk === 4) {
			temp = (SBOX[(temp >>> 24) & 0xff]! << 24) | (SBOX[(temp >>> 16) & 0xff]! << 16) | (SBOX[(temp >>> 8) & 0xff]! << 8) | SBOX[temp & 0xff]!
		}
		schedule[i] = (schedule[i - nk]! ^ temp) >>> 0
	}
	return { rounds, schedule }
}

const addRoundKey = (state: Uint8Array, schedule: Uint32Array, round: number): void => {
	for (let c = 0; c < 4; c++) {
		const word = schedule[round * 4 + c]!
		state[4 * c]! ^= (word >>> 24) & 0xff
		state[4 * c + 1]! ^= (word >>> 16) & 0xff
		state[4 * c + 2]! ^= (word >>> 8) & 0xff
		state[4 * c + 3]! ^= word & 0xff
	}
}

const encryptBlock = (block: Uint8Array, schedule: Uint32Array, rounds: number): Uint8Array => {
	const s = new Uint8Array(16)
	// FIPS-197 §3.4: state[r][c] = in[r + 4c] — the wire order is already
	// column-major, so the load is the identity, not a transpose. (A
	// row-major load/save pair computes T·AES·T instead of AES: it still
	// passes FIPS vectors fed transposed on both sides, but fails GCM,
	// whose counter blocks are raw byte arrays.)
	for (let i = 0; i < 16; i++) s[i] = block[i]!
	addRoundKey(s, schedule, 0)
	for (let round = 1; round < rounds; round++) {
		for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]!]!
		// ShiftRows
		let t = s[1]!
		s[1] = s[5]!
		s[5] = s[9]!
		s[9] = s[13]!
		s[13] = t
		t = s[2]!
		s[2] = s[10]!
		s[10] = t
		t = s[6]!
		s[6] = s[14]!
		s[14] = t
		t = s[3]!
		s[3] = s[15]!
		s[15] = s[11]!
		s[11] = s[7]!
		s[7] = t
		for (let c = 0; c < 4; c++) {
			const a0 = s[4 * c]!
			const a1 = s[4 * c + 1]!
			const a2 = s[4 * c + 2]!
			const a3 = s[4 * c + 3]!
			s[4 * c] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3
			s[4 * c + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3
			s[4 * c + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3)
			s[4 * c + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3)
		}
		addRoundKey(s, schedule, round)
	}
	for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]!]!
	let t = s[1]!
	s[1] = s[5]!
	s[5] = s[9]!
	s[9] = s[13]!
	s[13] = t
	t = s[2]!
	s[2] = s[10]!
	s[10] = t
	t = s[6]!
	s[6] = s[14]!
	s[14] = t
	t = s[3]!
	s[3] = s[15]!
	s[15] = s[11]!
	s[11] = s[7]!
	s[7] = t
	addRoundKey(s, schedule, rounds)
	const out = new Uint8Array(16)
	for (let i = 0; i < 16; i++) out[i] = s[i]!
	return out
}

// --- GHASH (GCM auth) ---
const ghash = (h: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array => {
	const block = (bytes: Uint8Array, offset: number): Uint8Array => {
		const out = new Uint8Array(16)
		const n = Math.min(16, bytes.length - offset)
		for (let i = 0; i < n; i++) out[i] = bytes[offset + i]!
		return out
	}
	const xorInto = (target: Uint8Array, other: Uint8Array): void => {
		for (let i = 0; i < 16; i++) target[i]! ^= other[i]!
	}
	const mul = (x: Uint8Array, y: Uint8Array): Uint8Array => {
		const z = new Uint8Array(16)
		const v = new Uint8Array(y)
		for (let i = 0; i < 128; i++) {
			if (x[i >> 3]! & (0x80 >> (i & 7))) for (let j = 0; j < 16; j++) z[j]! ^= v[j]!
			const lsb = v[15]! & 1
			for (let j = 15; j > 0; j--) v[j] = ((v[j]! >>> 1) | ((v[j - 1]! & 1) << 7)) & 0xff
			v[0] = ((v[0]! >>> 1) ^ (lsb ? 0xe1 : 0)) & 0xff
		}
		return z
	}
	let y: Uint8Array = new Uint8Array(16)
	for (let off = 0; off < aad.length; off += 16) {
		xorInto(y, block(aad, off))
		y = mul(y, h)
	}
	for (let off = 0; off < ciphertext.length; off += 16) {
		xorInto(y, block(ciphertext, off))
		y = mul(y, h)
	}
	const lens = new Uint8Array(16)
	const view = new DataView(lens.buffer)
	view.setUint32(0, Math.floor((aad.length * 8) / 0x100000000))
	view.setUint32(4, (aad.length * 8) >>> 0)
	view.setUint32(8, Math.floor((ciphertext.length * 8) / 0x100000000))
	view.setUint32(12, (ciphertext.length * 8) >>> 0)
	xorInto(y, lens)
	return mul(y, h)
}

const incr32 = (counter: Uint8Array): void => {
	const view = new DataView(counter.buffer, counter.byteOffset, counter.byteLength)
	view.setUint32(12, (view.getUint32(12) + 1) >>> 0)
}

/** AES-256-GCM encrypt, returning `ciphertext || tag` (OpenSSL shape). */
export const aesGcm256EncryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	plaintext: Uint8Array
): Uint8Array => {
	if (key.length !== 32) throw new RangeError(`AES-256 key must be 32 bytes, got ${key.length}`)
	if (nonce.length !== 12) throw new RangeError(`GCM nonce must be 12 bytes, got ${nonce.length}`)
	const { rounds, schedule } = expandKey(key)
	const h = encryptBlock(new Uint8Array(16), schedule, rounds)
	const j0 = concatBytes([nonce, new Uint8Array([0, 0, 0, 1])])
	const ciphertext = new Uint8Array(plaintext.length)
	const counter = new Uint8Array(j0)
	for (let off = 0; off < plaintext.length; off += 16) {
		incr32(counter)
		const keystream = encryptBlock(counter, schedule, rounds)
		const n = Math.min(16, plaintext.length - off)
		for (let i = 0; i < n; i++) ciphertext[off + i] = (plaintext[off + i]! ^ keystream[i]!) & 0xff
	}
	const tag = ghash(h, aad, ciphertext)
	const s = encryptBlock(j0, schedule, rounds)
	for (let i = 0; i < GCM_TAG_BYTES; i++) tag[i]! ^= s[i]!
	return concatBytes([ciphertext, tag])
}

/** AES-256-GCM decrypt of `ciphertext || tag`; throws on auth failure. */
export const aesGcm256DecryptPortable = (
	key: Uint8Array,
	nonce: Uint8Array,
	aad: Uint8Array,
	ciphertextWithTag: Uint8Array
): Uint8Array => {
	if (key.length !== 32) throw new RangeError(`AES-256 key must be 32 bytes, got ${key.length}`)
	if (nonce.length !== 12) throw new RangeError(`GCM nonce must be 12 bytes, got ${nonce.length}`)
	if (ciphertextWithTag.length < GCM_TAG_BYTES) {
		throw new RangeError('AES-GCM ciphertext is shorter than its authentication tag')
	}
	const { rounds, schedule } = expandKey(key)
	const h = encryptBlock(new Uint8Array(16), schedule, rounds)
	const j0 = concatBytes([nonce, new Uint8Array([0, 0, 0, 1])])
	const split = ciphertextWithTag.length - GCM_TAG_BYTES
	const ciphertext = ciphertextWithTag.subarray(0, split)
	const tag = ciphertextWithTag.subarray(split)
	const expected = ghash(h, aad, ciphertext)
	const s = encryptBlock(j0, schedule, rounds)
	for (let i = 0; i < GCM_TAG_BYTES; i++) expected[i]! ^= s[i]!
	let diff = 0
	for (let i = 0; i < GCM_TAG_BYTES; i++) diff |= expected[i]! ^ tag[i]!
	if (diff !== 0) throw new Error('AES-GCM authentication failed')
	const plaintext = new Uint8Array(ciphertext.length)
	const counter = new Uint8Array(j0)
	for (let off = 0; off < ciphertext.length; off += 16) {
		incr32(counter)
		const keystream = encryptBlock(counter, schedule, rounds)
		const n = Math.min(16, ciphertext.length - off)
		for (let i = 0; i < n; i++) plaintext[off + i] = (ciphertext[off + i]! ^ keystream[i]!) & 0xff
	}
	return plaintext
}

void concatBytes
