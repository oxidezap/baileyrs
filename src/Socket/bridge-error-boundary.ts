/**
 * Recreate a bridge rejection at the JS boundary so its stack names the caller.
 *
 * The engine constructs its errors inside wasm, in a microtask continuation
 * that runs after the server response arrives. V8 captures the stack at
 * construction, so what reaches the consumer is glue plus `wasm://` frames
 * and never the code that made the call. Recreating the error inside a catch
 * the caller is awaiting fixes that: V8's async stack walk names the awaiting
 * frames, so a bot sees `at async itsOwnCommand` instead of function indices.
 *
 * What survives translation, and how:
 *
 *  - The engine sets its payload (`kind`, `serverCode`, `serverText`,
 *    `errorType`, `backoffSeconds`, and whatever it adds next) and `name`
 *    (`WhatsAppError`) as own enumerable properties, while `message` and
 *    `stack` are own non-enumerable ones. `Object.assign` therefore copies
 *    exactly the payload and the name, never touches the fresh stack, and
 *    cannot invent a key the rejection did not carry.
 *  - The original error becomes `cause`, so the wasm-side stack stays
 *    reachable for whoever wants the engine's half of the story.
 *  - Anything that is not the bridge's shape (an `Error` carrying a string
 *    `kind`) passes through with the same identity it arrived with.
 *
 * The wrap happens once per client: `getClient()`/`getClientSync()` hand out
 * a `Proxy` whose method wrappers are built on first access and cached, so
 * the happy path pays one property trap and one extra promise layer, and the
 * error path pays for everything else.
 */

import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

/** The bridge's rejection shape: a real `Error` with a string `kind`. */
const isBridgeRejection = (error: unknown): error is Error & { kind: string } =>
	error instanceof Error && typeof (error as { kind?: unknown }).kind === 'string'

/** Rebuild a bridge rejection here; return anything else untouched. */
export const withCallerStack = (error: unknown): unknown => {
	if (!isBridgeRejection(error)) return error
	return Object.assign(new Error(error.message, { cause: error }), error)
}

const rethrowWithCallerStack = async <T>(call: Promise<T>): Promise<T> => {
	try {
		return await call
	} catch (error) {
		throw withCallerStack(error)
	}
}

const wrappedClients = new WeakMap<WasmWhatsAppClient, WasmWhatsAppClient>()

/**
 * The client the socket hands out. Methods bind to the raw client (wasm
 * bindings need their own `this`), sync returns pass through untouched, and
 * promise returns reject through `withCallerStack`.
 */
export const wrapBridgeClient = (client: WasmWhatsAppClient): WasmWhatsAppClient => {
	const memo = wrappedClients.get(client)
	if (memo) return memo

	const methods = new Map<PropertyKey, unknown>()
	const wrapped = new Proxy(client, {
		get(target, prop) {
			const hit = methods.get(prop)
			if (hit !== undefined) return hit
			const value = Reflect.get(target, prop)
			if (typeof value !== 'function') return value
			const method = (...args: unknown[]) => {
				const out = (value as (...a: unknown[]) => unknown).apply(target, args)
				return out instanceof Promise ? rethrowWithCallerStack(out) : out
			}
			methods.set(prop, method)
			return method
		}
	})
	wrappedClients.set(client, wrapped)
	return wrapped
}
