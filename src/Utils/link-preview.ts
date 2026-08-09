import { Buffer } from 'node:buffer'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import type { WAUrlInfo } from '../Types/Message.ts'
import { Boom } from './boom.ts'
import type { ILogger } from './logger.ts'
import { extractImageThumb } from './messages-media.ts'

const THUMBNAIL_WIDTH_PX = 192
/** An explicit scheme names a link wherever it sits, so nothing is required before it. */
const SCHEMED_URL = /https?:\/\/[^\s<>]+/i
/**
 * A bare host has to earn it: something before it, and an alphabetic last
 * label, which is what separates `example.com` from `version 1.22`.
 */
const BARE_HOST = /(^|[\s([{'"<])((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>]*)?)(?=[\s.,!?)\]}>]|$)/i

/**
 * The first link in a piece of text, or undefined when there is none. Exported
 * under an underscore so the extraction can be tested without a network.
 *
 * Trailing prose punctuation is dropped: a link at the end of a sentence
 * carries the full stop with it, and `https://example.com.` is not what the
 * writer meant. A closing bracket goes the same way, which costs the rare url
 * that genuinely ends in one and saves the common case of a link in
 * parentheses.
 */
export const _firstLink = (text: string): string | undefined => {
	const schemed = SCHEMED_URL.exec(text)
	const bare = BARE_HOST.exec(text)
	// Whichever starts earlier. A bare match begins at the character before the
	// host, so it is that offset, not the match's, that compares.
	const bareAt = bare ? bare.index + bare[1]!.length : Number.POSITIVE_INFINITY
	const found = (schemed && schemed.index <= bareAt ? schemed[0] : bare?.[2])?.replace(/[.,!?;:'")\]}]+$/, '')
	if (!found) return undefined
	// Case-insensitively, since `HTTPS://` is a scheme too and prefixing it
	// again would build a URL that parses as nothing.
	return /^https?:\/\//i.test(found) ? found : `https://${found}`
}
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
 * The eight groups an IPv6 literal stands for, with `::` expanded and any
 * trailing dotted quad folded in. Undefined when the text is not one, so an
 * unrecognised form is refused rather than read as public.
 */
const hextetsOf = (address: string): number[] | undefined => {
	const [head, tail, ...rest] = address.split('::')
	if (rest.length) return undefined

	const groupsOf = (part: string): number[] | undefined => {
		if (!part) return []
		const groups: number[] = []
		for (const piece of part.split(':')) {
			if (piece.includes('.')) {
				if (isIP(piece) !== 4) return undefined
				const [a, b, c, d] = piece.split('.').map(Number)
				groups.push((a! << 8) | b!, (c! << 8) | d!)
			} else if (/^[0-9a-f]{1,4}$/.test(piece)) {
				groups.push(Number.parseInt(piece, 16))
			} else {
				return undefined
			}
		}
		return groups
	}

	const left = groupsOf(head ?? '')
	const right = tail === undefined ? [] : groupsOf(tail)
	if (!left || !right) return undefined
	if (tail === undefined) return left.length === 8 ? left : undefined
	const gap = 8 - left.length - right.length
	return gap < 0 ? undefined : [...left, ...Array.from<number>({ length: gap }).fill(0), ...right]
}

/**
 * The v4 address an IPv4-mapped IPv6 literal stands for, in each spelling of
 * it: `::ffff:127.0.0.1`, `::ffff:7f00:1` and `::ffff:0:7f00:1` are one
 * address, and judging only one leaves the others a way through.
 */
const dottedQuad = (high: number, low: number) => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`

const mappedIPv4 = (groups: number[]): string | undefined => {
	const zeroesUpTo = (count: number) => groups.slice(0, count).every(group => group === 0)
	if (!((zeroesUpTo(5) && groups[5] === 0xffff) || (zeroesUpTo(4) && groups[4] === 0xffff && groups[5] === 0))) {
		return undefined
	}
	return dottedQuad(groups[6]!, groups[7]!)
}

const isPrivateIPv4 = (address: string): boolean => {
	const [a, b, c] = address.split('.').map(Number)
	// Anything unparseable is refused rather than allowed, so a form not
	// recognised here cannot become a way through.
	if (a === undefined || b === undefined || c === undefined) return true
	if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return true
	if (a === 0 || a === 10 || a === 127) return true
	if (a === 169 && b === 254) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	if (a === 192 && b === 168) return true
	if (a === 100 && b >= 64 && b <= 127) return true
	// Not private, but not globally routable either. An operator who routes one
	// of these internally would otherwise have it reachable from a preview.
	if (a === 192 && b === 0 && (c === 0 || c === 2)) return true
	if (a === 198 && (b === 18 || b === 19)) return true
	if (a === 198 && b === 51 && c === 100) return true
	if (a === 203 && b === 0 && c === 113) return true
	return a >= 224
}

/**
 * Judged by value rather than by how the address is written. Both callers hand
 * this canonical text today, and resting on that would make the guard wrong the
 * moment one of them stops.
 */
const isPrivateIPv6 = (groups: number[]): boolean => {
	const mapped = mappedIPv4(groups)
	if (mapped) return isPrivateIPv4(mapped)
	// NAT64 carries a v4 address the network translates to on the way out, so
	// the embedded address is what decides. Only the /96 embedding can be read
	// off the literal; any other length in the prefix is refused instead.
	if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
		return groups.slice(2, 6).every(group => group === 0) ? isPrivateIPv4(dottedQuad(groups[6]!, groups[7]!)) : true
	}
	// All of `::/96`, which covers the unspecified address, loopback and the
	// deprecated v4-compatible forms.
	if (groups.slice(0, 6).every(group => group === 0)) return true
	const first = groups[0]!
	// fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local and
	// ff00::/8 multicast, which the v4 side already refuses as 224/4.
	if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true
	return (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00
}

/**
 * Addresses no outbound request from a link preview may reach: loopback, the
 * private ranges, link-local and the cloud metadata address that sits inside
 * link-local and is the usual target, plus the IPv6 equivalents.
 */
const isPrivateAddress = (address: string): boolean => {
	if (isIP(address) !== 6) return isPrivateIPv4(address)
	const groups = hextetsOf(address.toLowerCase())
	return groups ? isPrivateIPv6(groups) : true
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
	const resolved = isIP(host) ? [host] : (await lookup(host, { all: true })).map(({ address }) => address)
	const [first] = resolved
	if (!first) {
		throw new Boom(`link preview: ${host} did not resolve`, { statusCode: 400 })
	}
	// Every address a name answers with, not just the first: several records
	// mean the one judged here need not be the one connected to.
	const refused = resolved.find(address => isPrivateAddress(address))
	if (refused) {
		throw new Boom(`link preview: refusing to fetch a private address (${refused})`, { statusCode: 400 })
	}
	return first
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
	if (opts.fetchOpts.proxyUrl) {
		// Refused rather than half-applied. The page fetch would resolve the
		// host locally, which both fails where only the proxy can resolve and
		// leaks the destination where the proxy was chosen for privacy, and the
		// thumbnail would connect direct. Honouring it needs a proxy dispatcher,
		// which is a dependency this package does not carry.
		throw new Boom(
			'getUrlInfo: proxyUrl is not supported, because neither the metadata fetch nor the thumbnail can be routed through a proxy here, and doing either directly would defeat the reason it was configured',
			{ statusCode: 501 }
		)
	}

	if (opts.uploadImage) {
		throw new Boom(
			'getUrlInfo: uploadImage is not supported, because an upload function here takes plaintext and returns the encrypted result, while this option is typed for one that takes an already-encrypted file. Leave it unset and the thumbnail is generated locally.',
			{ statusCode: 501 }
		)
	}

	// A designed branch rather than a swallowed parser error: text with no link
	// in it has no preview, which is an answer, not a failure. Deciding it here
	// means every error the parser does raise is a real one.
	const previewLink = _firstLink(text)
	if (!previewLink) return undefined

	{
		const { getLinkPreview } = (await import('link-preview-js' as string)) as {
			getLinkPreview: (url: string, options: Record<string, unknown>) => Promise<LinkPreviewResult>
		}

		// The whole call is raced, not each step inside it. The parser takes its
		// timeout up front but runs the resolver hook before starting that timer,
		// so bounding the lookup and the request separately still let them add
		// up. Racing the call is the only bound the parser cannot walk past.
		const deadline = AbortSignal.timeout(opts.fetchOpts.timeout)

		const info = await Promise.race([
			getLinkPreview(previewLink, {
				...opts.fetchOpts,
				// `manual`, not `follow`: the redirect handler below only runs on
				// manual, so following automatically would send every hop unchecked.
				followRedirects: 'manual',
				// Same site only, so a preview cannot become an open redirect
				// follower. One hop, because that is what the parser offers under
				// manual redirects: it consults this once and fetches once more.
				handleRedirects: (baseURL: string, forwardedURL: string) => {
					const from = new URL(baseURL)
					const to = new URL(forwardedURL)
					// Scheme and port too, not the host alone: the follow-up request
					// carries the caller's headers, so a hop to http:// on the same
					// name would put their credentials on the wire in clear, and one
					// to another port would hand them to a different service.
					if (to.protocol !== from.protocol || to.port !== from.port) return false
					return (
						to.hostname === from.hostname ||
						to.hostname === `www.${from.hostname}` ||
						`www.${to.hostname}` === from.hostname
					)
				},
				// Resolves the host so the address, not the name, is judged. The
				// parser rejects loopback on what this returns, and the private
				// ranges are rejected here. A redirect brings it back.
				resolveDNSHost: async (target: string) => await publicAddressOf(new URL(target)),
				headers: opts.fetchOpts?.headers as Record<string, string> | undefined
			}),
			new Promise<never>((_resolve, reject) =>
				deadline.addEventListener('abort', () => reject(deadline.reason), { once: true })
			)
		])

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
