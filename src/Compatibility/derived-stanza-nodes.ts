import type { BinaryNode } from '../Types/index.ts'

/**
 * Upstream Baileys derives no stanza children of its own, so a caller that
 * wants the `<biz>` on an interactive message has to attach it — which is what
 * every payment recipe in that ecosystem tells them to do. The engine here
 * derives it from the message content instead, and from
 * `whatsapp-rust-bridge` 0.11.0 it refuses a caller node whose tag it already
 * derives rather than sending both. Two of them on one `<message>` is what the
 * client silently declines to render.
 *
 * That refusal is the correct behaviour and this is not an attempt to undo it.
 * It only keeps the promise this library makes: Baileys code runs unchanged.
 * A caller node the engine did not derive is left alone, because on a message
 * that derives nothing the caller's node is the only one there is.
 */

/** The wire text the engine uses. Matched rather than parsed: it carries the tag. */
const DERIVED_CONFLICT = 'conflicts with the one this send derives'

interface BridgeRejection {
	kind?: unknown
	reason?: unknown
	message?: unknown
}

/**
 * The tag the engine refused, or `undefined` when the error is something else.
 *
 * Read off the message rather than off a field: the rejection names the tag
 * inside its text (`extra stanza child <biz> conflicts with …`), and matching
 * the sentence keeps this from firing on an unrelated invalid-argument — a
 * malformed JID, an out-of-range enum — that a blanket retry would silently
 * send twice.
 */
export const derivedNodeConflictTag = (error: unknown): string | undefined => {
	if (typeof error !== 'object' || error === null) return undefined
	const { kind, reason, message } = error as BridgeRejection
	if (kind !== 'invalid-argument') return undefined
	const text = typeof reason === 'string' ? reason : typeof message === 'string' ? message : ''
	if (!text.includes(DERIVED_CONFLICT)) return undefined
	return /<([a-z-]+)>/u.exec(text)?.[1]
}

/** The caller's nodes without the one the engine derives, or `undefined` if none matched. */
export const withoutDerivedNode = (nodes: readonly BinaryNode[], tag: string): BinaryNode[] | undefined => {
	const kept = nodes.filter(node => node.tag !== tag)
	return kept.length === nodes.length ? undefined : kept
}
