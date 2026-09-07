import type { WasmWhatsAppClient as MockClient } from '@oxidezap/whatsapp-rust-bridge'
/**
 * `chatModify` used to end in an `else` that logged a warning and resolved, for
 * every variant the bridge did not expose: link previews, the five label
 * actions, quick replies. `contact: null` did the same.
 *
 * That is worse than a missing method. A missing method is a `TypeError` the
 * caller sees. A call that resolves having done nothing is silent data loss:
 * the caller believes the chat is labelled and nothing was ever synced, and
 * neither the signature nor the type system says otherwise.
 *
 * So these tests come in two halves. One pins that every variant now reaches
 * the bridge call that performs it, with the arguments in the order the bridge
 * takes them. The other pins that anything left over rejects.
 */

import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { describe, it } from 'node:test'
import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'

import { makeChatActionMethods } from '../Socket/chat-actions.ts'
import type { WithClientSocketContext as SocketContext } from '../Socket/types.ts'
import type { ChatModification } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import { expect } from './expect.ts'

const CHAT = '15551230000@s.whatsapp.net'

const logger = {
	level: 'silent',
	child: () => logger,
	trace: () => undefined,
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
	error: () => undefined
} as ILogger

/** Records every bridge method the modification reaches, with its arguments. */
const makeHarness = () => {
	const calls: Array<[string, unknown[]]> = []
	const record =
		(name: string) =>
		async (...args: unknown[]) => {
			calls.push([name, args])
		}
	const client = new Proxy({} as Record<string, unknown>, {
		// `then` has to stay undefined: a proxy that answers it is a thenable,
		// and `await getClient()` would try to resolve the client itself.
		get: (_target, prop) => (typeof prop === 'string' && prop !== 'then' ? record(prop) : undefined)
	}) as unknown as WasmWhatsAppClient
	const ctx = {
		ev: new EventEmitter(),
		logger,
		withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) => operation((await client) as MockClient)
	} as unknown as SocketContext
	return { calls, methods: makeChatActionMethods(ctx) }
}

/**
 * Every variant that used to fall into the silent `else`, plus `contact: null`,
 * with the bridge call each one has to become.
 *
 * The argument order is the point of the table. Upstream takes
 * `(jid, labelId)` and the bridge takes `(labelId, chatJid)`; both are strings,
 * so a swap type checks and silently labels the wrong thing.
 */
const FORMERLY_SILENT: Array<{ label: string; mod: ChatModification; call: [string, unknown[]] }> = [
	{
		label: 'disableLinkPreviews',
		mod: { disableLinkPreviews: { isPreviewsDisabled: true } },
		call: ['setLinkPreviewsDisabled', [true]]
	},
	{
		label: 'addLabel (create)',
		mod: { addLabel: { id: 'lbl-1', name: 'Leads', color: 3 } },
		call: ['createLabel', ['lbl-1', 'Leads', 3]]
	},
	{
		label: 'addLabel (deleted flag routes to delete)',
		mod: { addLabel: { id: 'lbl-1', name: 'Leads', deleted: true } },
		call: ['deleteLabel', ['lbl-1']]
	},
	{
		label: 'addChatLabel',
		mod: { addChatLabel: { labelId: 'lbl-1' } },
		call: ['addChatLabel', ['lbl-1', CHAT]]
	},
	{
		label: 'removeChatLabel',
		mod: { removeChatLabel: { labelId: 'lbl-1' } },
		call: ['removeChatLabel', ['lbl-1', CHAT]]
	},
	{
		label: 'addMessageLabel',
		mod: { addMessageLabel: { labelId: 'lbl-1', messageId: 'MSG1' } },
		call: ['addMessageLabel', ['lbl-1', CHAT, 'MSG1']]
	},
	{
		label: 'removeMessageLabel',
		mod: { removeMessageLabel: { labelId: 'lbl-1', messageId: 'MSG1' } },
		call: ['removeMessageLabel', ['lbl-1', CHAT, 'MSG1']]
	},
	{
		label: 'quickReply (create)',
		mod: { quickReply: { timestamp: '1700000000', shortcut: 'hi', message: 'Hello', keywords: ['greet'], count: 0 } },
		call: ['setQuickReply', ['1700000000', 'hi', 'Hello', ['greet'], 0]]
	},
	{
		label: 'quickReply (deleted flag routes to delete)',
		mod: { quickReply: { timestamp: '1700000000', deleted: true } },
		call: ['deleteQuickReply', ['1700000000']]
	},
	{
		// The one contact mutation the wire models as a Remove. A Set carrying
		// empty fields would rename the contact to the empty string instead.
		label: 'contact: null',
		mod: { contact: null },
		call: ['removeContact', [CHAT]]
	}
]

describe('chatModify: variants that used to resolve without doing anything', () => {
	for (const { label, mod, call } of FORMERLY_SILENT) {
		it(`${label} reaches ${call[0]}`, async () => {
			const { calls, methods } = makeHarness()

			await methods.chatModify(mod, CHAT)

			expect(calls).toEqual([call])
		})
	}
})

describe('chatModify: a quick reply with no usable key gets one', () => {
	// Upstream mints a key from the clock for both, and the core rejects an
	// empty index, so neither may reach the bridge as ''.
	for (const [label, timestamp] of [
		['empty', ''],
		['absent', undefined]
	] as const) {
		it(`a ${label} timestamp becomes a generated key`, async () => {
			const { calls, methods } = makeHarness()

			await methods.chatModify({ quickReply: { timestamp, shortcut: 'hi', message: 'Hello' } }, CHAT)

			const [name, args] = calls[0]!
			expect(name).toBe('setQuickReply')
			expect(typeof args[0]).toBe('string')
			expect((args[0] as string).length > 0).toBe(true)
		})
	}
})

/**
 * Both input types carry fields the bridge call has no slot for. Accepting one
 * and dropping it is the same silent success in miniature: the caller asked for
 * a username to be set and got a resolved promise with nothing set.
 */
describe('chatModify: a field the wire call cannot carry is refused, not dropped', () => {
	for (const field of ['lidJid', 'pnJid', 'username'] as const) {
		it(`contact.${field} rejects rather than being ignored`, async () => {
			const { calls, methods } = makeHarness()

			await expect(methods.chatModify({ contact: { fullName: 'Ada', [field]: 'something' } }, CHAT)).rejects.toThrow(
				new RegExp(`${field} cannot be set`)
			)
			expect(calls).toEqual([])
		})
	}

	it('addLabel.predefinedId rejects rather than being ignored', async () => {
		const { calls, methods } = makeHarness()

		await expect(
			methods.chatModify({ addLabel: { id: 'lbl-1', name: 'Leads', predefinedId: 3 } }, CHAT)
		).rejects.toThrow(/predefinedId cannot be set/)
		expect(calls).toEqual([])
	})

	// The label mutation replaces the whole action, so an omitted field is
	// "set to nothing" rather than "leave alone". Upstream can omit one
	// because it builds the proto itself; this call has no way to.
	for (const [label, body] of [
		['name', { id: 'lbl-1', color: 3 }],
		['color', { id: 'lbl-1', name: 'Leads' }]
	] as const) {
		it(`addLabel without ${label} rejects rather than resetting it`, async () => {
			const { calls, methods } = makeHarness()

			await expect(methods.chatModify({ addLabel: body }, CHAT)).rejects.toThrow(/name and color are both required/)
			expect(calls).toEqual([])
		})
	}

	it('a delete still works with predefinedId present, since the delete carries no payload', async () => {
		const { calls, methods } = makeHarness()

		await methods.chatModify({ addLabel: { id: 'lbl-1', predefinedId: 3, deleted: true } }, CHAT)

		expect(calls).toEqual([['deleteLabel', ['lbl-1']]])
	})
})

/**
 * The delegation tests above compare our calls against a fake, so on their own
 * they prove we call what this file says we call and nothing more. For the
 * label methods that is not enough: every parameter is a string, so a swapped
 * pair type checks, and a swap made in both the code and its test would agree
 * with itself.
 *
 * This reads the parameter names out of the bridge's own declarations, so the
 * assumed order is pinned to the package rather than to us. Together the two
 * halves mean something: we pass label first, and label is what the bridge
 * takes first.
 */
describe('the argument order these tests assume is the one the bridge declares', () => {
	const dts = readFileSync(
		path.resolve(
			import.meta.dirname,
			'../../node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge.d.ts'
		),
		'utf8'
	)

	const parameterNames = (method: string): string[] => {
		const declaration = new RegExp(`^\\s{4}${method}\\((.*?)\\):`, 'm').exec(dts)
		if (!declaration) throw new Error(`no declaration for ${method} in the bridge .d.ts`)
		return (
			declaration[1]!
				.split(/,(?![^<(]*[>)])/)
				.map(parameter => parameter.trim().split(':')[0]!.trim())
				// The whole point is the order, so an empty parameter list has to
				// come back empty rather than as ['']
				.filter(name => name.length > 0)
		)
	}

	for (const [method, expected] of [
		['addChatLabel', ['label_id', 'chat_jid']],
		['removeChatLabel', ['label_id', 'chat_jid']],
		['addMessageLabel', ['label_id', 'chat_jid', 'message_id']],
		['removeMessageLabel', ['label_id', 'chat_jid', 'message_id']],
		['createLabel', ['label_id', 'name', 'color']],
		['saveContact', ['jid', 'full_name', 'first_name', 'save_on_primary_addressbook']],
		['setQuickReply', ['id', 'shortcut', 'message', 'keywords', 'count']]
	] as const) {
		it(`${method} takes (${expected.join(', ')})`, () => {
			expect(parameterNames(method)).toEqual([...expected])
		})
	}
})

describe('chatModify: anything with no path rejects', () => {
	it('names the variant it could not run', async () => {
		const { calls, methods } = makeHarness()

		await expect(methods.chatModify({ notARealVariant: true } as unknown as ChatModification, CHAT)).rejects.toThrow(
			/unsupported modification 'notARealVariant'/
		)
		expect(calls).toEqual([])
	})

	it('an empty modification rejects rather than passing silently', async () => {
		const { methods } = makeHarness()

		await expect(methods.chatModify({} as ChatModification, CHAT)).rejects.toThrow(/unsupported modification/)
	})
})

describe('chatModify: the variants that already worked still do', () => {
	it('a contact with a value still saves, and carries every field', async () => {
		const { calls, methods } = makeHarness()

		await methods.chatModify(
			{ contact: { fullName: 'Ada Lovelace', firstName: 'Ada', saveOnPrimaryAddressbook: false } },
			CHAT
		)

		expect(calls).toEqual([['saveContact', [CHAT, 'Ada Lovelace', 'Ada', false]]])
	})

	it('star iterates every message, not just the first', async () => {
		const { calls, methods } = makeHarness()

		await methods.chatModify({ star: { messages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], star: true } }, CHAT)

		expect(calls).toEqual([
			['starMessage', [CHAT, 'A', true]],
			['starMessage', [CHAT, 'B', true]],
			['starMessage', [CHAT, 'C', true]]
		])
	})
})

/**
 * The ten public methods are sugar over `chatModify`, as they are upstream. The
 * risk they carry is their own argument order, which differs from the bridge's
 * in every label case.
 */
describe('the public methods reach the same bridge calls', () => {
	it('addChatLabel(jid, labelId) does not swap its arguments', async () => {
		const { calls, methods } = makeHarness()

		await methods.addChatLabel(CHAT, 'lbl-9')

		expect(calls).toEqual([['addChatLabel', ['lbl-9', CHAT]]])
	})

	it('removeChatLabel(jid, labelId) does not swap its arguments', async () => {
		const { calls, methods } = makeHarness()

		await methods.removeChatLabel(CHAT, 'lbl-9')

		expect(calls).toEqual([['removeChatLabel', ['lbl-9', CHAT]]])
	})

	it('addMessageLabel(jid, messageId, labelId) reorders to (labelId, jid, messageId)', async () => {
		const { calls, methods } = makeHarness()

		await methods.addMessageLabel(CHAT, 'MSG7', 'lbl-9')

		expect(calls).toEqual([['addMessageLabel', ['lbl-9', CHAT, 'MSG7']]])
	})

	it('removeMessageLabel(jid, messageId, labelId) reorders the same way', async () => {
		const { calls, methods } = makeHarness()

		await methods.removeMessageLabel(CHAT, 'MSG7', 'lbl-9')

		expect(calls).toEqual([['removeMessageLabel', ['lbl-9', CHAT, 'MSG7']]])
	})

	it('addLabel forwards the whole body', async () => {
		const { calls, methods } = makeHarness()

		await methods.addLabel(CHAT, { id: 'lbl-2', name: 'VIP', color: 7 })

		expect(calls).toEqual([['createLabel', ['lbl-2', 'VIP', 7]]])
	})

	it('addOrEditContact carries all three contact fields', async () => {
		const { calls, methods } = makeHarness()

		await methods.addOrEditContact(CHAT, {
			fullName: 'Grace Hopper',
			firstName: 'Grace',
			saveOnPrimaryAddressbook: true
		})

		expect(calls).toEqual([['saveContact', [CHAT, 'Grace Hopper', 'Grace', true]]])
	})

	it('removeContact takes the Remove path', async () => {
		const { calls, methods } = makeHarness()

		await methods.removeContact(CHAT)

		expect(calls).toEqual([['removeContact', [CHAT]]])
	})

	it('star forwards every message', async () => {
		const { calls, methods } = makeHarness()

		await methods.star(CHAT, [{ id: 'A' }, { id: 'B' }], false)

		expect(calls).toEqual([
			['starMessage', [CHAT, 'A', false]],
			['starMessage', [CHAT, 'B', false]]
		])
	})

	it('addOrEditQuickReply keys the upsert by the timestamp it was given', async () => {
		const { calls, methods } = makeHarness()

		await methods.addOrEditQuickReply({
			timestamp: '1699999999',
			shortcut: 'ty',
			message: 'Thank you',
			keywords: [],
			count: 2
		})

		expect(calls).toEqual([['setQuickReply', ['1699999999', 'ty', 'Thank you', [], 2]]])
	})

	it('removeQuickReply deletes by the same key', async () => {
		const { calls, methods } = makeHarness()

		await methods.removeQuickReply('1699999999')

		expect(calls).toEqual([['deleteQuickReply', ['1699999999']]])
	})
})

describe('chatModify does not swallow a bridge failure', () => {
	it('a rejecting bridge call surfaces to the caller', async () => {
		const client = {
			addChatLabel: async () => {
				throw new Error('invalid argument request: no app state sync key available')
			}
		} as unknown as WasmWhatsAppClient
		const ctx = {
			ev: new EventEmitter(),
			logger,
			withClient: async <T>(operation: (client: MockClient) => T | Promise<T>) =>
				operation((await client) as MockClient)
		} as unknown as SocketContext

		await expect(makeChatActionMethods(ctx).addChatLabel(CHAT, 'lbl-1')).rejects.toThrow(
			/no app state sync key available/
		)
	})
})
