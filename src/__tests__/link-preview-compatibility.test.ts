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

import { _getCompressedJpegThumbnail as getCompressedJpegThumbnail, getUrlInfo } from '../Utils/link-preview.ts'
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

	it('a host that cannot be resolved surfaces its error instead', async () => {
		await expect(getUrlInfo('https://not-a-real-host.invalid', OPTS)).rejects.toThrow()
	})

	/**
	 * Upstream's `uploadImage` is typed for an uploader that takes an
	 * already-encrypted file; an uploader here takes plaintext and returns the
	 * encrypted result. Accepting it would hand the caller's own function the
	 * wrong argument, which is worse than saying so.
	 */
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
		['an IPv6 unique-local address', 'http://[fd00::1]/x.jpg']
	] as const) {
		it(`refuses ${label}`, async () => {
			await expect(fetchThumbnail(address)).rejects.toThrow(/private address/)
		})
	}

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
