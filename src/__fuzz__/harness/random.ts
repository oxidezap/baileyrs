/**
 * Deterministic PRNG for the fuzz suite.
 *
 * Nothing in `src/__fuzz__` may reach for `Math.random`: a divergence nobody can
 * replay is a divergence nobody can fix. Every run reports the seed it used and
 * `FUZZ_SEED=<seed>` reproduces the identical input stream, so a nightly failure
 * turns into a local one-liner.
 */

/** Hashes an arbitrary seed string into the four words sfc32 needs. */
const seedWords = (seed: string): [number, number, number, number] => {
	let h = 2_166_136_261 >>> 0
	const words: number[] = []
	for (let round = 0; round < 4; round++) {
		for (let index = 0; index < seed.length; index++) {
			h ^= seed.charCodeAt(index)
			h = Math.imul(h, 16_777_619)
			h ^= h >>> 13
		}
		h = Math.imul(h ^ round, 2_654_435_761)
		words.push((h >>> 0) || 0x9e37_79b9)
	}
	return [words[0]!, words[1]!, words[2]!, words[3]!]
}

export interface Random {
	/** Uniform float in [0, 1). */
	next(): number
	/** Uniform integer in [min, max], inclusive on both ends. */
	int(min: number, max: number): number
	/** Uniform integer in [0, bound). Returns 0 when `bound <= 0`. */
	below(bound: number): number
	/** True with probability `probability` (default 0.5). */
	bool(probability?: number): boolean
	/** Uniform element of a non-empty list. */
	pick<T>(items: readonly T[]): T
	/** Picks by relative weight; entries with weight <= 0 are never chosen. */
	weighted<T>(entries: readonly (readonly [weight: number, value: T])[]): T
	/** A copy of `items` in random order. */
	shuffle<T>(items: readonly T[]): T[]
	/** `count` random bytes. */
	bytes(count: number): Uint8Array
	/**
	 * An independent stream derived from this one. Used to give each generated
	 * sub-value its own deterministic stream without ordering coupling.
	 */
	fork(label: string): Random
	/** The seed this stream was built from, for failure reports. */
	readonly seed: string
}

/** sfc32 — small, fast, no dependencies, and good enough for input generation. */
export const makeRandom = (seed: string): Random => {
	let [a, b, c, d] = seedWords(seed)

	const next = (): number => {
		a >>>= 0
		b >>>= 0
		c >>>= 0
		d >>>= 0
		let t = (a + b) | 0
		a = b ^ (b >>> 9)
		b = (c + (c << 3)) | 0
		c = (c << 21) | (c >>> 11)
		d = (d + 1) | 0
		t = (t + d) | 0
		c = (c + t) | 0
		return (t >>> 0) / 4_294_967_296
	}

	// Discard the first outputs: sfc32 needs a short warm-up before the low bits
	// of a weak seed stop showing through.
	for (let index = 0; index < 12; index++) next()

	const random: Random = {
		seed,
		next,
		below: bound => (bound <= 0 ? 0 : Math.floor(next() * bound)),
		int: (min, max) => (max <= min ? min : min + Math.floor(next() * (max - min + 1))),
		bool: (probability = 0.5) => next() < probability,
		pick: items => {
			if (items.length === 0) throw new Error('Random.pick: empty list')
			return items[Math.floor(next() * items.length)]!
		},
		weighted: entries => {
			const total = entries.reduce((sum, [weight]) => sum + Math.max(0, weight), 0)
			if (total <= 0) throw new Error('Random.weighted: no entry carries positive weight')
			let threshold = next() * total
			for (const [weight, value] of entries) {
				threshold -= Math.max(0, weight)
				if (threshold < 0) return value
			}
			return entries[entries.length - 1]![1]
		},
		shuffle: items => {
			const copy = [...items]
			for (let index = copy.length - 1; index > 0; index--) {
				const target = Math.floor(next() * (index + 1))
				const swap = copy[index]!
				copy[index] = copy[target]!
				copy[target] = swap
			}
			return copy
		},
		bytes: count => {
			const out = new Uint8Array(Math.max(0, count))
			for (let index = 0; index < out.length; index++) out[index] = Math.floor(next() * 256)
			return out
		},
		fork: label => makeRandom(`${seed}:${label}:${Math.floor(next() * 4_294_967_296)}`)
	}

	return random
}
