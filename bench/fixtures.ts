import type { BinaryNode } from '../src/Types/index.ts'
import type { ILogger } from '../src/Utils/logger.ts'

export const silentLogger: ILogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

/** A deterministic mix of the JID shapes seen on the message pipeline. */
export const makeJids = (count: number): string[] => {
	const jids: string[] = []
	for (let i = 0; i < count; i++) {
		const user = String(5_511_900_000_000 + i * 7919)
		switch (i % 6) {
			case 0:
				jids.push(`${user}@s.whatsapp.net`)
				break
			case 1:
				jids.push(`${user}:${(i % 20) + 1}@s.whatsapp.net`)
				break
			case 2:
				jids.push(`${100_000_000_000_000 + i}@lid`)
				break
			case 3:
				jids.push(`${100_000_000_000_000 + i}:${i % 5}@lid`)
				break
			case 4:
				jids.push(`1203630${user}@g.us`)
				break
			default:
				jids.push(`${user}@c.us`)
		}
	}
	return jids
}

/** An IQ-style result node with a list of participants and properties. */
export const makeGroupNode = (participants: number): BinaryNode => ({
	tag: 'iq',
	attrs: { id: 'ABCD-1234', type: 'result', from: '120363040237990503@g.us' },
	content: [
		{
			tag: 'group',
			attrs: {
				id: '120363040237990503',
				subject: 'Benchmark group',
				creation: '1734000000',
				creator: '5511999990000@s.whatsapp.net'
			},
			content: [
				{ tag: 'description', attrs: { id: 'DESC1' }, content: [{ tag: 'body', attrs: {}, content: 'A group' }] },
				...Array.from({ length: participants }, (_, i) => ({
					tag: 'participant',
					attrs: {
						jid: `${100_000_000_000_000 + i}@lid`,
						phone_number: `${5_511_900_000_000 + i}@s.whatsapp.net`,
						...(i % 10 === 0 ? { type: 'admin' } : {})
					}
				}))
			]
		},
		{
			tag: 'props',
			attrs: {},
			content: Array.from({ length: 64 }, (_, i) => ({
				tag: 'prop',
				attrs:
					i % 2 === 0
						? { name: `prop_${i}`, value: String(i) }
						: ({ config_code: String(i), config_value: 'x' } as Record<string, string>)
			}))
		},
		{ tag: 'media', attrs: {}, content: new Uint8Array(256).map((_, i) => i) }
	]
})
