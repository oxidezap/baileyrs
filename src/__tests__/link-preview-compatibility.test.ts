/**
 * Almost every root export upstream has and this package does not is protocol
 * machinery that lives in Rust here, so refusing them is the whole answer.
 * `getUrlInfo` is the exception worth having: an HTTP fetch, an OpenGraph parse
 * and a thumbnail, none of it protocol, and its dependency was already declared
 * with nothing reading it.
 *
 * What is tested is the part this file decides: which failures mean "nothing to
 * preview" and which belong to the caller, plus the one option it refuses. The
 * shaping of a fetched page is not covered here, and deliberately so: the
 * parser rejects loopback and private hosts by design, so a local server cannot
 * drive it, and a stub raising the errors a test expects proves only that the
 * test raised them.
 */

import { describe, it } from 'node:test'

import {
	_firstLink as firstLink,
	_getCompressedJpegThumbnail as getCompressedJpegThumbnail,
	getUrlInfo
} from '../Utils/link-preview.ts'
import { expect } from './expect.ts'

const OPTS = { thumbnailWidth: 192, fetchOpts: { timeout: 3000 } }

describe('getUrlInfo separates having no preview from failing to get one', () => {
	/**
	 * The one failure that means "nothing here to preview". Swallowing anything
	 * else would make a timeout indistinguishable from a page with no metadata,
	 * and a caller retrying the first would give up on the second.
	 */
	it('text with no URL in it resolves empty rather than throwing', async () => {
		const info = await getUrlInfo('there is no link in this sentence', OPTS)

		expect(info).toBe(undefined)
	})

	/**
	 * Ordinary prose contains dots. Treating any of them as a host would send
	 * the text to the parser, which rejects it, and since a parser failure now
	 * surfaces rather than being swallowed, benign input would come back as an
	 * error instead of as no preview.
	 */
	for (const [label, text] of [
		['a version number', 'upgraded to version 1.22 today'],
		['a sentence ending in a full stop', 'that is all i had to say.'],
		['an ellipsis', 'well... maybe not'],
		['a decimal', 'it cost 3.50 in total']
	] as const) {
		it(`${label} is not mistaken for a link`, async () => {
			expect(await getUrlInfo(text, OPTS)).toBe(undefined)
		})
	}

	// The parser is handed the link, not the sentence it sits in.
	it('a link inside a sentence is what gets fetched', async () => {
		// Bounded so this does not wait on the network: reaching the fetch at
		// all is what distinguishes it from the no-link branch above.
		await expect(
			getUrlInfo('visit https://example.com today', { thumbnailWidth: 192, fetchOpts: { timeout: 1 } })
		).rejects.toThrow()
	})

	it('a link that is present but unusable is not treated as absent', async () => {
		// Reaching the parser at all is the point: this is the branch where a
		// failure has to surface rather than be read as "no preview".
		await expect(getUrlInfo('https://example.com', { ...OPTS, fetchOpts: { timeout: 1 } })).rejects.toThrow()
	})

	/**
	 * Upstream's `uploadImage` is typed for an uploader that takes an
	 * already-encrypted file; an uploader here takes plaintext and returns the
	 * encrypted result. Accepting it would hand the caller's own function the
	 * wrong argument, which is worse than saying so.
	 */
	// A proxy cannot be honoured on either fetch here, and half-applying it is
	// worse than refusing: the page lookup would resolve locally and the
	// thumbnail would connect direct, both of which the operator configured
	// against.
	it('a configured proxy is refused rather than half-applied', async () => {
		await expect(
			getUrlInfo('https://example.com', { ...OPTS, fetchOpts: { ...OPTS.fetchOpts, proxyUrl: 'http://proxy:8080' } })
		).rejects.toThrow(/proxyUrl is not supported/)
	})

	it('uploadImage is refused, naming the contract it cannot honour', async () => {
		await expect(getUrlInfo('https://example.com', { ...OPTS, uploadImage: async () => undefined })).rejects.toThrow(
			/uploadImage is not supported/
		)
	})

	it('the refusal happens before anything is fetched', async () => {
		await expect(
			getUrlInfo('there is no link in this sentence', { ...OPTS, uploadImage: async () => undefined })
		).rejects.toThrow(/uploadImage is not supported/)
	})
})

/**
 * A preview page is attacker-controlled and the image URL it advertises is
 * whatever it wants, so an unchecked thumbnail fetch is a request the bot makes
 * on that page's behalf, to an address the operator never chose. These drive
 * the guard directly, because the shaping path that reaches it cannot be
 * exercised offline.
 */
describe('the thumbnail fetch refuses destinations a preview must not reach', () => {
	const fetchThumbnail = (image: string, page = 'https://example.com/article') =>
		getCompressedJpegThumbnail(image, page, OPTS)

	for (const [label, address] of [
		['loopback', 'http://127.0.0.1/x.jpg'],
		['the private 10 block', 'http://10.0.0.5/x.jpg'],
		['the private 192.168 block', 'http://192.168.1.1/x.jpg'],
		['a private 172 block address', 'http://172.16.0.1/x.jpg'],
		['carrier-grade NAT space', 'http://100.64.0.1/x.jpg'],
		['link-local, where the cloud metadata address lives', 'http://169.254.169.254/latest/meta-data/'],
		['IPv6 loopback', 'http://[::1]/x.jpg'],
		['an IPv6 unique-local address', 'http://[fd00::1]/x.jpg'],
		['v4-mapped loopback written in dotted form', 'http://[::ffff:127.0.0.1]/x.jpg'],
		// The same address as the line above, written the other way. Judging
		// only the dotted form would leave this one a way through.
		['v4-mapped loopback written in hex', 'http://[::ffff:7f00:1]/x.jpg'],
		['v4-mapped link-local in hex', 'http://[::ffff:a9fe:a9fe]/x.jpg']
	] as const) {
		it(`refuses ${label}`, async () => {
			await expect(fetchThumbnail(address)).rejects.toThrow(/private address/)
		})
	}

	/**
	 * A literal private address is refused before any request is made. The
	 * parser's own URL pattern excludes those ranges, so this passes without the
	 * resolver hook; what the hook adds is the case that pattern cannot see, a
	 * public name that resolves to a private address, and that one needs a
	 * controlled DNS name and is not covered here.
	 */
	it('the page fetch refuses a private address too, not only the thumbnail', async () => {
		await expect(getUrlInfo('http://169.254.169.254/latest/meta-data/', OPTS)).rejects.toThrow()
	})

	it('refuses a scheme that is not http', async () => {
		await expect(fetchThumbnail('file:///etc/passwd')).rejects.toThrow(/refusing to fetch file:/)
	})

	it('skips the thumbnail rather than connecting direct when a proxy was configured', async () => {
		await expect(
			getCompressedJpegThumbnail('https://cdn.example.com/x.jpg', 'https://example.com', {
				...OPTS,
				fetchOpts: { ...OPTS.fetchOpts, proxyUrl: 'http://proxy.internal:8080' }
			})
		).rejects.toThrow(/proxyUrl is not applied/)
	})
})

/**
 * What gets fetched, decided without a network. The extraction is what
 * separates "no link here", which is an answer, from "a link that failed",
 * which is an error, so it is worth pinning on its own.
 */
describe('the link is taken out of the text it was written in', () => {
	for (const [label, text, expected] of [
		['a bare link', 'https://example.com/a', 'https://example.com/a'],
		['a link inside a sentence', 'visit https://example.com/a today', 'https://example.com/a'],
		['a scheme-less host', 'example.com/a', 'https://example.com/a'],
		// A link at the end of a sentence carries the full stop with it, and
		// fetching `example.com.` is not what the writer meant.
		['a link ending a sentence', 'go to https://example.com.', 'https://example.com'],
		['a link before a comma', 'https://example.com, then leave', 'https://example.com'],
		['a link in parentheses', 'see (https://example.com) for more', 'https://example.com'],
		['a link before an exclamation', 'look at https://example.com!', 'https://example.com'],
		['the first of several', 'https://one.example then https://two.example', 'https://one.example']
	] as const) {
		it(`${label} becomes ${expected}`, () => {
			expect(firstLink(text)).toBe(expected)
		})
	}

	for (const [label, text] of [
		['a version number', 'upgraded to version 1.22 today'],
		['a sentence with no link', 'there is no link in this sentence'],
		['a decimal', 'it cost 3.50 in total']
	] as const) {
		it(`${label} yields nothing to fetch`, () => {
			expect(firstLink(text)).toBe(undefined)
		})
	}
})
