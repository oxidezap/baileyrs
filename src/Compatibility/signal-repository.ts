import type { WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import type { LIDMapping, SignalAuthState, SignalRepositoryWithLIDStore } from '../Types/index.ts'
import type { ILogger } from '../Utils/logger.ts'
import {
	isHostedLidUser,
	isHostedPnUser,
	isLidUser,
	isPnUser,
	jidDecode,
	jidEncode,
	WAJIDDomains
} from '../WABinary/index.ts'
import type { SocketContext } from '../Socket/types.ts'

type SignalRepositoryContext = Pick<SocketContext, 'logger' | 'withClient'>

const nativeContexts = new WeakMap<SignalAuthState, SignalRepositoryContext>()

const isPnNamespace = (jid: string | undefined) => isPnUser(jid) || isHostedPnUser(jid)
const isLidNamespace = (jid: string | undefined) => isLidUser(jid) || isHostedLidUser(jid)

const lidForPnDevice = (pn: string, lid: string): string | null => {
	const source = jidDecode(pn)
	const target = jidDecode(lid)
	if (!source || !target) return null
	return jidEncode(target.user, isHostedPnUser(pn) ? 'hosted.lid' : 'lid', source.device)
}

const pnForLidDevice = (lid: string, pn: string): string | null => {
	const source = jidDecode(lid)
	const target = jidDecode(pn)
	if (!source || !target) return null
	return jidEncode(target.user, isHostedLidUser(lid) ? 'hosted' : 's.whatsapp.net', source.device)
}

export const jidToSignalProtocolAddressCompat = (jid: string): string => {
	const decoded = jidDecode(jid)
	if (!decoded?.user) {
		throw new Error(`JID decoded but user is empty: "${jid}"`)
	}

	const { user, device, server, domainType } = decoded
	if (device === 99 && server !== 'hosted' && server !== 'hosted.lid') {
		throw new Error('Unexpected non-hosted device JID with device 99. This ID seems invalid. ID:' + jid)
	}

	const signalUser = domainType !== WAJIDDomains.WHATSAPP ? `${user}_${domainType}` : user
	return `${signalUser}.${device || 0}`
}

export const bindSignalRepositoryContext = (auth: SignalAuthState, ctx: SignalRepositoryContext) => {
	nativeContexts.set(auth, ctx)
}

/** Default public factory; the socket binds its native context before invoking it. */
export const makeDefaultSignalRepository = (
	auth: SignalAuthState,
	logger: ILogger,
	_pnToLIDFunc?: (jids: string[]) => Promise<LIDMapping[] | undefined>
): SignalRepositoryWithLIDStore =>
	makeSignalRepository({
		logger,
		withClient: operation => {
			const ctx = nativeContexts.get(auth)
			if (!ctx) {
				return Promise.reject(
					new Error('Signal repository is not bound to an active socket; pass it through SocketConfig')
				)
			}
			return ctx.withClient(operation)
		}
	})

const resolveMappings = async (
	client: WasmWhatsAppClient,
	inputs: string[],
	direction: 'pn-to-lid' | 'lid-to-pn',
	ctx: Pick<SocketContext, 'logger'>
): Promise<LIDMapping[] | null> => {
	if (inputs.length === 0) return null
	const unique = [...new Set(inputs)].filter(jid =>
		direction === 'pn-to-lid' ? isPnNamespace(jid) : isLidNamespace(jid)
	)
	const settled = await Promise.allSettled(
		unique.map(async input => {
			if (direction === 'pn-to-lid') {
				const resolved = await client.lidForPn(input)
				const lid = resolved ? lidForPnDevice(input, resolved) : null
				return lid ? ({ pn: input, lid } satisfies LIDMapping) : null
			}

			const resolved = await client.pnForLid(input)
			const pn = resolved ? pnForLidDevice(input, resolved) : null
			return pn ? ({ pn, lid: input } satisfies LIDMapping) : null
		})
	)
	const mappings: LIDMapping[] = []
	for (const result of settled) {
		if (result.status === 'fulfilled') {
			if (result.value) mappings.push(result.value)
		} else {
			ctx.logger.debug({ err: result.reason, direction }, 'LID-PN lookup rejected — skipping')
		}
	}
	return mappings.length ? mappings : null
}

/** Translate the neutral bridge Signal surface into the public repository contract. */
export const makeSignalRepository = (ctx: SignalRepositoryContext): SignalRepositoryWithLIDStore => {
	return {
		decryptMessage: async opts =>
			ctx.withClient(client => client.signalDecryptMessage(opts.jid, opts.type, opts.ciphertext)),
		encryptMessage: async opts => ctx.withClient(client => client.signalEncryptMessage(opts.jid, opts.data)),
		decryptGroupMessage: async opts =>
			ctx.withClient(client => client.signalDecryptGroupMessage(opts.group, opts.authorJid, opts.msg)),
		encryptGroupMessage: async opts =>
			ctx.withClient(client => client.signalEncryptGroupMessage(opts.group, opts.data, opts.meId)),
		processSenderKeyDistributionMessage: async ({ item, authorJid }) => {
			if (!item.groupId) {
				throw new Error('Group ID is required for sender key distribution message')
			}
			const distribution = item.axolotlSenderKeyDistributionMessage
			if (!distribution) {
				throw new Error('Sender key distribution payload is required')
			}
			await ctx.withClient(client => client.signalProcessSenderKeyDistribution(item.groupId!, authorJid, distribution))
		},
		getSenderKeyDistributionMessage: async ({ group, meId }) =>
			ctx.withClient(client => client.signalGetSenderKeyDistribution(group, meId)),
		hasSenderKey: async ({ group, meId }) => ctx.withClient(client => client.signalHasSenderKey(group, meId)),
		getSessionInfo: async jid => (await ctx.withClient(client => client.signalGetSessionInfo(jid))) ?? null,
		injectE2ESession: async ({ jid, session }) => {
			await ctx.withClient(client => client.signalInstallPreKeyBundle(jid, session))
		},
		validateSession: async jid => ({ exists: await ctx.withClient(client => client.signalValidateSession(jid)) }),
		jidToSignalProtocolAddress: jidToSignalProtocolAddressCompat,
		migrateSession: async (fromJid, toJid) => {
			if (!fromJid || !isLidNamespace(toJid)) return { migrated: 0, skipped: 0, total: 0 }
			if (!isPnNamespace(fromJid)) return { migrated: 0, skipped: 0, total: 1 }
			return ctx.withClient(client => client.signalMigrateSessions(fromJid, toJid))
		},
		deleteSession: async jids => {
			if (jids.length) await ctx.withClient(client => client.signalDeleteSessions(jids))
		},
		lidMapping: {
			storeLIDPNMappings: async pairs => {
				const valid = pairs.filter(({ lid, pn }) => {
					const accepted = isLidNamespace(lid) && isPnNamespace(pn)
					if (!accepted) ctx.logger.warn(`Invalid LID-PN mapping: ${lid}, ${pn}`)
					return accepted
				})
				if (valid.length) await ctx.withClient(client => client.addLidPnMappings(valid))
			},
			getLIDForPN: async pn => {
				return ctx.withClient(async client => {
					return (await resolveMappings(client, [pn], 'pn-to-lid', ctx))?.[0]?.lid ?? null
				})
			},
			getLIDsForPNs: async pns => ctx.withClient(client => resolveMappings(client, pns, 'pn-to-lid', ctx)),
			getPNForLID: async lid => {
				return ctx.withClient(async client => {
					return (await resolveMappings(client, [lid], 'lid-to-pn', ctx))?.[0]?.pn ?? null
				})
			},
			getPNsForLIDs: async lids => ctx.withClient(client => resolveMappings(client, lids, 'lid-to-pn', ctx)),
			close: () => undefined
		},
		close: () => undefined
	}
}
