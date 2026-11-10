import type { BinaryNode } from '../../Types/index.ts'
import { getBinaryNodeChild } from '../../WABinary/generic-utils.ts'
import { areJidsSameUser, jidDecode } from '../../WABinary/jid-utils.ts'
import { isStringNullOrEmpty } from '../../Utils/generics.ts'
import type { ILogger } from '../../Utils/logger.ts'

export type IdentityChangeResult =
	| { action: 'no_identity_node' }
	| { action: 'invalid_notification' }
	| { action: 'skipped_companion_device'; device: number }
	| { action: 'skipped_self_primary' }
	| { action: 'debounced' }
	| { action: 'skipped_offline' }
	| { action: 'skipped_no_session' }
	| { action: 'session_refreshed' }
	| { action: 'session_refresh_failed'; error: unknown }

/** Minimal cache contract consumed by the standalone identity helper. */
export type IdentityChangeDebounceCache = {
	get(key: string | number): boolean | undefined
	set(key: string | number, value: boolean, ttl?: number | string): unknown
}

export type IdentityChangeContext = {
	meId: string | undefined
	meLid: string | undefined
	validateSession: (jid: string) => Promise<{ exists: boolean; reason?: string }>
	assertSessions: (jids: string[], force?: boolean) => Promise<boolean>
	debounceCache: IdentityChangeDebounceCache
	logger: ILogger
	onBeforeSessionRefresh?: (jid: string) => void
}

export async function handleIdentityChange(
	node: BinaryNode,
	ctx: IdentityChangeContext
): Promise<IdentityChangeResult> {
	const from = node.attrs.from
	if (!from) return { action: 'invalid_notification' }
	if (!getBinaryNodeChild(node, 'identity')) return { action: 'no_identity_node' }

	ctx.logger.info({ jid: from }, 'identity changed')
	const decoded = jidDecode(from)
	if (decoded?.device && decoded.device !== 0) {
		ctx.logger.debug({ jid: from, device: decoded.device }, 'ignoring identity change from companion device')
		return { action: 'skipped_companion_device', device: decoded.device }
	}

	if (ctx.meId && (areJidsSameUser(from, ctx.meId) || (ctx.meLid && areJidsSameUser(from, ctx.meLid)))) {
		ctx.logger.info({ jid: from }, 'self primary identity changed')
		return { action: 'skipped_self_primary' }
	}
	if (ctx.debounceCache.get(from)) return { action: 'debounced' }
	ctx.debounceCache.set(from, true)

	const session = await ctx.validateSession(from)
	if (!session.exists) return { action: 'skipped_no_session' }
	if (!isStringNullOrEmpty(node.attrs.offline)) return { action: 'skipped_offline' }
	ctx.onBeforeSessionRefresh?.(from)
	try {
		await ctx.assertSessions([from], true)
		return { action: 'session_refreshed' }
	} catch (error) {
		ctx.logger.warn({ error, jid: from }, 'failed to assert sessions after identity change')
		return { action: 'session_refresh_failed', error }
	}
}
