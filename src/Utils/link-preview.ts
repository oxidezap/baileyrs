import { Buffer } from 'node:buffer'
import type { WAUrlInfo } from '../Types/Message.ts'
import { Boom } from './boom.ts'
import type { ILogger } from './logger.ts'
import { extractImageThumb, getHttpStream } from './messages-media.ts'

const THUMBNAIL_WIDTH_PX = 192

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

const getCompressedJpegThumbnail = async (url: string, { thumbnailWidth, fetchOpts }: URLGenerationOptions) => {
	const stream = await getHttpStream(url, fetchOpts)
	return await extractImageThumb(stream, thumbnailWidth)
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
				urlInfo.jpegThumbnail = Buffer.from((await getCompressedJpegThumbnail(image, opts)).buffer)
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
