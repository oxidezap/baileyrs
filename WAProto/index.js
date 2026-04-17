/**
 * WAProto shim — routes protobuf encode/decode through whatsapp-rust-bridge.
 *
 * Decode: The bridge's CamelSerializer outputs camelCase keys, Uint8Array for bytes,
 *         and skips proto default values. No JS post-processing needed.
 * Encode: JS converts camelCase→snake_case and base64→Uint8Array before passing to bridge.
 *
 * Namespace strategy:
 * - Top-level classes (Message, WebMessageInfo, ...) have full encode/decode.
 * - Nested types that are serialized standalone (PollVoteMessage, ...) also have encode/decode.
 * - Nested types that only ride inside a parent message use `passthrough()` —
 *   `.create()` / `.fromObject()` just return the input.
 * - `Message` and `ContextInfo` are wrapped in a Proxy so any capitalized sub-property
 *   bots access (e.g. `Message.InteractiveMessage.fromObject(...)`) is lazily
 *   synthesized as a passthrough, preventing runtime TypeError on bot code that
 *   TypeScript happily compiled against the auto-generated `.d.ts`.
 * - Enums must be populated explicitly (Proxy can't know their numeric values).
 *   See the "Enums" section below.
 *
 * TODO: Replace this manually-maintained shim with a runtime module auto-generated
 * by whatsapp-rust-bridge alongside the existing `.d.ts` emission.
 *   Why: eliminates the single source-of-truth drift between what `.d.ts` declares
 *   (1,352 types) and what this file populates (~90), so every proto type bots
 *   consume from the bridge schema works at runtime without manual backfill.
 */

import { encodeProto, decodeProto } from 'whatsapp-rust-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProtoClass(typeName) {
  return {
    encode(obj) {
      return {
        finish() {
          return encodeProto(typeName, obj);
        },
      };
    },
    decode(buffer) {
      const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const decoded = decodeProto(typeName, data);
      if (decoded && typeof decoded === 'object') {
        decoded.toJSON = function () { return this; };
      }
      return decoded;
    },
    create(obj) { return obj || {}; },
    fromObject(obj) {
      if (obj && typeof obj === 'object') {
        obj.toJSON = function() { return this; };
      }
      return obj;
    },
    toObject(obj) { return obj; },
  };
}

const passthrough = () => ({
  create(obj) { return obj || {}; },
  fromObject(obj) { return obj; },
});

/**
 * Wrap a namespace so unknown capitalized sub-properties synthesize a passthrough.
 * Lets bot code like `proto.Message.InteractiveMessage.fromObject({...})` work
 * without us manually declaring every message type.
 */
function wrapNamespace(target) {
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t || typeof prop !== 'string') return t[prop];
      if (/^[A-Z]/.test(prop)) {
        t[prop] = passthrough();
        return t[prop];
      }
      return undefined;
    },
  });
}

// ---------------------------------------------------------------------------
// Top-level proto classes
// ---------------------------------------------------------------------------

const ADVDeviceIdentity = createProtoClass('AdvDeviceIdentity');
const ADVSignedDeviceIdentity = createProtoClass('AdvSignedDeviceIdentity');
const ADVSignedDeviceIdentityHMAC = createProtoClass('AdvSignedDeviceIdentityHmac');
const ADVSignedKeyIndexList = createProtoClass('AdvSignedKeyIndexList');
const ADVKeyIndexList = ADVSignedKeyIndexList; // historical alias (both names used by consumers)
const CertChain = createProtoClass('CertChain');
const ClientPayload = createProtoClass('ClientPayload');
const DeviceProps = createProtoClass('DeviceProps');
const ExternalBlobReference = createProtoClass('ExternalBlobReference');
const HandshakeMessage = createProtoClass('HandshakeMessage');
const HistorySync = createProtoClass('HistorySync');
const LIDMigrationMappingSyncPayload = createProtoClass('LidMigrationMappingSyncPayload');
const MediaRetryNotification = createProtoClass('MediaRetryNotification');
const Message = createProtoClass('Message');
const SenderKeyDistributionMessage = createProtoClass('SenderKeyDistributionMessage');
const SenderKeyMessage = createProtoClass('SenderKeyMessage');
const ServerErrorReceipt = createProtoClass('ServerErrorReceipt');
const SyncActionData = createProtoClass('SyncActionData');
const SyncdMutations = createProtoClass('SyncdMutations');
const SyncdPatch = createProtoClass('SyncdPatch');
const SyncdSnapshot = createProtoClass('SyncdSnapshot');
const VerifiedNameCertificate = createProtoClass('VerifiedNameCertificate');
const WebMessageInfo = createProtoClass('WebMessageInfo');
const SyncdMutation = createProtoClass('SyncdMutation');
const SyncdRecord = createProtoClass('SyncdRecord');
const SyncActionValue = createProtoClass('SyncActionValue');
const ExitCode = createProtoClass('ExitCode');

// Top-level types commonly accessed by Baileys-compatible bots (passthrough — no standalone encoding)
const HydratedTemplateButton = passthrough();
const HydratedFourRowTemplate = passthrough();
const TemplateButton = passthrough();

// ---------------------------------------------------------------------------
// Nested types with encode/decode (serialized standalone)
// ---------------------------------------------------------------------------

CertChain.NoiseCertificate = createProtoClass('CertChain.NoiseCertificate');
CertChain.NoiseCertificate.Details = createProtoClass('CertChain.NoiseCertificate.Details');
Message.PollVoteMessage = createProtoClass('Message.PollVoteMessage');
Message.EventResponseMessage = createProtoClass('Message.EventResponseMessage');
VerifiedNameCertificate.Details = createProtoClass('VerifiedNameCertificate.Details');

// ---------------------------------------------------------------------------
// OneOf variants and nested holders — passthrough
// (Previously pointed to parent typename, which was misleading; these never
//  encode/decode standalone, they ride inside their parent.)
// ---------------------------------------------------------------------------

HandshakeMessage.ClientHello = passthrough();
HandshakeMessage.ServerHello = passthrough();
HandshakeMessage.ClientFinish = passthrough();
DeviceProps.AppVersion = passthrough();
DeviceProps.HistorySyncConfig = passthrough();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const ADVEncryptionType = { E2EE: 0, HOSTED: 1 };

// --- ClientPayload ---
ClientPayload.ConnectReason = { PUSH: 0, USER_ACTIVATED: 1, SCHEDULED: 2, ERROR_RECONNECT: 3, NETWORK_SWITCH: 4, PING_RECONNECT: 5, UNKNOWN: 6 };
ClientPayload.ConnectType = { CELLULAR_UNKNOWN: 0, WIFI_UNKNOWN: 1, CELLULAR_EDGE: 100, CELLULAR_IDEN: 101, CELLULAR_UMTS: 102, CELLULAR_EVDO: 103, CELLULAR_GPRS: 104, CELLULAR_HSDPA: 105, CELLULAR_HSUPA: 106, CELLULAR_HSPA: 107, CELLULAR_CDMA: 108, CELLULAR_1XRTT: 109, CELLULAR_EHRPD: 110, CELLULAR_LTE: 111, CELLULAR_HSPAP: 112 };
ClientPayload.AccountType = { DEFAULT: 0, GUEST: 1 };
ClientPayload.IOSAppExtension = { SHARE_EXTENSION: 0, SERVICE_EXTENSION: 1, INTENTS_EXTENSION: 2 };
ClientPayload.Product = { WHATSAPP: 0, MESSENGER: 1, INTEROP: 2, INTEROP_MSGR: 3, WHATSAPP_LID: 4 };
ClientPayload.TrafficAnonymization = { OFF: 0, STANDARD: 1 };
ClientPayload.UserAgent = {
  Platform: { ANDROID: 0, IOS: 1, WINDOWS_PHONE: 2, BLACKBERRY: 3, BLACKBERRYX: 4, S40: 5, S60: 6, PYTHON_CLIENT: 7, TIZEN: 8, ENTERPRISE: 9, SMB_ANDROID: 10, KAIOS: 11, SMB_IOS: 12, WINDOWS: 13, WEB: 14, PORTAL: 15, GREEN_ANDROID: 16, GREEN_IPHONE: 17, BLUE_ANDROID: 18, BLUE_IPHONE: 19, FBLITE_ANDROID: 20, MLITE_ANDROID: 21, IGLITE_ANDROID: 22, PAGE: 23, MACOS: 24, OCULUS_MSG: 25, OCULUS_CALL: 26, MILAN: 27, CAPI: 28, WEAROS: 29, ARDEVICE: 30, VRDEVICE: 31, BLUE_WEB: 32, IPAD: 33, TEST: 34, SMART_GLASSES: 35, BLUE_VR: 36, AR_WRIST: 37 },
  ReleaseChannel: { RELEASE: 0, BETA: 1, ALPHA: 2, DEBUG: 3 },
  DeviceType: { PHONE: 0, TABLET: 1, DESKTOP: 2, WEARABLE: 3, VR: 4 },
};
ClientPayload.WebInfo = { WebSubPlatform: { WEB_BROWSER: 0, APP_STORE: 1, WIN_STORE: 2, DARWIN: 3, WIN32: 4, WIN_HYBRID: 5 } };
ClientPayload.DNSSource = { DNSResolutionMethod: { SYSTEM: 0, GOOGLE: 1, HARDCODED: 2, OVERRIDE: 3, FALLBACK: 4, MNS: 5 } };

// --- DeviceProps ---
DeviceProps.PlatformType = { UNKNOWN: 0, CHROME: 1, FIREFOX: 2, IE: 3, OPERA: 4, SAFARI: 5, EDGE: 6, DESKTOP: 7, IPAD: 8, ANDROID_TABLET: 9, OHANA: 10, ALOHA: 11, CATALINA: 12, TCL_TV: 13, IOS_PHONE: 14, IOS_CATALYST: 15, ANDROID_PHONE: 16, ANDROID_AMBIGUOUS: 17, WEAR_OS: 18, AR_WRIST: 19, AR_DEVICE: 20, UWP: 21, VR: 22, CLOUD_API: 23, SMARTGLASSES: 24 };

// --- HistorySync ---
HistorySync.HistorySyncType = { INITIAL_BOOTSTRAP: 0, INITIAL_STATUS_V3: 1, FULL: 2, RECENT: 3, PUSH_NAME: 4, NON_BLOCKING_DATA: 5, ON_DEMAND: 6 };
HistorySync.BotAIWaitListState = { IN_WAITLIST: 0, AI_AVAILABLE: 1 };

// --- MediaRetryNotification ---
MediaRetryNotification.ResultType = { GENERAL_ERROR: 0, SUCCESS: 1, NOT_FOUND: 2, DECRYPTION_ERROR: 3 };

// --- Message enums (attached directly; Proxy covers the rest) ---
Message.ButtonsResponseMessage = { Type: { UNKNOWN: 0, DISPLAY_TEXT: 1 } };
Message.ButtonsMessage = { HeaderType: { UNKNOWN: 0, EMPTY: 1, TEXT: 2, DOCUMENT: 3, IMAGE: 4, VIDEO: 5, LOCATION: 6 } };
Message.ListMessage = { ListType: { UNKNOWN: 0, SINGLE_SELECT: 1, PRODUCT_LIST: 2 } };
Message.ListResponseMessage = { ListType: { UNKNOWN: 0, SINGLE_SELECT: 1 } };
Message.OrderMessage = {
  OrderStatus: { INQUIRY: 1, ACCEPTED: 2, DECLINED: 3 },
  OrderSurface: { CATALOG: 1 },
};
Message.InvoiceMessage = { AttachmentType: { IMAGE: 0, PDF: 1 } };
Message.PinInChatMessage = { Type: { UNKNOWN_TYPE: 0, PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } };
Message.PeerDataOperationRequestType = { UPLOAD_STICKER: 0, SEND_RECENT_STICKER_BOOTSTRAP: 1, GENERATE_LINK_PREVIEW: 2, HISTORY_SYNC_ON_DEMAND: 3, PLACEHOLDER_MESSAGE_RESEND: 4, WAFFLE_LINKING_NONCE_FETCH: 5, FULL_HISTORY_SYNC_ON_DEMAND: 6, COMPANION_META_NONCE_FETCH: 7, COMPANION_SYNCD_SNAPSHOT_FATAL_RECOVERY: 8, COMPANION_CANONICAL_USER_NONCE_FETCH: 9, HISTORY_SYNC_CHUNK_RETRY: 10, GALAXY_FLOW_ACTION: 11 };
Message.ProtocolMessage = { Type: { REVOKE: 0, EPHEMERAL_SETTING: 3, EPHEMERAL_SYNC_RESPONSE: 4, HISTORY_SYNC_NOTIFICATION: 5, APP_STATE_SYNC_KEY_SHARE: 6, APP_STATE_SYNC_KEY_REQUEST: 7, MSG_FANOUT_BACKFILL_REQUEST: 8, INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC: 9, APP_STATE_FATAL_EXCEPTION_NOTIFICATION: 10, SHARE_PHONE_NUMBER: 11, MESSAGE_EDIT: 14, PEER_DATA_OPERATION_REQUEST_MESSAGE: 16, PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE: 17, REQUEST_WELCOME_MESSAGE: 18, BOT_FEEDBACK_MESSAGE: 19, MEDIA_NOTIFY_MESSAGE: 20, CLOUD_API_THREAD_CONTROL_NOTIFICATION: 21, LID_MIGRATION_MAPPING_SYNC: 22, REMINDER_MESSAGE: 23, BOT_MEMU_ONBOARDING_MESSAGE: 24, STATUS_MENTION_MESSAGE: 25, STOP_GENERATION_MESSAGE: 26, LIMIT_SHARING: 27, AI_PSI_METADATA: 28, AI_QUERY_FANOUT: 29, GROUP_MEMBER_LABEL_CHANGE: 30 } };
Message.HistorySyncType = { INITIAL_BOOTSTRAP: 0, INITIAL_STATUS_V3: 1, FULL: 2, RECENT: 3, PUSH_NAME: 4, NON_BLOCKING_DATA: 5, ON_DEMAND: 6, NO_HISTORY: 7, MESSAGE_ACCESS_STATUS: 8 };
Message.EventResponseMessage.EventResponseType = { UNKNOWN: 0, GOING: 1, NOT_GOING: 2, MAYBE: 3 };
Message.MediaKeyDomain = { UNSET: 0, E2EE_CHAT: 1, STATUS: 2, CAPI: 3, BOT: 4 };
Message.PollContentType = { UNKNOWN: 0, TEXT: 1, IMAGE: 2 };
Message.PollType = { POLL: 0, QUIZ: 1 };

SyncdMutation.SyncdOperation = { SET: 0, REMOVE: 1 };

// --- WebMessageInfo ---
WebMessageInfo.Status = { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 };
WebMessageInfo.BizPrivacyStatus = { E2EE: 0, FB: 2, BSP: 1, BSP_AND_FB: 3 };
WebMessageInfo.StubType = { UNKNOWN: 0, REVOKE: 1, CIPHERTEXT: 2, FUTUREPROOF: 3, NON_VERIFIED_TRANSITION: 4, UNVERIFIED_TRANSITION: 5, VERIFIED_TRANSITION: 6, VERIFIED_LOW_UNKNOWN: 7, VERIFIED_HIGH: 8, VERIFIED_INITIAL_UNKNOWN: 9, VERIFIED_INITIAL_LOW: 10, VERIFIED_INITIAL_HIGH: 11, VERIFIED_TRANSITION_ANY_TO_NONE: 12, VERIFIED_TRANSITION_ANY_TO_HIGH: 13, VERIFIED_TRANSITION_HIGH_TO_LOW: 14, VERIFIED_TRANSITION_HIGH_TO_UNKNOWN: 15, VERIFIED_TRANSITION_UNKNOWN_TO_LOW: 16, VERIFIED_TRANSITION_LOW_TO_UNKNOWN: 17, VERIFIED_TRANSITION_NONE_TO_LOW: 18, VERIFIED_TRANSITION_NONE_TO_UNKNOWN: 19, GROUP_CREATE: 20, GROUP_CHANGE_SUBJECT: 21, GROUP_CHANGE_ICON: 22, GROUP_CHANGE_INVITE_LINK: 23, GROUP_CHANGE_DESCRIPTION: 24, GROUP_CHANGE_RESTRICT: 25, GROUP_CHANGE_ANNOUNCE: 26, GROUP_PARTICIPANT_ADD: 27, GROUP_PARTICIPANT_REMOVE: 28, GROUP_PARTICIPANT_PROMOTE: 29, GROUP_PARTICIPANT_DEMOTE: 30, GROUP_PARTICIPANT_INVITE: 31, GROUP_PARTICIPANT_LEAVE: 32, GROUP_PARTICIPANT_CHANGE_NUMBER: 33, BROADCAST_CREATE: 34, BROADCAST_ADD: 35, BROADCAST_REMOVE: 36, GENERIC_NOTIFICATION: 37, E2E_IDENTITY_CHANGED: 38, E2E_ENCRYPTED: 39, CALL_MISSED_VOICE: 40, CALL_MISSED_VIDEO: 41, INDIVIDUAL_CHANGE_NUMBER: 42, GROUP_DELETE: 43, GROUP_ANNOUNCE_MODE_MESSAGE_BOUNCE: 44, CALL_MISSED_GROUP_VOICE: 45, CALL_MISSED_GROUP_VIDEO: 46, PAYMENT_CIPHERTEXT: 47, PAYMENT_FUTUREPROOF: 48, PAYMENT_TRANSACTION_STATUS_UPDATE_FAILED: 49, PAYMENT_TRANSACTION_STATUS_UPDATE_REFUNDED: 50, PAYMENT_TRANSACTION_STATUS_UPDATE_REFUND_FAILED: 51, PAYMENT_TRANSACTION_STATUS_RECEIVER_PENDING_SETUP: 52, PAYMENT_TRANSACTION_STATUS_RECEIVER_SUCCESS_AFTER_HICCUP: 53, PAYMENT_ACTION_ACCOUNT_SETUP_REMINDER: 54, PAYMENT_ACTION_SEND_PAYMENT_REMINDER: 55, PAYMENT_ACTION_SEND_PAYMENT_INVITATION: 56, PAYMENT_ACTION_REQUEST_DECLINED: 57, PAYMENT_ACTION_REQUEST_EXPIRED: 58, PAYMENT_ACTION_REQUEST_CANCELLED: 59, BIZ_VERIFIED_TRANSITION_TOP_TO_BOTTOM: 60, BIZ_VERIFIED_TRANSITION_BOTTOM_TO_TOP: 61, BIZ_INTRO_TOP: 62, BIZ_INTRO_BOTTOM: 63, BIZ_NAME_CHANGE: 64, BIZ_MOVE_TO_CONSUMER_APP: 65, BIZ_TWO_TIER_MIGRATION_TOP: 66, BIZ_TWO_TIER_MIGRATION_BOTTOM: 67, OVERSIZED: 68, GROUP_CHANGE_NO_FREQUENTLY_FORWARDED: 69, GROUP_V4_ADD_INVITE_SENT: 70, GROUP_PARTICIPANT_ADD_REQUEST_JOIN: 71, CHANGE_EPHEMERAL_SETTING: 72, E2E_DEVICE_CHANGED: 73, VIEWED_ONCE: 74, E2E_ENCRYPTED_NOW: 75, BLUE_MSG_BSP_FB_TO_BSP_PREMISE: 76, BLUE_MSG_BSP_FB_TO_SELF_FB: 77, BLUE_MSG_BSP_FB_TO_SELF_PREMISE: 78, BLUE_MSG_BSP_FB_UNVERIFIED: 79, BLUE_MSG_BSP_FB_UNVERIFIED_TO_SELF_PREMISE_VERIFIED: 80, BLUE_MSG_BSP_FB_VERIFIED: 81, BLUE_MSG_BSP_FB_VERIFIED_TO_SELF_PREMISE_UNVERIFIED: 82, BLUE_MSG_BSP_PREMISE_TO_SELF_PREMISE: 83, BLUE_MSG_BSP_PREMISE_UNVERIFIED: 84, BLUE_MSG_BSP_PREMISE_UNVERIFIED_TO_SELF_PREMISE_VERIFIED: 85, BLUE_MSG_BSP_PREMISE_VERIFIED: 86, BLUE_MSG_BSP_PREMISE_VERIFIED_TO_SELF_PREMISE_UNVERIFIED: 87, BLUE_MSG_CONSUMER_TO_BSP_FB_UNVERIFIED: 88, BLUE_MSG_CONSUMER_TO_BSP_PREMISE_UNVERIFIED: 89, BLUE_MSG_CONSUMER_TO_SELF_FB_UNVERIFIED: 90, BLUE_MSG_CONSUMER_TO_SELF_PREMISE_UNVERIFIED: 91, BLUE_MSG_SELF_FB_TO_BSP_PREMISE: 92, BLUE_MSG_SELF_FB_TO_SELF_PREMISE: 93, BLUE_MSG_SELF_FB_UNVERIFIED: 94, BLUE_MSG_SELF_FB_UNVERIFIED_TO_SELF_PREMISE_VERIFIED: 95, BLUE_MSG_SELF_FB_VERIFIED: 96, BLUE_MSG_SELF_FB_VERIFIED_TO_SELF_PREMISE_UNVERIFIED: 97, BLUE_MSG_SELF_PREMISE_TO_BSP_PREMISE: 98, BLUE_MSG_SELF_PREMISE_UNVERIFIED: 99, BLUE_MSG_SELF_PREMISE_VERIFIED: 100, BLUE_MSG_TO_BSP_FB: 101, BLUE_MSG_TO_CONSUMER: 102, BLUE_MSG_TO_SELF_FB: 103, BLUE_MSG_UNVERIFIED_TO_BSP_FB_VERIFIED: 104, BLUE_MSG_UNVERIFIED_TO_BSP_PREMISE_VERIFIED: 105, BLUE_MSG_UNVERIFIED_TO_SELF_FB_VERIFIED: 106, BLUE_MSG_UNVERIFIED_TO_VERIFIED: 107, BLUE_MSG_VERIFIED_TO_BSP_FB_UNVERIFIED: 108, BLUE_MSG_VERIFIED_TO_BSP_PREMISE_UNVERIFIED: 109, BLUE_MSG_VERIFIED_TO_SELF_FB_UNVERIFIED: 110, BLUE_MSG_VERIFIED_TO_UNVERIFIED: 111, BLUE_MSG_BSP_FB_UNVERIFIED_TO_BSP_PREMISE_VERIFIED: 112, BLUE_MSG_BSP_FB_UNVERIFIED_TO_SELF_FB_VERIFIED: 113, BLUE_MSG_BSP_FB_VERIFIED_TO_BSP_PREMISE_UNVERIFIED: 114, BLUE_MSG_BSP_FB_VERIFIED_TO_SELF_FB_UNVERIFIED: 115, BLUE_MSG_SELF_FB_UNVERIFIED_TO_BSP_PREMISE_VERIFIED: 116, BLUE_MSG_SELF_FB_VERIFIED_TO_BSP_PREMISE_UNVERIFIED: 117, E2E_IDENTITY_UNAVAILABLE: 118, GROUP_CREATING: 119, GROUP_CREATE_FAILED: 120, GROUP_BOUNCED: 121, BLOCK_CONTACT: 122, EPHEMERAL_SETTING_NOT_APPLIED: 123, SYNC_FAILED: 124, SYNCING: 125, BIZ_PRIVACY_MODE_INIT_FB: 126, BIZ_PRIVACY_MODE_INIT_BSP: 127, BIZ_PRIVACY_MODE_TO_FB: 128, BIZ_PRIVACY_MODE_TO_BSP: 129, DISAPPEARING_MODE: 130, E2E_DEVICE_FETCH_FAILED: 131, ADMIN_REVOKE: 132, GROUP_INVITE_LINK_GROWTH_LOCKED: 133, COMMUNITY_LINK_PARENT_GROUP: 134, COMMUNITY_LINK_SIBLING_GROUP: 135, COMMUNITY_UNLINK_PARENT_GROUP: 137, COMMUNITY_UNLINK_SIBLING_GROUP: 138, COMMUNITY_UNLINK_SUB_GROUP: 139, GROUP_PARTICIPANT_ACCEPT: 140, GROUP_PARTICIPANT_LINKED_GROUP_JOIN: 141, COMMUNITY_CREATE: 142, EPHEMERAL_KEEP_IN_CHAT: 143, GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST: 144, GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE: 145, INTEGRITY_UNLINK_PARENT_GROUP: 146, COMMUNITY_PARTICIPANT_PROMOTE: 147, COMMUNITY_PARTICIPANT_DEMOTE: 148, COMMUNITY_PARENT_GROUP_DELETED: 149, COMMUNITY_LINK_PARENT_GROUP_MEMBERSHIP_APPROVAL: 150, GROUP_PARTICIPANT_JOINED_GROUP_AND_PARENT_GROUP: 151, MASKED_THREAD_CREATED: 152, MASKED_THREAD_UNMASKED: 153, BIZ_CHAT_ASSIGNMENT: 154, CHAT_PSA: 155, CHAT_POLL_CREATION_MESSAGE: 156, CAG_MASKED_THREAD_CREATED: 157, COMMUNITY_PARENT_GROUP_SUBJECT_CHANGED: 158, CAG_INVITE_AUTO_ADD: 159, BIZ_CHAT_ASSIGNMENT_UNASSIGN: 160, CAG_INVITE_AUTO_JOINED: 161, SCHEDULED_CALL_START_MESSAGE: 162, COMMUNITY_INVITE_RICH: 163, COMMUNITY_INVITE_AUTO_ADD_RICH: 164, SUB_GROUP_INVITE_RICH: 165, SUB_GROUP_PARTICIPANT_ADD_RICH: 166, COMMUNITY_LINK_PARENT_GROUP_RICH: 167, COMMUNITY_PARTICIPANT_ADD_RICH: 168, SILENCED_UNKNOWN_CALLER_AUDIO: 169, SILENCED_UNKNOWN_CALLER_VIDEO: 170, GROUP_MEMBER_ADD_MODE: 171, GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD: 172, COMMUNITY_CHANGE_DESCRIPTION: 173, SENDER_INVITE: 174, RECEIVER_INVITE: 175, COMMUNITY_ALLOW_MEMBER_ADDED_GROUPS: 176, PINNED_MESSAGE_IN_CHAT: 177, PAYMENT_INVITE_SETUP_INVITER: 178, PAYMENT_INVITE_SETUP_INVITEE_RECEIVE_ONLY: 179, PAYMENT_INVITE_SETUP_INVITEE_SEND_AND_RECEIVE: 180, LINKED_GROUP_CALL_START: 181, REPORT_TO_ADMIN_ENABLED_STATUS: 182, EMPTY_SUBGROUP_CREATE: 183, SCHEDULED_CALL_CANCEL: 184, SUBGROUP_ADMIN_TRIGGERED_AUTO_ADD_RICH: 185, GROUP_CHANGE_RECENT_HISTORY_SHARING: 186, PAID_MESSAGE_SERVER_CAMPAIGN_ID: 187, GENERAL_CHAT_CREATE: 188, GENERAL_CHAT_ADD: 189, GENERAL_CHAT_AUTO_ADD_DISABLED: 190, SUGGESTED_SUBGROUP_ANNOUNCE: 191, BIZ_BOT_1P_MESSAGING_ENABLED: 192, CHANGE_USERNAME: 193, BIZ_COEX_PRIVACY_INIT_SELF: 194, BIZ_COEX_PRIVACY_TRANSITION_SELF: 195, SUPPORT_AI_EDUCATION: 196, BIZ_BOT_3P_MESSAGING_ENABLED: 197, REMINDER_SETUP_MESSAGE: 198, REMINDER_SENT_MESSAGE: 199, REMINDER_CANCEL_MESSAGE: 200, BIZ_COEX_PRIVACY_INIT: 201, BIZ_COEX_PRIVACY_TRANSITION: 202, GROUP_DEACTIVATED: 203, COMMUNITY_DEACTIVATE_SIBLING_GROUP: 204, EVENT_UPDATED: 205, EVENT_CANCELED: 206, COMMUNITY_OWNER_UPDATED: 207, COMMUNITY_SUB_GROUP_VISIBILITY_HIDDEN: 208, CAPI_GROUP_NE2EE_SYSTEM_MESSAGE: 209, STATUS_MENTION: 210, USER_CONTROLS_SYSTEM_MESSAGE: 211, SUPPORT_SYSTEM_MESSAGE: 212, CHANGE_LID: 213, BIZ_CUSTOMER_3PD_DATA_SHARING_OPT_IN_MESSAGE: 214, BIZ_CUSTOMER_3PD_DATA_SHARING_OPT_OUT_MESSAGE: 215, CHANGE_LIMIT_SHARING: 216, GROUP_MEMBER_LINK_MODE: 217, BIZ_AUTOMATICALLY_LABELED_CHAT_SYSTEM_MESSAGE: 218, PHONE_NUMBER_HIDING_CHAT_DEPRECATED_MESSAGE: 219, QUARANTINED_MESSAGE: 220, GROUP_MEMBER_SHARE_GROUP_HISTORY_MODE: 221 };

// --- Top-level holders + enums (not attached to a class above) ---
const PinInChat = { Type: { UNKNOWN_TYPE: 0, PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } };
SyncActionValue.NotificationActivitySettingAction = { NotificationActivitySetting: { DEFAULT_ALL_MESSAGES: 0, ALL_MESSAGES: 1, HIGHLIGHTS: 2, DEFAULT_HIGHLIGHTS: 3 } };
const DisappearingMode = {
  Initiator: { CHANGED_IN_CHAT: 0, INITIATED_BY_ME: 1, INITIATED_BY_OTHER: 2, BIZ_UPGRADE_FB_HOSTING: 3 },
  Trigger: { UNKNOWN: 0, CHAT_SETTING: 1, ACCOUNT_SETTING: 2, BULK_CHANGE: 3, BIZ_SUPPORTS_FB_HOSTING: 4, UNKNOWN_GROUPS: 5 },
};
const GroupParticipant = { Rank: { REGULAR: 0, ADMIN: 1, SUPERADMIN: 2 } };
const Conversation = { EndOfHistoryTransferType: { COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY: 0, COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY: 1, COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY: 2 } };
const KeepType = { UNKNOWN: 0, KEEP_FOR_ALL: 1, UNDO_KEEP_FOR_ALL: 2 };
const MediaVisibility = { DEFAULT: 0, OFF: 1, ON: 2 };

// ---------------------------------------------------------------------------
// ContextInfo — populated with bot-accessed enums, then wrapped in Proxy
// ---------------------------------------------------------------------------

const ContextInfoBase = {
  ExternalAdReplyInfo: {
    MediaType: { NONE: 0, IMAGE: 1, VIDEO: 2 },
    AdType: { CTWA: 0, CAWC: 1 },
    ContentType: { UPDATE: 1, UPDATE_CARD: 2, LINK_CARD: 3 },
  },
  AdReplyInfo: {
    MediaType: { NONE: 0, IMAGE: 1, VIDEO: 2 },
  },
};
const ContextInfo = wrapNamespace(ContextInfoBase);

// ---------------------------------------------------------------------------
// Wrap Message in Proxy (after all explicit attachments are done)
// ---------------------------------------------------------------------------

const MessageNamespace = wrapNamespace(Message);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const proto = {
  ADVDeviceIdentity, ADVKeyIndexList, ADVSignedDeviceIdentity, ADVSignedDeviceIdentityHMAC,
  ADVSignedKeyIndexList, ADVEncryptionType, CertChain, ClientPayload, Conversation,
  DeviceProps, DisappearingMode, ExternalBlobReference, GroupParticipant, HandshakeMessage,
  HistorySync, HydratedTemplateButton, HydratedFourRowTemplate, KeepType,
  LIDMigrationMappingSyncPayload, MediaRetryNotification, MediaVisibility,
  Message: MessageNamespace,
  PinInChat, SenderKeyDistributionMessage, SenderKeyMessage, ServerErrorReceipt,
  SyncActionData, SyncActionValue, SyncdMutation, SyncdMutations, SyncdPatch, SyncdRecord,
  SyncdSnapshot, TemplateButton, VerifiedNameCertificate, WebMessageInfo,
  ContextInfo,
  ExitCode,
};

export { proto as WAProto };
export default proto;
