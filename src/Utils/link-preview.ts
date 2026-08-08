import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import type { WAUrlInfo } from '../Types/Message.ts'
import { Boom } from './boom.ts'
import type { ILogger } from './logger.ts'
import { extractImageThumb } from './messages-media.ts'

const THUMBNAIL_WIDTH_PX = 192
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
const isPrivateAddress = (address: string): boolean => {
	if (isIP(address) === 6) {
		const normalised = address.toLowerCase()
		if (normalised === '::1' || normalised === '::') return true
		if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true
		if (normalised.startsWith('fe8') || normalised.startsWith('fe9') || normalised.startsWith('fea')) return true
		if (normalised.startsWith('feb')) return true
		// v4-mapped, judged on the address it maps to.
		const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised)
		return mapped ? isPrivateAddress(mapped[1]!) : false
	}

	const [a, b] = address.split('.').map(Number)
	if (a === undefined || b === undefined) return true
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
 */
const assertPublicDestination = async (target: URL): Promise<void> => {
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new Boom(`link preview thumbnail: refusing to fetch ${target.protocol}`, { statusCode: 400 })
	}
	const host = target.hostname.replace(/^\[|\]$/g, '')
	const address = isIP(host) ? host : (await lookup(host)).address
	if (isPrivateAddress(address)) {
		throw new Boom(`link preview thumbnail: refusing to fetch a private address (${address})`, { statusCode: 400 })
	}
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

	const target = new URL(url, pageUrl)
	await assertPublicDestination(target)

	const sameOrigin = target.origin === new URL(pageUrl).origin
	const response = await fetch(target, {
		method: 'GET',
		redirect: 'error',
		signal: AbortSignal.timeout(fetchOpts.timeout),
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
 * Resolves to undefined when the page has no title to preview or the fetch
 * found nothing usable, and throws for anything else, as upstream does.
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

	try {
		let retries = 0
		const maxRetry = 5
		const { getLinkPreview } = (await import('link-preview-js' as string)) as {
			getLinkPreview: (url: string, options: Record<string, unknown>) => Promise<LinkPreviewResult>
		}
		const previewLink = text.startsWith('https://') || text.startsWith('http://') ? text : `https://${text}`

		const info = await getLinkPreview(previewLink, {
			...opts.fetchOpts,
			followRedirects: 'follow',
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
	} catch (err) {
		// The one failure that means "no preview here" rather than "something
		// broke": every other error belongs to the caller.
		if (!(err instanceof Error) || !err.message.includes('receive a valid')) throw err
		return undefined
	}
}
