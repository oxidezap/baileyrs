import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { getBinaryNodeChild, getBinaryNodeChildren, getBinaryNodeChildString } from '../../WABinary/generic-utils.ts'
import type { USyncUser } from '../USyncUser.ts'

type BotProfileCommand = { name: string; description: string }
type BotProfileInfo = {
	jid: string
	name: string
	attributes: string
	description: string
	category: string
	isDefault: boolean
	prompts: string[]
	personaId: string
	commands: BotProfileCommand[]
	commandsDescription: string
}

export class USyncBotProfileProtocol implements USyncQueryProtocol {
	name = 'bot'
	getQueryElement(): BinaryNode {
		return { tag: 'bot', attrs: {}, content: [{ tag: 'profile', attrs: { v: '1' } }] }
	}
	getUserElement(user: USyncUser): BinaryNode {
		return {
			tag: 'bot',
			attrs: {},
			content: [{ tag: 'profile', attrs: { persona_id: user.personaId! } }]
		}
	}
	parser(node: BinaryNode): BotProfileInfo {
		const profile = getBinaryNodeChild(getBinaryNodeChild(node, 'bot'), 'profile')
		const commandsNode = getBinaryNodeChild(profile, 'commands')
		const promptsNode = getBinaryNodeChild(profile, 'prompts')
		const commands = getBinaryNodeChildren(commandsNode, 'command').map(command => ({
			name: getBinaryNodeChildString(command, 'name')!,
			description: getBinaryNodeChildString(command, 'description')!
		}))
		const prompts = getBinaryNodeChildren(promptsNode, 'prompt').map(
			prompt => `${getBinaryNodeChildString(prompt, 'emoji')!} ${getBinaryNodeChildString(prompt, 'text')!}`
		)
		return {
			isDefault: !!getBinaryNodeChild(profile, 'default'),
			jid: node.attrs.jid!,
			name: getBinaryNodeChildString(profile, 'name')!,
			attributes: getBinaryNodeChildString(profile, 'attributes')!,
			description: getBinaryNodeChildString(profile, 'description')!,
			category: getBinaryNodeChildString(profile, 'category')!,
			personaId: profile!.attrs.persona_id!,
			commandsDescription: getBinaryNodeChildString(commandsNode, 'description')!,
			commands,
			prompts
		}
	}
}
