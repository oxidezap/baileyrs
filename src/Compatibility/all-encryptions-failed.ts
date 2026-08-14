import { Boom } from '../Utils/boom.ts'

/**
 * A send that produced no ciphertext for its recipient.
 *
 * Upstream Baileys drops a device it cannot encrypt for and, when that leaves
 * nothing, throws `Boom('All encryptions failed', { statusCode: 500 })`
 * (`Socket/messages-send.ts`, in `createParticipantNodes`). The engine reached
 * the same conclusion later: until `whatsapp-rust-bridge` 0.13.0 it returned a
 * message id for a send that was never transmitted, and it now rejects with
 * `no-recipient-device` instead.
 *
 * Same condition, different spelling, so it is translated here rather than
 * left for the caller: Baileys code that branches on `statusCode === 500` or
 * matches the message keeps working, and `attempted` rides along as extra
 * data upstream has no way to carry.
 */

const NO_RECIPIENT_DEVICE = 'no-recipient-device'

/** How many recipient devices the engine tried, when it said. */
const attemptedFrom = (error: object): number | undefined => {
	const { attempted } = error as { attempted?: unknown }
	return typeof attempted === 'number' ? attempted : undefined
}

/**
 * The rejection Baileys code expects, or the original error untouched.
 *
 * Narrow on purpose: only the engine's own `no-recipient-device` is rewritten,
 * so every other failure still reaches the caller with the shape the bridge
 * gave it.
 */
export const asAllEncryptionsFailed = (error: unknown): unknown => {
	if (typeof error !== 'object' || error === null) return error
	if ((error as { kind?: unknown }).kind !== NO_RECIPIENT_DEVICE) return error
	return new Boom('All encryptions failed', {
		statusCode: 500,
		data: { attempted: attemptedFrom(error) }
	})
}

/** Run a send, translating only that one rejection. */
export const sendReportingUpstreamFailure = async <T>(send: () => Promise<T>): Promise<T> => {
	try {
		return await send()
	} catch (error) {
		throw asAllEncryptionsFailed(error)
	}
}
