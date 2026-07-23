import type { USyncQueryProtocol } from '../Types/USync.ts'
import type { BinaryNode } from '../Types/index.ts'
import { getBinaryNodeChild } from '../WABinary/generic-utils.ts'
import { USyncBotProfileProtocol } from './Protocols/USyncBotProfileProtocol.ts'
import { USyncLIDProtocol } from './Protocols/USyncLIDProtocol.ts'
import {
	USyncContactProtocol,
	USyncDeviceProtocol,
	USyncDisappearingModeProtocol,
	USyncStatusProtocol,
	USyncUsernameProtocol
} from './Protocols/index.ts'
import type { USyncUser } from './USyncUser.ts'

export type USyncQueryResultList = { [protocol: string]: unknown; id: string }
export type USyncQueryResult = { list: USyncQueryResultList[]; sideList: USyncQueryResultList[] }

export class USyncQuery {
	protocols: USyncQueryProtocol[]
	users: USyncUser[]
	context: string
	mode: string

	constructor() {
		this.protocols = []
		this.users = []
		this.context = 'interactive'
		this.mode = 'query'
	}

	withMode(mode: string) {
		this.mode = mode
		return this
	}
	withContext(context: string) {
		this.context = context
		return this
	}
	withUser(user: USyncUser) {
		this.users.push(user)
		return this
	}

	parseUSyncQueryResult(result: BinaryNode | undefined): USyncQueryResult | undefined {
		if (result?.attrs.type !== 'result') return
		const protocolMap = Object.fromEntries(this.protocols.map(protocol => [protocol.name, protocol.parser]))
		const queryResult: USyncQueryResult = { list: [], sideList: [] }
		const listNode = getBinaryNodeChild(getBinaryNodeChild(result, 'usync'), 'list')
		if (Array.isArray(listNode?.content)) {
			queryResult.list = listNode.content.reduce<USyncQueryResultList[]>((entries, node) => {
				const id = node.attrs.jid
				if (!id) return entries
				const data = Array.isArray(node.content)
					? Object.fromEntries(
							node.content
								.map(content => {
									const parser = protocolMap[content.tag]
									return [content.tag, parser ? parser(content) : null]
								})
								.filter(([, value]) => value !== null) as [string, unknown][]
						)
					: {}
				entries.push({ ...data, id })
				return entries
			}, [])
		}
		return queryResult
	}

	withDeviceProtocol() {
		this.protocols.push(new USyncDeviceProtocol())
		return this
	}
	withContactProtocol() {
		this.protocols.push(new USyncContactProtocol())
		return this
	}
	withStatusProtocol() {
		this.protocols.push(new USyncStatusProtocol())
		return this
	}
	withDisappearingModeProtocol() {
		this.protocols.push(new USyncDisappearingModeProtocol())
		return this
	}
	withBotProfileProtocol() {
		this.protocols.push(new USyncBotProfileProtocol())
		return this
	}
	withLIDProtocol() {
		this.protocols.push(new USyncLIDProtocol())
		return this
	}
	withUsernameProtocol() {
		this.protocols.push(new USyncUsernameProtocol())
		return this
	}
}
