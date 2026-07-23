/**
 * Nominal enum declarations for the public compatibility surface.
 *
 * Runtime modules expose frozen, Node-executable objects with these shapes.
 * Keeping the declarations here gives those objects the same nominal member
 * identity as the corresponding public enum contracts without requiring
 * transform-only TypeScript syntax at runtime.
 */

export declare enum RetryReason {
	UnknownError = 0,
	SignalErrorNoSession = 1,
	SignalErrorInvalidKey = 2,
	SignalErrorInvalidKeyId = 3,
	SignalErrorInvalidMessage = 4,
	SignalErrorInvalidSignature = 5,
	SignalErrorFutureMessage = 6,
	SignalErrorBadMac = 7,
	SignalErrorInvalidSession = 8,
	SignalErrorInvalidMsgKey = 9,
	BadBroadcastEphemeralSetting = 10,
	UnknownCompanionNoPrekey = 11,
	AdvFailure = 12,
	StatusRevokeDelay = 13
}

export declare enum LabelColor {
	Color1 = 0,
	Color2 = 1,
	Color3 = 2,
	Color4 = 3,
	Color5 = 4,
	Color6 = 5,
	Color7 = 6,
	Color8 = 7,
	Color9 = 8,
	Color10 = 9,
	Color11 = 10,
	Color12 = 11,
	Color13 = 12,
	Color14 = 13,
	Color15 = 14,
	Color16 = 15,
	Color17 = 16,
	Color18 = 17,
	Color19 = 18,
	Color20 = 19
}

export declare enum LabelAssociationType {
	Chat = 'label_jid',
	Message = 'label_message'
}

export declare enum WAMessageAddressingMode {
	PN = 'pn',
	LID = 'lid'
}

export declare enum XWAPaths {
	xwa2_newsletter_create = 'xwa2_newsletter_create',
	xwa2_newsletter_subscribers = 'xwa2_newsletter_subscribers',
	xwa2_newsletter_view = 'xwa2_newsletter_view',
	xwa2_newsletter_metadata = 'xwa2_newsletter',
	xwa2_newsletter_admin_count = 'xwa2_newsletter_admin',
	xwa2_newsletter_mute_v2 = 'xwa2_newsletter_mute_v2',
	xwa2_newsletter_unmute_v2 = 'xwa2_newsletter_unmute_v2',
	xwa2_newsletter_follow = 'xwa2_newsletter_follow',
	xwa2_newsletter_unfollow = 'xwa2_newsletter_unfollow',
	xwa2_newsletter_join_v2 = 'xwa2_newsletter_join_v2',
	xwa2_newsletter_leave_v2 = 'xwa2_newsletter_leave_v2',
	xwa2_newsletter_change_owner = 'xwa2_newsletter_change_owner',
	xwa2_newsletter_demote = 'xwa2_newsletter_demote',
	xwa2_newsletter_delete_v2 = 'xwa2_newsletter_delete_v2',
	xwa2_fetch_account_reachout_timelock = 'xwa2_fetch_account_reachout_timelock',
	xwa2_message_capping_info = 'xwa2_message_capping_info'
}

export declare enum QueryIds {
	CREATE = '8823471724422422',
	UPDATE_METADATA = '24250201037901610',
	METADATA = '6563316087068696',
	SUBSCRIBERS = '9783111038412085',
	FOLLOW = '24404358912487870',
	UNFOLLOW = '9767147403369991',
	MUTE = '29766401636284406',
	UNMUTE = '9864994326891137',
	ADMIN_COUNT = '7130823597031706',
	CHANGE_OWNER = '7341777602580933',
	DEMOTE = '6551828931592903',
	DELETE = '30062808666639665',
	REACHOUT_TIMELOCK = '23983697327930364',
	MESSAGE_CAPPING_INFO = '24503548349331633'
}

export declare enum ReachoutTimelockEnforcementType {
	BIZ_COMMERCE_VIOLATION_ALCOHOL = 'BIZ_COMMERCE_VIOLATION_ALCOHOL',
	BIZ_COMMERCE_VIOLATION_ADULT = 'BIZ_COMMERCE_VIOLATION_ADULT',
	BIZ_COMMERCE_VIOLATION_ANIMALS = 'BIZ_COMMERCE_VIOLATION_ANIMALS',
	BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS = 'BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS',
	BIZ_COMMERCE_VIOLATION_DATING = 'BIZ_COMMERCE_VIOLATION_DATING',
	BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS = 'BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS',
	BIZ_COMMERCE_VIOLATION_DRUGS = 'BIZ_COMMERCE_VIOLATION_DRUGS',
	BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC = 'BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC',
	BIZ_COMMERCE_VIOLATION_GAMBLING = 'BIZ_COMMERCE_VIOLATION_GAMBLING',
	BIZ_COMMERCE_VIOLATION_HEALTHCARE = 'BIZ_COMMERCE_VIOLATION_HEALTHCARE',
	BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY = 'BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY',
	BIZ_COMMERCE_VIOLATION_SUPPLEMENTS = 'BIZ_COMMERCE_VIOLATION_SUPPLEMENTS',
	BIZ_COMMERCE_VIOLATION_TOBACCO = 'BIZ_COMMERCE_VIOLATION_TOBACCO',
	BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT = 'BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT',
	BIZ_COMMERCE_VIOLATION_WEAPONS = 'BIZ_COMMERCE_VIOLATION_WEAPONS',
	BIZ_QUALITY = 'BIZ_QUALITY',
	DEFAULT = 'DEFAULT',
	WEB_COMPANION_ONLY = 'WEB_COMPANION_ONLY'
}

export declare enum SyncState {
	Connecting = 0,
	AwaitingInitialSync = 1,
	Syncing = 2,
	Online = 3
}

export declare enum NewChatMessageCappingStatusType {
	NONE = 'NONE',
	FIRST_WARNING = 'FIRST_WARNING',
	SECOND_WARNING = 'SECOND_WARNING',
	CAPPED = 'CAPPED'
}

export declare enum NewChatMessageCappingMVStatusType {
	NOT_ELIGIBLE = 'NOT_ELIGIBLE',
	NOT_ACTIVE = 'NOT_ACTIVE',
	ACTIVE = 'ACTIVE',
	ACTIVE_UPGRADE_AVAILABLE = 'ACTIVE_UPGRADE_AVAILABLE'
}

export declare enum NewChatMessageCappingOTEStatusType {
	NOT_ELIGIBLE = 'NOT_ELIGIBLE',
	ELIGIBLE = 'ELIGIBLE',
	ACTIVE_IN_CURRENT_CYCLE = 'ACTIVE_IN_CURRENT_CYCLE',
	EXHAUSTED = 'EXHAUSTED'
}

// `connectionLost` and `timedOut` intentionally share the same status code.
/* eslint-disable typescript-eslint/no-duplicate-enum-values */
export declare enum DisconnectReason {
	connectionClosed = 428,
	connectionLost = 408,
	connectionReplaced = 440,
	timedOut = 408,
	loggedOut = 401,
	badSession = 500,
	restartRequired = 515,
	multideviceMismatch = 411,
	forbidden = 403,
	unavailableService = 503
}
/* eslint-enable typescript-eslint/no-duplicate-enum-values */

export declare enum CompanionWebClientType {
	UNKNOWN = 0,
	CHROME = 1,
	EDGE = 2,
	FIREFOX = 3,
	IE = 4,
	OPERA = 5,
	SAFARI = 6,
	ELECTRON = 7,
	UWP = 8,
	OTHER_WEB_CLIENT = 9
}

export declare enum WAJIDDomains {
	WHATSAPP = 0,
	LID = 1,
	HOSTED = 128,
	HOSTED_LID = 129
}
