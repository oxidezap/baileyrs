import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import type { WAUrlInfo } from '../Types/Message.ts'
import { Boom } from './boom.ts'
import type { ILogger } from './logger.ts'
import { extractImageThumb } from './messages-media.ts'

const THUMBNAIL_WIDTH_PX = 192
/**
 * Whether the text names something fetchable at all: an explicit scheme, or a
 * host with a dot in it. Deliberately loose, since the parser judges the URL
 * properly; this only separates "no link here" from "a link that failed".
 */
const FIRST_URL = /(^|\s)(https?:\/\/\S+|[^\s.]+\.[^\s.]{2,}\S*)/i
/** Enough for any preview thumbnail, and small enough that a hostile one cannot exhaust memory. */
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024

export type URLGenerationOptions = {
	thumbnailWidth: number
	fetchOpts: {
		/** Timeout in ms */
		timeout: number
		proxyUrl?: string
		headers?: HeadersInit
	}
	uploadImage?: (encFilePath: string, opts: { fileEncSha256B64: string; mediaType: string }) => Promise<unknown>
	logger?: ILogger
}

/**
 * The shape read off `link-preview-js`, declared here rather than imported:
 * the package is an optional peer, so a consumer who does not want link
 * previews does not install it and this file must still typecheck.
 */
type LinkPreviewResult = {
	url: string
	title?: string
	description?: string
	images?: string[]
}

/**
 * Addresses no outbound request from a link preview may reach: loopback, the
 * private ranges, link-local, and the cloud metadata address that sits inside
 * link-local and is the usual target.
 */
/**
 * The v4 address an IPv4-mapped IPv6 literal stands for, in either form it can
 * be written: `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same address, and
 * judging only the dotted one leaves the other a way through.
 */
const mappedIPv4 = (address: string): string | undefined => {
	const mapped = /^::ffff:(?:0:)?(.+)$/i.exec(address)
	if (!mapped) return undefined
	const tail = mapped[1]!
	if (isIP(tail) === 4) return tail
	const hextets = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail)
	if (!hextets) return undefined
	const high = Number.parseInt(hextets[1]!, 16)
	const low = Number.parseInt(hextets[2]!, 16)
	return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

const isPrivateAddress = (address: string): boolean => {
	if (isIP(address) === 6) {
		const normalised = address.toLowerCase()
		const mapped = mappedIPv4(normalised)
		if (mapped) return isPrivateAddress(mapped)
		if (normalised === '::1' || normalised === '::') return true
		if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true
		if (normalised.startsWith('fe8') || normalised.startsWith('fe9') || normalised.startsWith('fea')) return true
		if (normalised.startsWith('feb')) return true
		return false
	}

	const [a, b] = address.split('.').map(Number)
	// Anything unparseable is refused rather than allowed, so a form not
	// recognised here cannot become a way through.
	if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return true
	if (a === 0 || a === 10 || a === 127) return true
	if (a === 169 && b === 254) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	if (a === 192 && b === 168) return true
	if (a === 100 && b >= 64 && b <= 127) return true
	return a >= 224
}

/**
 * A preview page is attacker-controlled, and the image URL it advertises is
 * whatever it wants. Unchecked, that turns a link preview into a request the
 * bot makes on the page's behalf, to an address the operator never chose.
 *
 * The host is resolved and judged before the request, because a public name
 * pointing at a private address is the whole trick. Redirects are refused
 * rather than followed, since each hop would need judging again and a
 * thumbnail is not worth that.
 *
 * A name that resolves differently between this check and the connection is
 * not closed off: doing that means pinning the address into the socket, which
 * needs a custom agent this package does not carry.
 */
const publicAddressOf = async (target: URL): Promise<string> => {
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new Boom(`link preview: refusing to fetch ${target.protocol}`, { statusCode: 400 })
	}
	const host = target.hostname.replace(/^\[|\]$/g, '')
	const address = isIP(host) ? host : (await lookup(host)).address
	if (isPrivateAddress(address)) {
		throw new Boom(`link preview: refusing to fetch a private address (${address})`, { statusCode: 400 })
	}
	return address
}

const assertPublicDestination = async (target: URL): Promise<void> => {
	await publicAddressOf(target)
}

/**
 * Fetched here rather than through `getHttpStream`, which forwards neither the
 * timeout nor the proxy and validates no destination. The credentials in
 * `headers` are for the page, so they are sent to the thumbnail only when it
 * is the same origin; another host advertised by that page must not receive
 * them.
 */
/** Exported under an underscore so the destination guard can be driven directly. */
export const _getCompressedJpegThumbnail = async (
	url: string,
	pageUrl: string,
	{ thumbnailWidth, fetchOpts }: URLGenerationOptions
) => {
	if (fetchOpts.proxyUrl) {
		// Silently connecting direct would defeat the reason a proxy was set.
		throw new Boom(
			'link preview thumbnail: proxyUrl is not applied to thumbnail fetches, so the thumbnail is skipped',
			{
				statusCode: 501
			}
		)
	}

	// One deadline for the whole operation, started before the lookup: a slow
	// resolver is as good a stall as a slow server, and the timeout is
	// documented as bounding the thumbnail, not just its connection.
	const signal = AbortSignal.timeout(fetchOpts.timeout)
	const target = new URL(url, pageUrl)
	await Promise.race([
		assertPublicDestination(target),
		new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
	])

	const sameOrigin = target.origin === new URL(pageUrl).origin
	const response = await fetch(target, {
		method: 'GET',
		redirect: 'error',
		signal,
		headers: sameOrigin ? (fetchOpts.headers as HeadersInit) : undefined
	})
	if (!response.ok) {
		throw new Boom(`link preview thumbnail: ${target} answered ${response.status}`, { statusCode: response.status })
	}

	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > MAX_THUMBNAIL_BYTES) {
		throw new Boom(`link preview thumbnail: ${declared} bytes is larger than the ${MAX_THUMBNAIL_BYTES} allowed`, {
			statusCode: 413
		})
	}

	// A declared length is a claim, so the body is counted as it arrives.
	const chunks: Buffer[] = []
	let read = 0
	for await (const chunk of response.body ? Readable.fromWeb(response.body as never) : []) {
		const bytes = chunk as Buffer
		read += bytes.length
		if (read > MAX_THUMBNAIL_BYTES) {
			throw new Boom(`link preview thumbnail: body exceeded the ${MAX_THUMBNAIL_BYTES} bytes allowed`, {
				statusCode: 413
			})
		}
		chunks.push(bytes)
	}

	return await extractImageThumb(Buffer.concat(chunks), thumbnailWidth)
}

/**
 * Reads the first URL out of a piece of text and fetches what a link preview
 * needs. Nothing here is protocol: it is an HTTP fetch, an OpenGraph parse and
 * a thumbnail, which is why it belongs in this layer rather than the engine.
 *
 * Resolves to undefined for the two cases that mean "no preview": text with no
 * link in it, and a page with no title. Everything else throws, including a
 * timeout, because a swallowed failure is indistinguishable from a page that
 * genuinely had nothing, and a caller retrying the first would give up on the
 * second.
 *
 * The metadata parse comes from `link-preview-js`, an optional peer dependency
 * this package already declares and had no reader for, so nothing new is
 * pulled in: a consumer who does not want link previews does not install it
 * and never calls this.
 */
export const getUrlInfo = async (
	text: string,
	opts: URLGenerationOptions = { thumbnailWidth: THUMBNAIL_WIDTH_PX, fetchOpts: { timeout: 3000 } }
): Promise<WAUrlInfo | undefined> => {
	if (opts.uploadImage) {
		throw new Boom(
			'getUrlInfo: uploadImage is not supported, because an upload function here takes plaintext and returns the encrypted result, while this option is typed for one that takes an already-encrypted file. Leave it unset and the thumbnail is generated locally.',
			{ statusCode: 501 }
		)
	}

	// A designed branch rather than a swallowed parser error: text with no link
	// in it has no preview, which is an answer, not a failure. Deciding it here
	// means every error the parser does raise is a real one.
	if (!FIRST_URL.test(text)) return undefined

	{
		let retries = 0
		const maxRetry = 5
		const { getLinkPreview } = (await import('link-preview-js' as string)) as {
			getLinkPreview: (url: string, options: Record<string, unknown>) => Promise<LinkPreviewResult>
		}
		const previewLink = text.startsWith('https://') || text.startsWith('http://') ? text : `https://${text}`

		const info = await getLinkPreview(previewLink, {
			...opts.fetchOpts,
			// `manual`, not `follow`: the redirect handler below only runs on
			// manual, so following automatically would send every hop unchecked.
			followRedirects: 'manual',
			// Only within the same site, and only so many times: a preview must
			// not become an open redirect follower.
			handleRedirects: (baseURL: string, forwardedURL: string) => {
				const from = new URL(baseURL).hostname
				const to = new URL(forwardedURL).hostname
				if (retries >= maxRetry) return false
				if (to === from || to === `www.${from}` || `www.${to}` === from) {
					retries += 1
					return true
				}
				return false
			},
			// Resolves the host so the address, not the name, is judged. The
			// parser rejects loopback on what this returns, and the private
			// ranges are rejected here.
			resolveDNSHost: async (target: string) => {
				const address = await publicAddressOf(new URL(target))
				return address
			},
			headers: opts.fetchOpts?.headers as Record<string, string> | undefined
		})

		if (!info?.title) return undefined

		const [image] = info.images ?? []
		const urlInfo: WAUrlInfo = {
			'canonical-url': info.url,
			'matched-text': text,
			title: info.title,
			description: info.description,
			originalThumbnailUrl: image
		}

		if (image) {
			// A preview without its thumbnail is still a preview, so a thumbnail
			// that fails to render is logged rather than losing the whole result.
			try {
				urlInfo.jpegThumbnail = Buffer.from((await _getCompressedJpegThumbnail(image, info.url, opts)).buffer)
			} catch (err) {
				opts.logger?.debug({ err, url: previewLink }, 'error in generating thumbnail')
			}
		}

		return urlInfo
	}
}
