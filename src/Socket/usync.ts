import {
	executeRawUSyncQuery,
	fromTypedUSyncResponse,
	toTypedUSyncQuery,
	type RawUSyncQuery,
	type TypedUSyncQuery
} from '../Compatibility/usync/adapter.ts'
import { Boom } from '../Utils/boom.ts'
import { USyncQuery, type USyncQueryResult, type USyncQueryResultList } from '../WAUSync/USyncQuery.ts'
import { USyncUser } from '../WAUSync/USyncUser.ts'

export interface USyncTransport {
	queryNode: RawUSyncQuery
	queryUsync: TypedUSyncQuery
}

export const makeUSyncMethods = ({ queryNode, queryUsync }: USyncTransport) => {
	const executeUSyncQuery = async (usyncQuery: USyncQuery): Promise<USyncQueryResult | undefined> => {
		if (usyncQuery.protocols.length === 0) {
			throw new Boom('USyncQuery must have at least one protocol')
		}

		const typedQuery = toTypedUSyncQuery(usyncQuery)
		if (!typedQuery) return executeRawUSyncQuery(usyncQuery, queryNode)
		return fromTypedUSyncResponse(usyncQuery, await queryUsync(typedQuery))
	}

	const fetchProtocol = async (
		jids: string[],
		withProtocol: (query: USyncQuery) => USyncQuery
	): Promise<USyncQueryResultList[] | undefined> => {
		const usyncQuery = withProtocol(new USyncQuery())
		for (const jid of jids) usyncQuery.withUser(new USyncUser().withId(jid))
		return (await executeUSyncQuery(usyncQuery))?.list
	}

	return {
		executeUSyncQuery,
		fetchStatus: (...jids: string[]): Promise<USyncQueryResultList[] | undefined> =>
			fetchProtocol(jids, protocolQuery => protocolQuery.withStatusProtocol()),
		fetchDisappearingDuration: (...jids: string[]): Promise<USyncQueryResultList[] | undefined> =>
			fetchProtocol(jids, protocolQuery => protocolQuery.withDisappearingModeProtocol())
	}
}
