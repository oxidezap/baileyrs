import type { SocketContext } from '../Socket/types.ts'

interface ParticipatingRefreshMethods {
	groupFetchAllParticipating(): Promise<unknown>
	communityFetchAllParticipating(): Promise<unknown>
}

const GROUPS_DIRTY_TYPE = 'groups'
const COMMUNITIES_DIRTY_TYPE = 'communities'

/** Refresh the matching metadata collection when the server marks it dirty. */
export const makeParticipatingRefreshHandler =
	(ctx: SocketContext, methods: ParticipatingRefreshMethods): ((dirtyType: string) => void) =>
	dirtyType => {
		const refresh =
			dirtyType === GROUPS_DIRTY_TYPE
				? methods.groupFetchAllParticipating
				: dirtyType === COMMUNITIES_DIRTY_TYPE
					? methods.communityFetchAllParticipating
					: undefined

		if (refresh) {
			void refresh().catch(error =>
				ctx.logger.warn({ err: error, type: dirtyType }, 'participating metadata refresh failed')
			)
		}
	}
