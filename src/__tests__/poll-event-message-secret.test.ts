import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'
import type { PollMessageOptions } from '../Types/index.ts'
import { generateWAMessageContent } from '../Utils/messages.ts'
import { expect } from './expect.ts'

/**
 * A poll and an event each carry the key that encrypts the replies to them, in
 * `messageContextInfo.messageSecret`.
 *
 * It has to be written by the *sender*, at creation, because the sender is the
 * only party that can keep it: `decryptPollVote` takes it as `pollEncKey` and
 * `decryptEventResponse` as `eventEncKey`, and the only copy a caller ever gets
 * is the message `sendMessage` returns and emits as `messages.upsert` — which is
 * this object, with only `key.id` patched from the relay result. Generated
 * without one, the poll still sends and other clients still vote; its own sender
 * simply can never read those votes.
 *
 * The core settles `messageSecret` on relay for messages that arrive without one
 * (see `Socket/messages.ts`), but it settles it on the wire, where the caller
 * cannot see it — right for the reporting token, wrong for a key the caller has
 * to keep. WhatsApp Web generates it on the sender at creation for both
 * (`WAWebPollsSendPollCreationMsgAction`, `WAWebSendEventCreationMsgAction`) and
 * refuses to build an event edit without it
 * (`WAWebCreateEncryptedEventEditMsgData`).
 */

// The same shape `pin-message.test.ts` uses: neither branch under test reaches
// the logger or the media client, and stubbing them would only hide it if one
// started to.
const options = () => ({ logger: undefined, waClient: undefined as never })

describe('poll and event carry a sender-side messageSecret', () => {
	it('generates a 32-byte secret for every poll shape', async () => {
		// All three poll protos, since the branch that picks between them is the
		// one the secret is written beside: a regression that moved the write
		// inside a shape check would still pass on the shape it was left in.
		const shapes: PollMessageOptions[] = [
			{ name: 'q', values: ['a', 'b'], selectableCount: 1 },
			{ name: 'q', values: ['a', 'b'], selectableCount: 2 },
			{ name: 'q', values: ['a', 'b'], toAnnouncementGroup: true }
		]
		for (const poll of shapes) {
			const content = await generateWAMessageContent({ poll }, options())
			const secret = content.messageContextInfo?.messageSecret
			expect(secret).toBeTruthy()
			expect(secret!.length).toEqual(32)
		}
	})

	it('generates a 32-byte secret for an event', async () => {
		const content = await generateWAMessageContent(
			{ event: { name: 'e', startDate: new Date(1_700_000_000_000) } },
			options()
		)
		const secret = content.messageContextInfo?.messageSecret
		expect(secret).toBeTruthy()
		expect(secret!.length).toEqual(32)
	})

	it('honours a caller-supplied secret rather than replacing it', async () => {
		// The public contract upstream declares on `PollMessageOptions` and
		// `EventMessageOptions`. A caller that persists its own key — the reason to
		// pass one at all — gets a message it cannot decrypt if this is regenerated.
		const mine = new Uint8Array(32).fill(0x2b)

		const poll = await generateWAMessageContent(
			{ poll: { name: 'q', values: ['a'], selectableCount: 1, messageSecret: mine } },
			options()
		)
		expect([...(poll.messageContextInfo?.messageSecret ?? [])]).toEqual([...mine])

		const event = await generateWAMessageContent(
			{ event: { name: 'e', startDate: new Date(1_700_000_000_000), messageSecret: mine } },
			options()
		)
		expect([...(event.messageContextInfo?.messageSecret ?? [])]).toEqual([...mine])
	})

	it('draws a fresh secret per message when the caller supplies none', async () => {
		// Reusing one key across two polls would let a voter on the first decrypt
		// votes on the second, so "has a secret" is not enough on its own.
		const secretOf = async () => {
			const content = await generateWAMessageContent({ poll: { name: 'q', values: ['a'] } }, options())
			return Buffer.from(content.messageContextInfo?.messageSecret ?? []).toString('hex')
		}
		const first = await secretOf()
		const second = await secretOf()
		expect(first.length).toEqual(64)
		expect(first).not.toBe(second)
	})
})
