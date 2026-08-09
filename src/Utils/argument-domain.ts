import { Boom } from './boom.ts'

/** Quoted when it is a string, bare otherwise, so `""` and `undefined` read apart. */
const shown = (value: unknown): string => {
	if (typeof value === 'string') return JSON.stringify(value)
	try {
		return String(value)
	} catch {
		// A null-prototype object, or one whose conversion throws. Reporting the
		// bad argument must not fail on the argument.
		return Object.prototype.toString.call(value)
	}
}

/**
 * Refuse a value outside a closed set, naming the method, the parameter, what
 * arrived and everything that is accepted.
 *
 * Call it in the synchronous prefix of the public method, ahead of the first
 * `await`. That is what puts the caller's own frame in the stack: a
 * fire-and-forget call leaves no awaiting frame for V8 to stitch an async
 * stack onto, and past the bridge boundary the rejection is built inside wasm
 * and carries nothing but wasm frames.
 *
 * The domain is always the values that define the parameter's type, never a
 * second list written beside it.
 */
export const assertArgumentDomain = <Value extends string | undefined>(
	method: string,
	parameter: string,
	value: unknown,
	domain: readonly Value[]
): Value => {
	if ((domain as readonly unknown[]).includes(value)) return value as Value

	const error = new Boom(
		`${method}: ${JSON.stringify(parameter)} must be one of ${domain.map(shown).join(', ')}, received ${shown(value)}`,
		{ statusCode: 400, data: { parameter, value, accepted: [...domain] } }
	)
	// Drop this frame: the method the consumer called is the useful top.
	Error.captureStackTrace(error, assertArgumentDomain)
	throw error
}
