/**
 * Use the same public error implementation as upstream Baileys. Besides
 * making `lastDisconnect.error` and `messages.media-update.error` exactly
 * assignable, this preserves the full Boom runtime contract (`reformat`,
 * `typeof`, mutable output headers and standard payload handling).
 *
 * `@hapi/boom` is an optional peer: when the consumer has it installed the
 * real implementation backs the export, so `instanceof` identity is shared
 * with the rest of their tree. Otherwise a local implementation with the
 * same observable behavior backs it, so a fresh install works without
 * adding the dependency.
 */

import { createRequire } from 'node:module'

/** Extra error data carried beside the formatted response. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface BoomOptions<Data = any> {
	/** The HTTP status code. Must be 400 or above. @default 500 */
	statusCode?: number
	/** Additional error information. @default null */
	data?: Data
	/** Constructor reference used to crop the exception call stack output. */
	ctor?: Function
	/** Replacement message applied on top of an existing error. */
	message?: string
	/**
	 * When the input is already a Boom error and a statusCode or message is
	 * provided, apply them. Pass false to leave the error untouched.
	 * @default true
	 */
	override?: boolean
	/** Extra properties assigned onto the error object. */
	decorate?: Record<string, unknown>
}

/** The formatted object used as the response payload. */
export interface BoomPayload {
	/** The HTTP status code derived from error.output.statusCode. */
	statusCode: number
	/** The HTTP status message derived from statusCode. */
	error: string
	/** The error message derived from error.message. */
	message: string
	/** Custom properties. */
	[key: string]: unknown
}

/** The formatted response carried on every Boom error. */
export interface BoomOutput {
	/** The HTTP status code. */
	statusCode: number
	/** HTTP headers, each key a header name. Mutable by design. */
	headers: { [header: string]: string | string[] | number | undefined }
	/** The formatted object used as the response payload. */
	payload: BoomPayload
}

/** A Boom error instance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Boom<Data = any> extends Error {
	/** Custom error data. Null unless the caller passed `data`. */
	data?: Data | null
	/** Always true on a Boom error. Checked by {@link isBoom}. */
	isBoom: boolean
	/** True when the status code is 500 or above. */
	isServer: boolean
	/** The formatted response. */
	output: BoomOutput
	/** The constructor used to create the error. */
	typeof: Function
	/**
	 * Rebuild the payload from the current status code and message.
	 * Returns the formatted message, matching the peer's declaration.
	 */
	reformat(debug?: boolean): string
}

/** The shared constructor behind the {@link Boom} export. */
export interface BoomConstructor {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new <Data = any>(message?: string | Error, options?: BoomOptions<Data>): Boom<Data>
	readonly prototype: Boom<unknown>
}

/** Reason phrases per status code, matching the peer's table. */
const STATUS_MESSAGES: ReadonlyMap<number, string> = new Map([
	[100, 'Continue'],
	[101, 'Switching Protocols'],
	[102, 'Processing'],
	[200, 'OK'],
	[201, 'Created'],
	[202, 'Accepted'],
	[203, 'Non-Authoritative Information'],
	[204, 'No Content'],
	[205, 'Reset Content'],
	[206, 'Partial Content'],
	[207, 'Multi-Status'],
	[300, 'Multiple Choices'],
	[301, 'Moved Permanently'],
	[302, 'Moved Temporarily'],
	[303, 'See Other'],
	[304, 'Not Modified'],
	[305, 'Use Proxy'],
	[307, 'Temporary Redirect'],
	[400, 'Bad Request'],
	[401, 'Unauthorized'],
	[402, 'Payment Required'],
	[403, 'Forbidden'],
	[404, 'Not Found'],
	[405, 'Method Not Allowed'],
	[406, 'Not Acceptable'],
	[407, 'Proxy Authentication Required'],
	[408, 'Request Time-out'],
	[409, 'Conflict'],
	[410, 'Gone'],
	[411, 'Length Required'],
	[412, 'Precondition Failed'],
	[413, 'Request Entity Too Large'],
	[414, 'Request-URI Too Large'],
	[415, 'Unsupported Media Type'],
	[416, 'Requested Range Not Satisfiable'],
	[417, 'Expectation Failed'],
	[418, "I'm a teapot"],
	[422, 'Unprocessable Entity'],
	[423, 'Locked'],
	[424, 'Failed Dependency'],
	[425, 'Too Early'],
	[426, 'Upgrade Required'],
	[428, 'Precondition Required'],
	[429, 'Too Many Requests'],
	[431, 'Request Header Fields Too Large'],
	[451, 'Unavailable For Legal Reasons'],
	[500, 'Internal Server Error'],
	[501, 'Not Implemented'],
	[502, 'Bad Gateway'],
	[503, 'Service Unavailable'],
	[504, 'Gateway Time-out'],
	[505, 'HTTP Version Not Supported'],
	[506, 'Variant Also Negotiates'],
	[507, 'Insufficient Storage'],
	[509, 'Bandwidth Limit Exceeded'],
	[510, 'Not Extended'],
	[511, 'Network Authentication Required']
])

const reformatBoom = function (this: Boom, debug = false): string {
	this.output.payload.statusCode = this.output.statusCode
	this.output.payload.error = STATUS_MESSAGES.get(this.output.statusCode) || 'Unknown'
	if (this.output.statusCode === 500 && debug !== true) {
		this.output.payload.message = 'An internal server error occurred'
	} else if (this.message) {
		this.output.payload.message = this.message
	}
	return this.output.payload.message
}

const initializeBoom = (error: Boom, statusCode: number, message?: string): Boom => {
	const code = Number.parseInt(String(statusCode), 10)
	if (Number.isNaN(code) || code < 400) {
		throw new Error(`First argument must be a number (400+): ${String(statusCode)}`)
	}
	error.isBoom = true
	error.isServer = code >= 500
	if (!Object.hasOwn(error, 'data')) error.data = null
	error.output = { statusCode: code, payload: {} as BoomPayload, headers: {} }
	Object.defineProperty(error, 'reformat', { value: reformatBoom, configurable: true })
	if (!message && !error.message) {
		error.reformat()
		message = error.output.payload.error
	}
	if (message) {
		error.message = message + (error.message ? `: ${error.message}` : '')
		error.output.payload.message = error.message
	}
	error.reformat()
	return error
}

/**
 * Local stand-in used only when `@hapi/boom` is not installed. Reproduces
 * the observable contract the rest of the package relies on: `output` with
 * status code, payload and mutable headers, `data`, `isServer`, `reformat`,
 * `typeof`, sanitized 500 messages, and `instanceof` recognition through
 * `Symbol.hasInstance`.
 */
class FallbackBoom<Data = unknown> extends Error implements Boom<Data> {
	data?: Data | null
	isBoom = true
	isServer = true
	output!: BoomOutput
	typeof!: Function
	declare reformat: (debug?: boolean) => string

	constructor(messageOrError?: string | Error, options: BoomOptions<Data> = {}) {
		if (messageOrError instanceof Error) {
			const copy = Object.create(
				Object.getPrototypeOf(messageOrError),
				Object.getOwnPropertyDescriptors(messageOrError)
			) as FallbackBoom<Data>
			Object.setPrototypeOf(copy, FallbackBoom.prototype)
			return boomifyFallback(copy, options)
		}
		const { statusCode = 500, data = null, ctor = FallbackBoom } = options
		super(messageOrError ?? undefined)
		if (typeof Error.captureStackTrace === 'function') Error.captureStackTrace(this, ctor)
		this.data = (data ?? null) as Data | null
		const initialized = initializeBoom(this, statusCode)
		Object.defineProperty(initialized, 'typeof', { value: ctor })
		if (options.decorate) Object.assign(initialized, options.decorate)
		return initialized as unknown as FallbackBoom<Data>
	}

	static [Symbol.hasInstance](instance: unknown): boolean {
		return isBoomFallback(instance)
	}
}

/** Local `isBoom`: an Error carrying the Boom marker, nothing looser. */
const isBoomFallback = (obj: unknown, statusCode?: number): obj is Boom =>
	obj instanceof Error &&
	(obj as Boom).isBoom === true &&
	(statusCode === undefined || (obj as Boom).output?.statusCode === statusCode)

/** Local `boomify`: decorate an existing error in place. */
const boomifyFallback = <Data = unknown>(error: Error, options: BoomOptions<Data> = {}): Boom<Data> => {
	if (!(error instanceof Error)) throw new Error('Cannot wrap non-Error object')
	const boom = error as Boom<Data>
	if (options.data !== undefined) boom.data = options.data as Data
	if (options.decorate) Object.assign(boom, options.decorate)
	if (!boom.isBoom) return initializeBoom(boom, options.statusCode ?? 500, options.message) as Boom<Data>
	if (options.override === false || (!options.statusCode && !options.message)) return boom
	return initializeBoom(boom, options.statusCode ?? boom.output.statusCode, options.message) as Boom<Data>
}

interface BoomPeerModule {
	Boom: BoomConstructor
	boomify: (error: Error, options?: BoomOptions) => Boom
	isBoom: (obj: unknown, statusCode?: number) => obj is Boom
}

const loadBoomPeer = (): BoomPeerModule | undefined => {
	try {
		return createRequire(import.meta.url)('@hapi/boom') as BoomPeerModule
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND') return undefined
		throw error
	}
}

const peer = loadBoomPeer()

/**
 * The shared error implementation. The peer's copy when installed, so error
 * identity is shared with the rest of the consumer's tree, else the local
 * implementation above.
 */
export const Boom: BoomConstructor = (peer?.Boom ?? FallbackBoom) as BoomConstructor

/** Decorate an existing error with the Boom response shape. */
export const boomify: (error: Error, options?: BoomOptions) => Boom = peer?.boomify ?? boomifyFallback

/** Whether a value is a Boom error, optionally with an exact status code. */
export const isBoom: (obj: unknown, statusCode?: number) => obj is Boom = peer?.isBoom ?? isBoomFallback
