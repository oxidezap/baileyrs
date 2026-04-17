export interface BoomPayload {
	readonly statusCode: number
	readonly error: string
	readonly message: string
}

export interface BoomOutput {
	readonly statusCode: number
	readonly headers: Readonly<Record<string, string>>
	readonly payload: BoomPayload
}

export interface BoomOptions<TData = unknown> {
	readonly statusCode?: number
	readonly data?: TData
	readonly cause?: unknown
}

const EMPTY_HEADERS: Readonly<Record<string, string>> = Object.freeze({})

const STATUS_PHRASES = Object.freeze({
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	408: 'Request Timeout',
	411: 'Length Required',
	428: 'Precondition Required',
	440: 'Login Timeout',
	499: 'Client Closed Request',
	500: 'Internal Server Error',
	503: 'Service Unavailable',
	515: 'HTTP Version Not Supported'
} as const) satisfies Readonly<Record<number, string>>

function statusPhrase(code: number): string {
	const known = (STATUS_PHRASES as Readonly<Record<number, string>>)[code]
	if (known !== undefined) return known
	if (code >= 500) return 'Server Error'
	if (code >= 400) return 'Client Error'
	return 'Error'
}

export class Boom<TData = unknown> extends Error {
	readonly isBoom = true as const
	readonly statusCode: number
	readonly data?: TData
	#output: BoomOutput | undefined

	constructor(message?: string | Error, options: BoomOptions<TData> = {}) {
		const msg = message instanceof Error ? message.message : (message ?? 'Unknown error')
		super(msg, options.cause !== undefined ? { cause: options.cause } : undefined)
		this.statusCode = options.statusCode ?? 500
		if (options.data !== undefined) this.data = options.data
		if (message instanceof Error && message.stack) this.stack = message.stack
	}

	get isServer(): boolean {
		return this.statusCode >= 500
	}

	get output(): BoomOutput {
		if (this.#output === undefined) {
			this.#output = {
				statusCode: this.statusCode,
				headers: EMPTY_HEADERS,
				payload: {
					statusCode: this.statusCode,
					error: statusPhrase(this.statusCode),
					message: this.message
				}
			}
		}

		return this.#output
	}

	static isBoom(err: unknown): err is Boom {
		return typeof err === 'object' && err !== null && (err as { isBoom?: unknown }).isBoom === true
	}
}
