import {
	type makeEventBuffer as upstreamMakeEventBuffer,
	type makeWASocket as upstreamMakeWASocket,
	type handleIdentityChange as upstreamHandleIdentityChange,
	type proto as upstreamProto,
	type BaileysEventEmitter as UpstreamEventEmitter,
	type BaileysEventMap as UpstreamEventMap,
	type AlbumMessageOptions as UpstreamAlbumMessageOptions,
	type CatalogCollection as UpstreamCatalogCollection,
	type GroupMetadata as UpstreamGroupMetadata,
	type GroupParticipant as UpstreamGroupParticipant,
	type IdentityChangeContext as UpstreamIdentityChangeContext,
	type MediaDecryptionKeyInfo as UpstreamMediaDecryptionKeyInfo,
	type PossiblyExtendedCacheStore as UpstreamPossiblyExtendedCacheStore,
	type Product as UpstreamProduct,
	type SignalRepository as UpstreamSignalRepository,
	type SocketConfig as UpstreamSocketConfig,
	type WAMediaUploadFunction as UpstreamWAMediaUploadFunction,
	type WAMessage as UpstreamWAMessage
} from 'baileys'
import {
	type makeWASocket as localMakeWASocket,
	type handleIdentityChange as localHandleIdentityChange,
	type proto as localProto,
	type BaileysEventMap as LocalEventMap,
	type BaileysEventEmitter as LocalEventEmitter,
	type AlbumMessageOptions as LocalAlbumMessageOptions,
	type CatalogCollection as LocalCatalogCollection,
	type GroupMetadata as LocalGroupMetadata,
	type GroupParticipant as LocalGroupParticipant,
	type IdentityChangeContext as LocalIdentityChangeContext,
	type MediaDecryptionKeyInfo as LocalMediaDecryptionKeyInfo,
	type PossiblyExtendedCacheStore as LocalPossiblyExtendedCacheStore,
	type Product as LocalProduct,
	type SignalRepository as LocalSignalRepository,
	type SocketConfig as LocalSocketConfig,
	type WAMediaUploadFunction as LocalWAMediaUploadFunction,
	type WAMessage as LocalWAMessage
} from '../../lib/index.js'
import type { makeEventBuffer as localMakeEventBuffer } from '../../lib/Utils/event-buffer.js'

type Assert<T extends true> = T
type Assignable<From, To> = [From] extends [To] ? true : false
type Exact<Left, Right> =
	Assignable<Left, Right> extends true ? (Assignable<Right, Left> extends true ? true : false) : false

// Core group contracts used by metadata caches and permission systems.
type GroupParticipantExact = Assert<Exact<LocalGroupParticipant, UpstreamGroupParticipant>>
type GroupMetadataLocalToUpstream = Assert<Assignable<LocalGroupMetadata, UpstreamGroupMetadata>>
type GroupMetadataUpstreamToLocal = Assert<Assignable<UpstreamGroupMetadata, LocalGroupMetadata>>

// The generated declaration facade must be the upstream WAProto contract even
// though runtime codec execution remains backed by whatsapp-rust-bridge.
type ProtoNamespaceExact = Assert<Exact<typeof localProto, typeof upstreamProto>>
type WAMessageExact = Assert<Exact<LocalWAMessage, UpstreamWAMessage>>

// Wire schemas intentionally model presence, not every contextual invariant.
// A raw payment request may omit its receiver in both public proto surfaces.
// Without outer receiver metadata, however, a group-payment request needs a
// non-null receiver for the captured client parser. This refinement models
// only that receiver invariant; it does not claim that every payment field is
// valid. Keep it development-only so relayMessage retains the exact upstream
// signature, while schema renames/nullability drift fail this typecheck.
type RequirePresent<T, Keys extends keyof T> = Omit<T, Keys> & {
	[Key in Keys]-?: Exclude<T[Key], null | undefined>
}
type IsOptional<T, Key extends keyof T> = {} extends Pick<T, Key> ? true : false
type LocalRawPaymentRequest = localProto.Message.IRequestPaymentMessage
type UpstreamRawPaymentRequest = upstreamProto.Message.IRequestPaymentMessage
type RawPaymentRequestExact = Assert<Exact<LocalRawPaymentRequest, UpstreamRawPaymentRequest>>
type RawPaymentReceiverOptionalExact = Assert<
	Exact<IsOptional<LocalRawPaymentRequest, 'requestFrom'>, IsOptional<UpstreamRawPaymentRequest, 'requestFrom'>>
>
type RawPaymentReceiverRemainsOptional = Assert<IsOptional<LocalRawPaymentRequest, 'requestFrom'>>
type LocalGroupPaymentRequestWithReceiver = RequirePresent<LocalRawPaymentRequest, 'requestFrom'>
type UpstreamGroupPaymentRequestWithReceiver = RequirePresent<UpstreamRawPaymentRequest, 'requestFrom'>
type GroupPaymentRequestWithReceiverExact = Assert<
	Exact<LocalGroupPaymentRequestWithReceiver, UpstreamGroupPaymentRequestWithReceiver>
>
type GroupPaymentReceiverRequired = Assert<
	IsOptional<LocalGroupPaymentRequestWithReceiver, 'requestFrom'> extends false ? true : false
>
type GroupPaymentReceiverType = Assert<Exact<LocalGroupPaymentRequestWithReceiver['requestFrom'], string>>

// Public type-only contracts should remain exact even when their behavior is
// implemented by a different runtime layer.
type AlbumMessageOptionsExact = Assert<Exact<LocalAlbumMessageOptions, UpstreamAlbumMessageOptions>>
type CatalogCollectionExact = Assert<Exact<LocalCatalogCollection, UpstreamCatalogCollection>>
type ProductExact = Assert<Exact<LocalProduct, UpstreamProduct>>
type MediaDecryptionKeyInfoExact = Assert<Exact<LocalMediaDecryptionKeyInfo, UpstreamMediaDecryptionKeyInfo>>
type PossiblyExtendedCacheStoreExact = Assert<
	Exact<LocalPossiblyExtendedCacheStore, UpstreamPossiblyExtendedCacheStore>
>
type SignalRepositoryExact = Assert<Exact<LocalSignalRepository, UpstreamSignalRepository>>
type LocalSignalRepositoryWithLIDStore = ReturnType<LocalSocketConfig['makeSignalRepository']>
type UpstreamSignalRepositoryWithLIDStore = ReturnType<UpstreamSocketConfig['makeSignalRepository']>
type LocalPublicLIDMappingStore = Pick<
	LocalSignalRepositoryWithLIDStore['lidMapping'],
	keyof LocalSignalRepositoryWithLIDStore['lidMapping']
>
type UpstreamPublicLIDMappingStore = Pick<
	UpstreamSignalRepositoryWithLIDStore['lidMapping'],
	keyof UpstreamSignalRepositoryWithLIDStore['lidMapping']
>
type MakeSignalRepositoryParametersExact = Assert<
	Exact<Parameters<LocalSocketConfig['makeSignalRepository']>, Parameters<UpstreamSocketConfig['makeSignalRepository']>>
>
type MakeSignalRepositoryPublicReturnExact = Assert<
	Exact<
		Omit<LocalSignalRepositoryWithLIDStore, 'lidMapping'> & { lidMapping: LocalPublicLIDMappingStore },
		Omit<UpstreamSignalRepositoryWithLIDStore, 'lidMapping'> & { lidMapping: UpstreamPublicLIDMappingStore }
	>
>
type WAMediaUploadFunctionExact = Assert<Exact<LocalWAMediaUploadFunction, UpstreamWAMediaUploadFunction>>

// The local identity helper intentionally accepts the narrow cache behavior it
// consumes instead of naming a concrete cache package. Existing upstream
// contexts remain accepted, and the local handler remains substitutable where
// the upstream handler type is expected.
type IdentityChangeContextUpstreamToLocal = Assert<
	Assignable<UpstreamIdentityChangeContext, LocalIdentityChangeContext>
>
type IdentityChangeHandlerLocalToUpstream = Assert<
	Assignable<typeof localHandleIdentityChange, typeof upstreamHandleIdentityChange>
>

// Event payloads touched by the compatibility translation layer.
type GroupParticipantsEventExact = Assert<
	Exact<LocalEventMap['group-participants.update'], UpstreamEventMap['group-participants.update']>
>
type GroupsUpsertEventExact = Assert<Exact<LocalEventMap['groups.upsert'], UpstreamEventMap['groups.upsert']>>
type GroupsUpdateEventExact = Assert<Exact<LocalEventMap['groups.update'], UpstreamEventMap['groups.update']>>
type JoinRequestEventExact = Assert<Exact<LocalEventMap['group.join-request'], UpstreamEventMap['group.join-request']>>

// The base emitter and the richer buffer return contract must remain usable in
// both directions. This catches accidental additions to the base interface as
// well as missing buffer lifecycle methods.
type EventNamesExact = Assert<Exact<keyof LocalEventMap, keyof UpstreamEventMap>>
type EventMapExact = Assert<Exact<LocalEventMap, UpstreamEventMap>>
type EventEmitterMethodsExact = Assert<Exact<keyof LocalEventEmitter, keyof UpstreamEventEmitter>>
type BufferLifecycleMethods = 'buffer' | 'createBufferedFunction' | 'destroy' | 'flush' | 'isBuffering'
type EventBufferLifecycleExact = Assert<
	Exact<
		Pick<ReturnType<typeof localMakeEventBuffer>, BufferLifecycleMethods>,
		Pick<ReturnType<typeof upstreamMakeEventBuffer>, BufferLifecycleMethods>
	>
>

type LocalSocket = ReturnType<typeof localMakeWASocket>
type UpstreamSocket = ReturnType<typeof upstreamMakeWASocket>
type RelayMessageResultExact = Assert<
	Exact<ReturnType<LocalSocket['relayMessage']>, ReturnType<UpstreamSocket['relayMessage']>>
>
type RelayMessageOptionsExact = Assert<
	Exact<Parameters<LocalSocket['relayMessage']>[2], Parameters<UpstreamSocket['relayMessage']>[2]>
>
type RelayMessageOptionsRequired = Assert<undefined extends Parameters<LocalSocket['relayMessage']>[2] ? false : true>
type StableGroupMethods =
	| 'groupMetadata'
	| 'groupCreate'
	| 'groupLeave'
	| 'groupUpdateSubject'
	| 'groupUpdateDescription'
	| 'groupFetchAllParticipating'
type StableLocalSocket = Pick<LocalSocket, StableGroupMethods>
type StableUpstreamSocket = Pick<UpstreamSocket, StableGroupMethods>
type StableSocketLocalToUpstream = Assert<Assignable<StableLocalSocket, StableUpstreamSocket>>
type StableSocketUpstreamToLocal = Assert<Assignable<StableUpstreamSocket, StableLocalSocket>>

type HighValueSocketMethods =
	| 'fetchBlocklist'
	| 'fetchMessageHistory'
	| 'getBusinessProfile'
	| 'digestKeyBundle'
	| 'groupLeave'
	| 'groupToggleEphemeral'
	| 'onWhatsApp'
	| 'presenceSubscribe'
	| 'requestPlaceholderResend'
	| 'rotateSignedPreKey'
	| 'sendPresenceUpdate'
	| 'uploadPreKeys'
	| 'uploadPreKeysToServerIfRequired'
type HighValueSocketMethodsExact = Assert<
	Exact<Pick<LocalSocket, HighValueSocketMethods>, Pick<UpstreamSocket, HighValueSocketMethods>>
>

type GroupCompatibilityMethods =
	| 'groupAcceptInvite'
	| 'groupAcceptInviteV4'
	| 'groupCreate'
	| 'groupFetchAllParticipating'
	| 'groupGetInviteInfo'
	| 'groupInviteCode'
	| 'groupJoinApprovalMode'
	| 'groupLeave'
	| 'groupMemberAddMode'
	| 'groupMetadata'
	| 'groupParticipantsUpdate'
	| 'groupRequestParticipantsList'
	| 'groupRequestParticipantsUpdate'
	| 'groupRevokeInvite'
	| 'groupRevokeInviteV4'
	| 'groupSettingUpdate'
	| 'groupToggleEphemeral'
	| 'groupUpdateDescription'
	| 'groupUpdateSubject'
type GroupCompatibilityMethodsExact = Assert<
	Exact<Pick<LocalSocket, GroupCompatibilityMethods>, Pick<UpstreamSocket, GroupCompatibilityMethods>>
>

type CommunityCompatibilityMethods =
	| 'communityAcceptInvite'
	| 'communityAcceptInviteV4'
	| 'communityCreate'
	| 'communityCreateGroup'
	| 'communityFetchAllParticipating'
	| 'communityFetchLinkedGroups'
	| 'communityGetInviteInfo'
	| 'communityInviteCode'
	| 'communityJoinApprovalMode'
	| 'communityLeave'
	| 'communityLinkGroup'
	| 'communityMemberAddMode'
	| 'communityMetadata'
	| 'communityParticipantsUpdate'
	| 'communityRequestParticipantsList'
	| 'communityRequestParticipantsUpdate'
	| 'communityRevokeInvite'
	| 'communityRevokeInviteV4'
	| 'communitySettingUpdate'
	| 'communityToggleEphemeral'
	| 'communityUnlinkGroup'
	| 'communityUpdateDescription'
	| 'communityUpdateSubject'
type CommunityCompatibilityMethodsExact = Assert<
	Exact<Pick<LocalSocket, CommunityCompatibilityMethods>, Pick<UpstreamSocket, CommunityCompatibilityMethods>>
>

type USyncCompatibilityMethods = 'executeUSyncQuery' | 'fetchDisappearingDuration' | 'fetchStatus'
type USyncCompatibilityMethodsExact = Assert<
	Exact<Pick<LocalSocket, USyncCompatibilityMethods>, Pick<UpstreamSocket, USyncCompatibilityMethods>>
>

type SocketBoundaryCompatibilityMethods =
	| 'profilePictureUrl'
	| 'readMessages'
	| 'removeProfilePicture'
	| 'sendMessageAck'
	| 'sendRetryRequest'
	| 'updateMemberLabel'
	| 'updateProfilePicture'
	| 'waitForMessage'
type SocketBoundaryCompatibilityMethodsExact = Assert<
	Exact<Pick<LocalSocket, SocketBoundaryCompatibilityMethods>, Pick<UpstreamSocket, SocketBoundaryCompatibilityMethods>>
>

// Keep the aliases referenced so no-unused type analysis can prove every
// assertion was instantiated.
export type CompatibilityTypeAssertions = [
	GroupParticipantExact,
	GroupMetadataLocalToUpstream,
	GroupMetadataUpstreamToLocal,
	ProtoNamespaceExact,
	WAMessageExact,
	RawPaymentRequestExact,
	RawPaymentReceiverOptionalExact,
	RawPaymentReceiverRemainsOptional,
	GroupPaymentRequestWithReceiverExact,
	GroupPaymentReceiverRequired,
	GroupPaymentReceiverType,
	AlbumMessageOptionsExact,
	CatalogCollectionExact,
	ProductExact,
	MediaDecryptionKeyInfoExact,
	PossiblyExtendedCacheStoreExact,
	SignalRepositoryExact,
	MakeSignalRepositoryParametersExact,
	MakeSignalRepositoryPublicReturnExact,
	WAMediaUploadFunctionExact,
	IdentityChangeContextUpstreamToLocal,
	IdentityChangeHandlerLocalToUpstream,
	GroupParticipantsEventExact,
	GroupsUpsertEventExact,
	GroupsUpdateEventExact,
	JoinRequestEventExact,
	EventNamesExact,
	EventMapExact,
	EventEmitterMethodsExact,
	EventBufferLifecycleExact,
	RelayMessageResultExact,
	RelayMessageOptionsExact,
	RelayMessageOptionsRequired,
	StableSocketLocalToUpstream,
	StableSocketUpstreamToLocal,
	HighValueSocketMethodsExact,
	GroupCompatibilityMethodsExact,
	CommunityCompatibilityMethodsExact,
	USyncCompatibilityMethodsExact,
	SocketBoundaryCompatibilityMethodsExact
]
