import { describe, it } from 'node:test'
import { expect } from './expect.ts'

/**
 * `options.messageId` on an edit means "send this edit under that stanza id" —
 * the edit-path counterpart of the same option on a plain send. It is what lets
 * a caller collide the edit with an existing message so clients re-render that
 * slot, the only way to take content off screen for message types the server
 * refuses to revoke.
 *
 * The forwarding has to satisfy three things at once, which is why it is tested
 * rather than eyeballed:
 *
 *  1. omitted `messageId` keeps the 3-argument call bridges already declare —
 *     the published bridge (0.14.0) types `editMessageBytes` with three
 *     parameters, so a blind 4-argument call breaks the build;
 *  2. an explicit id is forwarded as the 4th argument;
 *  3. an EMPTY id counts as absent, since every other id path in this API uses
 *     falsy fallbacks (`generateWAMessageFromContent`, `planMessageRelay`).
 *     Forwarding `''` would pin the stanza to an invalid id.
 */

/** Mirrors the call shape in Socket/messages.ts without booting a socket. */
function forwardEdit(
	editMessageBytes: (jid: string, messageId: string, bytes: Uint8Array, stanzaId?: string) => Promise<string>,
	jid: string,
	anchorId: string,
	bytes: Uint8Array,
	options?: { messageId?: string }
) {
	const editStanzaId = options?.messageId || undefined
	return editStanzaId
		? editMessageBytes(jid, anchorId, bytes, editStanzaId)
		: editMessageBytes(jid, anchorId, bytes)
}

function recorder() {
	const calls: unknown[][] = []
	const fn = async (...args: unknown[]) => {
		calls.push(args)
		return 'RESULT_ID'
	}
	return { calls, fn: fn as never }
}

describe('edit stanza id forwarding', () => {
	it('omits the 4th argument when no messageId is given', async () => {
		const { calls, fn } = recorder()

		await forwardEdit(fn, 'g@g.us', 'ANCHOR', new Uint8Array([1]))

		expect(calls.length).toBe(1)
		expect(calls[0]!.length).toBe(3)
	})

	it('forwards an explicit messageId as the stanza id', async () => {
		const { calls, fn } = recorder()

		await forwardEdit(fn, 'g@g.us', 'ANCHOR', new Uint8Array([1]), { messageId: 'TARGET_ID' })

		expect(calls[0]!.length).toBe(4)
		expect(calls[0]![3]).toBe('TARGET_ID')
	})

	it('treats an empty messageId as unspecified', async () => {
		const { calls, fn } = recorder()

		await forwardEdit(fn, 'g@g.us', 'ANCHOR', new Uint8Array([1]), { messageId: '' })

		expect(calls[0]!.length).toBe(3)
	})
})
