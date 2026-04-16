type Long = number;
declare namespace $protobuf {
    interface Writer { finish(): Uint8Array; }
    type Reader = Uint8Array;
    interface IConversionOptions { [key: string]: any; }
}

export namespace proto {

    enum AdvEncryptionType {
        E2EE = 0,
        HOSTED = 1,
    }

    enum AiRichResponseMessageType {
        AI_RICH_RESPONSE_TYPE_UNKNOWN = 0,
        AI_RICH_RESPONSE_TYPE_STANDARD = 1,
    }

    enum AiRichResponseSubMessageType {
        AI_RICH_RESPONSE_UNKNOWN = 0,
        AI_RICH_RESPONSE_GRID_IMAGE = 1,
        AI_RICH_RESPONSE_TEXT = 2,
        AI_RICH_RESPONSE_INLINE_IMAGE = 3,
        AI_RICH_RESPONSE_TABLE = 4,
        AI_RICH_RESPONSE_CODE = 5,
        AI_RICH_RESPONSE_DYNAMIC = 6,
        AI_RICH_RESPONSE_MAP = 7,
        AI_RICH_RESPONSE_LATEX = 8,
        AI_RICH_RESPONSE_CONTENT_ITEMS = 9,
    }

    enum BotMetricsEntryPoint {
        UNDEFINED_ENTRY_POINT = 0,
        FAVICON = 1,
        CHATLIST = 2,
        AISEARCH_NULL_STATE_PAPER_PLANE = 3,
        AISEARCH_NULL_STATE_SUGGESTION = 4,
        AISEARCH_TYPE_AHEAD_SUGGESTION = 5,
        AISEARCH_TYPE_AHEAD_PAPER_PLANE = 6,
        AISEARCH_TYPE_AHEAD_RESULT_CHATLIST = 7,
        AISEARCH_TYPE_AHEAD_RESULT_MESSAGES = 8,
        AIVOICE_SEARCH_BAR = 9,
        AIVOICE_FAVICON = 10,
        AISTUDIO = 11,
        DEEPLINK = 12,
        NOTIFICATION = 13,
        PROFILE_MESSAGE_BUTTON = 14,
        FORWARD = 15,
        APP_SHORTCUT = 16,
        FF_FAMILY = 17,
        AI_TAB = 18,
        AI_HOME = 19,
        AI_DEEPLINK_IMMERSIVE = 20,
        AI_DEEPLINK = 21,
        META_AI_CHAT_SHORTCUT_AI_STUDIO = 22,
        UGC_CHAT_SHORTCUT_AI_STUDIO = 23,
        NEW_CHAT_AI_STUDIO = 24,
        AIVOICE_FAVICON_CALL_HISTORY = 25,
        ASK_META_AI_CONTEXT_MENU = 26,
        ASK_META_AI_CONTEXT_MENU1ON1 = 27,
        ASK_META_AI_CONTEXT_MENU_GROUP = 28,
        INVOKE_META_AI1ON1 = 29,
        INVOKE_META_AI_GROUP = 30,
        META_AI_FORWARD = 31,
        NEW_CHAT_AI_CONTACT = 32,
        MESSAGE_QUICK_ACTION1_ON1_CHAT = 33,
        MESSAGE_QUICK_ACTION_GROUP_CHAT = 34,
        ATTACHMENT_TRAY1_ON1_CHAT = 35,
        ATTACHMENT_TRAY_GROUP_CHAT = 36,
        ASK_META_AI_MEDIA_VIEWER1ON1 = 37,
        ASK_META_AI_MEDIA_VIEWER_GROUP = 38,
        MEDIA_PICKER1_ON1_CHAT = 39,
        MEDIA_PICKER_GROUP_CHAT = 40,
        ASK_META_AI_NO_SEARCH_RESULTS = 41,
        META_AI_SETTINGS = 45,
    }

    enum BotMetricsThreadEntryPoint {
        AI_TAB_THREAD = 1,
        AI_HOME_THREAD = 2,
        AI_DEEPLINK_IMMERSIVE_THREAD = 3,
        AI_DEEPLINK_THREAD = 4,
        ASK_META_AI_CONTEXT_MENU_THREAD = 5,
    }

    enum BotSessionSource {
        NONE = 0,
        NULL_STATE = 1,
        TYPEAHEAD = 2,
        USER_INPUT = 3,
        EMU_FLASH = 4,
        EMU_FLASH_FOLLOWUP = 5,
        VOICE = 6,
        AI_HOME_SESSION = 7,
    }

    enum CollectionName {
        UNKNOWN = 0,
        REGULAR = 1,
        REGULAR_LOW = 2,
        REGULAR_HIGH = 3,
        CRITICAL_BLOCK = 4,
        CRITICAL_UNBLOCK_LOW = 5,
    }

    enum KeepType {
        UNKNOWN = 0,
        KEEP_FOR_ALL = 1,
        UNDO_KEEP_FOR_ALL = 2,
    }

    enum MediaVisibility {
        DEFAULT = 0,
        OFF = 1,
        ON = 2,
    }

    enum MutationProps {
        STAR_ACTION = 2,
        CONTACT_ACTION = 3,
        MUTE_ACTION = 4,
        PIN_ACTION = 5,
        SECURITY_NOTIFICATION_SETTING = 6,
        PUSH_NAME_SETTING = 7,
        QUICK_REPLY_ACTION = 8,
        RECENT_EMOJI_WEIGHTS_ACTION = 11,
        LABEL_MESSAGE_ACTION = 13,
        LABEL_EDIT_ACTION = 14,
        LABEL_ASSOCIATION_ACTION = 15,
        LOCALE_SETTING = 16,
        ARCHIVE_CHAT_ACTION = 17,
        DELETE_MESSAGE_FOR_ME_ACTION = 18,
        KEY_EXPIRATION = 19,
        MARK_CHAT_AS_READ_ACTION = 20,
        CLEAR_CHAT_ACTION = 21,
        DELETE_CHAT_ACTION = 22,
        UNARCHIVE_CHATS_SETTING = 23,
        PRIMARY_FEATURE = 24,
        ANDROID_UNSUPPORTED_ACTIONS = 26,
        AGENT_ACTION = 27,
        SUBSCRIPTION_ACTION = 28,
        USER_STATUS_MUTE_ACTION = 29,
        TIME_FORMAT_ACTION = 30,
        NUX_ACTION = 31,
        PRIMARY_VERSION_ACTION = 32,
        STICKER_ACTION = 33,
        REMOVE_RECENT_STICKER_ACTION = 34,
        CHAT_ASSIGNMENT = 35,
        CHAT_ASSIGNMENT_OPENED_STATUS = 36,
        PN_FOR_LID_CHAT_ACTION = 37,
        MARKETING_MESSAGE_ACTION = 38,
        MARKETING_MESSAGE_BROADCAST_ACTION = 39,
        EXTERNAL_WEB_BETA_ACTION = 40,
        PRIVACY_SETTING_RELAY_ALL_CALLS = 41,
        CALL_LOG_ACTION = 42,
        UGC_BOT = 43,
        STATUS_PRIVACY = 44,
        BOT_WELCOME_REQUEST_ACTION = 45,
        DELETE_INDIVIDUAL_CALL_LOG = 46,
        LABEL_REORDERING_ACTION = 47,
        PAYMENT_INFO_ACTION = 48,
        CUSTOM_PAYMENT_METHODS_ACTION = 49,
        LOCK_CHAT_ACTION = 50,
        CHAT_LOCK_SETTINGS = 51,
        WAMO_USER_IDENTIFIER_ACTION = 52,
        PRIVACY_SETTING_DISABLE_LINK_PREVIEWS_ACTION = 53,
        DEVICE_CAPABILITIES = 54,
        NOTE_EDIT_ACTION = 55,
        FAVORITES_ACTION = 56,
        MERCHANT_PAYMENT_PARTNER_ACTION = 57,
        WAFFLE_ACCOUNT_LINK_STATE_ACTION = 58,
        USERNAME_CHAT_START_MODE = 59,
        NOTIFICATION_ACTIVITY_SETTING_ACTION = 60,
        LID_CONTACT_ACTION = 61,
        CTWA_PER_CUSTOMER_DATA_SHARING_ACTION = 62,
        PAYMENT_TOS_ACTION = 63,
        PRIVACY_SETTING_CHANNELS_PERSONALISED_RECOMMENDATION_ACTION = 64,
        BUSINESS_BROADCAST_ASSOCIATION_ACTION = 65,
        DETECTED_OUTCOMES_STATUS_ACTION = 66,
        MAIBA_AI_FEATURES_CONTROL_ACTION = 68,
        BUSINESS_BROADCAST_LIST_ACTION = 69,
        MUSIC_USER_ID_ACTION = 70,
        STATUS_POST_OPT_IN_NOTIFICATION_PREFERENCES_ACTION = 71,
        AVATAR_UPDATED_ACTION = 72,
        GALAXY_FLOW_ACTION = 73,
        PRIVATE_PROCESSING_SETTING_ACTION = 74,
        NEWSLETTER_SAVED_INTERESTS_ACTION = 75,
        AI_THREAD_RENAME_ACTION = 76,
        INTERACTIVE_MESSAGE_ACTION = 77,
        SETTINGS_SYNC_ACTION = 78,
        SHARE_OWN_PN = 10001,
        BUSINESS_BROADCAST_ACTION = 10002,
        AI_THREAD_DELETE_ACTION = 10003,
    }

    enum PrivacySystemMessage {
        E2EE_MSG = 1,
        NE2EE_SELF = 2,
        NE2EE_OTHER = 3,
    }

    enum SessionTransparencyType {
        UNKNOWN_TYPE = 0,
        NY_AI_SAFETY_DISCLAIMER = 1,
    }

    enum WebLinkRenderConfig {
        WEBVIEW = 0,
        SYSTEM = 1,
    }

    interface IAdvDeviceIdentity {
        rawId?: (number|null);
        timestamp?: (number|Long|null);
        keyIndex?: (number|null);
        accountType?: proto.AdvEncryptionType|null;
        deviceType?: proto.AdvEncryptionType|null;
    }

    class AdvDeviceIdentity implements IAdvDeviceIdentity {
        constructor(p?: IAdvDeviceIdentity);
        public rawId?: (number|null);
        public timestamp?: (number|Long|null);
        public keyIndex?: (number|null);
        public accountType?: proto.AdvEncryptionType|null;
        public deviceType?: proto.AdvEncryptionType|null;
        public static create(properties?: IAdvDeviceIdentity): AdvDeviceIdentity;
        public static encode(m: IAdvDeviceIdentity, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdvDeviceIdentity;
        public static fromObject(d: { [k: string]: any }): AdvDeviceIdentity;
        public static toObject(m: AdvDeviceIdentity, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAdvKeyIndexList {
        rawId?: (number|null);
        timestamp?: (number|Long|null);
        currentIndex?: (number|null);
        validIndexes?: number[];
        accountType?: proto.AdvEncryptionType|null;
    }

    class AdvKeyIndexList implements IAdvKeyIndexList {
        constructor(p?: IAdvKeyIndexList);
        public rawId?: (number|null);
        public timestamp?: (number|Long|null);
        public currentIndex?: (number|null);
        public validIndexes: number[];
        public accountType?: proto.AdvEncryptionType|null;
        public static create(properties?: IAdvKeyIndexList): AdvKeyIndexList;
        public static encode(m: IAdvKeyIndexList, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdvKeyIndexList;
        public static fromObject(d: { [k: string]: any }): AdvKeyIndexList;
        public static toObject(m: AdvKeyIndexList, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAdvSignedDeviceIdentity {
        details?: (Uint8Array|null);
        accountSignatureKey?: (Uint8Array|null);
        accountSignature?: (Uint8Array|null);
        deviceSignature?: (Uint8Array|null);
    }

    class AdvSignedDeviceIdentity implements IAdvSignedDeviceIdentity {
        constructor(p?: IAdvSignedDeviceIdentity);
        public details?: (Uint8Array|null);
        public accountSignatureKey?: (Uint8Array|null);
        public accountSignature?: (Uint8Array|null);
        public deviceSignature?: (Uint8Array|null);
        public static create(properties?: IAdvSignedDeviceIdentity): AdvSignedDeviceIdentity;
        public static encode(m: IAdvSignedDeviceIdentity, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdvSignedDeviceIdentity;
        public static fromObject(d: { [k: string]: any }): AdvSignedDeviceIdentity;
        public static toObject(m: AdvSignedDeviceIdentity, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAdvSignedDeviceIdentityHmac {
        details?: (Uint8Array|null);
        hmac?: (Uint8Array|null);
        accountType?: proto.AdvEncryptionType|null;
    }

    class AdvSignedDeviceIdentityHmac implements IAdvSignedDeviceIdentityHmac {
        constructor(p?: IAdvSignedDeviceIdentityHmac);
        public details?: (Uint8Array|null);
        public hmac?: (Uint8Array|null);
        public accountType?: proto.AdvEncryptionType|null;
        public static create(properties?: IAdvSignedDeviceIdentityHmac): AdvSignedDeviceIdentityHmac;
        public static encode(m: IAdvSignedDeviceIdentityHmac, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdvSignedDeviceIdentityHmac;
        public static fromObject(d: { [k: string]: any }): AdvSignedDeviceIdentityHmac;
        public static toObject(m: AdvSignedDeviceIdentityHmac, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAdvSignedKeyIndexList {
        details?: (Uint8Array|null);
        accountSignature?: (Uint8Array|null);
        accountSignatureKey?: (Uint8Array|null);
    }

    class AdvSignedKeyIndexList implements IAdvSignedKeyIndexList {
        constructor(p?: IAdvSignedKeyIndexList);
        public details?: (Uint8Array|null);
        public accountSignature?: (Uint8Array|null);
        public accountSignatureKey?: (Uint8Array|null);
        public static create(properties?: IAdvSignedKeyIndexList): AdvSignedKeyIndexList;
        public static encode(m: IAdvSignedKeyIndexList, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdvSignedKeyIndexList;
        public static fromObject(d: { [k: string]: any }): AdvSignedKeyIndexList;
        public static toObject(m: AdvSignedKeyIndexList, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiHomeState {
        lastFetchTime?: (number|Long|null);
        capabilityOptions?: proto.IAiHomeOption[];
        conversationOptions?: proto.IAiHomeOption[];
    }

    class AiHomeState implements IAiHomeState {
        constructor(p?: IAiHomeState);
        public lastFetchTime?: (number|Long|null);
        public capabilityOptions: proto.IAiHomeOption[];
        public conversationOptions: proto.IAiHomeOption[];
        public static create(properties?: IAiHomeState): AiHomeState;
        public static encode(m: IAiHomeState, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiHomeState;
        public static fromObject(d: { [k: string]: any }): AiHomeState;
        public static toObject(m: AiHomeState, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiQueryFanout {
        messageKey?: (proto.IMessageKey|null);
        message?: (proto.IMessage|null);
        timestamp?: (number|Long|null);
    }

    class AiQueryFanout implements IAiQueryFanout {
        constructor(p?: IAiQueryFanout);
        public messageKey?: (proto.IMessageKey|null);
        public message?: (proto.IMessage|null);
        public timestamp?: (number|Long|null);
        public static create(properties?: IAiQueryFanout): AiQueryFanout;
        public static encode(m: IAiQueryFanout, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiQueryFanout;
        public static fromObject(d: { [k: string]: any }): AiQueryFanout;
        public static toObject(m: AiQueryFanout, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRegenerateMetadata {
        messageKey?: (proto.IMessageKey|null);
        responseTimestampMs?: (number|Long|null);
    }

    class AiRegenerateMetadata implements IAiRegenerateMetadata {
        constructor(p?: IAiRegenerateMetadata);
        public messageKey?: (proto.IMessageKey|null);
        public responseTimestampMs?: (number|Long|null);
        public static create(properties?: IAiRegenerateMetadata): AiRegenerateMetadata;
        public static encode(m: IAiRegenerateMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRegenerateMetadata;
        public static fromObject(d: { [k: string]: any }): AiRegenerateMetadata;
        public static toObject(m: AiRegenerateMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseCodeMetadata {
        codeLanguage?: (string|null);
        codeBlocks?: proto.IAiRichResponseCodeBlock[];
    }

    class AiRichResponseCodeMetadata implements IAiRichResponseCodeMetadata {
        constructor(p?: IAiRichResponseCodeMetadata);
        public codeLanguage?: (string|null);
        public codeBlocks: proto.IAiRichResponseCodeBlock[];
        public static create(properties?: IAiRichResponseCodeMetadata): AiRichResponseCodeMetadata;
        public static encode(m: IAiRichResponseCodeMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseCodeMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseCodeMetadata;
        public static toObject(m: AiRichResponseCodeMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseContentItemsMetadata {
        itemsMetadata?: proto.IAiRichResponseContentItemMetadata[];
        contentType?: proto.AiRichResponseContentItemsMetadata.ContentType|null;
    }

    class AiRichResponseContentItemsMetadata implements IAiRichResponseContentItemsMetadata {
        constructor(p?: IAiRichResponseContentItemsMetadata);
        public itemsMetadata: proto.IAiRichResponseContentItemMetadata[];
        public contentType?: proto.AiRichResponseContentItemsMetadata.ContentType|null;
        public static create(properties?: IAiRichResponseContentItemsMetadata): AiRichResponseContentItemsMetadata;
        public static encode(m: IAiRichResponseContentItemsMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseContentItemsMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseContentItemsMetadata;
        public static toObject(m: AiRichResponseContentItemsMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseDynamicMetadata {
        type?: proto.AiRichResponseDynamicMetadata.AiRichResponseDynamicMetadataType|null;
        version?: (number|Long|null);
        url?: (string|null);
        loopCount?: (number|null);
    }

    class AiRichResponseDynamicMetadata implements IAiRichResponseDynamicMetadata {
        constructor(p?: IAiRichResponseDynamicMetadata);
        public type?: proto.AiRichResponseDynamicMetadata.AiRichResponseDynamicMetadataType|null;
        public version?: (number|Long|null);
        public url?: (string|null);
        public loopCount?: (number|null);
        public static create(properties?: IAiRichResponseDynamicMetadata): AiRichResponseDynamicMetadata;
        public static encode(m: IAiRichResponseDynamicMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseDynamicMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseDynamicMetadata;
        public static toObject(m: AiRichResponseDynamicMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseGridImageMetadata {
        gridImageUrl?: (proto.IAiRichResponseImageUrl|null);
        imageUrls?: proto.IAiRichResponseImageUrl[];
    }

    class AiRichResponseGridImageMetadata implements IAiRichResponseGridImageMetadata {
        constructor(p?: IAiRichResponseGridImageMetadata);
        public gridImageUrl?: (proto.IAiRichResponseImageUrl|null);
        public imageUrls: proto.IAiRichResponseImageUrl[];
        public static create(properties?: IAiRichResponseGridImageMetadata): AiRichResponseGridImageMetadata;
        public static encode(m: IAiRichResponseGridImageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseGridImageMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseGridImageMetadata;
        public static toObject(m: AiRichResponseGridImageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseImageUrl {
        imagePreviewUrl?: (string|null);
        imageHighResUrl?: (string|null);
        sourceUrl?: (string|null);
    }

    class AiRichResponseImageUrl implements IAiRichResponseImageUrl {
        constructor(p?: IAiRichResponseImageUrl);
        public imagePreviewUrl?: (string|null);
        public imageHighResUrl?: (string|null);
        public sourceUrl?: (string|null);
        public static create(properties?: IAiRichResponseImageUrl): AiRichResponseImageUrl;
        public static encode(m: IAiRichResponseImageUrl, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseImageUrl;
        public static fromObject(d: { [k: string]: any }): AiRichResponseImageUrl;
        public static toObject(m: AiRichResponseImageUrl, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseInlineImageMetadata {
        imageUrl?: (proto.IAiRichResponseImageUrl|null);
        imageText?: (string|null);
        alignment?: proto.AiRichResponseInlineImageMetadata.AiRichResponseImageAlignment|null;
        tapLinkUrl?: (string|null);
    }

    class AiRichResponseInlineImageMetadata implements IAiRichResponseInlineImageMetadata {
        constructor(p?: IAiRichResponseInlineImageMetadata);
        public imageUrl?: (proto.IAiRichResponseImageUrl|null);
        public imageText?: (string|null);
        public alignment?: proto.AiRichResponseInlineImageMetadata.AiRichResponseImageAlignment|null;
        public tapLinkUrl?: (string|null);
        public static create(properties?: IAiRichResponseInlineImageMetadata): AiRichResponseInlineImageMetadata;
        public static encode(m: IAiRichResponseInlineImageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseInlineImageMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseInlineImageMetadata;
        public static toObject(m: AiRichResponseInlineImageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseLatexMetadata {
        text?: (string|null);
        expressions?: proto.IAiRichResponseLatexExpression[];
    }

    class AiRichResponseLatexMetadata implements IAiRichResponseLatexMetadata {
        constructor(p?: IAiRichResponseLatexMetadata);
        public text?: (string|null);
        public expressions: proto.IAiRichResponseLatexExpression[];
        public static create(properties?: IAiRichResponseLatexMetadata): AiRichResponseLatexMetadata;
        public static encode(m: IAiRichResponseLatexMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseLatexMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseLatexMetadata;
        public static toObject(m: AiRichResponseLatexMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseMapMetadata {
        centerLatitude?: (number|null);
        centerLongitude?: (number|null);
        latitudeDelta?: (number|null);
        longitudeDelta?: (number|null);
        annotations?: proto.IAiRichResponseMapAnnotation[];
        showInfoList?: (boolean|null);
    }

    class AiRichResponseMapMetadata implements IAiRichResponseMapMetadata {
        constructor(p?: IAiRichResponseMapMetadata);
        public centerLatitude?: (number|null);
        public centerLongitude?: (number|null);
        public latitudeDelta?: (number|null);
        public longitudeDelta?: (number|null);
        public annotations: proto.IAiRichResponseMapAnnotation[];
        public showInfoList?: (boolean|null);
        public static create(properties?: IAiRichResponseMapMetadata): AiRichResponseMapMetadata;
        public static encode(m: IAiRichResponseMapMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseMapMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseMapMetadata;
        public static toObject(m: AiRichResponseMapMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseMessage {
        messageType?: proto.AiRichResponseMessageType|null;
        submessages?: proto.IAiRichResponseSubMessage[];
        unifiedResponse?: (proto.IAiRichResponseUnifiedResponse|null);
        contextInfo?: (proto.IContextInfo|null);
    }

    class AiRichResponseMessage implements IAiRichResponseMessage {
        constructor(p?: IAiRichResponseMessage);
        public messageType?: proto.AiRichResponseMessageType|null;
        public submessages: proto.IAiRichResponseSubMessage[];
        public unifiedResponse?: (proto.IAiRichResponseUnifiedResponse|null);
        public contextInfo?: (proto.IContextInfo|null);
        public static create(properties?: IAiRichResponseMessage): AiRichResponseMessage;
        public static encode(m: IAiRichResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseMessage;
        public static fromObject(d: { [k: string]: any }): AiRichResponseMessage;
        public static toObject(m: AiRichResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseSubMessage {
        messageType?: proto.AiRichResponseSubMessageType|null;
        gridImageMetadata?: (proto.IAiRichResponseGridImageMetadata|null);
        messageText?: (string|null);
        imageMetadata?: (proto.IAiRichResponseInlineImageMetadata|null);
        codeMetadata?: (proto.IAiRichResponseCodeMetadata|null);
        tableMetadata?: (proto.IAiRichResponseTableMetadata|null);
        dynamicMetadata?: (proto.IAiRichResponseDynamicMetadata|null);
        latexMetadata?: (proto.IAiRichResponseLatexMetadata|null);
        mapMetadata?: (proto.IAiRichResponseMapMetadata|null);
        contentItemsMetadata?: (proto.IAiRichResponseContentItemsMetadata|null);
    }

    class AiRichResponseSubMessage implements IAiRichResponseSubMessage {
        constructor(p?: IAiRichResponseSubMessage);
        public messageType?: proto.AiRichResponseSubMessageType|null;
        public gridImageMetadata?: (proto.IAiRichResponseGridImageMetadata|null);
        public messageText?: (string|null);
        public imageMetadata?: (proto.IAiRichResponseInlineImageMetadata|null);
        public codeMetadata?: (proto.IAiRichResponseCodeMetadata|null);
        public tableMetadata?: (proto.IAiRichResponseTableMetadata|null);
        public dynamicMetadata?: (proto.IAiRichResponseDynamicMetadata|null);
        public latexMetadata?: (proto.IAiRichResponseLatexMetadata|null);
        public mapMetadata?: (proto.IAiRichResponseMapMetadata|null);
        public contentItemsMetadata?: (proto.IAiRichResponseContentItemsMetadata|null);
        public static create(properties?: IAiRichResponseSubMessage): AiRichResponseSubMessage;
        public static encode(m: IAiRichResponseSubMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseSubMessage;
        public static fromObject(d: { [k: string]: any }): AiRichResponseSubMessage;
        public static toObject(m: AiRichResponseSubMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseTableMetadata {
        rows?: proto.IAiRichResponseTableRow[];
        title?: (string|null);
    }

    class AiRichResponseTableMetadata implements IAiRichResponseTableMetadata {
        constructor(p?: IAiRichResponseTableMetadata);
        public rows: proto.IAiRichResponseTableRow[];
        public title?: (string|null);
        public static create(properties?: IAiRichResponseTableMetadata): AiRichResponseTableMetadata;
        public static encode(m: IAiRichResponseTableMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseTableMetadata;
        public static fromObject(d: { [k: string]: any }): AiRichResponseTableMetadata;
        public static toObject(m: AiRichResponseTableMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiRichResponseUnifiedResponse {
        data?: (Uint8Array|null);
    }

    class AiRichResponseUnifiedResponse implements IAiRichResponseUnifiedResponse {
        constructor(p?: IAiRichResponseUnifiedResponse);
        public data?: (Uint8Array|null);
        public static create(properties?: IAiRichResponseUnifiedResponse): AiRichResponseUnifiedResponse;
        public static encode(m: IAiRichResponseUnifiedResponse, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseUnifiedResponse;
        public static fromObject(d: { [k: string]: any }): AiRichResponseUnifiedResponse;
        public static toObject(m: AiRichResponseUnifiedResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAiThreadInfo {
        serverInfo?: (proto.IAiThreadServerInfo|null);
        clientInfo?: (proto.IAiThreadClientInfo|null);
    }

    class AiThreadInfo implements IAiThreadInfo {
        constructor(p?: IAiThreadInfo);
        public serverInfo?: (proto.IAiThreadServerInfo|null);
        public clientInfo?: (proto.IAiThreadClientInfo|null);
        public static create(properties?: IAiThreadInfo): AiThreadInfo;
        public static encode(m: IAiThreadInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiThreadInfo;
        public static fromObject(d: { [k: string]: any }): AiThreadInfo;
        public static toObject(m: AiThreadInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAccount {
        lid?: (string|null);
        username?: (string|null);
        countryCode?: (string|null);
        isUsernameDeleted?: (boolean|null);
    }

    class Account implements IAccount {
        constructor(p?: IAccount);
        public lid?: (string|null);
        public username?: (string|null);
        public countryCode?: (string|null);
        public isUsernameDeleted?: (boolean|null);
        public static create(properties?: IAccount): Account;
        public static encode(m: IAccount, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Account;
        public static fromObject(d: { [k: string]: any }): Account;
        public static toObject(m: Account, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IActionLink {
        url?: (string|null);
        buttonTitle?: (string|null);
    }

    class ActionLink implements IActionLink {
        constructor(p?: IActionLink);
        public url?: (string|null);
        public buttonTitle?: (string|null);
        public static create(properties?: IActionLink): ActionLink;
        public static encode(m: IActionLink, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ActionLink;
        public static fromObject(d: { [k: string]: any }): ActionLink;
        public static toObject(m: ActionLink, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAutoDownloadSettings {
        downloadImages?: (boolean|null);
        downloadAudio?: (boolean|null);
        downloadVideo?: (boolean|null);
        downloadDocuments?: (boolean|null);
    }

    class AutoDownloadSettings implements IAutoDownloadSettings {
        constructor(p?: IAutoDownloadSettings);
        public downloadImages?: (boolean|null);
        public downloadAudio?: (boolean|null);
        public downloadVideo?: (boolean|null);
        public downloadDocuments?: (boolean|null);
        public static create(properties?: IAutoDownloadSettings): AutoDownloadSettings;
        public static encode(m: IAutoDownloadSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AutoDownloadSettings;
        public static fromObject(d: { [k: string]: any }): AutoDownloadSettings;
        public static toObject(m: AutoDownloadSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IAvatarUserSettings {
        fbid?: (string|null);
        password?: (string|null);
    }

    class AvatarUserSettings implements IAvatarUserSettings {
        constructor(p?: IAvatarUserSettings);
        public fbid?: (string|null);
        public password?: (string|null);
        public static create(properties?: IAvatarUserSettings): AvatarUserSettings;
        public static encode(m: IAvatarUserSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AvatarUserSettings;
        public static fromObject(d: { [k: string]: any }): AvatarUserSettings;
        public static toObject(m: AvatarUserSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBizAccountLinkInfo {
        whatsappBizAcctFbid?: (number|Long|null);
        whatsappAcctNumber?: (string|null);
        issueTime?: (number|Long|null);
        hostStorage?: proto.BizAccountLinkInfo.HostStorageType|null;
        accountType?: proto.BizAccountLinkInfo.AccountType|null;
    }

    class BizAccountLinkInfo implements IBizAccountLinkInfo {
        constructor(p?: IBizAccountLinkInfo);
        public whatsappBizAcctFbid?: (number|Long|null);
        public whatsappAcctNumber?: (string|null);
        public issueTime?: (number|Long|null);
        public hostStorage?: proto.BizAccountLinkInfo.HostStorageType|null;
        public accountType?: proto.BizAccountLinkInfo.AccountType|null;
        public static create(properties?: IBizAccountLinkInfo): BizAccountLinkInfo;
        public static encode(m: IBizAccountLinkInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BizAccountLinkInfo;
        public static fromObject(d: { [k: string]: any }): BizAccountLinkInfo;
        public static toObject(m: BizAccountLinkInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBizAccountPayload {
        vnameCert?: (proto.IVerifiedNameCertificate|null);
        bizAcctLinkInfo?: (Uint8Array|null);
    }

    class BizAccountPayload implements IBizAccountPayload {
        constructor(p?: IBizAccountPayload);
        public vnameCert?: (proto.IVerifiedNameCertificate|null);
        public bizAcctLinkInfo?: (Uint8Array|null);
        public static create(properties?: IBizAccountPayload): BizAccountPayload;
        public static encode(m: IBizAccountPayload, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BizAccountPayload;
        public static fromObject(d: { [k: string]: any }): BizAccountPayload;
        public static toObject(m: BizAccountPayload, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBizIdentityInfo {
        vlevel?: proto.BizIdentityInfo.VerifiedLevelValue|null;
        vnameCert?: (proto.IVerifiedNameCertificate|null);
        signed?: (boolean|null);
        revoked?: (boolean|null);
        hostStorage?: proto.BizIdentityInfo.HostStorageType|null;
        actualActors?: proto.BizIdentityInfo.ActualActorsType|null;
        privacyModeTs?: (number|Long|null);
        featureControls?: (number|Long|null);
    }

    class BizIdentityInfo implements IBizIdentityInfo {
        constructor(p?: IBizIdentityInfo);
        public vlevel?: proto.BizIdentityInfo.VerifiedLevelValue|null;
        public vnameCert?: (proto.IVerifiedNameCertificate|null);
        public signed?: (boolean|null);
        public revoked?: (boolean|null);
        public hostStorage?: proto.BizIdentityInfo.HostStorageType|null;
        public actualActors?: proto.BizIdentityInfo.ActualActorsType|null;
        public privacyModeTs?: (number|Long|null);
        public featureControls?: (number|Long|null);
        public static create(properties?: IBizIdentityInfo): BizIdentityInfo;
        public static encode(m: IBizIdentityInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BizIdentityInfo;
        public static fromObject(d: { [k: string]: any }): BizIdentityInfo;
        public static toObject(m: BizIdentityInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotAgeCollectionMetadata {
        ageCollectionEligible?: (boolean|null);
        shouldTriggerAgeCollectionOnClient?: (boolean|null);
        ageCollectionType?: proto.BotAgeCollectionMetadata.AgeCollectionType|null;
    }

    class BotAgeCollectionMetadata implements IBotAgeCollectionMetadata {
        constructor(p?: IBotAgeCollectionMetadata);
        public ageCollectionEligible?: (boolean|null);
        public shouldTriggerAgeCollectionOnClient?: (boolean|null);
        public ageCollectionType?: proto.BotAgeCollectionMetadata.AgeCollectionType|null;
        public static create(properties?: IBotAgeCollectionMetadata): BotAgeCollectionMetadata;
        public static encode(m: IBotAgeCollectionMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotAgeCollectionMetadata;
        public static fromObject(d: { [k: string]: any }): BotAgeCollectionMetadata;
        public static toObject(m: BotAgeCollectionMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotAvatarMetadata {
        sentiment?: (number|null);
        behaviorGraph?: (string|null);
        action?: (number|null);
        intensity?: (number|null);
        wordCount?: (number|null);
    }

    class BotAvatarMetadata implements IBotAvatarMetadata {
        constructor(p?: IBotAvatarMetadata);
        public sentiment?: (number|null);
        public behaviorGraph?: (string|null);
        public action?: (number|null);
        public intensity?: (number|null);
        public wordCount?: (number|null);
        public static create(properties?: IBotAvatarMetadata): BotAvatarMetadata;
        public static encode(m: IBotAvatarMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotAvatarMetadata;
        public static fromObject(d: { [k: string]: any }): BotAvatarMetadata;
        public static toObject(m: BotAvatarMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotCapabilityMetadata {
        capabilities?: proto.BotCapabilityMetadata.BotCapabilityType;
    }

    class BotCapabilityMetadata implements IBotCapabilityMetadata {
        constructor(p?: IBotCapabilityMetadata);
        public capabilities: proto.BotCapabilityMetadata.BotCapabilityType;
        public static create(properties?: IBotCapabilityMetadata): BotCapabilityMetadata;
        public static encode(m: IBotCapabilityMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotCapabilityMetadata;
        public static fromObject(d: { [k: string]: any }): BotCapabilityMetadata;
        public static toObject(m: BotCapabilityMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotDocumentMessageMetadata {
        pluginType?: proto.BotDocumentMessageMetadata.DocumentPluginType|null;
    }

    class BotDocumentMessageMetadata implements IBotDocumentMessageMetadata {
        constructor(p?: IBotDocumentMessageMetadata);
        public pluginType?: proto.BotDocumentMessageMetadata.DocumentPluginType|null;
        public static create(properties?: IBotDocumentMessageMetadata): BotDocumentMessageMetadata;
        public static encode(m: IBotDocumentMessageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotDocumentMessageMetadata;
        public static fromObject(d: { [k: string]: any }): BotDocumentMessageMetadata;
        public static toObject(m: BotDocumentMessageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotFeedbackMessage {
        messageKey?: (proto.IMessageKey|null);
        kind?: proto.BotFeedbackMessage.BotFeedbackKind|null;
        text?: (string|null);
        kindNegative?: (number|Long|null);
        kindPositive?: (number|Long|null);
        kindReport?: proto.BotFeedbackMessage.ReportKind|null;
        sideBySideSurveyMetadata?: (proto.ISideBySideSurveyMetadata|null);
    }

    class BotFeedbackMessage implements IBotFeedbackMessage {
        constructor(p?: IBotFeedbackMessage);
        public messageKey?: (proto.IMessageKey|null);
        public kind?: proto.BotFeedbackMessage.BotFeedbackKind|null;
        public text?: (string|null);
        public kindNegative?: (number|Long|null);
        public kindPositive?: (number|Long|null);
        public kindReport?: proto.BotFeedbackMessage.ReportKind|null;
        public sideBySideSurveyMetadata?: (proto.ISideBySideSurveyMetadata|null);
        public static create(properties?: IBotFeedbackMessage): BotFeedbackMessage;
        public static encode(m: IBotFeedbackMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotFeedbackMessage;
        public static fromObject(d: { [k: string]: any }): BotFeedbackMessage;
        public static toObject(m: BotFeedbackMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotGroupMetadata {
        participantsMetadata?: proto.IBotGroupParticipantMetadata[];
    }

    class BotGroupMetadata implements IBotGroupMetadata {
        constructor(p?: IBotGroupMetadata);
        public participantsMetadata: proto.IBotGroupParticipantMetadata[];
        public static create(properties?: IBotGroupMetadata): BotGroupMetadata;
        public static encode(m: IBotGroupMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotGroupMetadata;
        public static fromObject(d: { [k: string]: any }): BotGroupMetadata;
        public static toObject(m: BotGroupMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotGroupParticipantMetadata {
        botFbid?: (string|null);
    }

    class BotGroupParticipantMetadata implements IBotGroupParticipantMetadata {
        constructor(p?: IBotGroupParticipantMetadata);
        public botFbid?: (string|null);
        public static create(properties?: IBotGroupParticipantMetadata): BotGroupParticipantMetadata;
        public static encode(m: IBotGroupParticipantMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotGroupParticipantMetadata;
        public static fromObject(d: { [k: string]: any }): BotGroupParticipantMetadata;
        public static toObject(m: BotGroupParticipantMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotImagineMetadata {
        imagineType?: proto.BotImagineMetadata.ImagineType|null;
    }

    class BotImagineMetadata implements IBotImagineMetadata {
        constructor(p?: IBotImagineMetadata);
        public imagineType?: proto.BotImagineMetadata.ImagineType|null;
        public static create(properties?: IBotImagineMetadata): BotImagineMetadata;
        public static encode(m: IBotImagineMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotImagineMetadata;
        public static fromObject(d: { [k: string]: any }): BotImagineMetadata;
        public static toObject(m: BotImagineMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotLinkedAccount {
        type?: proto.BotLinkedAccount.BotLinkedAccountType|null;
    }

    class BotLinkedAccount implements IBotLinkedAccount {
        constructor(p?: IBotLinkedAccount);
        public type?: proto.BotLinkedAccount.BotLinkedAccountType|null;
        public static create(properties?: IBotLinkedAccount): BotLinkedAccount;
        public static encode(m: IBotLinkedAccount, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotLinkedAccount;
        public static fromObject(d: { [k: string]: any }): BotLinkedAccount;
        public static toObject(m: BotLinkedAccount, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotLinkedAccountsMetadata {
        accounts?: proto.IBotLinkedAccount[];
        acAuthTokens?: (Uint8Array|null);
        acErrorCode?: (number|null);
    }

    class BotLinkedAccountsMetadata implements IBotLinkedAccountsMetadata {
        constructor(p?: IBotLinkedAccountsMetadata);
        public accounts: proto.IBotLinkedAccount[];
        public acAuthTokens?: (Uint8Array|null);
        public acErrorCode?: (number|null);
        public static create(properties?: IBotLinkedAccountsMetadata): BotLinkedAccountsMetadata;
        public static encode(m: IBotLinkedAccountsMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotLinkedAccountsMetadata;
        public static fromObject(d: { [k: string]: any }): BotLinkedAccountsMetadata;
        public static toObject(m: BotLinkedAccountsMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMediaMetadata {
        fileSha256?: (string|null);
        mediaKey?: (string|null);
        fileEncSha256?: (string|null);
        directPath?: (string|null);
        mediaKeyTimestamp?: (number|Long|null);
        mimetype?: (string|null);
        orientationType?: proto.BotMediaMetadata.OrientationType|null;
    }

    class BotMediaMetadata implements IBotMediaMetadata {
        constructor(p?: IBotMediaMetadata);
        public fileSha256?: (string|null);
        public mediaKey?: (string|null);
        public fileEncSha256?: (string|null);
        public directPath?: (string|null);
        public mediaKeyTimestamp?: (number|Long|null);
        public mimetype?: (string|null);
        public orientationType?: proto.BotMediaMetadata.OrientationType|null;
        public static create(properties?: IBotMediaMetadata): BotMediaMetadata;
        public static encode(m: IBotMediaMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMediaMetadata;
        public static fromObject(d: { [k: string]: any }): BotMediaMetadata;
        public static toObject(m: BotMediaMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMemoryFact {
        fact?: (string|null);
        factId?: (string|null);
    }

    class BotMemoryFact implements IBotMemoryFact {
        constructor(p?: IBotMemoryFact);
        public fact?: (string|null);
        public factId?: (string|null);
        public static create(properties?: IBotMemoryFact): BotMemoryFact;
        public static encode(m: IBotMemoryFact, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMemoryFact;
        public static fromObject(d: { [k: string]: any }): BotMemoryFact;
        public static toObject(m: BotMemoryFact, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMemoryMetadata {
        addedFacts?: proto.IBotMemoryFact[];
        removedFacts?: proto.IBotMemoryFact[];
        disclaimer?: (string|null);
    }

    class BotMemoryMetadata implements IBotMemoryMetadata {
        constructor(p?: IBotMemoryMetadata);
        public addedFacts: proto.IBotMemoryFact[];
        public removedFacts: proto.IBotMemoryFact[];
        public disclaimer?: (string|null);
        public static create(properties?: IBotMemoryMetadata): BotMemoryMetadata;
        public static encode(m: IBotMemoryMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMemoryMetadata;
        public static fromObject(d: { [k: string]: any }): BotMemoryMetadata;
        public static toObject(m: BotMemoryMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMemuMetadata {
        faceImages?: proto.IBotMediaMetadata[];
    }

    class BotMemuMetadata implements IBotMemuMetadata {
        constructor(p?: IBotMemuMetadata);
        public faceImages: proto.IBotMediaMetadata[];
        public static create(properties?: IBotMemuMetadata): BotMemuMetadata;
        public static encode(m: IBotMemuMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMemuMetadata;
        public static fromObject(d: { [k: string]: any }): BotMemuMetadata;
        public static toObject(m: BotMemuMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMessageOrigin {
        type?: proto.BotMessageOrigin.BotMessageOriginType|null;
    }

    class BotMessageOrigin implements IBotMessageOrigin {
        constructor(p?: IBotMessageOrigin);
        public type?: proto.BotMessageOrigin.BotMessageOriginType|null;
        public static create(properties?: IBotMessageOrigin): BotMessageOrigin;
        public static encode(m: IBotMessageOrigin, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMessageOrigin;
        public static fromObject(d: { [k: string]: any }): BotMessageOrigin;
        public static toObject(m: BotMessageOrigin, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMessageOriginMetadata {
        origins?: proto.IBotMessageOrigin[];
    }

    class BotMessageOriginMetadata implements IBotMessageOriginMetadata {
        constructor(p?: IBotMessageOriginMetadata);
        public origins: proto.IBotMessageOrigin[];
        public static create(properties?: IBotMessageOriginMetadata): BotMessageOriginMetadata;
        public static encode(m: IBotMessageOriginMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMessageOriginMetadata;
        public static fromObject(d: { [k: string]: any }): BotMessageOriginMetadata;
        public static toObject(m: BotMessageOriginMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMessageSharingInfo {
        botEntryPointOrigin?: proto.BotMetricsEntryPoint|null;
        forwardScore?: (number|null);
    }

    class BotMessageSharingInfo implements IBotMessageSharingInfo {
        constructor(p?: IBotMessageSharingInfo);
        public botEntryPointOrigin?: proto.BotMetricsEntryPoint|null;
        public forwardScore?: (number|null);
        public static create(properties?: IBotMessageSharingInfo): BotMessageSharingInfo;
        public static encode(m: IBotMessageSharingInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMessageSharingInfo;
        public static fromObject(d: { [k: string]: any }): BotMessageSharingInfo;
        public static toObject(m: BotMessageSharingInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMetadata {
        avatarMetadata?: (proto.IBotAvatarMetadata|null);
        personaId?: (string|null);
        pluginMetadata?: (proto.IBotPluginMetadata|null);
        suggestedPromptMetadata?: (proto.IBotSuggestedPromptMetadata|null);
        invokerJid?: (string|null);
        sessionMetadata?: (proto.IBotSessionMetadata|null);
        memuMetadata?: (proto.IBotMemuMetadata|null);
        timezone?: (string|null);
        reminderMetadata?: (proto.IBotReminderMetadata|null);
        modelMetadata?: (proto.IBotModelMetadata|null);
        messageDisclaimerText?: (string|null);
        progressIndicatorMetadata?: (proto.IBotProgressIndicatorMetadata|null);
        capabilityMetadata?: (proto.IBotCapabilityMetadata|null);
        imagineMetadata?: (proto.IBotImagineMetadata|null);
        memoryMetadata?: (proto.IBotMemoryMetadata|null);
        renderingMetadata?: (proto.IBotRenderingMetadata|null);
        botMetricsMetadata?: (proto.IBotMetricsMetadata|null);
        botLinkedAccountsMetadata?: (proto.IBotLinkedAccountsMetadata|null);
        richResponseSourcesMetadata?: (proto.IBotSourcesMetadata|null);
        aiConversationContext?: (Uint8Array|null);
        botPromotionMessageMetadata?: (proto.IBotPromotionMessageMetadata|null);
        botModeSelectionMetadata?: (proto.IBotModeSelectionMetadata|null);
        botQuotaMetadata?: (proto.IBotQuotaMetadata|null);
        botAgeCollectionMetadata?: (proto.IBotAgeCollectionMetadata|null);
        conversationStarterPromptId?: (string|null);
        botResponseId?: (string|null);
        verificationMetadata?: (proto.IBotSignatureVerificationMetadata|null);
        unifiedResponseMutation?: (proto.IBotUnifiedResponseMutation|null);
        botMessageOriginMetadata?: (proto.IBotMessageOriginMetadata|null);
        inThreadSurveyMetadata?: (proto.IInThreadSurveyMetadata|null);
        botThreadInfo?: (proto.IAiThreadInfo|null);
        regenerateMetadata?: (proto.IAiRegenerateMetadata|null);
        sessionTransparencyMetadata?: (proto.ISessionTransparencyMetadata|null);
        botDocumentMessageMetadata?: (proto.IBotDocumentMessageMetadata|null);
        botGroupMetadata?: (proto.IBotGroupMetadata|null);
        botRenderingConfigMetadata?: (proto.IBotRenderingConfigMetadata|null);
        internalMetadata?: (Uint8Array|null);
    }

    class BotMetadata implements IBotMetadata {
        constructor(p?: IBotMetadata);
        public avatarMetadata?: (proto.IBotAvatarMetadata|null);
        public personaId?: (string|null);
        public pluginMetadata?: (proto.IBotPluginMetadata|null);
        public suggestedPromptMetadata?: (proto.IBotSuggestedPromptMetadata|null);
        public invokerJid?: (string|null);
        public sessionMetadata?: (proto.IBotSessionMetadata|null);
        public memuMetadata?: (proto.IBotMemuMetadata|null);
        public timezone?: (string|null);
        public reminderMetadata?: (proto.IBotReminderMetadata|null);
        public modelMetadata?: (proto.IBotModelMetadata|null);
        public messageDisclaimerText?: (string|null);
        public progressIndicatorMetadata?: (proto.IBotProgressIndicatorMetadata|null);
        public capabilityMetadata?: (proto.IBotCapabilityMetadata|null);
        public imagineMetadata?: (proto.IBotImagineMetadata|null);
        public memoryMetadata?: (proto.IBotMemoryMetadata|null);
        public renderingMetadata?: (proto.IBotRenderingMetadata|null);
        public botMetricsMetadata?: (proto.IBotMetricsMetadata|null);
        public botLinkedAccountsMetadata?: (proto.IBotLinkedAccountsMetadata|null);
        public richResponseSourcesMetadata?: (proto.IBotSourcesMetadata|null);
        public aiConversationContext?: (Uint8Array|null);
        public botPromotionMessageMetadata?: (proto.IBotPromotionMessageMetadata|null);
        public botModeSelectionMetadata?: (proto.IBotModeSelectionMetadata|null);
        public botQuotaMetadata?: (proto.IBotQuotaMetadata|null);
        public botAgeCollectionMetadata?: (proto.IBotAgeCollectionMetadata|null);
        public conversationStarterPromptId?: (string|null);
        public botResponseId?: (string|null);
        public verificationMetadata?: (proto.IBotSignatureVerificationMetadata|null);
        public unifiedResponseMutation?: (proto.IBotUnifiedResponseMutation|null);
        public botMessageOriginMetadata?: (proto.IBotMessageOriginMetadata|null);
        public inThreadSurveyMetadata?: (proto.IInThreadSurveyMetadata|null);
        public botThreadInfo?: (proto.IAiThreadInfo|null);
        public regenerateMetadata?: (proto.IAiRegenerateMetadata|null);
        public sessionTransparencyMetadata?: (proto.ISessionTransparencyMetadata|null);
        public botDocumentMessageMetadata?: (proto.IBotDocumentMessageMetadata|null);
        public botGroupMetadata?: (proto.IBotGroupMetadata|null);
        public botRenderingConfigMetadata?: (proto.IBotRenderingConfigMetadata|null);
        public internalMetadata?: (Uint8Array|null);
        public static create(properties?: IBotMetadata): BotMetadata;
        public static encode(m: IBotMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMetadata;
        public static fromObject(d: { [k: string]: any }): BotMetadata;
        public static toObject(m: BotMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotMetricsMetadata {
        destinationId?: (string|null);
        destinationEntryPoint?: proto.BotMetricsEntryPoint|null;
        threadOrigin?: proto.BotMetricsThreadEntryPoint|null;
    }

    class BotMetricsMetadata implements IBotMetricsMetadata {
        constructor(p?: IBotMetricsMetadata);
        public destinationId?: (string|null);
        public destinationEntryPoint?: proto.BotMetricsEntryPoint|null;
        public threadOrigin?: proto.BotMetricsThreadEntryPoint|null;
        public static create(properties?: IBotMetricsMetadata): BotMetricsMetadata;
        public static encode(m: IBotMetricsMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotMetricsMetadata;
        public static fromObject(d: { [k: string]: any }): BotMetricsMetadata;
        public static toObject(m: BotMetricsMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotModeSelectionMetadata {
        mode?: proto.BotModeSelectionMetadata.BotUserSelectionMode;
    }

    class BotModeSelectionMetadata implements IBotModeSelectionMetadata {
        constructor(p?: IBotModeSelectionMetadata);
        public mode: proto.BotModeSelectionMetadata.BotUserSelectionMode;
        public static create(properties?: IBotModeSelectionMetadata): BotModeSelectionMetadata;
        public static encode(m: IBotModeSelectionMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotModeSelectionMetadata;
        public static fromObject(d: { [k: string]: any }): BotModeSelectionMetadata;
        public static toObject(m: BotModeSelectionMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotModelMetadata {
        modelType?: proto.BotModelMetadata.ModelType|null;
        premiumModelStatus?: proto.BotModelMetadata.PremiumModelStatus|null;
        modelNameOverride?: (string|null);
    }

    class BotModelMetadata implements IBotModelMetadata {
        constructor(p?: IBotModelMetadata);
        public modelType?: proto.BotModelMetadata.ModelType|null;
        public premiumModelStatus?: proto.BotModelMetadata.PremiumModelStatus|null;
        public modelNameOverride?: (string|null);
        public static create(properties?: IBotModelMetadata): BotModelMetadata;
        public static encode(m: IBotModelMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotModelMetadata;
        public static fromObject(d: { [k: string]: any }): BotModelMetadata;
        public static toObject(m: BotModelMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotPluginMetadata {
        provider?: proto.BotPluginMetadata.SearchProvider|null;
        pluginType?: proto.BotPluginMetadata.PluginType|null;
        thumbnailCdnUrl?: (string|null);
        profilePhotoCdnUrl?: (string|null);
        searchProviderUrl?: (string|null);
        referenceIndex?: (number|null);
        expectedLinksCount?: (number|null);
        searchQuery?: (string|null);
        parentPluginMessageKey?: (proto.IMessageKey|null);
        deprecatedField?: proto.BotPluginMetadata.PluginType|null;
        parentPluginType?: proto.BotPluginMetadata.PluginType|null;
        faviconCdnUrl?: (string|null);
    }

    class BotPluginMetadata implements IBotPluginMetadata {
        constructor(p?: IBotPluginMetadata);
        public provider?: proto.BotPluginMetadata.SearchProvider|null;
        public pluginType?: proto.BotPluginMetadata.PluginType|null;
        public thumbnailCdnUrl?: (string|null);
        public profilePhotoCdnUrl?: (string|null);
        public searchProviderUrl?: (string|null);
        public referenceIndex?: (number|null);
        public expectedLinksCount?: (number|null);
        public searchQuery?: (string|null);
        public parentPluginMessageKey?: (proto.IMessageKey|null);
        public deprecatedField?: proto.BotPluginMetadata.PluginType|null;
        public parentPluginType?: proto.BotPluginMetadata.PluginType|null;
        public faviconCdnUrl?: (string|null);
        public static create(properties?: IBotPluginMetadata): BotPluginMetadata;
        public static encode(m: IBotPluginMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPluginMetadata;
        public static fromObject(d: { [k: string]: any }): BotPluginMetadata;
        public static toObject(m: BotPluginMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotProgressIndicatorMetadata {
        progressDescription?: (string|null);
        stepsMetadata?: proto.IBotPlanningStepMetadata[];
        estimatedCompletionTime?: (number|Long|null);
    }

    class BotProgressIndicatorMetadata implements IBotProgressIndicatorMetadata {
        constructor(p?: IBotProgressIndicatorMetadata);
        public progressDescription?: (string|null);
        public stepsMetadata: proto.IBotPlanningStepMetadata[];
        public estimatedCompletionTime?: (number|Long|null);
        public static create(properties?: IBotProgressIndicatorMetadata): BotProgressIndicatorMetadata;
        public static encode(m: IBotProgressIndicatorMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotProgressIndicatorMetadata;
        public static fromObject(d: { [k: string]: any }): BotProgressIndicatorMetadata;
        public static toObject(m: BotProgressIndicatorMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotPromotionMessageMetadata {
        promotionType?: proto.BotPromotionMessageMetadata.BotPromotionType|null;
        buttonTitle?: (string|null);
    }

    class BotPromotionMessageMetadata implements IBotPromotionMessageMetadata {
        constructor(p?: IBotPromotionMessageMetadata);
        public promotionType?: proto.BotPromotionMessageMetadata.BotPromotionType|null;
        public buttonTitle?: (string|null);
        public static create(properties?: IBotPromotionMessageMetadata): BotPromotionMessageMetadata;
        public static encode(m: IBotPromotionMessageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPromotionMessageMetadata;
        public static fromObject(d: { [k: string]: any }): BotPromotionMessageMetadata;
        public static toObject(m: BotPromotionMessageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotPromptSuggestion {
        prompt?: (string|null);
        promptId?: (string|null);
    }

    class BotPromptSuggestion implements IBotPromptSuggestion {
        constructor(p?: IBotPromptSuggestion);
        public prompt?: (string|null);
        public promptId?: (string|null);
        public static create(properties?: IBotPromptSuggestion): BotPromptSuggestion;
        public static encode(m: IBotPromptSuggestion, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPromptSuggestion;
        public static fromObject(d: { [k: string]: any }): BotPromptSuggestion;
        public static toObject(m: BotPromptSuggestion, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotPromptSuggestions {
        suggestions?: proto.IBotPromptSuggestion[];
    }

    class BotPromptSuggestions implements IBotPromptSuggestions {
        constructor(p?: IBotPromptSuggestions);
        public suggestions: proto.IBotPromptSuggestion[];
        public static create(properties?: IBotPromptSuggestions): BotPromptSuggestions;
        public static encode(m: IBotPromptSuggestions, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPromptSuggestions;
        public static fromObject(d: { [k: string]: any }): BotPromptSuggestions;
        public static toObject(m: BotPromptSuggestions, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotQuotaMetadata {
        botFeatureQuotaMetadata?: proto.IBotFeatureQuotaMetadata[];
    }

    class BotQuotaMetadata implements IBotQuotaMetadata {
        constructor(p?: IBotQuotaMetadata);
        public botFeatureQuotaMetadata: proto.IBotFeatureQuotaMetadata[];
        public static create(properties?: IBotQuotaMetadata): BotQuotaMetadata;
        public static encode(m: IBotQuotaMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotQuotaMetadata;
        public static fromObject(d: { [k: string]: any }): BotQuotaMetadata;
        public static toObject(m: BotQuotaMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotReminderMetadata {
        requestMessageKey?: (proto.IMessageKey|null);
        action?: proto.BotReminderMetadata.ReminderAction|null;
        name?: (string|null);
        nextTriggerTimestamp?: (number|Long|null);
        frequency?: proto.BotReminderMetadata.ReminderFrequency|null;
    }

    class BotReminderMetadata implements IBotReminderMetadata {
        constructor(p?: IBotReminderMetadata);
        public requestMessageKey?: (proto.IMessageKey|null);
        public action?: proto.BotReminderMetadata.ReminderAction|null;
        public name?: (string|null);
        public nextTriggerTimestamp?: (number|Long|null);
        public frequency?: proto.BotReminderMetadata.ReminderFrequency|null;
        public static create(properties?: IBotReminderMetadata): BotReminderMetadata;
        public static encode(m: IBotReminderMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotReminderMetadata;
        public static fromObject(d: { [k: string]: any }): BotReminderMetadata;
        public static toObject(m: BotReminderMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotRenderingConfigMetadata {
        bloksVersioningId?: (string|null);
        pixelDensity?: (number|null);
    }

    class BotRenderingConfigMetadata implements IBotRenderingConfigMetadata {
        constructor(p?: IBotRenderingConfigMetadata);
        public bloksVersioningId?: (string|null);
        public pixelDensity?: (number|null);
        public static create(properties?: IBotRenderingConfigMetadata): BotRenderingConfigMetadata;
        public static encode(m: IBotRenderingConfigMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotRenderingConfigMetadata;
        public static fromObject(d: { [k: string]: any }): BotRenderingConfigMetadata;
        public static toObject(m: BotRenderingConfigMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotRenderingMetadata {
        keywords?: proto.IKeyword[];
    }

    class BotRenderingMetadata implements IBotRenderingMetadata {
        constructor(p?: IBotRenderingMetadata);
        public keywords: proto.IKeyword[];
        public static create(properties?: IBotRenderingMetadata): BotRenderingMetadata;
        public static encode(m: IBotRenderingMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotRenderingMetadata;
        public static fromObject(d: { [k: string]: any }): BotRenderingMetadata;
        public static toObject(m: BotRenderingMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotSessionMetadata {
        sessionId?: (string|null);
        sessionSource?: proto.BotSessionSource|null;
    }

    class BotSessionMetadata implements IBotSessionMetadata {
        constructor(p?: IBotSessionMetadata);
        public sessionId?: (string|null);
        public sessionSource?: proto.BotSessionSource|null;
        public static create(properties?: IBotSessionMetadata): BotSessionMetadata;
        public static encode(m: IBotSessionMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSessionMetadata;
        public static fromObject(d: { [k: string]: any }): BotSessionMetadata;
        public static toObject(m: BotSessionMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotSignatureVerificationMetadata {
        proofs?: proto.IBotSignatureVerificationUseCaseProof[];
    }

    class BotSignatureVerificationMetadata implements IBotSignatureVerificationMetadata {
        constructor(p?: IBotSignatureVerificationMetadata);
        public proofs: proto.IBotSignatureVerificationUseCaseProof[];
        public static create(properties?: IBotSignatureVerificationMetadata): BotSignatureVerificationMetadata;
        public static encode(m: IBotSignatureVerificationMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSignatureVerificationMetadata;
        public static fromObject(d: { [k: string]: any }): BotSignatureVerificationMetadata;
        public static toObject(m: BotSignatureVerificationMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotSignatureVerificationUseCaseProof {
        version?: (number|null);
        useCase?: proto.BotSignatureVerificationUseCaseProof.BotSignatureUseCase|null;
        signature?: (Uint8Array|null);
        certificateChain?: Uint8Array[];
    }

    class BotSignatureVerificationUseCaseProof implements IBotSignatureVerificationUseCaseProof {
        constructor(p?: IBotSignatureVerificationUseCaseProof);
        public version?: (number|null);
        public useCase?: proto.BotSignatureVerificationUseCaseProof.BotSignatureUseCase|null;
        public signature?: (Uint8Array|null);
        public certificateChain: Uint8Array[];
        public static create(properties?: IBotSignatureVerificationUseCaseProof): BotSignatureVerificationUseCaseProof;
        public static encode(m: IBotSignatureVerificationUseCaseProof, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSignatureVerificationUseCaseProof;
        public static fromObject(d: { [k: string]: any }): BotSignatureVerificationUseCaseProof;
        public static toObject(m: BotSignatureVerificationUseCaseProof, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotSourcesMetadata {
        sources?: proto.IBotSourceItem[];
    }

    class BotSourcesMetadata implements IBotSourcesMetadata {
        constructor(p?: IBotSourcesMetadata);
        public sources: proto.IBotSourceItem[];
        public static create(properties?: IBotSourcesMetadata): BotSourcesMetadata;
        public static encode(m: IBotSourcesMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSourcesMetadata;
        public static fromObject(d: { [k: string]: any }): BotSourcesMetadata;
        public static toObject(m: BotSourcesMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotSuggestedPromptMetadata {
        suggestedPrompts?: string[];
        selectedPromptIndex?: (number|null);
        promptSuggestions?: (proto.IBotPromptSuggestions|null);
        selectedPromptId?: (string|null);
    }

    class BotSuggestedPromptMetadata implements IBotSuggestedPromptMetadata {
        constructor(p?: IBotSuggestedPromptMetadata);
        public suggestedPrompts: string[];
        public selectedPromptIndex?: (number|null);
        public promptSuggestions?: (proto.IBotPromptSuggestions|null);
        public selectedPromptId?: (string|null);
        public static create(properties?: IBotSuggestedPromptMetadata): BotSuggestedPromptMetadata;
        public static encode(m: IBotSuggestedPromptMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSuggestedPromptMetadata;
        public static fromObject(d: { [k: string]: any }): BotSuggestedPromptMetadata;
        public static toObject(m: BotSuggestedPromptMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IBotUnifiedResponseMutation {
        sbsMetadata?: (proto.ISideBySideMetadata|null);
        mediaDetailsMetadataList?: proto.IMediaDetailsMetadata[];
    }

    class BotUnifiedResponseMutation implements IBotUnifiedResponseMutation {
        constructor(p?: IBotUnifiedResponseMutation);
        public sbsMetadata?: (proto.ISideBySideMetadata|null);
        public mediaDetailsMetadataList: proto.IMediaDetailsMetadata[];
        public static create(properties?: IBotUnifiedResponseMutation): BotUnifiedResponseMutation;
        public static encode(m: IBotUnifiedResponseMutation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotUnifiedResponseMutation;
        public static fromObject(d: { [k: string]: any }): BotUnifiedResponseMutation;
        public static toObject(m: BotUnifiedResponseMutation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICallLogRecord {
        callResult?: proto.CallLogRecord.CallResult|null;
        isDndMode?: (boolean|null);
        silenceReason?: proto.CallLogRecord.SilenceReason|null;
        duration?: (number|Long|null);
        startTime?: (number|Long|null);
        isIncoming?: (boolean|null);
        isVideo?: (boolean|null);
        isCallLink?: (boolean|null);
        callLinkToken?: (string|null);
        scheduledCallId?: (string|null);
        callId?: (string|null);
        callCreatorJid?: (string|null);
        groupJid?: (string|null);
        participants?: proto.IParticipantInfo[];
        callType?: proto.CallLogRecord.CallType|null;
    }

    class CallLogRecord implements ICallLogRecord {
        constructor(p?: ICallLogRecord);
        public callResult?: proto.CallLogRecord.CallResult|null;
        public isDndMode?: (boolean|null);
        public silenceReason?: proto.CallLogRecord.SilenceReason|null;
        public duration?: (number|Long|null);
        public startTime?: (number|Long|null);
        public isIncoming?: (boolean|null);
        public isVideo?: (boolean|null);
        public isCallLink?: (boolean|null);
        public callLinkToken?: (string|null);
        public scheduledCallId?: (string|null);
        public callId?: (string|null);
        public callCreatorJid?: (string|null);
        public groupJid?: (string|null);
        public participants: proto.IParticipantInfo[];
        public callType?: proto.CallLogRecord.CallType|null;
        public static create(properties?: ICallLogRecord): CallLogRecord;
        public static encode(m: ICallLogRecord, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CallLogRecord;
        public static fromObject(d: { [k: string]: any }): CallLogRecord;
        public static toObject(m: CallLogRecord, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICertChain {
        leaf?: (proto.INoiseCertificate|null);
        intermediate?: (proto.INoiseCertificate|null);
    }

    class CertChain implements ICertChain {
        constructor(p?: ICertChain);
        public leaf?: (proto.INoiseCertificate|null);
        public intermediate?: (proto.INoiseCertificate|null);
        public static create(properties?: ICertChain): CertChain;
        public static encode(m: ICertChain, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CertChain;
        public static fromObject(d: { [k: string]: any }): CertChain;
        public static toObject(m: CertChain, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IChatLockSettings {
        hideLockedChats?: (boolean|null);
        secretCode?: (proto.IUserPassword|null);
    }

    class ChatLockSettings implements IChatLockSettings {
        constructor(p?: IChatLockSettings);
        public hideLockedChats?: (boolean|null);
        public secretCode?: (proto.IUserPassword|null);
        public static create(properties?: IChatLockSettings): ChatLockSettings;
        public static encode(m: IChatLockSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ChatLockSettings;
        public static fromObject(d: { [k: string]: any }): ChatLockSettings;
        public static toObject(m: ChatLockSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IChatRowOpaqueData {
        draftMessage?: (proto.IDraftMessage|null);
    }

    class ChatRowOpaqueData implements IChatRowOpaqueData {
        constructor(p?: IChatRowOpaqueData);
        public draftMessage?: (proto.IDraftMessage|null);
        public static create(properties?: IChatRowOpaqueData): ChatRowOpaqueData;
        public static encode(m: IChatRowOpaqueData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ChatRowOpaqueData;
        public static fromObject(d: { [k: string]: any }): ChatRowOpaqueData;
        public static toObject(m: ChatRowOpaqueData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICitation {
        title?: string;
        subtitle?: string;
        cmsId?: string;
        imageUrl?: string;
    }

    class Citation implements ICitation {
        constructor(p?: ICitation);
        public title: string;
        public subtitle: string;
        public cmsId: string;
        public imageUrl: string;
        public static create(properties?: ICitation): Citation;
        public static encode(m: ICitation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Citation;
        public static fromObject(d: { [k: string]: any }): Citation;
        public static toObject(m: Citation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IClientPairingProps {
        isChatDbLidMigrated?: (boolean|null);
        isSyncdPureLidSession?: (boolean|null);
        isSyncdSnapshotRecoveryEnabled?: (boolean|null);
        isHsThumbnailSyncEnabled?: (boolean|null);
    }

    class ClientPairingProps implements IClientPairingProps {
        constructor(p?: IClientPairingProps);
        public isChatDbLidMigrated?: (boolean|null);
        public isSyncdPureLidSession?: (boolean|null);
        public isSyncdSnapshotRecoveryEnabled?: (boolean|null);
        public isHsThumbnailSyncEnabled?: (boolean|null);
        public static create(properties?: IClientPairingProps): ClientPairingProps;
        public static encode(m: IClientPairingProps, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ClientPairingProps;
        public static fromObject(d: { [k: string]: any }): ClientPairingProps;
        public static toObject(m: ClientPairingProps, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IClientPayload {
        username?: (number|Long|null);
        passive?: (boolean|null);
        userAgent?: (proto.IUserAgent|null);
        webInfo?: (proto.IWebInfo|null);
        pushName?: (string|null);
        sessionId?: (number|null);
        shortConnect?: (boolean|null);
        connectType?: proto.ClientPayload.ConnectType|null;
        connectReason?: proto.ClientPayload.ConnectReason|null;
        shards?: number[];
        dnsSource?: (proto.IDnsSource|null);
        connectAttemptCount?: (number|null);
        device?: (number|null);
        devicePairingData?: (proto.IDevicePairingRegistrationData|null);
        product?: proto.ClientPayload.Product|null;
        fbCat?: (Uint8Array|null);
        fbUserAgent?: (Uint8Array|null);
        oc?: (boolean|null);
        lc?: (number|null);
        iosAppExtension?: proto.ClientPayload.IosAppExtension|null;
        fbAppId?: (number|Long|null);
        fbDeviceId?: (Uint8Array|null);
        pull?: (boolean|null);
        paddingBytes?: (Uint8Array|null);
        yearClass?: (number|null);
        memClass?: (number|null);
        interopData?: (proto.IInteropData|null);
        trafficAnonymization?: proto.ClientPayload.TrafficAnonymization|null;
        lidDbMigrated?: (boolean|null);
        accountType?: proto.ClientPayload.AccountType|null;
        connectionSequenceInfo?: (number|null);
        paaLink?: (boolean|null);
        preacksCount?: (number|null);
        processingQueueSize?: (number|null);
    }

    class ClientPayload implements IClientPayload {
        constructor(p?: IClientPayload);
        public username?: (number|Long|null);
        public passive?: (boolean|null);
        public userAgent?: (proto.IUserAgent|null);
        public webInfo?: (proto.IWebInfo|null);
        public pushName?: (string|null);
        public sessionId?: (number|null);
        public shortConnect?: (boolean|null);
        public connectType?: proto.ClientPayload.ConnectType|null;
        public connectReason?: proto.ClientPayload.ConnectReason|null;
        public shards: number[];
        public dnsSource?: (proto.IDnsSource|null);
        public connectAttemptCount?: (number|null);
        public device?: (number|null);
        public devicePairingData?: (proto.IDevicePairingRegistrationData|null);
        public product?: proto.ClientPayload.Product|null;
        public fbCat?: (Uint8Array|null);
        public fbUserAgent?: (Uint8Array|null);
        public oc?: (boolean|null);
        public lc?: (number|null);
        public iosAppExtension?: proto.ClientPayload.IosAppExtension|null;
        public fbAppId?: (number|Long|null);
        public fbDeviceId?: (Uint8Array|null);
        public pull?: (boolean|null);
        public paddingBytes?: (Uint8Array|null);
        public yearClass?: (number|null);
        public memClass?: (number|null);
        public interopData?: (proto.IInteropData|null);
        public trafficAnonymization?: proto.ClientPayload.TrafficAnonymization|null;
        public lidDbMigrated?: (boolean|null);
        public accountType?: proto.ClientPayload.AccountType|null;
        public connectionSequenceInfo?: (number|null);
        public paaLink?: (boolean|null);
        public preacksCount?: (number|null);
        public processingQueueSize?: (number|null);
        public static create(properties?: IClientPayload): ClientPayload;
        public static encode(m: IClientPayload, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ClientPayload;
        public static fromObject(d: { [k: string]: any }): ClientPayload;
        public static toObject(m: ClientPayload, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICommentMetadata {
        commentParentKey?: (proto.IMessageKey|null);
        replyCount?: (number|null);
    }

    class CommentMetadata implements ICommentMetadata {
        constructor(p?: ICommentMetadata);
        public commentParentKey?: (proto.IMessageKey|null);
        public replyCount?: (number|null);
        public static create(properties?: ICommentMetadata): CommentMetadata;
        public static encode(m: ICommentMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CommentMetadata;
        public static fromObject(d: { [k: string]: any }): CommentMetadata;
        public static toObject(m: CommentMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICompanionCommitment {
        hash?: (Uint8Array|null);
    }

    class CompanionCommitment implements ICompanionCommitment {
        constructor(p?: ICompanionCommitment);
        public hash?: (Uint8Array|null);
        public static create(properties?: ICompanionCommitment): CompanionCommitment;
        public static encode(m: ICompanionCommitment, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CompanionCommitment;
        public static fromObject(d: { [k: string]: any }): CompanionCommitment;
        public static toObject(m: CompanionCommitment, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ICompanionEphemeralIdentity {
        publicKey?: (Uint8Array|null);
        deviceType?: proto.DeviceProps.PlatformType|null;
        ref?: (string|null);
    }

    class CompanionEphemeralIdentity implements ICompanionEphemeralIdentity {
        constructor(p?: ICompanionEphemeralIdentity);
        public publicKey?: (Uint8Array|null);
        public deviceType?: proto.DeviceProps.PlatformType|null;
        public ref?: (string|null);
        public static create(properties?: ICompanionEphemeralIdentity): CompanionEphemeralIdentity;
        public static encode(m: ICompanionEphemeralIdentity, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CompanionEphemeralIdentity;
        public static fromObject(d: { [k: string]: any }): CompanionEphemeralIdentity;
        public static toObject(m: CompanionEphemeralIdentity, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IConfig {
        field?: proto.IHashMap;
        version?: (number|null);
    }

    class Config implements IConfig {
        constructor(p?: IConfig);
        public field: proto.IHashMap;
        public version?: (number|null);
        public static create(properties?: IConfig): Config;
        public static encode(m: IConfig, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Config;
        public static fromObject(d: { [k: string]: any }): Config;
        public static toObject(m: Config, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IContextInfo {
        stanzaId?: (string|null);
        participant?: (string|null);
        quotedMessage?: (proto.IMessage|null);
        remoteJid?: (string|null);
        mentionedJid?: string[];
        conversionSource?: (string|null);
        conversionData?: (Uint8Array|null);
        conversionDelaySeconds?: (number|null);
        forwardingScore?: (number|null);
        isForwarded?: (boolean|null);
        quotedAd?: (proto.IAdReplyInfo|null);
        placeholderKey?: (proto.IMessageKey|null);
        expiration?: (number|null);
        ephemeralSettingTimestamp?: (number|Long|null);
        ephemeralSharedSecret?: (Uint8Array|null);
        externalAdReply?: (proto.IExternalAdReplyInfo|null);
        entryPointConversionSource?: (string|null);
        entryPointConversionApp?: (string|null);
        entryPointConversionDelaySeconds?: (number|null);
        disappearingMode?: (proto.IDisappearingMode|null);
        actionLink?: (proto.IActionLink|null);
        groupSubject?: (string|null);
        parentGroupJid?: (string|null);
        trustBannerType?: (string|null);
        trustBannerAction?: (number|null);
        isSampled?: (boolean|null);
        groupMentions?: proto.IGroupMention[];
        utm?: (proto.IUtmInfo|null);
        forwardedNewsletterMessageInfo?: (proto.IForwardedNewsletterMessageInfo|null);
        businessMessageForwardInfo?: (proto.IBusinessMessageForwardInfo|null);
        smbClientCampaignId?: (string|null);
        smbServerCampaignId?: (string|null);
        dataSharingContext?: (proto.IDataSharingContext|null);
        alwaysShowAdAttribution?: (boolean|null);
        featureEligibilities?: (proto.IFeatureEligibilities|null);
        entryPointConversionExternalSource?: (string|null);
        entryPointConversionExternalMedium?: (string|null);
        ctwaSignals?: (string|null);
        ctwaPayload?: (Uint8Array|null);
        forwardedAiBotMessageInfo?: (proto.IForwardedAiBotMessageInfo|null);
        statusAttributionType?: proto.ContextInfo.StatusAttributionType|null;
        urlTrackingMap?: (proto.IUrlTrackingMap|null);
        pairedMediaType?: proto.ContextInfo.PairedMediaType|null;
        rankingVersion?: (number|null);
        memberLabel?: (proto.IMemberLabel|null);
        isQuestion?: (boolean|null);
        statusSourceType?: proto.ContextInfo.StatusSourceType|null;
        statusAttributions?: proto.IStatusAttribution[];
        isGroupStatus?: (boolean|null);
        forwardOrigin?: proto.ContextInfo.ForwardOrigin|null;
        questionReplyQuotedMessage?: (proto.IQuestionReplyQuotedMessage|null);
        statusAudienceMetadata?: (proto.IStatusAudienceMetadata|null);
        nonJidMentions?: (number|null);
        quotedType?: proto.ContextInfo.QuotedType|null;
        botMessageSharingInfo?: (proto.IBotMessageSharingInfo|null);
    }

    class ContextInfo implements IContextInfo {
        constructor(p?: IContextInfo);
        public stanzaId?: (string|null);
        public participant?: (string|null);
        public quotedMessage?: (proto.IMessage|null);
        public remoteJid?: (string|null);
        public mentionedJid: string[];
        public conversionSource?: (string|null);
        public conversionData?: (Uint8Array|null);
        public conversionDelaySeconds?: (number|null);
        public forwardingScore?: (number|null);
        public isForwarded?: (boolean|null);
        public quotedAd?: (proto.IAdReplyInfo|null);
        public placeholderKey?: (proto.IMessageKey|null);
        public expiration?: (number|null);
        public ephemeralSettingTimestamp?: (number|Long|null);
        public ephemeralSharedSecret?: (Uint8Array|null);
        public externalAdReply?: (proto.IExternalAdReplyInfo|null);
        public entryPointConversionSource?: (string|null);
        public entryPointConversionApp?: (string|null);
        public entryPointConversionDelaySeconds?: (number|null);
        public disappearingMode?: (proto.IDisappearingMode|null);
        public actionLink?: (proto.IActionLink|null);
        public groupSubject?: (string|null);
        public parentGroupJid?: (string|null);
        public trustBannerType?: (string|null);
        public trustBannerAction?: (number|null);
        public isSampled?: (boolean|null);
        public groupMentions: proto.IGroupMention[];
        public utm?: (proto.IUtmInfo|null);
        public forwardedNewsletterMessageInfo?: (proto.IForwardedNewsletterMessageInfo|null);
        public businessMessageForwardInfo?: (proto.IBusinessMessageForwardInfo|null);
        public smbClientCampaignId?: (string|null);
        public smbServerCampaignId?: (string|null);
        public dataSharingContext?: (proto.IDataSharingContext|null);
        public alwaysShowAdAttribution?: (boolean|null);
        public featureEligibilities?: (proto.IFeatureEligibilities|null);
        public entryPointConversionExternalSource?: (string|null);
        public entryPointConversionExternalMedium?: (string|null);
        public ctwaSignals?: (string|null);
        public ctwaPayload?: (Uint8Array|null);
        public forwardedAiBotMessageInfo?: (proto.IForwardedAiBotMessageInfo|null);
        public statusAttributionType?: proto.ContextInfo.StatusAttributionType|null;
        public urlTrackingMap?: (proto.IUrlTrackingMap|null);
        public pairedMediaType?: proto.ContextInfo.PairedMediaType|null;
        public rankingVersion?: (number|null);
        public memberLabel?: (proto.IMemberLabel|null);
        public isQuestion?: (boolean|null);
        public statusSourceType?: proto.ContextInfo.StatusSourceType|null;
        public statusAttributions: proto.IStatusAttribution[];
        public isGroupStatus?: (boolean|null);
        public forwardOrigin?: proto.ContextInfo.ForwardOrigin|null;
        public questionReplyQuotedMessage?: (proto.IQuestionReplyQuotedMessage|null);
        public statusAudienceMetadata?: (proto.IStatusAudienceMetadata|null);
        public nonJidMentions?: (number|null);
        public quotedType?: proto.ContextInfo.QuotedType|null;
        public botMessageSharingInfo?: (proto.IBotMessageSharingInfo|null);
        public static create(properties?: IContextInfo): ContextInfo;
        public static encode(m: IContextInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ContextInfo;
        public static fromObject(d: { [k: string]: any }): ContextInfo;
        public static toObject(m: ContextInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IConversation {
        id?: string;
        messages?: proto.IHistorySyncMsg[];
        newJid?: (string|null);
        oldJid?: (string|null);
        lastMsgTimestamp?: (number|Long|null);
        unreadCount?: (number|null);
        readOnly?: (boolean|null);
        endOfHistoryTransfer?: (boolean|null);
        ephemeralExpiration?: (number|null);
        ephemeralSettingTimestamp?: (number|Long|null);
        endOfHistoryTransferType?: proto.Conversation.EndOfHistoryTransferType|null;
        conversationTimestamp?: (number|Long|null);
        name?: (string|null);
        pHash?: (string|null);
        notSpam?: (boolean|null);
        archived?: (boolean|null);
        disappearingMode?: (proto.IDisappearingMode|null);
        unreadMentionCount?: (number|null);
        markedAsUnread?: (boolean|null);
        participant?: proto.IGroupParticipant[];
        tcToken?: (Uint8Array|null);
        tcTokenTimestamp?: (number|Long|null);
        contactPrimaryIdentityKey?: (Uint8Array|null);
        pinned?: (number|null);
        muteEndTime?: (number|Long|null);
        wallpaper?: (proto.IWallpaperSettings|null);
        mediaVisibility?: proto.MediaVisibility|null;
        tcTokenSenderTimestamp?: (number|Long|null);
        suspended?: (boolean|null);
        terminated?: (boolean|null);
        createdAt?: (number|Long|null);
        createdBy?: (string|null);
        description?: (string|null);
        support?: (boolean|null);
        isParentGroup?: (boolean|null);
        parentGroupId?: (string|null);
        isDefaultSubgroup?: (boolean|null);
        displayName?: (string|null);
        pnJid?: (string|null);
        shareOwnPn?: (boolean|null);
        pnhDuplicateLidThread?: (boolean|null);
        lidJid?: (string|null);
        username?: (string|null);
        lidOriginType?: (string|null);
        commentsCount?: (number|null);
        locked?: (boolean|null);
        systemMessageToInsert?: proto.PrivacySystemMessage|null;
        capiCreatedGroup?: (boolean|null);
        accountLid?: (string|null);
        limitSharing?: (boolean|null);
        limitSharingSettingTimestamp?: (number|Long|null);
        limitSharingTrigger?: proto.LimitSharing.TriggerType|null;
        limitSharingInitiatedByMe?: (boolean|null);
        maibaAiThreadEnabled?: (boolean|null);
    }

    class Conversation implements IConversation {
        constructor(p?: IConversation);
        public id: string;
        public messages: proto.IHistorySyncMsg[];
        public newJid?: (string|null);
        public oldJid?: (string|null);
        public lastMsgTimestamp?: (number|Long|null);
        public unreadCount?: (number|null);
        public readOnly?: (boolean|null);
        public endOfHistoryTransfer?: (boolean|null);
        public ephemeralExpiration?: (number|null);
        public ephemeralSettingTimestamp?: (number|Long|null);
        public endOfHistoryTransferType?: proto.Conversation.EndOfHistoryTransferType|null;
        public conversationTimestamp?: (number|Long|null);
        public name?: (string|null);
        public pHash?: (string|null);
        public notSpam?: (boolean|null);
        public archived?: (boolean|null);
        public disappearingMode?: (proto.IDisappearingMode|null);
        public unreadMentionCount?: (number|null);
        public markedAsUnread?: (boolean|null);
        public participant: proto.IGroupParticipant[];
        public tcToken?: (Uint8Array|null);
        public tcTokenTimestamp?: (number|Long|null);
        public contactPrimaryIdentityKey?: (Uint8Array|null);
        public pinned?: (number|null);
        public muteEndTime?: (number|Long|null);
        public wallpaper?: (proto.IWallpaperSettings|null);
        public mediaVisibility?: proto.MediaVisibility|null;
        public tcTokenSenderTimestamp?: (number|Long|null);
        public suspended?: (boolean|null);
        public terminated?: (boolean|null);
        public createdAt?: (number|Long|null);
        public createdBy?: (string|null);
        public description?: (string|null);
        public support?: (boolean|null);
        public isParentGroup?: (boolean|null);
        public parentGroupId?: (string|null);
        public isDefaultSubgroup?: (boolean|null);
        public displayName?: (string|null);
        public pnJid?: (string|null);
        public shareOwnPn?: (boolean|null);
        public pnhDuplicateLidThread?: (boolean|null);
        public lidJid?: (string|null);
        public username?: (string|null);
        public lidOriginType?: (string|null);
        public commentsCount?: (number|null);
        public locked?: (boolean|null);
        public systemMessageToInsert?: proto.PrivacySystemMessage|null;
        public capiCreatedGroup?: (boolean|null);
        public accountLid?: (string|null);
        public limitSharing?: (boolean|null);
        public limitSharingSettingTimestamp?: (number|Long|null);
        public limitSharingTrigger?: proto.LimitSharing.TriggerType|null;
        public limitSharingInitiatedByMe?: (boolean|null);
        public maibaAiThreadEnabled?: (boolean|null);
        public static create(properties?: IConversation): Conversation;
        public static encode(m: IConversation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Conversation;
        public static fromObject(d: { [k: string]: any }): Conversation;
        public static toObject(m: Conversation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IDeviceCapabilities {
        chatLockSupportLevel?: proto.DeviceCapabilities.ChatLockSupportLevel|null;
        lidMigration?: (proto.ILidMigration|null);
        businessBroadcast?: (proto.IBusinessBroadcast|null);
        userHasAvatar?: (proto.IUserHasAvatar|null);
        memberNameTagPrimarySupport?: proto.DeviceCapabilities.MemberNameTagPrimarySupport|null;
        aiThread?: (proto.IAiThread|null);
    }

    class DeviceCapabilities implements IDeviceCapabilities {
        constructor(p?: IDeviceCapabilities);
        public chatLockSupportLevel?: proto.DeviceCapabilities.ChatLockSupportLevel|null;
        public lidMigration?: (proto.ILidMigration|null);
        public businessBroadcast?: (proto.IBusinessBroadcast|null);
        public userHasAvatar?: (proto.IUserHasAvatar|null);
        public memberNameTagPrimarySupport?: proto.DeviceCapabilities.MemberNameTagPrimarySupport|null;
        public aiThread?: (proto.IAiThread|null);
        public static create(properties?: IDeviceCapabilities): DeviceCapabilities;
        public static encode(m: IDeviceCapabilities, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeviceCapabilities;
        public static fromObject(d: { [k: string]: any }): DeviceCapabilities;
        public static toObject(m: DeviceCapabilities, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IDeviceConsistencyCodeMessage {
        generation?: (number|null);
        signature?: (Uint8Array|null);
    }

    class DeviceConsistencyCodeMessage implements IDeviceConsistencyCodeMessage {
        constructor(p?: IDeviceConsistencyCodeMessage);
        public generation?: (number|null);
        public signature?: (Uint8Array|null);
        public static create(properties?: IDeviceConsistencyCodeMessage): DeviceConsistencyCodeMessage;
        public static encode(m: IDeviceConsistencyCodeMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeviceConsistencyCodeMessage;
        public static fromObject(d: { [k: string]: any }): DeviceConsistencyCodeMessage;
        public static toObject(m: DeviceConsistencyCodeMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IDeviceListMetadata {
        senderKeyHash?: (Uint8Array|null);
        senderTimestamp?: (number|Long|null);
        senderKeyIndexes?: number[];
        senderAccountType?: proto.AdvEncryptionType|null;
        receiverAccountType?: proto.AdvEncryptionType|null;
        recipientKeyHash?: (Uint8Array|null);
        recipientTimestamp?: (number|Long|null);
        recipientKeyIndexes?: number[];
    }

    class DeviceListMetadata implements IDeviceListMetadata {
        constructor(p?: IDeviceListMetadata);
        public senderKeyHash?: (Uint8Array|null);
        public senderTimestamp?: (number|Long|null);
        public senderKeyIndexes: number[];
        public senderAccountType?: proto.AdvEncryptionType|null;
        public receiverAccountType?: proto.AdvEncryptionType|null;
        public recipientKeyHash?: (Uint8Array|null);
        public recipientTimestamp?: (number|Long|null);
        public recipientKeyIndexes: number[];
        public static create(properties?: IDeviceListMetadata): DeviceListMetadata;
        public static encode(m: IDeviceListMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeviceListMetadata;
        public static fromObject(d: { [k: string]: any }): DeviceListMetadata;
        public static toObject(m: DeviceListMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IDeviceProps {
        os?: (string|null);
        version?: (proto.IAppVersion|null);
        platformType?: proto.DeviceProps.PlatformType|null;
        requireFullSync?: (boolean|null);
        historySyncConfig?: (proto.IHistorySyncConfig|null);
    }

    class DeviceProps implements IDeviceProps {
        constructor(p?: IDeviceProps);
        public os?: (string|null);
        public version?: (proto.IAppVersion|null);
        public platformType?: proto.DeviceProps.PlatformType|null;
        public requireFullSync?: (boolean|null);
        public historySyncConfig?: (proto.IHistorySyncConfig|null);
        public static create(properties?: IDeviceProps): DeviceProps;
        public static encode(m: IDeviceProps, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeviceProps;
        public static fromObject(d: { [k: string]: any }): DeviceProps;
        public static toObject(m: DeviceProps, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IDisappearingMode {
        initiator?: proto.DisappearingMode.Initiator|null;
        trigger?: proto.DisappearingMode.Trigger|null;
        initiatorDeviceJid?: (string|null);
        initiatedByMe?: (boolean|null);
    }

    class DisappearingMode implements IDisappearingMode {
        constructor(p?: IDisappearingMode);
        public initiator?: proto.DisappearingMode.Initiator|null;
        public trigger?: proto.DisappearingMode.Trigger|null;
        public initiatorDeviceJid?: (string|null);
        public initiatedByMe?: (boolean|null);
        public static create(properties?: IDisappearingMode): DisappearingMode;
        public static encode(m: IDisappearingMode, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DisappearingMode;
        public static fromObject(d: { [k: string]: any }): DisappearingMode;
        public static toObject(m: DisappearingMode, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEmbeddedContent {
        embeddedMessage?: (proto.IEmbeddedMessage|null);
        embeddedMusic?: (proto.IEmbeddedMusic|null);
        /** Prost oneof field */
        content?: {
            embeddedMessage?: (proto.IEmbeddedMessage|null);
            embeddedMusic?: (proto.IEmbeddedMusic|null);
        } | null;
    }

    class EmbeddedContent implements IEmbeddedContent {
        constructor(p?: IEmbeddedContent);
        public embeddedMessage?: (proto.IEmbeddedMessage|null);
        public embeddedMusic?: (proto.IEmbeddedMusic|null);
        public content?: ("embeddedMessage"|"embeddedMusic");
        public static create(properties?: IEmbeddedContent): EmbeddedContent;
        public static encode(m: IEmbeddedContent, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EmbeddedContent;
        public static fromObject(d: { [k: string]: any }): EmbeddedContent;
        public static toObject(m: EmbeddedContent, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEmbeddedMessage {
        stanzaId?: (string|null);
        message?: (proto.IMessage|null);
    }

    class EmbeddedMessage implements IEmbeddedMessage {
        constructor(p?: IEmbeddedMessage);
        public stanzaId?: (string|null);
        public message?: (proto.IMessage|null);
        public static create(properties?: IEmbeddedMessage): EmbeddedMessage;
        public static encode(m: IEmbeddedMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EmbeddedMessage;
        public static fromObject(d: { [k: string]: any }): EmbeddedMessage;
        public static toObject(m: EmbeddedMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEmbeddedMusic {
        musicContentMediaId?: (string|null);
        songId?: (string|null);
        author?: (string|null);
        title?: (string|null);
        artworkDirectPath?: (string|null);
        artworkSha256?: (Uint8Array|null);
        artworkEncSha256?: (Uint8Array|null);
        artistAttribution?: (string|null);
        countryBlocklist?: (Uint8Array|null);
        isExplicit?: (boolean|null);
        artworkMediaKey?: (Uint8Array|null);
        musicSongStartTimeInMs?: (number|Long|null);
        derivedContentStartTimeInMs?: (number|Long|null);
        overlapDurationInMs?: (number|Long|null);
    }

    class EmbeddedMusic implements IEmbeddedMusic {
        constructor(p?: IEmbeddedMusic);
        public musicContentMediaId?: (string|null);
        public songId?: (string|null);
        public author?: (string|null);
        public title?: (string|null);
        public artworkDirectPath?: (string|null);
        public artworkSha256?: (Uint8Array|null);
        public artworkEncSha256?: (Uint8Array|null);
        public artistAttribution?: (string|null);
        public countryBlocklist?: (Uint8Array|null);
        public isExplicit?: (boolean|null);
        public artworkMediaKey?: (Uint8Array|null);
        public musicSongStartTimeInMs?: (number|Long|null);
        public derivedContentStartTimeInMs?: (number|Long|null);
        public overlapDurationInMs?: (number|Long|null);
        public static create(properties?: IEmbeddedMusic): EmbeddedMusic;
        public static encode(m: IEmbeddedMusic, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EmbeddedMusic;
        public static fromObject(d: { [k: string]: any }): EmbeddedMusic;
        public static toObject(m: EmbeddedMusic, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEncryptedPairingRequest {
        encryptedPayload?: (Uint8Array|null);
        iv?: (Uint8Array|null);
    }

    class EncryptedPairingRequest implements IEncryptedPairingRequest {
        constructor(p?: IEncryptedPairingRequest);
        public encryptedPayload?: (Uint8Array|null);
        public iv?: (Uint8Array|null);
        public static create(properties?: IEncryptedPairingRequest): EncryptedPairingRequest;
        public static encode(m: IEncryptedPairingRequest, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EncryptedPairingRequest;
        public static fromObject(d: { [k: string]: any }): EncryptedPairingRequest;
        public static toObject(m: EncryptedPairingRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEphemeralSetting {
        duration?: (number|null);
        timestamp?: (number|Long|null);
    }

    class EphemeralSetting implements IEphemeralSetting {
        constructor(p?: IEphemeralSetting);
        public duration?: (number|null);
        public timestamp?: (number|Long|null);
        public static create(properties?: IEphemeralSetting): EphemeralSetting;
        public static encode(m: IEphemeralSetting, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EphemeralSetting;
        public static fromObject(d: { [k: string]: any }): EphemeralSetting;
        public static toObject(m: EphemeralSetting, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEventAdditionalMetadata {
        isStale?: (boolean|null);
    }

    class EventAdditionalMetadata implements IEventAdditionalMetadata {
        constructor(p?: IEventAdditionalMetadata);
        public isStale?: (boolean|null);
        public static create(properties?: IEventAdditionalMetadata): EventAdditionalMetadata;
        public static encode(m: IEventAdditionalMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EventAdditionalMetadata;
        public static fromObject(d: { [k: string]: any }): EventAdditionalMetadata;
        public static toObject(m: EventAdditionalMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IEventResponse {
        eventResponseMessageKey?: (proto.IMessageKey|null);
        timestampMs?: (number|Long|null);
        eventResponseMessage?: (proto.IEventResponseMessage|null);
        unread?: (boolean|null);
    }

    class EventResponse implements IEventResponse {
        constructor(p?: IEventResponse);
        public eventResponseMessageKey?: (proto.IMessageKey|null);
        public timestampMs?: (number|Long|null);
        public eventResponseMessage?: (proto.IEventResponseMessage|null);
        public unread?: (boolean|null);
        public static create(properties?: IEventResponse): EventResponse;
        public static encode(m: IEventResponse, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EventResponse;
        public static fromObject(d: { [k: string]: any }): EventResponse;
        public static toObject(m: EventResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IExitCode {
        code?: (number|Long|null);
        text?: (string|null);
    }

    class ExitCode implements IExitCode {
        constructor(p?: IExitCode);
        public code?: (number|Long|null);
        public text?: (string|null);
        public static create(properties?: IExitCode): ExitCode;
        public static encode(m: IExitCode, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExitCode;
        public static fromObject(d: { [k: string]: any }): ExitCode;
        public static toObject(m: ExitCode, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IExternalBlobReference {
        mediaKey?: (Uint8Array|null);
        directPath?: (string|null);
        handle?: (string|null);
        fileSizeBytes?: (number|Long|null);
        fileSha256?: (Uint8Array|null);
        fileEncSha256?: (Uint8Array|null);
    }

    class ExternalBlobReference implements IExternalBlobReference {
        constructor(p?: IExternalBlobReference);
        public mediaKey?: (Uint8Array|null);
        public directPath?: (string|null);
        public handle?: (string|null);
        public fileSizeBytes?: (number|Long|null);
        public fileSha256?: (Uint8Array|null);
        public fileEncSha256?: (Uint8Array|null);
        public static create(properties?: IExternalBlobReference): ExternalBlobReference;
        public static encode(m: IExternalBlobReference, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExternalBlobReference;
        public static fromObject(d: { [k: string]: any }): ExternalBlobReference;
        public static toObject(m: ExternalBlobReference, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IField {
        minVersion?: (number|null);
        maxVersion?: (number|null);
        notReportableMinVersion?: (number|null);
        isMessage?: (boolean|null);
        subfield?: proto.IHashMap;
    }

    class Field implements IField {
        constructor(p?: IField);
        public minVersion?: (number|null);
        public maxVersion?: (number|null);
        public notReportableMinVersion?: (number|null);
        public isMessage?: (boolean|null);
        public subfield: proto.IHashMap;
        public static create(properties?: IField): Field;
        public static encode(m: IField, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Field;
        public static fromObject(d: { [k: string]: any }): Field;
        public static toObject(m: Field, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IForwardedAiBotMessageInfo {
        botName?: (string|null);
        botJid?: (string|null);
        creatorName?: (string|null);
    }

    class ForwardedAiBotMessageInfo implements IForwardedAiBotMessageInfo {
        constructor(p?: IForwardedAiBotMessageInfo);
        public botName?: (string|null);
        public botJid?: (string|null);
        public creatorName?: (string|null);
        public static create(properties?: IForwardedAiBotMessageInfo): ForwardedAiBotMessageInfo;
        public static encode(m: IForwardedAiBotMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ForwardedAiBotMessageInfo;
        public static fromObject(d: { [k: string]: any }): ForwardedAiBotMessageInfo;
        public static toObject(m: ForwardedAiBotMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IGlobalSettings {
        lightThemeWallpaper?: (proto.IWallpaperSettings|null);
        mediaVisibility?: proto.MediaVisibility|null;
        darkThemeWallpaper?: (proto.IWallpaperSettings|null);
        autoDownloadWiFi?: (proto.IAutoDownloadSettings|null);
        autoDownloadCellular?: (proto.IAutoDownloadSettings|null);
        autoDownloadRoaming?: (proto.IAutoDownloadSettings|null);
        showIndividualNotificationsPreview?: (boolean|null);
        showGroupNotificationsPreview?: (boolean|null);
        disappearingModeDuration?: (number|null);
        disappearingModeTimestamp?: (number|Long|null);
        avatarUserSettings?: (proto.IAvatarUserSettings|null);
        fontSize?: (number|null);
        securityNotifications?: (boolean|null);
        autoUnarchiveChats?: (boolean|null);
        videoQualityMode?: (number|null);
        photoQualityMode?: (number|null);
        individualNotificationSettings?: (proto.INotificationSettings|null);
        groupNotificationSettings?: (proto.INotificationSettings|null);
        chatLockSettings?: (proto.IChatLockSettings|null);
        chatDbLidMigrationTimestamp?: (number|Long|null);
    }

    class GlobalSettings implements IGlobalSettings {
        constructor(p?: IGlobalSettings);
        public lightThemeWallpaper?: (proto.IWallpaperSettings|null);
        public mediaVisibility?: proto.MediaVisibility|null;
        public darkThemeWallpaper?: (proto.IWallpaperSettings|null);
        public autoDownloadWiFi?: (proto.IAutoDownloadSettings|null);
        public autoDownloadCellular?: (proto.IAutoDownloadSettings|null);
        public autoDownloadRoaming?: (proto.IAutoDownloadSettings|null);
        public showIndividualNotificationsPreview?: (boolean|null);
        public showGroupNotificationsPreview?: (boolean|null);
        public disappearingModeDuration?: (number|null);
        public disappearingModeTimestamp?: (number|Long|null);
        public avatarUserSettings?: (proto.IAvatarUserSettings|null);
        public fontSize?: (number|null);
        public securityNotifications?: (boolean|null);
        public autoUnarchiveChats?: (boolean|null);
        public videoQualityMode?: (number|null);
        public photoQualityMode?: (number|null);
        public individualNotificationSettings?: (proto.INotificationSettings|null);
        public groupNotificationSettings?: (proto.INotificationSettings|null);
        public chatLockSettings?: (proto.IChatLockSettings|null);
        public chatDbLidMigrationTimestamp?: (number|Long|null);
        public static create(properties?: IGlobalSettings): GlobalSettings;
        public static encode(m: IGlobalSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GlobalSettings;
        public static fromObject(d: { [k: string]: any }): GlobalSettings;
        public static toObject(m: GlobalSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IGroupHistoryBundleInfo {
        deprecatedMessageHistoryBundle?: (proto.IMessageHistoryBundle|null);
        processState?: proto.GroupHistoryBundleInfo.ProcessState|null;
    }

    class GroupHistoryBundleInfo implements IGroupHistoryBundleInfo {
        constructor(p?: IGroupHistoryBundleInfo);
        public deprecatedMessageHistoryBundle?: (proto.IMessageHistoryBundle|null);
        public processState?: proto.GroupHistoryBundleInfo.ProcessState|null;
        public static create(properties?: IGroupHistoryBundleInfo): GroupHistoryBundleInfo;
        public static encode(m: IGroupHistoryBundleInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupHistoryBundleInfo;
        public static fromObject(d: { [k: string]: any }): GroupHistoryBundleInfo;
        public static toObject(m: GroupHistoryBundleInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IGroupHistoryIndividualMessageInfo {
        bundleMessageKey?: (proto.IMessageKey|null);
        editedAfterReceivedAsHistory?: (boolean|null);
    }

    class GroupHistoryIndividualMessageInfo implements IGroupHistoryIndividualMessageInfo {
        constructor(p?: IGroupHistoryIndividualMessageInfo);
        public bundleMessageKey?: (proto.IMessageKey|null);
        public editedAfterReceivedAsHistory?: (boolean|null);
        public static create(properties?: IGroupHistoryIndividualMessageInfo): GroupHistoryIndividualMessageInfo;
        public static encode(m: IGroupHistoryIndividualMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupHistoryIndividualMessageInfo;
        public static fromObject(d: { [k: string]: any }): GroupHistoryIndividualMessageInfo;
        public static toObject(m: GroupHistoryIndividualMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IGroupMention {
        groupJid?: (string|null);
        groupSubject?: (string|null);
    }

    class GroupMention implements IGroupMention {
        constructor(p?: IGroupMention);
        public groupJid?: (string|null);
        public groupSubject?: (string|null);
        public static create(properties?: IGroupMention): GroupMention;
        public static encode(m: IGroupMention, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupMention;
        public static fromObject(d: { [k: string]: any }): GroupMention;
        public static toObject(m: GroupMention, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IGroupParticipant {
        userJid?: string;
        rank?: proto.GroupParticipant.Rank|null;
        memberLabel?: (proto.IMemberLabel|null);
    }

    class GroupParticipant implements IGroupParticipant {
        constructor(p?: IGroupParticipant);
        public userJid: string;
        public rank?: proto.GroupParticipant.Rank|null;
        public memberLabel?: (proto.IMemberLabel|null);
        public static create(properties?: IGroupParticipant): GroupParticipant;
        public static encode(m: IGroupParticipant, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupParticipant;
        public static fromObject(d: { [k: string]: any }): GroupParticipant;
        public static toObject(m: GroupParticipant, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IHandshakeMessage {
        clientHello?: (proto.IClientHello|null);
        serverHello?: (proto.IServerHello|null);
        clientFinish?: (proto.IClientFinish|null);
    }

    class HandshakeMessage implements IHandshakeMessage {
        constructor(p?: IHandshakeMessage);
        public clientHello?: (proto.IClientHello|null);
        public serverHello?: (proto.IServerHello|null);
        public clientFinish?: (proto.IClientFinish|null);
        public static create(properties?: IHandshakeMessage): HandshakeMessage;
        public static encode(m: IHandshakeMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HandshakeMessage;
        public static fromObject(d: { [k: string]: any }): HandshakeMessage;
        public static toObject(m: HandshakeMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IHistorySync {
        syncType?: proto.HistorySync.HistorySyncType;
        conversations?: proto.IConversation[];
        statusV3Messages?: proto.IWebMessageInfo[];
        chunkOrder?: (number|null);
        progress?: (number|null);
        pushnames?: proto.IPushname[];
        globalSettings?: (proto.IGlobalSettings|null);
        threadIdUserSecret?: (Uint8Array|null);
        threadDsTimeframeOffset?: (number|null);
        recentStickers?: proto.IStickerMetadata[];
        pastParticipants?: proto.IPastParticipants[];
        callLogRecords?: proto.ICallLogRecord[];
        aiWaitListState?: proto.HistorySync.BotAiWaitListState|null;
        phoneNumberToLidMappings?: proto.IPhoneNumberToLidMapping[];
        companionMetaNonce?: (string|null);
        shareableChatIdentifierEncryptionKey?: (Uint8Array|null);
        accounts?: proto.IAccount[];
    }

    class HistorySync implements IHistorySync {
        constructor(p?: IHistorySync);
        public syncType: proto.HistorySync.HistorySyncType;
        public conversations: proto.IConversation[];
        public statusV3Messages: proto.IWebMessageInfo[];
        public chunkOrder?: (number|null);
        public progress?: (number|null);
        public pushnames: proto.IPushname[];
        public globalSettings?: (proto.IGlobalSettings|null);
        public threadIdUserSecret?: (Uint8Array|null);
        public threadDsTimeframeOffset?: (number|null);
        public recentStickers: proto.IStickerMetadata[];
        public pastParticipants: proto.IPastParticipants[];
        public callLogRecords: proto.ICallLogRecord[];
        public aiWaitListState?: proto.HistorySync.BotAiWaitListState|null;
        public phoneNumberToLidMappings: proto.IPhoneNumberToLidMapping[];
        public companionMetaNonce?: (string|null);
        public shareableChatIdentifierEncryptionKey?: (Uint8Array|null);
        public accounts: proto.IAccount[];
        public static create(properties?: IHistorySync): HistorySync;
        public static encode(m: IHistorySync, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySync;
        public static fromObject(d: { [k: string]: any }): HistorySync;
        public static toObject(m: HistorySync, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IHistorySyncMsg {
        message?: (proto.IWebMessageInfo|null);
        msgOrderId?: (number|Long|null);
    }

    class HistorySyncMsg implements IHistorySyncMsg {
        constructor(p?: IHistorySyncMsg);
        public message?: (proto.IWebMessageInfo|null);
        public msgOrderId?: (number|Long|null);
        public static create(properties?: IHistorySyncMsg): HistorySyncMsg;
        public static encode(m: IHistorySyncMsg, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncMsg;
        public static fromObject(d: { [k: string]: any }): HistorySyncMsg;
        public static toObject(m: HistorySyncMsg, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IHydratedTemplateButton {
        index?: (number|null);
        quickReplyButton?: (proto.IHydratedQuickReplyButton|null);
        urlButton?: (proto.IHydratedUrlButton|null);
        callButton?: (proto.IHydratedCallButton|null);
        /** Prost oneof field */
        hydratedButton?: {
            quickReplyButton?: (proto.IHydratedQuickReplyButton|null);
            urlButton?: (proto.IHydratedUrlButton|null);
            callButton?: (proto.IHydratedCallButton|null);
        } | null;
    }

    class HydratedTemplateButton implements IHydratedTemplateButton {
        constructor(p?: IHydratedTemplateButton);
        public index?: (number|null);
        public quickReplyButton?: (proto.IHydratedQuickReplyButton|null);
        public urlButton?: (proto.IHydratedUrlButton|null);
        public callButton?: (proto.IHydratedCallButton|null);
        public hydratedButton?: ("quickReplyButton"|"urlButton"|"callButton");
        public static create(properties?: IHydratedTemplateButton): HydratedTemplateButton;
        public static encode(m: IHydratedTemplateButton, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HydratedTemplateButton;
        public static fromObject(d: { [k: string]: any }): HydratedTemplateButton;
        public static toObject(m: HydratedTemplateButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IIdentityKeyPairStructure {
        publicKey?: (Uint8Array|null);
        privateKey?: (Uint8Array|null);
    }

    class IdentityKeyPairStructure implements IIdentityKeyPairStructure {
        constructor(p?: IIdentityKeyPairStructure);
        public publicKey?: (Uint8Array|null);
        public privateKey?: (Uint8Array|null);
        public static create(properties?: IIdentityKeyPairStructure): IdentityKeyPairStructure;
        public static encode(m: IIdentityKeyPairStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): IdentityKeyPairStructure;
        public static fromObject(d: { [k: string]: any }): IdentityKeyPairStructure;
        public static toObject(m: IdentityKeyPairStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IInThreadSurveyMetadata {
        tessaSessionId?: (string|null);
        simonSessionId?: (string|null);
        simonSurveyId?: (string|null);
        tessaRootId?: (string|null);
        requestId?: (string|null);
        tessaEvent?: (string|null);
        invitationHeaderText?: (string|null);
        invitationBodyText?: (string|null);
        invitationCtaText?: (string|null);
        invitationCtaUrl?: (string|null);
        surveyTitle?: (string|null);
        questions?: proto.IInThreadSurveyQuestion[];
        surveyContinueButtonText?: (string|null);
        surveySubmitButtonText?: (string|null);
        privacyStatementFull?: (string|null);
        privacyStatementParts?: proto.IInThreadSurveyPrivacyStatementPart[];
        feedbackToastText?: (string|null);
        startQuestionIndex?: (number|null);
    }

    class InThreadSurveyMetadata implements IInThreadSurveyMetadata {
        constructor(p?: IInThreadSurveyMetadata);
        public tessaSessionId?: (string|null);
        public simonSessionId?: (string|null);
        public simonSurveyId?: (string|null);
        public tessaRootId?: (string|null);
        public requestId?: (string|null);
        public tessaEvent?: (string|null);
        public invitationHeaderText?: (string|null);
        public invitationBodyText?: (string|null);
        public invitationCtaText?: (string|null);
        public invitationCtaUrl?: (string|null);
        public surveyTitle?: (string|null);
        public questions: proto.IInThreadSurveyQuestion[];
        public surveyContinueButtonText?: (string|null);
        public surveySubmitButtonText?: (string|null);
        public privacyStatementFull?: (string|null);
        public privacyStatementParts: proto.IInThreadSurveyPrivacyStatementPart[];
        public feedbackToastText?: (string|null);
        public startQuestionIndex?: (number|null);
        public static create(properties?: IInThreadSurveyMetadata): InThreadSurveyMetadata;
        public static encode(m: IInThreadSurveyMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InThreadSurveyMetadata;
        public static fromObject(d: { [k: string]: any }): InThreadSurveyMetadata;
        public static toObject(m: InThreadSurveyMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IInteractiveAnnotation {
        polygonVertices?: proto.IPoint[];
        shouldSkipConfirmation?: (boolean|null);
        embeddedContent?: (proto.IEmbeddedContent|null);
        statusLinkType?: proto.InteractiveAnnotation.StatusLinkType|null;
        location?: (proto.ILocation|null);
        newsletter?: (proto.IForwardedNewsletterMessageInfo|null);
        embeddedAction?: (boolean|null);
        tapAction?: (proto.ITapLinkAction|null);
        /** Prost oneof field */
        action?: {
            location?: (proto.ILocation|null);
            newsletter?: (proto.IForwardedNewsletterMessageInfo|null);
            embeddedAction?: (boolean|null);
            tapAction?: (proto.ITapLinkAction|null);
        } | null;
    }

    class InteractiveAnnotation implements IInteractiveAnnotation {
        constructor(p?: IInteractiveAnnotation);
        public polygonVertices: proto.IPoint[];
        public shouldSkipConfirmation?: (boolean|null);
        public embeddedContent?: (proto.IEmbeddedContent|null);
        public statusLinkType?: proto.InteractiveAnnotation.StatusLinkType|null;
        public location?: (proto.ILocation|null);
        public newsletter?: (proto.IForwardedNewsletterMessageInfo|null);
        public embeddedAction?: (boolean|null);
        public tapAction?: (proto.ITapLinkAction|null);
        public action?: ("location"|"newsletter"|"embeddedAction"|"tapAction");
        public static create(properties?: IInteractiveAnnotation): InteractiveAnnotation;
        public static encode(m: IInteractiveAnnotation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteractiveAnnotation;
        public static fromObject(d: { [k: string]: any }): InteractiveAnnotation;
        public static toObject(m: InteractiveAnnotation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IInteractiveMessageAdditionalMetadata {
        isGalaxyFlowCompleted?: (boolean|null);
    }

    class InteractiveMessageAdditionalMetadata implements IInteractiveMessageAdditionalMetadata {
        constructor(p?: IInteractiveMessageAdditionalMetadata);
        public isGalaxyFlowCompleted?: (boolean|null);
        public static create(properties?: IInteractiveMessageAdditionalMetadata): InteractiveMessageAdditionalMetadata;
        public static encode(m: IInteractiveMessageAdditionalMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteractiveMessageAdditionalMetadata;
        public static fromObject(d: { [k: string]: any }): InteractiveMessageAdditionalMetadata;
        public static toObject(m: InteractiveMessageAdditionalMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IKeepInChat {
        keepType?: proto.KeepType|null;
        serverTimestamp?: (number|Long|null);
        key?: (proto.IMessageKey|null);
        deviceJid?: (string|null);
        clientTimestampMs?: (number|Long|null);
        serverTimestampMs?: (number|Long|null);
    }

    class KeepInChat implements IKeepInChat {
        constructor(p?: IKeepInChat);
        public keepType?: proto.KeepType|null;
        public serverTimestamp?: (number|Long|null);
        public key?: (proto.IMessageKey|null);
        public deviceJid?: (string|null);
        public clientTimestampMs?: (number|Long|null);
        public serverTimestampMs?: (number|Long|null);
        public static create(properties?: IKeepInChat): KeepInChat;
        public static encode(m: IKeepInChat, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): KeepInChat;
        public static fromObject(d: { [k: string]: any }): KeepInChat;
        public static toObject(m: KeepInChat, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IKeyExchangeMessage {
        id?: (number|null);
        baseKey?: (Uint8Array|null);
        ratchetKey?: (Uint8Array|null);
        identityKey?: (Uint8Array|null);
        baseKeySignature?: (Uint8Array|null);
    }

    class KeyExchangeMessage implements IKeyExchangeMessage {
        constructor(p?: IKeyExchangeMessage);
        public id?: (number|null);
        public baseKey?: (Uint8Array|null);
        public ratchetKey?: (Uint8Array|null);
        public identityKey?: (Uint8Array|null);
        public baseKeySignature?: (Uint8Array|null);
        public static create(properties?: IKeyExchangeMessage): KeyExchangeMessage;
        public static encode(m: IKeyExchangeMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): KeyExchangeMessage;
        public static fromObject(d: { [k: string]: any }): KeyExchangeMessage;
        public static toObject(m: KeyExchangeMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IKeyId {
        id?: (Uint8Array|null);
    }

    class KeyId implements IKeyId {
        constructor(p?: IKeyId);
        public id?: (Uint8Array|null);
        public static create(properties?: IKeyId): KeyId;
        public static encode(m: IKeyId, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): KeyId;
        public static fromObject(d: { [k: string]: any }): KeyId;
        public static toObject(m: KeyId, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILidMigrationMapping {
        pn?: number|Long;
        assignedLid?: number|Long;
        latestLid?: (number|Long|null);
    }

    class LidMigrationMapping implements ILidMigrationMapping {
        constructor(p?: ILidMigrationMapping);
        public pn: number|Long;
        public assignedLid: number|Long;
        public latestLid?: (number|Long|null);
        public static create(properties?: ILidMigrationMapping): LidMigrationMapping;
        public static encode(m: ILidMigrationMapping, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LidMigrationMapping;
        public static fromObject(d: { [k: string]: any }): LidMigrationMapping;
        public static toObject(m: LidMigrationMapping, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILidMigrationMappingSyncMessage {
        encodedMappingPayload?: (Uint8Array|null);
    }

    class LidMigrationMappingSyncMessage implements ILidMigrationMappingSyncMessage {
        constructor(p?: ILidMigrationMappingSyncMessage);
        public encodedMappingPayload?: (Uint8Array|null);
        public static create(properties?: ILidMigrationMappingSyncMessage): LidMigrationMappingSyncMessage;
        public static encode(m: ILidMigrationMappingSyncMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LidMigrationMappingSyncMessage;
        public static fromObject(d: { [k: string]: any }): LidMigrationMappingSyncMessage;
        public static toObject(m: LidMigrationMappingSyncMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILidMigrationMappingSyncPayload {
        pnToLidMappings?: proto.ILidMigrationMapping[];
        chatDbMigrationTimestamp?: (number|Long|null);
    }

    class LidMigrationMappingSyncPayload implements ILidMigrationMappingSyncPayload {
        constructor(p?: ILidMigrationMappingSyncPayload);
        public pnToLidMappings: proto.ILidMigrationMapping[];
        public chatDbMigrationTimestamp?: (number|Long|null);
        public static create(properties?: ILidMigrationMappingSyncPayload): LidMigrationMappingSyncPayload;
        public static encode(m: ILidMigrationMappingSyncPayload, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LidMigrationMappingSyncPayload;
        public static fromObject(d: { [k: string]: any }): LidMigrationMappingSyncPayload;
        public static toObject(m: LidMigrationMappingSyncPayload, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILegacyMessage {
        eventResponseMessage?: (proto.IEventResponseMessage|null);
        pollVote?: (proto.IPollVoteMessage|null);
    }

    class LegacyMessage implements ILegacyMessage {
        constructor(p?: ILegacyMessage);
        public eventResponseMessage?: (proto.IEventResponseMessage|null);
        public pollVote?: (proto.IPollVoteMessage|null);
        public static create(properties?: ILegacyMessage): LegacyMessage;
        public static encode(m: ILegacyMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LegacyMessage;
        public static fromObject(d: { [k: string]: any }): LegacyMessage;
        public static toObject(m: LegacyMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILimitSharing {
        sharingLimited?: (boolean|null);
        trigger?: proto.LimitSharing.TriggerType|null;
        limitSharingSettingTimestamp?: (number|Long|null);
        initiatedByMe?: (boolean|null);
    }

    class LimitSharing implements ILimitSharing {
        constructor(p?: ILimitSharing);
        public sharingLimited?: (boolean|null);
        public trigger?: proto.LimitSharing.TriggerType|null;
        public limitSharingSettingTimestamp?: (number|Long|null);
        public initiatedByMe?: (boolean|null);
        public static create(properties?: ILimitSharing): LimitSharing;
        public static encode(m: ILimitSharing, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LimitSharing;
        public static fromObject(d: { [k: string]: any }): LimitSharing;
        public static toObject(m: LimitSharing, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILocalizedName {
        lg?: (string|null);
        lc?: (string|null);
        verifiedName?: (string|null);
    }

    class LocalizedName implements ILocalizedName {
        constructor(p?: ILocalizedName);
        public lg?: (string|null);
        public lc?: (string|null);
        public verifiedName?: (string|null);
        public static create(properties?: ILocalizedName): LocalizedName;
        public static encode(m: ILocalizedName, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LocalizedName;
        public static fromObject(d: { [k: string]: any }): LocalizedName;
        public static toObject(m: LocalizedName, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ILocation {
        degreesLatitude?: (number|null);
        degreesLongitude?: (number|null);
        name?: (string|null);
    }

    class Location implements ILocation {
        constructor(p?: ILocation);
        public degreesLatitude?: (number|null);
        public degreesLongitude?: (number|null);
        public name?: (string|null);
        public static create(properties?: ILocation): Location;
        public static encode(m: ILocation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Location;
        public static fromObject(d: { [k: string]: any }): Location;
        public static toObject(m: Location, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMediaData {
        localPath?: (string|null);
    }

    class MediaData implements IMediaData {
        constructor(p?: IMediaData);
        public localPath?: (string|null);
        public static create(properties?: IMediaData): MediaData;
        public static encode(m: IMediaData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MediaData;
        public static fromObject(d: { [k: string]: any }): MediaData;
        public static toObject(m: MediaData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMediaNotifyMessage {
        expressPathUrl?: (string|null);
        fileEncSha256?: (Uint8Array|null);
        fileLength?: (number|Long|null);
    }

    class MediaNotifyMessage implements IMediaNotifyMessage {
        constructor(p?: IMediaNotifyMessage);
        public expressPathUrl?: (string|null);
        public fileEncSha256?: (Uint8Array|null);
        public fileLength?: (number|Long|null);
        public static create(properties?: IMediaNotifyMessage): MediaNotifyMessage;
        public static encode(m: IMediaNotifyMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MediaNotifyMessage;
        public static fromObject(d: { [k: string]: any }): MediaNotifyMessage;
        public static toObject(m: MediaNotifyMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMediaRetryNotification {
        stanzaId?: (string|null);
        directPath?: (string|null);
        result?: proto.MediaRetryNotification.ResultType|null;
        messageSecret?: (Uint8Array|null);
    }

    class MediaRetryNotification implements IMediaRetryNotification {
        constructor(p?: IMediaRetryNotification);
        public stanzaId?: (string|null);
        public directPath?: (string|null);
        public result?: proto.MediaRetryNotification.ResultType|null;
        public messageSecret?: (Uint8Array|null);
        public static create(properties?: IMediaRetryNotification): MediaRetryNotification;
        public static encode(m: IMediaRetryNotification, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MediaRetryNotification;
        public static fromObject(d: { [k: string]: any }): MediaRetryNotification;
        public static toObject(m: MediaRetryNotification, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMemberLabel {
        label?: (string|null);
        labelTimestamp?: (number|Long|null);
    }

    class MemberLabel implements IMemberLabel {
        constructor(p?: IMemberLabel);
        public label?: (string|null);
        public labelTimestamp?: (number|Long|null);
        public static create(properties?: IMemberLabel): MemberLabel;
        public static encode(m: IMemberLabel, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MemberLabel;
        public static fromObject(d: { [k: string]: any }): MemberLabel;
        public static toObject(m: MemberLabel, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessage {
        conversation?: (string|null);
        senderKeyDistributionMessage?: (proto.ISenderKeyDistributionMessage|null);
        imageMessage?: (proto.IImageMessage|null);
        contactMessage?: (proto.IContactMessage|null);
        locationMessage?: (proto.ILocationMessage|null);
        extendedTextMessage?: (proto.IExtendedTextMessage|null);
        documentMessage?: (proto.IDocumentMessage|null);
        audioMessage?: (proto.IAudioMessage|null);
        videoMessage?: (proto.IVideoMessage|null);
        call?: (proto.ICall|null);
        chat?: (proto.IChat|null);
        protocolMessage?: (proto.IProtocolMessage|null);
        contactsArrayMessage?: (proto.IContactsArrayMessage|null);
        highlyStructuredMessage?: (proto.IHighlyStructuredMessage|null);
        fastRatchetKeySenderKeyDistributionMessage?: (proto.ISenderKeyDistributionMessage|null);
        sendPaymentMessage?: (proto.ISendPaymentMessage|null);
        liveLocationMessage?: (proto.ILiveLocationMessage|null);
        requestPaymentMessage?: (proto.IRequestPaymentMessage|null);
        declinePaymentRequestMessage?: (proto.IDeclinePaymentRequestMessage|null);
        cancelPaymentRequestMessage?: (proto.ICancelPaymentRequestMessage|null);
        templateMessage?: (proto.ITemplateMessage|null);
        stickerMessage?: (proto.IStickerMessage|null);
        groupInviteMessage?: (proto.IGroupInviteMessage|null);
        templateButtonReplyMessage?: (proto.ITemplateButtonReplyMessage|null);
        productMessage?: (proto.IProductMessage|null);
        deviceSentMessage?: (proto.IDeviceSentMessage|null);
        messageContextInfo?: (proto.IMessageContextInfo|null);
        listMessage?: (proto.IListMessage|null);
        viewOnceMessage?: (proto.IFutureProofMessage|null);
        orderMessage?: (proto.IOrderMessage|null);
        listResponseMessage?: (proto.IListResponseMessage|null);
        ephemeralMessage?: (proto.IFutureProofMessage|null);
        invoiceMessage?: (proto.IInvoiceMessage|null);
        buttonsMessage?: (proto.IButtonsMessage|null);
        buttonsResponseMessage?: (proto.IButtonsResponseMessage|null);
        paymentInviteMessage?: (proto.IPaymentInviteMessage|null);
        interactiveMessage?: (proto.IInteractiveMessage|null);
        reactionMessage?: (proto.IReactionMessage|null);
        stickerSyncRmrMessage?: (proto.IStickerSyncRmrMessage|null);
        interactiveResponseMessage?: (proto.IInteractiveResponseMessage|null);
        pollCreationMessage?: (proto.IPollCreationMessage|null);
        pollUpdateMessage?: (proto.IPollUpdateMessage|null);
        keepInChatMessage?: (proto.IKeepInChatMessage|null);
        documentWithCaptionMessage?: (proto.IFutureProofMessage|null);
        requestPhoneNumberMessage?: (proto.IRequestPhoneNumberMessage|null);
        viewOnceMessageV2?: (proto.IFutureProofMessage|null);
        encReactionMessage?: (proto.IEncReactionMessage|null);
        editedMessage?: (proto.IFutureProofMessage|null);
        viewOnceMessageV2Extension?: (proto.IFutureProofMessage|null);
        pollCreationMessageV2?: (proto.IPollCreationMessage|null);
        scheduledCallCreationMessage?: (proto.IScheduledCallCreationMessage|null);
        groupMentionedMessage?: (proto.IFutureProofMessage|null);
        pinInChatMessage?: (proto.IPinInChatMessage|null);
        pollCreationMessageV3?: (proto.IPollCreationMessage|null);
        scheduledCallEditMessage?: (proto.IScheduledCallEditMessage|null);
        ptvMessage?: (proto.IVideoMessage|null);
        botInvokeMessage?: (proto.IFutureProofMessage|null);
        callLogMesssage?: (proto.ICallLogMessage|null);
        messageHistoryBundle?: (proto.IMessageHistoryBundle|null);
        encCommentMessage?: (proto.IEncCommentMessage|null);
        bcallMessage?: (proto.IBCallMessage|null);
        lottieStickerMessage?: (proto.IFutureProofMessage|null);
        eventMessage?: (proto.IEventMessage|null);
        encEventResponseMessage?: (proto.IEncEventResponseMessage|null);
        commentMessage?: (proto.ICommentMessage|null);
        newsletterAdminInviteMessage?: (proto.INewsletterAdminInviteMessage|null);
        placeholderMessage?: (proto.IPlaceholderMessage|null);
        secretEncryptedMessage?: (proto.ISecretEncryptedMessage|null);
        albumMessage?: (proto.IAlbumMessage|null);
        eventCoverImage?: (proto.IFutureProofMessage|null);
        stickerPackMessage?: (proto.IStickerPackMessage|null);
        statusMentionMessage?: (proto.IFutureProofMessage|null);
        pollResultSnapshotMessage?: (proto.IPollResultSnapshotMessage|null);
        pollCreationOptionImageMessage?: (proto.IFutureProofMessage|null);
        associatedChildMessage?: (proto.IFutureProofMessage|null);
        groupStatusMentionMessage?: (proto.IFutureProofMessage|null);
        pollCreationMessageV4?: (proto.IFutureProofMessage|null);
        statusAddYours?: (proto.IFutureProofMessage|null);
        groupStatusMessage?: (proto.IFutureProofMessage|null);
        richResponseMessage?: (proto.IAiRichResponseMessage|null);
        statusNotificationMessage?: (proto.IStatusNotificationMessage|null);
        limitSharingMessage?: (proto.IFutureProofMessage|null);
        botTaskMessage?: (proto.IFutureProofMessage|null);
        questionMessage?: (proto.IFutureProofMessage|null);
        messageHistoryNotice?: (proto.IMessageHistoryNotice|null);
        groupStatusMessageV2?: (proto.IFutureProofMessage|null);
        botForwardedMessage?: (proto.IFutureProofMessage|null);
        statusQuestionAnswerMessage?: (proto.IStatusQuestionAnswerMessage|null);
        questionReplyMessage?: (proto.IFutureProofMessage|null);
        questionResponseMessage?: (proto.IQuestionResponseMessage|null);
        statusQuotedMessage?: (proto.IStatusQuotedMessage|null);
        statusStickerInteractionMessage?: (proto.IStatusStickerInteractionMessage|null);
        pollCreationMessageV5?: (proto.IPollCreationMessage|null);
        newsletterFollowerInviteMessageV2?: (proto.INewsletterFollowerInviteMessage|null);
        pollResultSnapshotMessageV3?: (proto.IPollResultSnapshotMessage|null);
        newsletterAdminProfileMessage?: (proto.IFutureProofMessage|null);
    }

    class Message implements IMessage {
        constructor(p?: IMessage);
        public conversation?: (string|null);
        public senderKeyDistributionMessage?: (proto.ISenderKeyDistributionMessage|null);
        public imageMessage?: (proto.IImageMessage|null);
        public contactMessage?: (proto.IContactMessage|null);
        public locationMessage?: (proto.ILocationMessage|null);
        public extendedTextMessage?: (proto.IExtendedTextMessage|null);
        public documentMessage?: (proto.IDocumentMessage|null);
        public audioMessage?: (proto.IAudioMessage|null);
        public videoMessage?: (proto.IVideoMessage|null);
        public call?: (proto.ICall|null);
        public chat?: (proto.IChat|null);
        public protocolMessage?: (proto.IProtocolMessage|null);
        public contactsArrayMessage?: (proto.IContactsArrayMessage|null);
        public highlyStructuredMessage?: (proto.IHighlyStructuredMessage|null);
        public fastRatchetKeySenderKeyDistributionMessage?: (proto.ISenderKeyDistributionMessage|null);
        public sendPaymentMessage?: (proto.ISendPaymentMessage|null);
        public liveLocationMessage?: (proto.ILiveLocationMessage|null);
        public requestPaymentMessage?: (proto.IRequestPaymentMessage|null);
        public declinePaymentRequestMessage?: (proto.IDeclinePaymentRequestMessage|null);
        public cancelPaymentRequestMessage?: (proto.ICancelPaymentRequestMessage|null);
        public templateMessage?: (proto.ITemplateMessage|null);
        public stickerMessage?: (proto.IStickerMessage|null);
        public groupInviteMessage?: (proto.IGroupInviteMessage|null);
        public templateButtonReplyMessage?: (proto.ITemplateButtonReplyMessage|null);
        public productMessage?: (proto.IProductMessage|null);
        public deviceSentMessage?: (proto.IDeviceSentMessage|null);
        public messageContextInfo?: (proto.IMessageContextInfo|null);
        public listMessage?: (proto.IListMessage|null);
        public viewOnceMessage?: (proto.IFutureProofMessage|null);
        public orderMessage?: (proto.IOrderMessage|null);
        public listResponseMessage?: (proto.IListResponseMessage|null);
        public ephemeralMessage?: (proto.IFutureProofMessage|null);
        public invoiceMessage?: (proto.IInvoiceMessage|null);
        public buttonsMessage?: (proto.IButtonsMessage|null);
        public buttonsResponseMessage?: (proto.IButtonsResponseMessage|null);
        public paymentInviteMessage?: (proto.IPaymentInviteMessage|null);
        public interactiveMessage?: (proto.IInteractiveMessage|null);
        public reactionMessage?: (proto.IReactionMessage|null);
        public stickerSyncRmrMessage?: (proto.IStickerSyncRmrMessage|null);
        public interactiveResponseMessage?: (proto.IInteractiveResponseMessage|null);
        public pollCreationMessage?: (proto.IPollCreationMessage|null);
        public pollUpdateMessage?: (proto.IPollUpdateMessage|null);
        public keepInChatMessage?: (proto.IKeepInChatMessage|null);
        public documentWithCaptionMessage?: (proto.IFutureProofMessage|null);
        public requestPhoneNumberMessage?: (proto.IRequestPhoneNumberMessage|null);
        public viewOnceMessageV2?: (proto.IFutureProofMessage|null);
        public encReactionMessage?: (proto.IEncReactionMessage|null);
        public editedMessage?: (proto.IFutureProofMessage|null);
        public viewOnceMessageV2Extension?: (proto.IFutureProofMessage|null);
        public pollCreationMessageV2?: (proto.IPollCreationMessage|null);
        public scheduledCallCreationMessage?: (proto.IScheduledCallCreationMessage|null);
        public groupMentionedMessage?: (proto.IFutureProofMessage|null);
        public pinInChatMessage?: (proto.IPinInChatMessage|null);
        public pollCreationMessageV3?: (proto.IPollCreationMessage|null);
        public scheduledCallEditMessage?: (proto.IScheduledCallEditMessage|null);
        public ptvMessage?: (proto.IVideoMessage|null);
        public botInvokeMessage?: (proto.IFutureProofMessage|null);
        public callLogMesssage?: (proto.ICallLogMessage|null);
        public messageHistoryBundle?: (proto.IMessageHistoryBundle|null);
        public encCommentMessage?: (proto.IEncCommentMessage|null);
        public bcallMessage?: (proto.IBCallMessage|null);
        public lottieStickerMessage?: (proto.IFutureProofMessage|null);
        public eventMessage?: (proto.IEventMessage|null);
        public encEventResponseMessage?: (proto.IEncEventResponseMessage|null);
        public commentMessage?: (proto.ICommentMessage|null);
        public newsletterAdminInviteMessage?: (proto.INewsletterAdminInviteMessage|null);
        public placeholderMessage?: (proto.IPlaceholderMessage|null);
        public secretEncryptedMessage?: (proto.ISecretEncryptedMessage|null);
        public albumMessage?: (proto.IAlbumMessage|null);
        public eventCoverImage?: (proto.IFutureProofMessage|null);
        public stickerPackMessage?: (proto.IStickerPackMessage|null);
        public statusMentionMessage?: (proto.IFutureProofMessage|null);
        public pollResultSnapshotMessage?: (proto.IPollResultSnapshotMessage|null);
        public pollCreationOptionImageMessage?: (proto.IFutureProofMessage|null);
        public associatedChildMessage?: (proto.IFutureProofMessage|null);
        public groupStatusMentionMessage?: (proto.IFutureProofMessage|null);
        public pollCreationMessageV4?: (proto.IFutureProofMessage|null);
        public statusAddYours?: (proto.IFutureProofMessage|null);
        public groupStatusMessage?: (proto.IFutureProofMessage|null);
        public richResponseMessage?: (proto.IAiRichResponseMessage|null);
        public statusNotificationMessage?: (proto.IStatusNotificationMessage|null);
        public limitSharingMessage?: (proto.IFutureProofMessage|null);
        public botTaskMessage?: (proto.IFutureProofMessage|null);
        public questionMessage?: (proto.IFutureProofMessage|null);
        public messageHistoryNotice?: (proto.IMessageHistoryNotice|null);
        public groupStatusMessageV2?: (proto.IFutureProofMessage|null);
        public botForwardedMessage?: (proto.IFutureProofMessage|null);
        public statusQuestionAnswerMessage?: (proto.IStatusQuestionAnswerMessage|null);
        public questionReplyMessage?: (proto.IFutureProofMessage|null);
        public questionResponseMessage?: (proto.IQuestionResponseMessage|null);
        public statusQuotedMessage?: (proto.IStatusQuotedMessage|null);
        public statusStickerInteractionMessage?: (proto.IStatusStickerInteractionMessage|null);
        public pollCreationMessageV5?: (proto.IPollCreationMessage|null);
        public newsletterFollowerInviteMessageV2?: (proto.INewsletterFollowerInviteMessage|null);
        public pollResultSnapshotMessageV3?: (proto.IPollResultSnapshotMessage|null);
        public newsletterAdminProfileMessage?: (proto.IFutureProofMessage|null);
        public static create(properties?: IMessage): Message;
        public static encode(m: IMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Message;
        public static fromObject(d: { [k: string]: any }): Message;
        public static toObject(m: Message, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageAddOn {
        messageAddOnType?: proto.MessageAddOn.MessageAddOnType|null;
        messageAddOn?: (proto.IMessage|null);
        senderTimestampMs?: (number|Long|null);
        serverTimestampMs?: (number|Long|null);
        status?: proto.WebMessageInfo.Status|null;
        addOnContextInfo?: (proto.IMessageAddOnContextInfo|null);
        messageAddOnKey?: (proto.IMessageKey|null);
        legacyMessage?: (proto.ILegacyMessage|null);
    }

    class MessageAddOn implements IMessageAddOn {
        constructor(p?: IMessageAddOn);
        public messageAddOnType?: proto.MessageAddOn.MessageAddOnType|null;
        public messageAddOn?: (proto.IMessage|null);
        public senderTimestampMs?: (number|Long|null);
        public serverTimestampMs?: (number|Long|null);
        public status?: proto.WebMessageInfo.Status|null;
        public addOnContextInfo?: (proto.IMessageAddOnContextInfo|null);
        public messageAddOnKey?: (proto.IMessageKey|null);
        public legacyMessage?: (proto.ILegacyMessage|null);
        public static create(properties?: IMessageAddOn): MessageAddOn;
        public static encode(m: IMessageAddOn, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageAddOn;
        public static fromObject(d: { [k: string]: any }): MessageAddOn;
        public static toObject(m: MessageAddOn, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageAddOnContextInfo {
        messageAddOnDurationInSecs?: (number|null);
        messageAddOnExpiryType?: proto.MessageContextInfo.MessageAddonExpiryType|null;
    }

    class MessageAddOnContextInfo implements IMessageAddOnContextInfo {
        constructor(p?: IMessageAddOnContextInfo);
        public messageAddOnDurationInSecs?: (number|null);
        public messageAddOnExpiryType?: proto.MessageContextInfo.MessageAddonExpiryType|null;
        public static create(properties?: IMessageAddOnContextInfo): MessageAddOnContextInfo;
        public static encode(m: IMessageAddOnContextInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageAddOnContextInfo;
        public static fromObject(d: { [k: string]: any }): MessageAddOnContextInfo;
        public static toObject(m: MessageAddOnContextInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageAssociation {
        associationType?: proto.MessageAssociation.AssociationType|null;
        parentMessageKey?: (proto.IMessageKey|null);
        messageIndex?: (number|null);
    }

    class MessageAssociation implements IMessageAssociation {
        constructor(p?: IMessageAssociation);
        public associationType?: proto.MessageAssociation.AssociationType|null;
        public parentMessageKey?: (proto.IMessageKey|null);
        public messageIndex?: (number|null);
        public static create(properties?: IMessageAssociation): MessageAssociation;
        public static encode(m: IMessageAssociation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageAssociation;
        public static fromObject(d: { [k: string]: any }): MessageAssociation;
        public static toObject(m: MessageAssociation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageContextInfo {
        deviceListMetadata?: (proto.IDeviceListMetadata|null);
        deviceListMetadataVersion?: (number|null);
        messageSecret?: (Uint8Array|null);
        paddingBytes?: (Uint8Array|null);
        messageAddOnDurationInSecs?: (number|null);
        botMessageSecret?: (Uint8Array|null);
        botMetadata?: (proto.IBotMetadata|null);
        reportingTokenVersion?: (number|null);
        messageAddOnExpiryType?: proto.MessageContextInfo.MessageAddonExpiryType|null;
        messageAssociation?: (proto.IMessageAssociation|null);
        capiCreatedGroup?: (boolean|null);
        supportPayload?: (string|null);
        limitSharing?: (proto.ILimitSharing|null);
        limitSharingV2?: (proto.ILimitSharing|null);
        threadId?: proto.IThreadId[];
        weblinkRenderConfig?: proto.WebLinkRenderConfig|null;
    }

    class MessageContextInfo implements IMessageContextInfo {
        constructor(p?: IMessageContextInfo);
        public deviceListMetadata?: (proto.IDeviceListMetadata|null);
        public deviceListMetadataVersion?: (number|null);
        public messageSecret?: (Uint8Array|null);
        public paddingBytes?: (Uint8Array|null);
        public messageAddOnDurationInSecs?: (number|null);
        public botMessageSecret?: (Uint8Array|null);
        public botMetadata?: (proto.IBotMetadata|null);
        public reportingTokenVersion?: (number|null);
        public messageAddOnExpiryType?: proto.MessageContextInfo.MessageAddonExpiryType|null;
        public messageAssociation?: (proto.IMessageAssociation|null);
        public capiCreatedGroup?: (boolean|null);
        public supportPayload?: (string|null);
        public limitSharing?: (proto.ILimitSharing|null);
        public limitSharingV2?: (proto.ILimitSharing|null);
        public threadId: proto.IThreadId[];
        public weblinkRenderConfig?: proto.WebLinkRenderConfig|null;
        public static create(properties?: IMessageContextInfo): MessageContextInfo;
        public static encode(m: IMessageContextInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageContextInfo;
        public static fromObject(d: { [k: string]: any }): MessageContextInfo;
        public static toObject(m: MessageContextInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageKey {
        remoteJid?: (string|null);
        fromMe?: (boolean|null);
        id?: (string|null);
        participant?: (string|null);
    }

    class MessageKey implements IMessageKey {
        constructor(p?: IMessageKey);
        public remoteJid?: (string|null);
        public fromMe?: (boolean|null);
        public id?: (string|null);
        public participant?: (string|null);
        public static create(properties?: IMessageKey): MessageKey;
        public static encode(m: IMessageKey, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageKey;
        public static fromObject(d: { [k: string]: any }): MessageKey;
        public static toObject(m: MessageKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMessageSecretMessage {
        version?: (number|null);
        encIv?: (Uint8Array|null);
        encPayload?: (Uint8Array|null);
    }

    class MessageSecretMessage implements IMessageSecretMessage {
        constructor(p?: IMessageSecretMessage);
        public version?: (number|null);
        public encIv?: (Uint8Array|null);
        public encPayload?: (Uint8Array|null);
        public static create(properties?: IMessageSecretMessage): MessageSecretMessage;
        public static encode(m: IMessageSecretMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageSecretMessage;
        public static fromObject(d: { [k: string]: any }): MessageSecretMessage;
        public static toObject(m: MessageSecretMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMoney {
        value?: (number|Long|null);
        offset?: (number|null);
        currencyCode?: (string|null);
    }

    class Money implements IMoney {
        constructor(p?: IMoney);
        public value?: (number|Long|null);
        public offset?: (number|null);
        public currencyCode?: (string|null);
        public static create(properties?: IMoney): Money;
        public static encode(m: IMoney, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Money;
        public static fromObject(d: { [k: string]: any }): Money;
        public static toObject(m: Money, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMsgOpaqueData {
        body?: (string|null);
        caption?: (string|null);
        lng?: (number|null);
        isLive?: (boolean|null);
        lat?: (number|null);
        paymentAmount1000?: (number|null);
        paymentNoteMsgBody?: (string|null);
        matchedText?: (string|null);
        title?: (string|null);
        description?: (string|null);
        futureproofBuffer?: (Uint8Array|null);
        clientUrl?: (string|null);
        loc?: (string|null);
        pollName?: (string|null);
        pollOptions?: proto.IPollOption[];
        pollSelectableOptionsCount?: (number|null);
        messageSecret?: (Uint8Array|null);
        originalSelfAuthor?: (string|null);
        senderTimestampMs?: (number|Long|null);
        pollUpdateParentKey?: (string|null);
        encPollVote?: (proto.IPollEncValue|null);
        isSentCagPollCreation?: (boolean|null);
        pollContentType?: proto.MsgOpaqueData.PollContentType|null;
        pollType?: proto.MsgOpaqueData.PollType|null;
        correctOptionIndex?: (number|null);
        pollVotesSnapshot?: (proto.IPollVotesSnapshot|null);
        encReactionTargetMessageKey?: (string|null);
        encReactionEncPayload?: (Uint8Array|null);
        encReactionEncIv?: (Uint8Array|null);
        botMessageSecret?: (Uint8Array|null);
        targetMessageKey?: (string|null);
        encPayload?: (Uint8Array|null);
        encIv?: (Uint8Array|null);
        eventName?: (string|null);
        isEventCanceled?: (boolean|null);
        eventDescription?: (string|null);
        eventJoinLink?: (string|null);
        eventStartTime?: (number|Long|null);
        eventLocation?: (proto.IEventLocation|null);
        eventEndTime?: (number|Long|null);
        eventIsScheduledCall?: (boolean|null);
        eventExtraGuestsAllowed?: (boolean|null);
        plainProtobufBytes?: (Uint8Array|null);
    }

    class MsgOpaqueData implements IMsgOpaqueData {
        constructor(p?: IMsgOpaqueData);
        public body?: (string|null);
        public caption?: (string|null);
        public lng?: (number|null);
        public isLive?: (boolean|null);
        public lat?: (number|null);
        public paymentAmount1000?: (number|null);
        public paymentNoteMsgBody?: (string|null);
        public matchedText?: (string|null);
        public title?: (string|null);
        public description?: (string|null);
        public futureproofBuffer?: (Uint8Array|null);
        public clientUrl?: (string|null);
        public loc?: (string|null);
        public pollName?: (string|null);
        public pollOptions: proto.IPollOption[];
        public pollSelectableOptionsCount?: (number|null);
        public messageSecret?: (Uint8Array|null);
        public originalSelfAuthor?: (string|null);
        public senderTimestampMs?: (number|Long|null);
        public pollUpdateParentKey?: (string|null);
        public encPollVote?: (proto.IPollEncValue|null);
        public isSentCagPollCreation?: (boolean|null);
        public pollContentType?: proto.MsgOpaqueData.PollContentType|null;
        public pollType?: proto.MsgOpaqueData.PollType|null;
        public correctOptionIndex?: (number|null);
        public pollVotesSnapshot?: (proto.IPollVotesSnapshot|null);
        public encReactionTargetMessageKey?: (string|null);
        public encReactionEncPayload?: (Uint8Array|null);
        public encReactionEncIv?: (Uint8Array|null);
        public botMessageSecret?: (Uint8Array|null);
        public targetMessageKey?: (string|null);
        public encPayload?: (Uint8Array|null);
        public encIv?: (Uint8Array|null);
        public eventName?: (string|null);
        public isEventCanceled?: (boolean|null);
        public eventDescription?: (string|null);
        public eventJoinLink?: (string|null);
        public eventStartTime?: (number|Long|null);
        public eventLocation?: (proto.IEventLocation|null);
        public eventEndTime?: (number|Long|null);
        public eventIsScheduledCall?: (boolean|null);
        public eventExtraGuestsAllowed?: (boolean|null);
        public plainProtobufBytes?: (Uint8Array|null);
        public static create(properties?: IMsgOpaqueData): MsgOpaqueData;
        public static encode(m: IMsgOpaqueData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MsgOpaqueData;
        public static fromObject(d: { [k: string]: any }): MsgOpaqueData;
        public static toObject(m: MsgOpaqueData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IMsgRowOpaqueData {
        currentMsg?: (proto.IMsgOpaqueData|null);
        quotedMsg?: (proto.IMsgOpaqueData|null);
    }

    class MsgRowOpaqueData implements IMsgRowOpaqueData {
        constructor(p?: IMsgRowOpaqueData);
        public currentMsg?: (proto.IMsgOpaqueData|null);
        public quotedMsg?: (proto.IMsgOpaqueData|null);
        public static create(properties?: IMsgRowOpaqueData): MsgRowOpaqueData;
        public static encode(m: IMsgRowOpaqueData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MsgRowOpaqueData;
        public static fromObject(d: { [k: string]: any }): MsgRowOpaqueData;
        public static toObject(m: MsgRowOpaqueData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface INoiseCertificate {
        details?: (Uint8Array|null);
        signature?: (Uint8Array|null);
    }

    class NoiseCertificate implements INoiseCertificate {
        constructor(p?: INoiseCertificate);
        public details?: (Uint8Array|null);
        public signature?: (Uint8Array|null);
        public static create(properties?: INoiseCertificate): NoiseCertificate;
        public static encode(m: INoiseCertificate, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NoiseCertificate;
        public static fromObject(d: { [k: string]: any }): NoiseCertificate;
        public static toObject(m: NoiseCertificate, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface INotificationMessageInfo {
        key?: (proto.IMessageKey|null);
        message?: (proto.IMessage|null);
        messageTimestamp?: (number|Long|null);
        participant?: (string|null);
    }

    class NotificationMessageInfo implements INotificationMessageInfo {
        constructor(p?: INotificationMessageInfo);
        public key?: (proto.IMessageKey|null);
        public message?: (proto.IMessage|null);
        public messageTimestamp?: (number|Long|null);
        public participant?: (string|null);
        public static create(properties?: INotificationMessageInfo): NotificationMessageInfo;
        public static encode(m: INotificationMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NotificationMessageInfo;
        public static fromObject(d: { [k: string]: any }): NotificationMessageInfo;
        public static toObject(m: NotificationMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface INotificationSettings {
        messageVibrate?: (string|null);
        messagePopup?: (string|null);
        messageLight?: (string|null);
        lowPriorityNotifications?: (boolean|null);
        reactionsMuted?: (boolean|null);
        callVibrate?: (string|null);
    }

    class NotificationSettings implements INotificationSettings {
        constructor(p?: INotificationSettings);
        public messageVibrate?: (string|null);
        public messagePopup?: (string|null);
        public messageLight?: (string|null);
        public lowPriorityNotifications?: (boolean|null);
        public reactionsMuted?: (boolean|null);
        public callVibrate?: (string|null);
        public static create(properties?: INotificationSettings): NotificationSettings;
        public static encode(m: INotificationSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NotificationSettings;
        public static fromObject(d: { [k: string]: any }): NotificationSettings;
        public static toObject(m: NotificationSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPairingRequest {
        companionPublicKey?: (Uint8Array|null);
        companionIdentityKey?: (Uint8Array|null);
        advSecret?: (Uint8Array|null);
    }

    class PairingRequest implements IPairingRequest {
        constructor(p?: IPairingRequest);
        public companionPublicKey?: (Uint8Array|null);
        public companionIdentityKey?: (Uint8Array|null);
        public advSecret?: (Uint8Array|null);
        public static create(properties?: IPairingRequest): PairingRequest;
        public static encode(m: IPairingRequest, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PairingRequest;
        public static fromObject(d: { [k: string]: any }): PairingRequest;
        public static toObject(m: PairingRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPastParticipant {
        userJid?: (string|null);
        leaveReason?: proto.PastParticipant.LeaveReason|null;
        leaveTs?: (number|Long|null);
    }

    class PastParticipant implements IPastParticipant {
        constructor(p?: IPastParticipant);
        public userJid?: (string|null);
        public leaveReason?: proto.PastParticipant.LeaveReason|null;
        public leaveTs?: (number|Long|null);
        public static create(properties?: IPastParticipant): PastParticipant;
        public static encode(m: IPastParticipant, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PastParticipant;
        public static fromObject(d: { [k: string]: any }): PastParticipant;
        public static toObject(m: PastParticipant, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPastParticipants {
        groupJid?: (string|null);
        pastParticipants?: proto.IPastParticipant[];
    }

    class PastParticipants implements IPastParticipants {
        constructor(p?: IPastParticipants);
        public groupJid?: (string|null);
        public pastParticipants: proto.IPastParticipant[];
        public static create(properties?: IPastParticipants): PastParticipants;
        public static encode(m: IPastParticipants, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PastParticipants;
        public static fromObject(d: { [k: string]: any }): PastParticipants;
        public static toObject(m: PastParticipants, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPatchDebugData {
        currentLthash?: (Uint8Array|null);
        newLthash?: (Uint8Array|null);
        patchVersion?: (Uint8Array|null);
        collectionName?: (Uint8Array|null);
        firstFourBytesFromAHashOfSnapshotMacKey?: (Uint8Array|null);
        newLthashSubtract?: (Uint8Array|null);
        numberAdd?: (number|null);
        numberRemove?: (number|null);
        numberOverride?: (number|null);
        senderPlatform?: proto.PatchDebugData.Platform|null;
        isSenderPrimary?: (boolean|null);
    }

    class PatchDebugData implements IPatchDebugData {
        constructor(p?: IPatchDebugData);
        public currentLthash?: (Uint8Array|null);
        public newLthash?: (Uint8Array|null);
        public patchVersion?: (Uint8Array|null);
        public collectionName?: (Uint8Array|null);
        public firstFourBytesFromAHashOfSnapshotMacKey?: (Uint8Array|null);
        public newLthashSubtract?: (Uint8Array|null);
        public numberAdd?: (number|null);
        public numberRemove?: (number|null);
        public numberOverride?: (number|null);
        public senderPlatform?: proto.PatchDebugData.Platform|null;
        public isSenderPrimary?: (boolean|null);
        public static create(properties?: IPatchDebugData): PatchDebugData;
        public static encode(m: IPatchDebugData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PatchDebugData;
        public static fromObject(d: { [k: string]: any }): PatchDebugData;
        public static toObject(m: PatchDebugData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPaymentBackground {
        id?: (string|null);
        fileLength?: (number|Long|null);
        width?: (number|null);
        height?: (number|null);
        mimetype?: (string|null);
        placeholderArgb?: (number|null);
        textArgb?: (number|null);
        subtextArgb?: (number|null);
        mediaData?: (proto.IMediaData|null);
        type?: proto.PaymentBackground.Type|null;
    }

    class PaymentBackground implements IPaymentBackground {
        constructor(p?: IPaymentBackground);
        public id?: (string|null);
        public fileLength?: (number|Long|null);
        public width?: (number|null);
        public height?: (number|null);
        public mimetype?: (string|null);
        public placeholderArgb?: (number|null);
        public textArgb?: (number|null);
        public subtextArgb?: (number|null);
        public mediaData?: (proto.IMediaData|null);
        public type?: proto.PaymentBackground.Type|null;
        public static create(properties?: IPaymentBackground): PaymentBackground;
        public static encode(m: IPaymentBackground, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentBackground;
        public static fromObject(d: { [k: string]: any }): PaymentBackground;
        public static toObject(m: PaymentBackground, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPaymentInfo {
        currencyDeprecated?: proto.PaymentInfo.Currency|null;
        amount1000?: (number|Long|null);
        receiverJid?: (string|null);
        status?: proto.PaymentInfo.Status|null;
        transactionTimestamp?: (number|Long|null);
        requestMessageKey?: (proto.IMessageKey|null);
        expiryTimestamp?: (number|Long|null);
        futureproofed?: (boolean|null);
        currency?: (string|null);
        txnStatus?: proto.PaymentInfo.TxnStatus|null;
        useNoviFiatFormat?: (boolean|null);
        primaryAmount?: (proto.IMoney|null);
        exchangeAmount?: (proto.IMoney|null);
    }

    class PaymentInfo implements IPaymentInfo {
        constructor(p?: IPaymentInfo);
        public currencyDeprecated?: proto.PaymentInfo.Currency|null;
        public amount1000?: (number|Long|null);
        public receiverJid?: (string|null);
        public status?: proto.PaymentInfo.Status|null;
        public transactionTimestamp?: (number|Long|null);
        public requestMessageKey?: (proto.IMessageKey|null);
        public expiryTimestamp?: (number|Long|null);
        public futureproofed?: (boolean|null);
        public currency?: (string|null);
        public txnStatus?: proto.PaymentInfo.TxnStatus|null;
        public useNoviFiatFormat?: (boolean|null);
        public primaryAmount?: (proto.IMoney|null);
        public exchangeAmount?: (proto.IMoney|null);
        public static create(properties?: IPaymentInfo): PaymentInfo;
        public static encode(m: IPaymentInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentInfo;
        public static fromObject(d: { [k: string]: any }): PaymentInfo;
        public static toObject(m: PaymentInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPhoneNumberToLidMapping {
        pnJid?: (string|null);
        lidJid?: (string|null);
    }

    class PhoneNumberToLidMapping implements IPhoneNumberToLidMapping {
        constructor(p?: IPhoneNumberToLidMapping);
        public pnJid?: (string|null);
        public lidJid?: (string|null);
        public static create(properties?: IPhoneNumberToLidMapping): PhoneNumberToLidMapping;
        public static encode(m: IPhoneNumberToLidMapping, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PhoneNumberToLidMapping;
        public static fromObject(d: { [k: string]: any }): PhoneNumberToLidMapping;
        public static toObject(m: PhoneNumberToLidMapping, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPhotoChange {
        oldPhoto?: (Uint8Array|null);
        newPhoto?: (Uint8Array|null);
        newPhotoId?: (number|null);
    }

    class PhotoChange implements IPhotoChange {
        constructor(p?: IPhotoChange);
        public oldPhoto?: (Uint8Array|null);
        public newPhoto?: (Uint8Array|null);
        public newPhotoId?: (number|null);
        public static create(properties?: IPhotoChange): PhotoChange;
        public static encode(m: IPhotoChange, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PhotoChange;
        public static fromObject(d: { [k: string]: any }): PhotoChange;
        public static toObject(m: PhotoChange, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPinInChat {
        type?: proto.PinInChat.Type|null;
        key?: (proto.IMessageKey|null);
        senderTimestampMs?: (number|Long|null);
        serverTimestampMs?: (number|Long|null);
        messageAddOnContextInfo?: (proto.IMessageAddOnContextInfo|null);
    }

    class PinInChat implements IPinInChat {
        constructor(p?: IPinInChat);
        public type?: proto.PinInChat.Type|null;
        public key?: (proto.IMessageKey|null);
        public senderTimestampMs?: (number|Long|null);
        public serverTimestampMs?: (number|Long|null);
        public messageAddOnContextInfo?: (proto.IMessageAddOnContextInfo|null);
        public static create(properties?: IPinInChat): PinInChat;
        public static encode(m: IPinInChat, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PinInChat;
        public static fromObject(d: { [k: string]: any }): PinInChat;
        public static toObject(m: PinInChat, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPoint {
        xDeprecated?: (number|null);
        yDeprecated?: (number|null);
        x?: (number|null);
        y?: (number|null);
    }

    class Point implements IPoint {
        constructor(p?: IPoint);
        public xDeprecated?: (number|null);
        public yDeprecated?: (number|null);
        public x?: (number|null);
        public y?: (number|null);
        public static create(properties?: IPoint): Point;
        public static encode(m: IPoint, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Point;
        public static fromObject(d: { [k: string]: any }): Point;
        public static toObject(m: Point, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPollAdditionalMetadata {
        pollInvalidated?: (boolean|null);
    }

    class PollAdditionalMetadata implements IPollAdditionalMetadata {
        constructor(p?: IPollAdditionalMetadata);
        public pollInvalidated?: (boolean|null);
        public static create(properties?: IPollAdditionalMetadata): PollAdditionalMetadata;
        public static encode(m: IPollAdditionalMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollAdditionalMetadata;
        public static fromObject(d: { [k: string]: any }): PollAdditionalMetadata;
        public static toObject(m: PollAdditionalMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPollEncValue {
        encPayload?: (Uint8Array|null);
        encIv?: (Uint8Array|null);
    }

    class PollEncValue implements IPollEncValue {
        constructor(p?: IPollEncValue);
        public encPayload?: (Uint8Array|null);
        public encIv?: (Uint8Array|null);
        public static create(properties?: IPollEncValue): PollEncValue;
        public static encode(m: IPollEncValue, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollEncValue;
        public static fromObject(d: { [k: string]: any }): PollEncValue;
        public static toObject(m: PollEncValue, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPollUpdate {
        pollUpdateMessageKey?: (proto.IMessageKey|null);
        vote?: (proto.IPollVoteMessage|null);
        senderTimestampMs?: (number|Long|null);
        serverTimestampMs?: (number|Long|null);
        unread?: (boolean|null);
    }

    class PollUpdate implements IPollUpdate {
        constructor(p?: IPollUpdate);
        public pollUpdateMessageKey?: (proto.IMessageKey|null);
        public vote?: (proto.IPollVoteMessage|null);
        public senderTimestampMs?: (number|Long|null);
        public serverTimestampMs?: (number|Long|null);
        public unread?: (boolean|null);
        public static create(properties?: IPollUpdate): PollUpdate;
        public static encode(m: IPollUpdate, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollUpdate;
        public static fromObject(d: { [k: string]: any }): PollUpdate;
        public static toObject(m: PollUpdate, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPreKeyRecordStructure {
        id?: (number|null);
        publicKey?: (Uint8Array|null);
        privateKey?: (Uint8Array|null);
    }

    class PreKeyRecordStructure implements IPreKeyRecordStructure {
        constructor(p?: IPreKeyRecordStructure);
        public id?: (number|null);
        public publicKey?: (Uint8Array|null);
        public privateKey?: (Uint8Array|null);
        public static create(properties?: IPreKeyRecordStructure): PreKeyRecordStructure;
        public static encode(m: IPreKeyRecordStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PreKeyRecordStructure;
        public static fromObject(d: { [k: string]: any }): PreKeyRecordStructure;
        public static toObject(m: PreKeyRecordStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPreKeySignalMessage {
        registrationId?: (number|null);
        preKeyId?: (number|null);
        signedPreKeyId?: (number|null);
        baseKey?: (Uint8Array|null);
        identityKey?: (Uint8Array|null);
        message?: (Uint8Array|null);
    }

    class PreKeySignalMessage implements IPreKeySignalMessage {
        constructor(p?: IPreKeySignalMessage);
        public registrationId?: (number|null);
        public preKeyId?: (number|null);
        public signedPreKeyId?: (number|null);
        public baseKey?: (Uint8Array|null);
        public identityKey?: (Uint8Array|null);
        public message?: (Uint8Array|null);
        public static create(properties?: IPreKeySignalMessage): PreKeySignalMessage;
        public static encode(m: IPreKeySignalMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PreKeySignalMessage;
        public static fromObject(d: { [k: string]: any }): PreKeySignalMessage;
        public static toObject(m: PreKeySignalMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPremiumMessageInfo {
        serverCampaignId?: (string|null);
    }

    class PremiumMessageInfo implements IPremiumMessageInfo {
        constructor(p?: IPremiumMessageInfo);
        public serverCampaignId?: (string|null);
        public static create(properties?: IPremiumMessageInfo): PremiumMessageInfo;
        public static encode(m: IPremiumMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PremiumMessageInfo;
        public static fromObject(d: { [k: string]: any }): PremiumMessageInfo;
        public static toObject(m: PremiumMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPrimaryEphemeralIdentity {
        publicKey?: (Uint8Array|null);
        nonce?: (Uint8Array|null);
    }

    class PrimaryEphemeralIdentity implements IPrimaryEphemeralIdentity {
        constructor(p?: IPrimaryEphemeralIdentity);
        public publicKey?: (Uint8Array|null);
        public nonce?: (Uint8Array|null);
        public static create(properties?: IPrimaryEphemeralIdentity): PrimaryEphemeralIdentity;
        public static encode(m: IPrimaryEphemeralIdentity, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrimaryEphemeralIdentity;
        public static fromObject(d: { [k: string]: any }): PrimaryEphemeralIdentity;
        public static toObject(m: PrimaryEphemeralIdentity, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IProcessedVideo {
        directPath?: (string|null);
        fileSha256?: (Uint8Array|null);
        height?: (number|null);
        width?: (number|null);
        fileLength?: (number|Long|null);
        bitrate?: (number|null);
        quality?: proto.ProcessedVideo.VideoQuality|null;
        capabilities?: string[];
    }

    class ProcessedVideo implements IProcessedVideo {
        constructor(p?: IProcessedVideo);
        public directPath?: (string|null);
        public fileSha256?: (Uint8Array|null);
        public height?: (number|null);
        public width?: (number|null);
        public fileLength?: (number|Long|null);
        public bitrate?: (number|null);
        public quality?: proto.ProcessedVideo.VideoQuality|null;
        public capabilities: string[];
        public static create(properties?: IProcessedVideo): ProcessedVideo;
        public static encode(m: IProcessedVideo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProcessedVideo;
        public static fromObject(d: { [k: string]: any }): ProcessedVideo;
        public static toObject(m: ProcessedVideo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IProloguePayload {
        companionEphemeralIdentity?: (Uint8Array|null);
        commitment?: (proto.ICompanionCommitment|null);
    }

    class ProloguePayload implements IProloguePayload {
        constructor(p?: IProloguePayload);
        public companionEphemeralIdentity?: (Uint8Array|null);
        public commitment?: (proto.ICompanionCommitment|null);
        public static create(properties?: IProloguePayload): ProloguePayload;
        public static encode(m: IProloguePayload, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProloguePayload;
        public static fromObject(d: { [k: string]: any }): ProloguePayload;
        public static toObject(m: ProloguePayload, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IPushname {
        id?: (string|null);
        pushname?: (string|null);
    }

    class Pushname implements IPushname {
        constructor(p?: IPushname);
        public id?: (string|null);
        public pushname?: (string|null);
        public static create(properties?: IPushname): Pushname;
        public static encode(m: IPushname, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Pushname;
        public static fromObject(d: { [k: string]: any }): Pushname;
        public static toObject(m: Pushname, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IQuarantinedMessage {
        originalData?: (Uint8Array|null);
        extractedText?: (string|null);
    }

    class QuarantinedMessage implements IQuarantinedMessage {
        constructor(p?: IQuarantinedMessage);
        public originalData?: (Uint8Array|null);
        public extractedText?: (string|null);
        public static create(properties?: IQuarantinedMessage): QuarantinedMessage;
        public static encode(m: IQuarantinedMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): QuarantinedMessage;
        public static fromObject(d: { [k: string]: any }): QuarantinedMessage;
        public static toObject(m: QuarantinedMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IReaction {
        key?: (proto.IMessageKey|null);
        text?: (string|null);
        groupingKey?: (string|null);
        senderTimestampMs?: (number|Long|null);
        unread?: (boolean|null);
    }

    class Reaction implements IReaction {
        constructor(p?: IReaction);
        public key?: (proto.IMessageKey|null);
        public text?: (string|null);
        public groupingKey?: (string|null);
        public senderTimestampMs?: (number|Long|null);
        public unread?: (boolean|null);
        public static create(properties?: IReaction): Reaction;
        public static encode(m: IReaction, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Reaction;
        public static fromObject(d: { [k: string]: any }): Reaction;
        public static toObject(m: Reaction, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IRecentEmojiWeight {
        emoji?: (string|null);
        weight?: (number|null);
    }

    class RecentEmojiWeight implements IRecentEmojiWeight {
        constructor(p?: IRecentEmojiWeight);
        public emoji?: (string|null);
        public weight?: (number|null);
        public static create(properties?: IRecentEmojiWeight): RecentEmojiWeight;
        public static encode(m: IRecentEmojiWeight, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RecentEmojiWeight;
        public static fromObject(d: { [k: string]: any }): RecentEmojiWeight;
        public static toObject(m: RecentEmojiWeight, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IRecordStructure {
        currentSession?: (proto.ISessionStructure|null);
        previousSessions?: proto.ISessionStructure[];
    }

    class RecordStructure implements IRecordStructure {
        constructor(p?: IRecordStructure);
        public currentSession?: (proto.ISessionStructure|null);
        public previousSessions: proto.ISessionStructure[];
        public static create(properties?: IRecordStructure): RecordStructure;
        public static encode(m: IRecordStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RecordStructure;
        public static fromObject(d: { [k: string]: any }): RecordStructure;
        public static toObject(m: RecordStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IReportable {
        minVersion?: (number|null);
        maxVersion?: (number|null);
        notReportableMinVersion?: (number|null);
        never?: (boolean|null);
    }

    class Reportable implements IReportable {
        constructor(p?: IReportable);
        public minVersion?: (number|null);
        public maxVersion?: (number|null);
        public notReportableMinVersion?: (number|null);
        public never?: (boolean|null);
        public static create(properties?: IReportable): Reportable;
        public static encode(m: IReportable, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Reportable;
        public static fromObject(d: { [k: string]: any }): Reportable;
        public static toObject(m: Reportable, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IReportingTokenInfo {
        reportingTag?: (Uint8Array|null);
    }

    class ReportingTokenInfo implements IReportingTokenInfo {
        constructor(p?: IReportingTokenInfo);
        public reportingTag?: (Uint8Array|null);
        public static create(properties?: IReportingTokenInfo): ReportingTokenInfo;
        public static encode(m: IReportingTokenInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ReportingTokenInfo;
        public static fromObject(d: { [k: string]: any }): ReportingTokenInfo;
        public static toObject(m: ReportingTokenInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISenderKeyDistributionMessage {
        id?: (number|null);
        iteration?: (number|null);
        chainKey?: (Uint8Array|null);
        signingKey?: (Uint8Array|null);
    }

    class SenderKeyDistributionMessage implements ISenderKeyDistributionMessage {
        constructor(p?: ISenderKeyDistributionMessage);
        public id?: (number|null);
        public iteration?: (number|null);
        public chainKey?: (Uint8Array|null);
        public signingKey?: (Uint8Array|null);
        public static create(properties?: ISenderKeyDistributionMessage): SenderKeyDistributionMessage;
        public static encode(m: ISenderKeyDistributionMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderKeyDistributionMessage;
        public static fromObject(d: { [k: string]: any }): SenderKeyDistributionMessage;
        public static toObject(m: SenderKeyDistributionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISenderKeyMessage {
        id?: (number|null);
        iteration?: (number|null);
        ciphertext?: (Uint8Array|null);
    }

    class SenderKeyMessage implements ISenderKeyMessage {
        constructor(p?: ISenderKeyMessage);
        public id?: (number|null);
        public iteration?: (number|null);
        public ciphertext?: (Uint8Array|null);
        public static create(properties?: ISenderKeyMessage): SenderKeyMessage;
        public static encode(m: ISenderKeyMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderKeyMessage;
        public static fromObject(d: { [k: string]: any }): SenderKeyMessage;
        public static toObject(m: SenderKeyMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISenderKeyRecordStructure {
        senderKeyStates?: proto.ISenderKeyStateStructure[];
    }

    class SenderKeyRecordStructure implements ISenderKeyRecordStructure {
        constructor(p?: ISenderKeyRecordStructure);
        public senderKeyStates: proto.ISenderKeyStateStructure[];
        public static create(properties?: ISenderKeyRecordStructure): SenderKeyRecordStructure;
        public static encode(m: ISenderKeyRecordStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderKeyRecordStructure;
        public static fromObject(d: { [k: string]: any }): SenderKeyRecordStructure;
        public static toObject(m: SenderKeyRecordStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISenderKeyStateStructure {
        senderKeyId?: (number|null);
        senderChainKey?: (proto.ISenderChainKey|null);
        senderSigningKey?: (proto.ISenderSigningKey|null);
        senderMessageKeys?: proto.ISenderMessageKey[];
    }

    class SenderKeyStateStructure implements ISenderKeyStateStructure {
        constructor(p?: ISenderKeyStateStructure);
        public senderKeyId?: (number|null);
        public senderChainKey?: (proto.ISenderChainKey|null);
        public senderSigningKey?: (proto.ISenderSigningKey|null);
        public senderMessageKeys: proto.ISenderMessageKey[];
        public static create(properties?: ISenderKeyStateStructure): SenderKeyStateStructure;
        public static encode(m: ISenderKeyStateStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderKeyStateStructure;
        public static fromObject(d: { [k: string]: any }): SenderKeyStateStructure;
        public static toObject(m: SenderKeyStateStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IServerErrorReceipt {
        stanzaId?: (string|null);
    }

    class ServerErrorReceipt implements IServerErrorReceipt {
        constructor(p?: IServerErrorReceipt);
        public stanzaId?: (string|null);
        public static create(properties?: IServerErrorReceipt): ServerErrorReceipt;
        public static encode(m: IServerErrorReceipt, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ServerErrorReceipt;
        public static fromObject(d: { [k: string]: any }): ServerErrorReceipt;
        public static toObject(m: ServerErrorReceipt, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISessionStructure {
        sessionVersion?: (number|null);
        localIdentityPublic?: (Uint8Array|null);
        remoteIdentityPublic?: (Uint8Array|null);
        rootKey?: (Uint8Array|null);
        previousCounter?: (number|null);
        senderChain?: (proto.IChain|null);
        receiverChains?: proto.IChain[];
        pendingKeyExchange?: (proto.IPendingKeyExchange|null);
        pendingPreKey?: (proto.IPendingPreKey|null);
        remoteRegistrationId?: (number|null);
        localRegistrationId?: (number|null);
        needsRefresh?: (boolean|null);
        aliceBaseKey?: (Uint8Array|null);
    }

    class SessionStructure implements ISessionStructure {
        constructor(p?: ISessionStructure);
        public sessionVersion?: (number|null);
        public localIdentityPublic?: (Uint8Array|null);
        public remoteIdentityPublic?: (Uint8Array|null);
        public rootKey?: (Uint8Array|null);
        public previousCounter?: (number|null);
        public senderChain?: (proto.IChain|null);
        public receiverChains: proto.IChain[];
        public pendingKeyExchange?: (proto.IPendingKeyExchange|null);
        public pendingPreKey?: (proto.IPendingPreKey|null);
        public remoteRegistrationId?: (number|null);
        public localRegistrationId?: (number|null);
        public needsRefresh?: (boolean|null);
        public aliceBaseKey?: (Uint8Array|null);
        public static create(properties?: ISessionStructure): SessionStructure;
        public static encode(m: ISessionStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SessionStructure;
        public static fromObject(d: { [k: string]: any }): SessionStructure;
        public static toObject(m: SessionStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISessionTransparencyMetadata {
        disclaimerText?: (string|null);
        hcaId?: (string|null);
        sessionTransparencyType?: proto.SessionTransparencyType|null;
    }

    class SessionTransparencyMetadata implements ISessionTransparencyMetadata {
        constructor(p?: ISessionTransparencyMetadata);
        public disclaimerText?: (string|null);
        public hcaId?: (string|null);
        public sessionTransparencyType?: proto.SessionTransparencyType|null;
        public static create(properties?: ISessionTransparencyMetadata): SessionTransparencyMetadata;
        public static encode(m: ISessionTransparencyMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SessionTransparencyMetadata;
        public static fromObject(d: { [k: string]: any }): SessionTransparencyMetadata;
        public static toObject(m: SessionTransparencyMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISignalMessage {
        ratchetKey?: (Uint8Array|null);
        counter?: (number|null);
        previousCounter?: (number|null);
        ciphertext?: (Uint8Array|null);
    }

    class SignalMessage implements ISignalMessage {
        constructor(p?: ISignalMessage);
        public ratchetKey?: (Uint8Array|null);
        public counter?: (number|null);
        public previousCounter?: (number|null);
        public ciphertext?: (Uint8Array|null);
        public static create(properties?: ISignalMessage): SignalMessage;
        public static encode(m: ISignalMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SignalMessage;
        public static fromObject(d: { [k: string]: any }): SignalMessage;
        public static toObject(m: SignalMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISignedPreKeyRecordStructure {
        id?: (number|null);
        publicKey?: (Uint8Array|null);
        privateKey?: (Uint8Array|null);
        signature?: (Uint8Array|null);
        timestamp?: (number|Long|null);
    }

    class SignedPreKeyRecordStructure implements ISignedPreKeyRecordStructure {
        constructor(p?: ISignedPreKeyRecordStructure);
        public id?: (number|null);
        public publicKey?: (Uint8Array|null);
        public privateKey?: (Uint8Array|null);
        public signature?: (Uint8Array|null);
        public timestamp?: (number|Long|null);
        public static create(properties?: ISignedPreKeyRecordStructure): SignedPreKeyRecordStructure;
        public static encode(m: ISignedPreKeyRecordStructure, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SignedPreKeyRecordStructure;
        public static fromObject(d: { [k: string]: any }): SignedPreKeyRecordStructure;
        public static toObject(m: SignedPreKeyRecordStructure, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IStatusAttribution {
        type?: proto.StatusAttribution.Type|null;
        actionUrl?: (string|null);
        statusReshare?: (proto.IStatusReshare|null);
        externalShare?: (proto.IExternalShare|null);
        music?: (proto.IMusic|null);
        groupStatus?: (proto.IGroupStatus|null);
        rlAttribution?: (proto.IRlAttribution|null);
        aiCreatedAttribution?: (proto.IAiCreatedAttribution|null);
        /** Prost oneof field */
        attributionData?: {
            statusReshare?: (proto.IStatusReshare|null);
            externalShare?: (proto.IExternalShare|null);
            music?: (proto.IMusic|null);
            groupStatus?: (proto.IGroupStatus|null);
            rlAttribution?: (proto.IRlAttribution|null);
            aiCreatedAttribution?: (proto.IAiCreatedAttribution|null);
        } | null;
    }

    class StatusAttribution implements IStatusAttribution {
        constructor(p?: IStatusAttribution);
        public type?: proto.StatusAttribution.Type|null;
        public actionUrl?: (string|null);
        public statusReshare?: (proto.IStatusReshare|null);
        public externalShare?: (proto.IExternalShare|null);
        public music?: (proto.IMusic|null);
        public groupStatus?: (proto.IGroupStatus|null);
        public rlAttribution?: (proto.IRlAttribution|null);
        public aiCreatedAttribution?: (proto.IAiCreatedAttribution|null);
        public attributionData?: ("statusReshare"|"externalShare"|"music"|"groupStatus"|"rlAttribution"|"aiCreatedAttribution");
        public static create(properties?: IStatusAttribution): StatusAttribution;
        public static encode(m: IStatusAttribution, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusAttribution;
        public static fromObject(d: { [k: string]: any }): StatusAttribution;
        public static toObject(m: StatusAttribution, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IStatusMentionMessage {
        quotedStatus?: (proto.IMessage|null);
    }

    class StatusMentionMessage implements IStatusMentionMessage {
        constructor(p?: IStatusMentionMessage);
        public quotedStatus?: (proto.IMessage|null);
        public static create(properties?: IStatusMentionMessage): StatusMentionMessage;
        public static encode(m: IStatusMentionMessage, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusMentionMessage;
        public static fromObject(d: { [k: string]: any }): StatusMentionMessage;
        public static toObject(m: StatusMentionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IStatusPsa {
        campaignId?: number|Long;
        campaignExpirationTimestamp?: (number|Long|null);
    }

    class StatusPsa implements IStatusPsa {
        constructor(p?: IStatusPsa);
        public campaignId: number|Long;
        public campaignExpirationTimestamp?: (number|Long|null);
        public static create(properties?: IStatusPsa): StatusPsa;
        public static encode(m: IStatusPsa, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusPsa;
        public static fromObject(d: { [k: string]: any }): StatusPsa;
        public static toObject(m: StatusPsa, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IStickerMetadata {
        url?: (string|null);
        fileSha256?: (Uint8Array|null);
        fileEncSha256?: (Uint8Array|null);
        mediaKey?: (Uint8Array|null);
        mimetype?: (string|null);
        height?: (number|null);
        width?: (number|null);
        directPath?: (string|null);
        fileLength?: (number|Long|null);
        weight?: (number|null);
        lastStickerSentTs?: (number|Long|null);
        isLottie?: (boolean|null);
        imageHash?: (string|null);
        isAvatarSticker?: (boolean|null);
    }

    class StickerMetadata implements IStickerMetadata {
        constructor(p?: IStickerMetadata);
        public url?: (string|null);
        public fileSha256?: (Uint8Array|null);
        public fileEncSha256?: (Uint8Array|null);
        public mediaKey?: (Uint8Array|null);
        public mimetype?: (string|null);
        public height?: (number|null);
        public width?: (number|null);
        public directPath?: (string|null);
        public fileLength?: (number|Long|null);
        public weight?: (number|null);
        public lastStickerSentTs?: (number|Long|null);
        public isLottie?: (boolean|null);
        public imageHash?: (string|null);
        public isAvatarSticker?: (boolean|null);
        public static create(properties?: IStickerMetadata): StickerMetadata;
        public static encode(m: IStickerMetadata, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StickerMetadata;
        public static fromObject(d: { [k: string]: any }): StickerMetadata;
        public static toObject(m: StickerMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncActionData {
        index?: (Uint8Array|null);
        value?: (proto.ISyncActionValue|null);
        padding?: (Uint8Array|null);
        version?: (number|null);
    }

    class SyncActionData implements ISyncActionData {
        constructor(p?: ISyncActionData);
        public index?: (Uint8Array|null);
        public value?: (proto.ISyncActionValue|null);
        public padding?: (Uint8Array|null);
        public version?: (number|null);
        public static create(properties?: ISyncActionData): SyncActionData;
        public static encode(m: ISyncActionData, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncActionData;
        public static fromObject(d: { [k: string]: any }): SyncActionData;
        public static toObject(m: SyncActionData, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncActionValue {
        timestamp?: (number|Long|null);
        starAction?: (proto.IStarAction|null);
        contactAction?: (proto.IContactAction|null);
        muteAction?: (proto.IMuteAction|null);
        pinAction?: (proto.IPinAction|null);
        pushNameSetting?: (proto.IPushNameSetting|null);
        quickReplyAction?: (proto.IQuickReplyAction|null);
        recentEmojiWeightsAction?: (proto.IRecentEmojiWeightsAction|null);
        labelEditAction?: (proto.ILabelEditAction|null);
        labelAssociationAction?: (proto.ILabelAssociationAction|null);
        localeSetting?: (proto.ILocaleSetting|null);
        archiveChatAction?: (proto.IArchiveChatAction|null);
        deleteMessageForMeAction?: (proto.IDeleteMessageForMeAction|null);
        keyExpiration?: (proto.IKeyExpiration|null);
        markChatAsReadAction?: (proto.IMarkChatAsReadAction|null);
        clearChatAction?: (proto.IClearChatAction|null);
        deleteChatAction?: (proto.IDeleteChatAction|null);
        unarchiveChatsSetting?: (proto.IUnarchiveChatsSetting|null);
        primaryFeature?: (proto.IPrimaryFeature|null);
        androidUnsupportedActions?: (proto.IAndroidUnsupportedActions|null);
        agentAction?: (proto.IAgentAction|null);
        subscriptionAction?: (proto.ISubscriptionAction|null);
        userStatusMuteAction?: (proto.IUserStatusMuteAction|null);
        timeFormatAction?: (proto.ITimeFormatAction|null);
        nuxAction?: (proto.INuxAction|null);
        primaryVersionAction?: (proto.IPrimaryVersionAction|null);
        stickerAction?: (proto.IStickerAction|null);
        removeRecentStickerAction?: (proto.IRemoveRecentStickerAction|null);
        chatAssignment?: (proto.IChatAssignmentAction|null);
        chatAssignmentOpenedStatus?: (proto.IChatAssignmentOpenedStatusAction|null);
        pnForLidChatAction?: (proto.IPnForLidChatAction|null);
        marketingMessageAction?: (proto.IMarketingMessageAction|null);
        marketingMessageBroadcastAction?: (proto.IMarketingMessageBroadcastAction|null);
        externalWebBetaAction?: (proto.IExternalWebBetaAction|null);
        privacySettingRelayAllCalls?: (proto.IPrivacySettingRelayAllCalls|null);
        callLogAction?: (proto.ICallLogAction|null);
        ugcBot?: (proto.IUgcBot|null);
        statusPrivacy?: (proto.IStatusPrivacyAction|null);
        botWelcomeRequestAction?: (proto.IBotWelcomeRequestAction|null);
        deleteIndividualCallLog?: (proto.IDeleteIndividualCallLogAction|null);
        labelReorderingAction?: (proto.ILabelReorderingAction|null);
        paymentInfoAction?: (proto.IPaymentInfoAction|null);
        customPaymentMethodsAction?: (proto.ICustomPaymentMethodsAction|null);
        lockChatAction?: (proto.ILockChatAction|null);
        chatLockSettings?: (proto.IChatLockSettings|null);
        wamoUserIdentifierAction?: (proto.IWamoUserIdentifierAction|null);
        privacySettingDisableLinkPreviewsAction?: (proto.IPrivacySettingDisableLinkPreviewsAction|null);
        deviceCapabilities?: (proto.IDeviceCapabilities|null);
        noteEditAction?: (proto.INoteEditAction|null);
        favoritesAction?: (proto.IFavoritesAction|null);
        merchantPaymentPartnerAction?: (proto.IMerchantPaymentPartnerAction|null);
        waffleAccountLinkStateAction?: (proto.IWaffleAccountLinkStateAction|null);
        usernameChatStartMode?: (proto.IUsernameChatStartModeAction|null);
        notificationActivitySettingAction?: (proto.INotificationActivitySettingAction|null);
        lidContactAction?: (proto.ILidContactAction|null);
        ctwaPerCustomerDataSharingAction?: (proto.ICtwaPerCustomerDataSharingAction|null);
        paymentTosAction?: (proto.IPaymentTosAction|null);
        privacySettingChannelsPersonalisedRecommendationAction?: (proto.IPrivacySettingChannelsPersonalisedRecommendationAction|null);
        detectedOutcomesStatusAction?: (proto.IDetectedOutcomesStatusAction|null);
        maibaAiFeaturesControlAction?: (proto.IMaibaAiFeaturesControlAction|null);
        businessBroadcastListAction?: (proto.IBusinessBroadcastListAction|null);
        musicUserIdAction?: (proto.IMusicUserIdAction|null);
        statusPostOptInNotificationPreferencesAction?: (proto.IStatusPostOptInNotificationPreferencesAction|null);
        avatarUpdatedAction?: (proto.IAvatarUpdatedAction|null);
        privateProcessingSettingAction?: (proto.IPrivateProcessingSettingAction|null);
        newsletterSavedInterestsAction?: (proto.INewsletterSavedInterestsAction|null);
        aiThreadRenameAction?: (proto.IAiThreadRenameAction|null);
        interactiveMessageAction?: (proto.IInteractiveMessageAction|null);
        settingsSyncAction?: (proto.ISettingsSyncAction|null);
    }

    class SyncActionValue implements ISyncActionValue {
        constructor(p?: ISyncActionValue);
        public timestamp?: (number|Long|null);
        public starAction?: (proto.IStarAction|null);
        public contactAction?: (proto.IContactAction|null);
        public muteAction?: (proto.IMuteAction|null);
        public pinAction?: (proto.IPinAction|null);
        public pushNameSetting?: (proto.IPushNameSetting|null);
        public quickReplyAction?: (proto.IQuickReplyAction|null);
        public recentEmojiWeightsAction?: (proto.IRecentEmojiWeightsAction|null);
        public labelEditAction?: (proto.ILabelEditAction|null);
        public labelAssociationAction?: (proto.ILabelAssociationAction|null);
        public localeSetting?: (proto.ILocaleSetting|null);
        public archiveChatAction?: (proto.IArchiveChatAction|null);
        public deleteMessageForMeAction?: (proto.IDeleteMessageForMeAction|null);
        public keyExpiration?: (proto.IKeyExpiration|null);
        public markChatAsReadAction?: (proto.IMarkChatAsReadAction|null);
        public clearChatAction?: (proto.IClearChatAction|null);
        public deleteChatAction?: (proto.IDeleteChatAction|null);
        public unarchiveChatsSetting?: (proto.IUnarchiveChatsSetting|null);
        public primaryFeature?: (proto.IPrimaryFeature|null);
        public androidUnsupportedActions?: (proto.IAndroidUnsupportedActions|null);
        public agentAction?: (proto.IAgentAction|null);
        public subscriptionAction?: (proto.ISubscriptionAction|null);
        public userStatusMuteAction?: (proto.IUserStatusMuteAction|null);
        public timeFormatAction?: (proto.ITimeFormatAction|null);
        public nuxAction?: (proto.INuxAction|null);
        public primaryVersionAction?: (proto.IPrimaryVersionAction|null);
        public stickerAction?: (proto.IStickerAction|null);
        public removeRecentStickerAction?: (proto.IRemoveRecentStickerAction|null);
        public chatAssignment?: (proto.IChatAssignmentAction|null);
        public chatAssignmentOpenedStatus?: (proto.IChatAssignmentOpenedStatusAction|null);
        public pnForLidChatAction?: (proto.IPnForLidChatAction|null);
        public marketingMessageAction?: (proto.IMarketingMessageAction|null);
        public marketingMessageBroadcastAction?: (proto.IMarketingMessageBroadcastAction|null);
        public externalWebBetaAction?: (proto.IExternalWebBetaAction|null);
        public privacySettingRelayAllCalls?: (proto.IPrivacySettingRelayAllCalls|null);
        public callLogAction?: (proto.ICallLogAction|null);
        public ugcBot?: (proto.IUgcBot|null);
        public statusPrivacy?: (proto.IStatusPrivacyAction|null);
        public botWelcomeRequestAction?: (proto.IBotWelcomeRequestAction|null);
        public deleteIndividualCallLog?: (proto.IDeleteIndividualCallLogAction|null);
        public labelReorderingAction?: (proto.ILabelReorderingAction|null);
        public paymentInfoAction?: (proto.IPaymentInfoAction|null);
        public customPaymentMethodsAction?: (proto.ICustomPaymentMethodsAction|null);
        public lockChatAction?: (proto.ILockChatAction|null);
        public chatLockSettings?: (proto.IChatLockSettings|null);
        public wamoUserIdentifierAction?: (proto.IWamoUserIdentifierAction|null);
        public privacySettingDisableLinkPreviewsAction?: (proto.IPrivacySettingDisableLinkPreviewsAction|null);
        public deviceCapabilities?: (proto.IDeviceCapabilities|null);
        public noteEditAction?: (proto.INoteEditAction|null);
        public favoritesAction?: (proto.IFavoritesAction|null);
        public merchantPaymentPartnerAction?: (proto.IMerchantPaymentPartnerAction|null);
        public waffleAccountLinkStateAction?: (proto.IWaffleAccountLinkStateAction|null);
        public usernameChatStartMode?: (proto.IUsernameChatStartModeAction|null);
        public notificationActivitySettingAction?: (proto.INotificationActivitySettingAction|null);
        public lidContactAction?: (proto.ILidContactAction|null);
        public ctwaPerCustomerDataSharingAction?: (proto.ICtwaPerCustomerDataSharingAction|null);
        public paymentTosAction?: (proto.IPaymentTosAction|null);
        public privacySettingChannelsPersonalisedRecommendationAction?: (proto.IPrivacySettingChannelsPersonalisedRecommendationAction|null);
        public detectedOutcomesStatusAction?: (proto.IDetectedOutcomesStatusAction|null);
        public maibaAiFeaturesControlAction?: (proto.IMaibaAiFeaturesControlAction|null);
        public businessBroadcastListAction?: (proto.IBusinessBroadcastListAction|null);
        public musicUserIdAction?: (proto.IMusicUserIdAction|null);
        public statusPostOptInNotificationPreferencesAction?: (proto.IStatusPostOptInNotificationPreferencesAction|null);
        public avatarUpdatedAction?: (proto.IAvatarUpdatedAction|null);
        public privateProcessingSettingAction?: (proto.IPrivateProcessingSettingAction|null);
        public newsletterSavedInterestsAction?: (proto.INewsletterSavedInterestsAction|null);
        public aiThreadRenameAction?: (proto.IAiThreadRenameAction|null);
        public interactiveMessageAction?: (proto.IInteractiveMessageAction|null);
        public settingsSyncAction?: (proto.ISettingsSyncAction|null);
        public static create(properties?: ISyncActionValue): SyncActionValue;
        public static encode(m: ISyncActionValue, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncActionValue;
        public static fromObject(d: { [k: string]: any }): SyncActionValue;
        public static toObject(m: SyncActionValue, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdIndex {
        blob?: (Uint8Array|null);
    }

    class SyncdIndex implements ISyncdIndex {
        constructor(p?: ISyncdIndex);
        public blob?: (Uint8Array|null);
        public static create(properties?: ISyncdIndex): SyncdIndex;
        public static encode(m: ISyncdIndex, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdIndex;
        public static fromObject(d: { [k: string]: any }): SyncdIndex;
        public static toObject(m: SyncdIndex, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdMutation {
        operation?: proto.SyncdMutation.SyncdOperation|null;
        record?: (proto.ISyncdRecord|null);
    }

    class SyncdMutation implements ISyncdMutation {
        constructor(p?: ISyncdMutation);
        public operation?: proto.SyncdMutation.SyncdOperation|null;
        public record?: (proto.ISyncdRecord|null);
        public static create(properties?: ISyncdMutation): SyncdMutation;
        public static encode(m: ISyncdMutation, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdMutation;
        public static fromObject(d: { [k: string]: any }): SyncdMutation;
        public static toObject(m: SyncdMutation, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdMutations {
        mutations?: proto.ISyncdMutation[];
    }

    class SyncdMutations implements ISyncdMutations {
        constructor(p?: ISyncdMutations);
        public mutations: proto.ISyncdMutation[];
        public static create(properties?: ISyncdMutations): SyncdMutations;
        public static encode(m: ISyncdMutations, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdMutations;
        public static fromObject(d: { [k: string]: any }): SyncdMutations;
        public static toObject(m: SyncdMutations, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdPatch {
        version?: (proto.ISyncdVersion|null);
        mutations?: proto.ISyncdMutation[];
        externalMutations?: (proto.IExternalBlobReference|null);
        snapshotMac?: (Uint8Array|null);
        patchMac?: (Uint8Array|null);
        keyId?: (proto.IKeyId|null);
        exitCode?: (proto.IExitCode|null);
        deviceIndex?: (number|null);
        clientDebugData?: (Uint8Array|null);
    }

    class SyncdPatch implements ISyncdPatch {
        constructor(p?: ISyncdPatch);
        public version?: (proto.ISyncdVersion|null);
        public mutations: proto.ISyncdMutation[];
        public externalMutations?: (proto.IExternalBlobReference|null);
        public snapshotMac?: (Uint8Array|null);
        public patchMac?: (Uint8Array|null);
        public keyId?: (proto.IKeyId|null);
        public exitCode?: (proto.IExitCode|null);
        public deviceIndex?: (number|null);
        public clientDebugData?: (Uint8Array|null);
        public static create(properties?: ISyncdPatch): SyncdPatch;
        public static encode(m: ISyncdPatch, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdPatch;
        public static fromObject(d: { [k: string]: any }): SyncdPatch;
        public static toObject(m: SyncdPatch, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdRecord {
        index?: (proto.ISyncdIndex|null);
        value?: (proto.ISyncdValue|null);
        keyId?: (proto.IKeyId|null);
    }

    class SyncdRecord implements ISyncdRecord {
        constructor(p?: ISyncdRecord);
        public index?: (proto.ISyncdIndex|null);
        public value?: (proto.ISyncdValue|null);
        public keyId?: (proto.IKeyId|null);
        public static create(properties?: ISyncdRecord): SyncdRecord;
        public static encode(m: ISyncdRecord, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdRecord;
        public static fromObject(d: { [k: string]: any }): SyncdRecord;
        public static toObject(m: SyncdRecord, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdSnapshot {
        version?: (proto.ISyncdVersion|null);
        records?: proto.ISyncdRecord[];
        mac?: (Uint8Array|null);
        keyId?: (proto.IKeyId|null);
    }

    class SyncdSnapshot implements ISyncdSnapshot {
        constructor(p?: ISyncdSnapshot);
        public version?: (proto.ISyncdVersion|null);
        public records: proto.ISyncdRecord[];
        public mac?: (Uint8Array|null);
        public keyId?: (proto.IKeyId|null);
        public static create(properties?: ISyncdSnapshot): SyncdSnapshot;
        public static encode(m: ISyncdSnapshot, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdSnapshot;
        public static fromObject(d: { [k: string]: any }): SyncdSnapshot;
        public static toObject(m: SyncdSnapshot, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdValue {
        blob?: (Uint8Array|null);
    }

    class SyncdValue implements ISyncdValue {
        constructor(p?: ISyncdValue);
        public blob?: (Uint8Array|null);
        public static create(properties?: ISyncdValue): SyncdValue;
        public static encode(m: ISyncdValue, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdValue;
        public static fromObject(d: { [k: string]: any }): SyncdValue;
        public static toObject(m: SyncdValue, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ISyncdVersion {
        version?: (number|Long|null);
    }

    class SyncdVersion implements ISyncdVersion {
        constructor(p?: ISyncdVersion);
        public version?: (number|Long|null);
        public static create(properties?: ISyncdVersion): SyncdVersion;
        public static encode(m: ISyncdVersion, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncdVersion;
        public static fromObject(d: { [k: string]: any }): SyncdVersion;
        public static toObject(m: SyncdVersion, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ITapLinkAction {
        title?: (string|null);
        tapUrl?: (string|null);
    }

    class TapLinkAction implements ITapLinkAction {
        constructor(p?: ITapLinkAction);
        public title?: (string|null);
        public tapUrl?: (string|null);
        public static create(properties?: ITapLinkAction): TapLinkAction;
        public static encode(m: ITapLinkAction, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TapLinkAction;
        public static fromObject(d: { [k: string]: any }): TapLinkAction;
        public static toObject(m: TapLinkAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface ITemplateButton {
        index?: (number|null);
        quickReplyButton?: (proto.IQuickReplyButton|null);
        urlButton?: (proto.IUrlButton|null);
        callButton?: (proto.ICallButton|null);
        /** Prost oneof field */
        button?: {
            quickReplyButton?: (proto.IQuickReplyButton|null);
            urlButton?: (proto.IUrlButton|null);
            callButton?: (proto.ICallButton|null);
        } | null;
    }

    class TemplateButton implements ITemplateButton {
        constructor(p?: ITemplateButton);
        public index?: (number|null);
        public quickReplyButton?: (proto.IQuickReplyButton|null);
        public urlButton?: (proto.IUrlButton|null);
        public callButton?: (proto.ICallButton|null);
        public button?: ("quickReplyButton"|"urlButton"|"callButton");
        public static create(properties?: ITemplateButton): TemplateButton;
        public static encode(m: ITemplateButton, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TemplateButton;
        public static fromObject(d: { [k: string]: any }): TemplateButton;
        public static toObject(m: TemplateButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IThreadId {
        threadType?: proto.ThreadId.ThreadType|null;
        threadKey?: (proto.IMessageKey|null);
    }

    class ThreadId implements IThreadId {
        constructor(p?: IThreadId);
        public threadType?: proto.ThreadId.ThreadType|null;
        public threadKey?: (proto.IMessageKey|null);
        public static create(properties?: IThreadId): ThreadId;
        public static encode(m: IThreadId, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ThreadId;
        public static fromObject(d: { [k: string]: any }): ThreadId;
        public static toObject(m: ThreadId, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IUrlTrackingMap {
        urlTrackingMapElements?: proto.IUrlTrackingMapElement[];
    }

    class UrlTrackingMap implements IUrlTrackingMap {
        constructor(p?: IUrlTrackingMap);
        public urlTrackingMapElements: proto.IUrlTrackingMapElement[];
        public static create(properties?: IUrlTrackingMap): UrlTrackingMap;
        public static encode(m: IUrlTrackingMap, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UrlTrackingMap;
        public static fromObject(d: { [k: string]: any }): UrlTrackingMap;
        public static toObject(m: UrlTrackingMap, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IUserPassword {
        encoding?: proto.UserPassword.Encoding|null;
        transformer?: proto.UserPassword.Transformer|null;
        transformerArg?: proto.ITransformerArg[];
        transformedData?: (Uint8Array|null);
    }

    class UserPassword implements IUserPassword {
        constructor(p?: IUserPassword);
        public encoding?: proto.UserPassword.Encoding|null;
        public transformer?: proto.UserPassword.Transformer|null;
        public transformerArg: proto.ITransformerArg[];
        public transformedData?: (Uint8Array|null);
        public static create(properties?: IUserPassword): UserPassword;
        public static encode(m: IUserPassword, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UserPassword;
        public static fromObject(d: { [k: string]: any }): UserPassword;
        public static toObject(m: UserPassword, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IUserReceipt {
        userJid?: string;
        receiptTimestamp?: (number|Long|null);
        readTimestamp?: (number|Long|null);
        playedTimestamp?: (number|Long|null);
        pendingDeviceJid?: string[];
        deliveredDeviceJid?: string[];
    }

    class UserReceipt implements IUserReceipt {
        constructor(p?: IUserReceipt);
        public userJid: string;
        public receiptTimestamp?: (number|Long|null);
        public readTimestamp?: (number|Long|null);
        public playedTimestamp?: (number|Long|null);
        public pendingDeviceJid: string[];
        public deliveredDeviceJid: string[];
        public static create(properties?: IUserReceipt): UserReceipt;
        public static encode(m: IUserReceipt, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UserReceipt;
        public static fromObject(d: { [k: string]: any }): UserReceipt;
        public static toObject(m: UserReceipt, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IVerifiedNameCertificate {
        details?: (Uint8Array|null);
        signature?: (Uint8Array|null);
        serverSignature?: (Uint8Array|null);
    }

    class VerifiedNameCertificate implements IVerifiedNameCertificate {
        constructor(p?: IVerifiedNameCertificate);
        public details?: (Uint8Array|null);
        public signature?: (Uint8Array|null);
        public serverSignature?: (Uint8Array|null);
        public static create(properties?: IVerifiedNameCertificate): VerifiedNameCertificate;
        public static encode(m: IVerifiedNameCertificate, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): VerifiedNameCertificate;
        public static fromObject(d: { [k: string]: any }): VerifiedNameCertificate;
        public static toObject(m: VerifiedNameCertificate, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IWallpaperSettings {
        filename?: (string|null);
        opacity?: (number|null);
    }

    class WallpaperSettings implements IWallpaperSettings {
        constructor(p?: IWallpaperSettings);
        public filename?: (string|null);
        public opacity?: (number|null);
        public static create(properties?: IWallpaperSettings): WallpaperSettings;
        public static encode(m: IWallpaperSettings, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WallpaperSettings;
        public static fromObject(d: { [k: string]: any }): WallpaperSettings;
        public static toObject(m: WallpaperSettings, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IWebFeatures {
        labelsDisplay?: proto.WebFeatures.Flag|null;
        voipIndividualOutgoing?: proto.WebFeatures.Flag|null;
        groupsV3?: proto.WebFeatures.Flag|null;
        groupsV3Create?: proto.WebFeatures.Flag|null;
        changeNumberV2?: proto.WebFeatures.Flag|null;
        queryStatusV3Thumbnail?: proto.WebFeatures.Flag|null;
        liveLocations?: proto.WebFeatures.Flag|null;
        queryVname?: proto.WebFeatures.Flag|null;
        voipIndividualIncoming?: proto.WebFeatures.Flag|null;
        quickRepliesQuery?: proto.WebFeatures.Flag|null;
        payments?: proto.WebFeatures.Flag|null;
        stickerPackQuery?: proto.WebFeatures.Flag|null;
        liveLocationsFinal?: proto.WebFeatures.Flag|null;
        labelsEdit?: proto.WebFeatures.Flag|null;
        mediaUpload?: proto.WebFeatures.Flag|null;
        mediaUploadRichQuickReplies?: proto.WebFeatures.Flag|null;
        vnameV2?: proto.WebFeatures.Flag|null;
        videoPlaybackUrl?: proto.WebFeatures.Flag|null;
        statusRanking?: proto.WebFeatures.Flag|null;
        voipIndividualVideo?: proto.WebFeatures.Flag|null;
        thirdPartyStickers?: proto.WebFeatures.Flag|null;
        frequentlyForwardedSetting?: proto.WebFeatures.Flag|null;
        groupsV4JoinPermission?: proto.WebFeatures.Flag|null;
        recentStickers?: proto.WebFeatures.Flag|null;
        catalog?: proto.WebFeatures.Flag|null;
        starredStickers?: proto.WebFeatures.Flag|null;
        voipGroupCall?: proto.WebFeatures.Flag|null;
        templateMessage?: proto.WebFeatures.Flag|null;
        templateMessageInteractivity?: proto.WebFeatures.Flag|null;
        ephemeralMessages?: proto.WebFeatures.Flag|null;
        e2ENotificationSync?: proto.WebFeatures.Flag|null;
        recentStickersV2?: proto.WebFeatures.Flag|null;
        recentStickersV3?: proto.WebFeatures.Flag|null;
        userNotice?: proto.WebFeatures.Flag|null;
        support?: proto.WebFeatures.Flag|null;
        groupUiiCleanup?: proto.WebFeatures.Flag|null;
        groupDogfoodingInternalOnly?: proto.WebFeatures.Flag|null;
        settingsSync?: proto.WebFeatures.Flag|null;
        archiveV2?: proto.WebFeatures.Flag|null;
        ephemeralAllowGroupMembers?: proto.WebFeatures.Flag|null;
        ephemeral24HDuration?: proto.WebFeatures.Flag|null;
        mdForceUpgrade?: proto.WebFeatures.Flag|null;
        disappearingMode?: proto.WebFeatures.Flag|null;
        externalMdOptInAvailable?: proto.WebFeatures.Flag|null;
        noDeleteMessageTimeLimit?: proto.WebFeatures.Flag|null;
    }

    class WebFeatures implements IWebFeatures {
        constructor(p?: IWebFeatures);
        public labelsDisplay?: proto.WebFeatures.Flag|null;
        public voipIndividualOutgoing?: proto.WebFeatures.Flag|null;
        public groupsV3?: proto.WebFeatures.Flag|null;
        public groupsV3Create?: proto.WebFeatures.Flag|null;
        public changeNumberV2?: proto.WebFeatures.Flag|null;
        public queryStatusV3Thumbnail?: proto.WebFeatures.Flag|null;
        public liveLocations?: proto.WebFeatures.Flag|null;
        public queryVname?: proto.WebFeatures.Flag|null;
        public voipIndividualIncoming?: proto.WebFeatures.Flag|null;
        public quickRepliesQuery?: proto.WebFeatures.Flag|null;
        public payments?: proto.WebFeatures.Flag|null;
        public stickerPackQuery?: proto.WebFeatures.Flag|null;
        public liveLocationsFinal?: proto.WebFeatures.Flag|null;
        public labelsEdit?: proto.WebFeatures.Flag|null;
        public mediaUpload?: proto.WebFeatures.Flag|null;
        public mediaUploadRichQuickReplies?: proto.WebFeatures.Flag|null;
        public vnameV2?: proto.WebFeatures.Flag|null;
        public videoPlaybackUrl?: proto.WebFeatures.Flag|null;
        public statusRanking?: proto.WebFeatures.Flag|null;
        public voipIndividualVideo?: proto.WebFeatures.Flag|null;
        public thirdPartyStickers?: proto.WebFeatures.Flag|null;
        public frequentlyForwardedSetting?: proto.WebFeatures.Flag|null;
        public groupsV4JoinPermission?: proto.WebFeatures.Flag|null;
        public recentStickers?: proto.WebFeatures.Flag|null;
        public catalog?: proto.WebFeatures.Flag|null;
        public starredStickers?: proto.WebFeatures.Flag|null;
        public voipGroupCall?: proto.WebFeatures.Flag|null;
        public templateMessage?: proto.WebFeatures.Flag|null;
        public templateMessageInteractivity?: proto.WebFeatures.Flag|null;
        public ephemeralMessages?: proto.WebFeatures.Flag|null;
        public e2ENotificationSync?: proto.WebFeatures.Flag|null;
        public recentStickersV2?: proto.WebFeatures.Flag|null;
        public recentStickersV3?: proto.WebFeatures.Flag|null;
        public userNotice?: proto.WebFeatures.Flag|null;
        public support?: proto.WebFeatures.Flag|null;
        public groupUiiCleanup?: proto.WebFeatures.Flag|null;
        public groupDogfoodingInternalOnly?: proto.WebFeatures.Flag|null;
        public settingsSync?: proto.WebFeatures.Flag|null;
        public archiveV2?: proto.WebFeatures.Flag|null;
        public ephemeralAllowGroupMembers?: proto.WebFeatures.Flag|null;
        public ephemeral24HDuration?: proto.WebFeatures.Flag|null;
        public mdForceUpgrade?: proto.WebFeatures.Flag|null;
        public disappearingMode?: proto.WebFeatures.Flag|null;
        public externalMdOptInAvailable?: proto.WebFeatures.Flag|null;
        public noDeleteMessageTimeLimit?: proto.WebFeatures.Flag|null;
        public static create(properties?: IWebFeatures): WebFeatures;
        public static encode(m: IWebFeatures, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WebFeatures;
        public static fromObject(d: { [k: string]: any }): WebFeatures;
        public static toObject(m: WebFeatures, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IWebMessageInfo {
        key?: proto.IMessageKey;
        message?: (proto.IMessage|null);
        messageTimestamp?: (number|Long|null);
        status?: proto.WebMessageInfo.Status|null;
        participant?: (string|null);
        messageC2sTimestamp?: (number|Long|null);
        ignore?: (boolean|null);
        starred?: (boolean|null);
        broadcast?: (boolean|null);
        pushName?: (string|null);
        mediaCiphertextSha256?: (Uint8Array|null);
        multicast?: (boolean|null);
        urlText?: (boolean|null);
        urlNumber?: (boolean|null);
        messageStubType?: proto.WebMessageInfo.StubType|null;
        clearMedia?: (boolean|null);
        messageStubParameters?: string[];
        duration?: (number|null);
        labels?: string[];
        paymentInfo?: (proto.IPaymentInfo|null);
        finalLiveLocation?: (proto.ILiveLocationMessage|null);
        quotedPaymentInfo?: (proto.IPaymentInfo|null);
        ephemeralStartTimestamp?: (number|Long|null);
        ephemeralDuration?: (number|null);
        ephemeralOffToOn?: (boolean|null);
        ephemeralOutOfSync?: (boolean|null);
        bizPrivacyStatus?: proto.WebMessageInfo.BizPrivacyStatus|null;
        verifiedBizName?: (string|null);
        mediaData?: (proto.IMediaData|null);
        photoChange?: (proto.IPhotoChange|null);
        userReceipt?: proto.IUserReceipt[];
        reactions?: proto.IReaction[];
        quotedStickerData?: (proto.IMediaData|null);
        futureproofData?: (Uint8Array|null);
        statusPsa?: (proto.IStatusPsa|null);
        pollUpdates?: proto.IPollUpdate[];
        pollAdditionalMetadata?: (proto.IPollAdditionalMetadata|null);
        agentId?: (string|null);
        statusAlreadyViewed?: (boolean|null);
        messageSecret?: (Uint8Array|null);
        keepInChat?: (proto.IKeepInChat|null);
        originalSelfAuthorUserJidString?: (string|null);
        revokeMessageTimestamp?: (number|Long|null);
        pinInChat?: (proto.IPinInChat|null);
        premiumMessageInfo?: (proto.IPremiumMessageInfo|null);
        is1PBizBotMessage?: (boolean|null);
        isGroupHistoryMessage?: (boolean|null);
        botMessageInvokerJid?: (string|null);
        commentMetadata?: (proto.ICommentMetadata|null);
        eventResponses?: proto.IEventResponse[];
        reportingTokenInfo?: (proto.IReportingTokenInfo|null);
        newsletterServerId?: (number|Long|null);
        eventAdditionalMetadata?: (proto.IEventAdditionalMetadata|null);
        isMentionedInStatus?: (boolean|null);
        statusMentions?: string[];
        targetMessageId?: (proto.IMessageKey|null);
        messageAddOns?: proto.IMessageAddOn[];
        statusMentionMessageInfo?: (proto.IStatusMentionMessage|null);
        isSupportAiMessage?: (boolean|null);
        statusMentionSources?: string[];
        supportAiCitations?: proto.ICitation[];
        botTargetId?: (string|null);
        groupHistoryIndividualMessageInfo?: (proto.IGroupHistoryIndividualMessageInfo|null);
        groupHistoryBundleInfo?: (proto.IGroupHistoryBundleInfo|null);
        interactiveMessageAdditionalMetadata?: (proto.IInteractiveMessageAdditionalMetadata|null);
        quarantinedMessage?: (proto.IQuarantinedMessage|null);
        nonJidMentions?: (number|null);
    }

    class WebMessageInfo implements IWebMessageInfo {
        constructor(p?: IWebMessageInfo);
        public key: proto.IMessageKey;
        public message?: (proto.IMessage|null);
        public messageTimestamp?: (number|Long|null);
        public status?: proto.WebMessageInfo.Status|null;
        public participant?: (string|null);
        public messageC2sTimestamp?: (number|Long|null);
        public ignore?: (boolean|null);
        public starred?: (boolean|null);
        public broadcast?: (boolean|null);
        public pushName?: (string|null);
        public mediaCiphertextSha256?: (Uint8Array|null);
        public multicast?: (boolean|null);
        public urlText?: (boolean|null);
        public urlNumber?: (boolean|null);
        public messageStubType?: proto.WebMessageInfo.StubType|null;
        public clearMedia?: (boolean|null);
        public messageStubParameters: string[];
        public duration?: (number|null);
        public labels: string[];
        public paymentInfo?: (proto.IPaymentInfo|null);
        public finalLiveLocation?: (proto.ILiveLocationMessage|null);
        public quotedPaymentInfo?: (proto.IPaymentInfo|null);
        public ephemeralStartTimestamp?: (number|Long|null);
        public ephemeralDuration?: (number|null);
        public ephemeralOffToOn?: (boolean|null);
        public ephemeralOutOfSync?: (boolean|null);
        public bizPrivacyStatus?: proto.WebMessageInfo.BizPrivacyStatus|null;
        public verifiedBizName?: (string|null);
        public mediaData?: (proto.IMediaData|null);
        public photoChange?: (proto.IPhotoChange|null);
        public userReceipt: proto.IUserReceipt[];
        public reactions: proto.IReaction[];
        public quotedStickerData?: (proto.IMediaData|null);
        public futureproofData?: (Uint8Array|null);
        public statusPsa?: (proto.IStatusPsa|null);
        public pollUpdates: proto.IPollUpdate[];
        public pollAdditionalMetadata?: (proto.IPollAdditionalMetadata|null);
        public agentId?: (string|null);
        public statusAlreadyViewed?: (boolean|null);
        public messageSecret?: (Uint8Array|null);
        public keepInChat?: (proto.IKeepInChat|null);
        public originalSelfAuthorUserJidString?: (string|null);
        public revokeMessageTimestamp?: (number|Long|null);
        public pinInChat?: (proto.IPinInChat|null);
        public premiumMessageInfo?: (proto.IPremiumMessageInfo|null);
        public is1PBizBotMessage?: (boolean|null);
        public isGroupHistoryMessage?: (boolean|null);
        public botMessageInvokerJid?: (string|null);
        public commentMetadata?: (proto.ICommentMetadata|null);
        public eventResponses: proto.IEventResponse[];
        public reportingTokenInfo?: (proto.IReportingTokenInfo|null);
        public newsletterServerId?: (number|Long|null);
        public eventAdditionalMetadata?: (proto.IEventAdditionalMetadata|null);
        public isMentionedInStatus?: (boolean|null);
        public statusMentions: string[];
        public targetMessageId?: (proto.IMessageKey|null);
        public messageAddOns: proto.IMessageAddOn[];
        public statusMentionMessageInfo?: (proto.IStatusMentionMessage|null);
        public isSupportAiMessage?: (boolean|null);
        public statusMentionSources: string[];
        public supportAiCitations: proto.ICitation[];
        public botTargetId?: (string|null);
        public groupHistoryIndividualMessageInfo?: (proto.IGroupHistoryIndividualMessageInfo|null);
        public groupHistoryBundleInfo?: (proto.IGroupHistoryBundleInfo|null);
        public interactiveMessageAdditionalMetadata?: (proto.IInteractiveMessageAdditionalMetadata|null);
        public quarantinedMessage?: (proto.IQuarantinedMessage|null);
        public nonJidMentions?: (number|null);
        public static create(properties?: IWebMessageInfo): WebMessageInfo;
        public static encode(m: IWebMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WebMessageInfo;
        public static fromObject(d: { [k: string]: any }): WebMessageInfo;
        public static toObject(m: WebMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    interface IWebNotificationsInfo {
        timestamp?: (number|Long|null);
        unreadChats?: (number|null);
        notifyMessageCount?: (number|null);
        notifyMessages?: proto.IWebMessageInfo[];
    }

    class WebNotificationsInfo implements IWebNotificationsInfo {
        constructor(p?: IWebNotificationsInfo);
        public timestamp?: (number|Long|null);
        public unreadChats?: (number|null);
        public notifyMessageCount?: (number|null);
        public notifyMessages: proto.IWebMessageInfo[];
        public static create(properties?: IWebNotificationsInfo): WebNotificationsInfo;
        public static encode(m: IWebNotificationsInfo, w?: $protobuf.Writer): $protobuf.Writer;
        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WebNotificationsInfo;
        public static fromObject(d: { [k: string]: any }): WebNotificationsInfo;
        public static toObject(m: WebNotificationsInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
        public toJSON(): { [k: string]: any };
    }

    namespace AiHomeState {

        interface IAiHomeOption {
            type?: proto.AiHomeOption.AiHomeActionType|null;
            title?: (string|null);
            promptText?: (string|null);
            sessionId?: (string|null);
            imageWdsIdentifier?: (string|null);
            imageTintColor?: (string|null);
            imageBackgroundColor?: (string|null);
        }

        class AiHomeOption implements IAiHomeOption {
            constructor(p?: IAiHomeOption);
            public type?: proto.AiHomeOption.AiHomeActionType|null;
            public title?: (string|null);
            public promptText?: (string|null);
            public sessionId?: (string|null);
            public imageWdsIdentifier?: (string|null);
            public imageTintColor?: (string|null);
            public imageBackgroundColor?: (string|null);
            public static create(properties?: IAiHomeOption): AiHomeOption;
            public static encode(m: IAiHomeOption, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiHomeOption;
            public static fromObject(d: { [k: string]: any }): AiHomeOption;
            public static toObject(m: AiHomeOption, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AiHomeOption {

            enum AiHomeActionType {
                PROMPT = 0,
                CREATE_IMAGE = 1,
                ANIMATE_PHOTO = 2,
                ANALYZE_FILE = 3,
            }
        }
    }

    namespace AiRichResponseCodeMetadata {

        enum AiRichResponseCodeHighlightType {
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_DEFAULT = 0,
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_KEYWORD = 1,
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_METHOD = 2,
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_STRING = 3,
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_NUMBER = 4,
            AI_RICH_RESPONSE_CODE_HIGHLIGHT_COMMENT = 5,
        }

        interface IAiRichResponseCodeBlock {
            highlightType?: proto.AiRichResponseCodeHighlightType|null;
            codeContent?: (string|null);
        }

        class AiRichResponseCodeBlock implements IAiRichResponseCodeBlock {
            constructor(p?: IAiRichResponseCodeBlock);
            public highlightType?: proto.AiRichResponseCodeHighlightType|null;
            public codeContent?: (string|null);
            public static create(properties?: IAiRichResponseCodeBlock): AiRichResponseCodeBlock;
            public static encode(m: IAiRichResponseCodeBlock, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseCodeBlock;
            public static fromObject(d: { [k: string]: any }): AiRichResponseCodeBlock;
            public static toObject(m: AiRichResponseCodeBlock, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace AiRichResponseContentItemsMetadata {

        enum ContentType {
            DEFAULT = 0,
            CAROUSEL = 1,
        }

        interface IAiRichResponseContentItemMetadata {
            reelItem?: (proto.IAiRichResponseReelItem|null);
            /** Prost oneof field */
            aIRichResponseContentItem?: {
                reelItem?: (proto.IAiRichResponseReelItem|null);
            } | null;
        }

        class AiRichResponseContentItemMetadata implements IAiRichResponseContentItemMetadata {
            constructor(p?: IAiRichResponseContentItemMetadata);
            public reelItem?: (proto.IAiRichResponseReelItem|null);
            public aIRichResponseContentItem?: ("reelItem");
            public static create(properties?: IAiRichResponseContentItemMetadata): AiRichResponseContentItemMetadata;
            public static encode(m: IAiRichResponseContentItemMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseContentItemMetadata;
            public static fromObject(d: { [k: string]: any }): AiRichResponseContentItemMetadata;
            public static toObject(m: AiRichResponseContentItemMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAiRichResponseReelItem {
            title?: (string|null);
            profileIconUrl?: (string|null);
            thumbnailUrl?: (string|null);
            videoUrl?: (string|null);
        }

        class AiRichResponseReelItem implements IAiRichResponseReelItem {
            constructor(p?: IAiRichResponseReelItem);
            public title?: (string|null);
            public profileIconUrl?: (string|null);
            public thumbnailUrl?: (string|null);
            public videoUrl?: (string|null);
            public static create(properties?: IAiRichResponseReelItem): AiRichResponseReelItem;
            public static encode(m: IAiRichResponseReelItem, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseReelItem;
            public static fromObject(d: { [k: string]: any }): AiRichResponseReelItem;
            public static toObject(m: AiRichResponseReelItem, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace AiRichResponseDynamicMetadata {

        enum AiRichResponseDynamicMetadataType {
            UNKNOWN = 0,
            IMAGE = 1,
            GIF = 2,
        }
    }

    namespace AiRichResponseInlineImageMetadata {

        enum AiRichResponseImageAlignment {
            AI_RICH_RESPONSE_IMAGE_LAYOUT_LEADING_ALIGNED = 0,
            AI_RICH_RESPONSE_IMAGE_LAYOUT_TRAILING_ALIGNED = 1,
            AI_RICH_RESPONSE_IMAGE_LAYOUT_CENTER_ALIGNED = 2,
        }
    }

    namespace AiRichResponseLatexMetadata {

        interface IAiRichResponseLatexExpression {
            latexExpression?: (string|null);
            url?: (string|null);
            width?: (number|null);
            height?: (number|null);
            fontHeight?: (number|null);
            imageTopPadding?: (number|null);
            imageLeadingPadding?: (number|null);
            imageBottomPadding?: (number|null);
            imageTrailingPadding?: (number|null);
        }

        class AiRichResponseLatexExpression implements IAiRichResponseLatexExpression {
            constructor(p?: IAiRichResponseLatexExpression);
            public latexExpression?: (string|null);
            public url?: (string|null);
            public width?: (number|null);
            public height?: (number|null);
            public fontHeight?: (number|null);
            public imageTopPadding?: (number|null);
            public imageLeadingPadding?: (number|null);
            public imageBottomPadding?: (number|null);
            public imageTrailingPadding?: (number|null);
            public static create(properties?: IAiRichResponseLatexExpression): AiRichResponseLatexExpression;
            public static encode(m: IAiRichResponseLatexExpression, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseLatexExpression;
            public static fromObject(d: { [k: string]: any }): AiRichResponseLatexExpression;
            public static toObject(m: AiRichResponseLatexExpression, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace AiRichResponseMapMetadata {

        interface IAiRichResponseMapAnnotation {
            annotationNumber?: (number|null);
            latitude?: (number|null);
            longitude?: (number|null);
            title?: (string|null);
            body?: (string|null);
        }

        class AiRichResponseMapAnnotation implements IAiRichResponseMapAnnotation {
            constructor(p?: IAiRichResponseMapAnnotation);
            public annotationNumber?: (number|null);
            public latitude?: (number|null);
            public longitude?: (number|null);
            public title?: (string|null);
            public body?: (string|null);
            public static create(properties?: IAiRichResponseMapAnnotation): AiRichResponseMapAnnotation;
            public static encode(m: IAiRichResponseMapAnnotation, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseMapAnnotation;
            public static fromObject(d: { [k: string]: any }): AiRichResponseMapAnnotation;
            public static toObject(m: AiRichResponseMapAnnotation, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace AiRichResponseTableMetadata {

        interface IAiRichResponseTableRow {
            items?: string[];
            isHeading?: (boolean|null);
        }

        class AiRichResponseTableRow implements IAiRichResponseTableRow {
            constructor(p?: IAiRichResponseTableRow);
            public items: string[];
            public isHeading?: (boolean|null);
            public static create(properties?: IAiRichResponseTableRow): AiRichResponseTableRow;
            public static encode(m: IAiRichResponseTableRow, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiRichResponseTableRow;
            public static fromObject(d: { [k: string]: any }): AiRichResponseTableRow;
            public static toObject(m: AiRichResponseTableRow, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace AiThreadInfo {

        interface IAiThreadClientInfo {
            type?: proto.AiThreadClientInfo.AiThreadType|null;
        }

        class AiThreadClientInfo implements IAiThreadClientInfo {
            constructor(p?: IAiThreadClientInfo);
            public type?: proto.AiThreadClientInfo.AiThreadType|null;
            public static create(properties?: IAiThreadClientInfo): AiThreadClientInfo;
            public static encode(m: IAiThreadClientInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiThreadClientInfo;
            public static fromObject(d: { [k: string]: any }): AiThreadClientInfo;
            public static toObject(m: AiThreadClientInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAiThreadServerInfo {
            title?: (string|null);
        }

        class AiThreadServerInfo implements IAiThreadServerInfo {
            constructor(p?: IAiThreadServerInfo);
            public title?: (string|null);
            public static create(properties?: IAiThreadServerInfo): AiThreadServerInfo;
            public static encode(m: IAiThreadServerInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiThreadServerInfo;
            public static fromObject(d: { [k: string]: any }): AiThreadServerInfo;
            public static toObject(m: AiThreadServerInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AiThreadClientInfo {

            enum AiThreadType {
                UNKNOWN = 0,
                DEFAULT = 1,
                INCOGNITO = 2,
            }
        }
    }

    namespace BizAccountLinkInfo {

        enum AccountType {
            ENTERPRISE = 0,
        }

        enum HostStorageType {
            ON_PREMISE = 0,
            FACEBOOK = 1,
        }
    }

    namespace BizIdentityInfo {

        enum ActualActorsType {
            SELF_ = 0,
            BSP = 1,
        }

        enum HostStorageType {
            ON_PREMISE = 0,
            FACEBOOK = 1,
        }

        enum VerifiedLevelValue {
            UNKNOWN = 0,
            LOW = 1,
            HIGH = 2,
        }
    }

    namespace BotAgeCollectionMetadata {

        enum AgeCollectionType {
            O18_BINARY = 0,
            WAFFLE = 1,
        }
    }

    namespace BotCapabilityMetadata {

        enum BotCapabilityType {
            UNKNOWN = 0,
            PROGRESS_INDICATOR = 1,
            RICH_RESPONSE_HEADING = 2,
            RICH_RESPONSE_NESTED_LIST = 3,
            AI_MEMORY = 4,
            RICH_RESPONSE_THREAD_SURFING = 5,
            RICH_RESPONSE_TABLE = 6,
            RICH_RESPONSE_CODE = 7,
            RICH_RESPONSE_STRUCTURED_RESPONSE = 8,
            RICH_RESPONSE_INLINE_IMAGE = 9,
            WA_IG1P_PLUGIN_RANKING_CONTROL = 10,
            WA_IG1P_PLUGIN_RANKING_UPDATE1 = 11,
            WA_IG1P_PLUGIN_RANKING_UPDATE2 = 12,
            WA_IG1P_PLUGIN_RANKING_UPDATE3 = 13,
            WA_IG1P_PLUGIN_RANKING_UPDATE4 = 14,
            WA_IG1P_PLUGIN_RANKING_UPDATE5 = 15,
            WA_IG1P_PLUGIN_RANKING_UPDATE6 = 16,
            WA_IG1P_PLUGIN_RANKING_UPDATE7 = 17,
            WA_IG1P_PLUGIN_RANKING_UPDATE8 = 18,
            WA_IG1P_PLUGIN_RANKING_UPDATE9 = 19,
            WA_IG1P_PLUGIN_RANKING_UPDATE10 = 20,
            RICH_RESPONSE_SUB_HEADING = 21,
            RICH_RESPONSE_GRID_IMAGE = 22,
            AI_STUDIO_UGC_MEMORY = 23,
            RICH_RESPONSE_LATEX = 24,
            RICH_RESPONSE_MAPS = 25,
            RICH_RESPONSE_INLINE_REELS = 26,
            AGENTIC_PLANNING = 27,
            ACCOUNT_LINKING = 28,
            STREAMING_DISAGGREGATION = 29,
            RICH_RESPONSE_GRID_IMAGE3P = 30,
            RICH_RESPONSE_LATEX_INLINE = 31,
            QUERY_PLAN = 32,
            PROACTIVE_MESSAGE = 33,
            RICH_RESPONSE_UNIFIED_RESPONSE = 34,
            PROMOTION_MESSAGE = 35,
            SIMPLIFIED_PROFILE_PAGE = 36,
            RICH_RESPONSE_SOURCES_IN_MESSAGE = 37,
            RICH_RESPONSE_SIDE_BY_SIDE_SURVEY = 38,
            RICH_RESPONSE_UNIFIED_TEXT_COMPONENT = 39,
            AI_SHARED_MEMORY = 40,
            RICH_RESPONSE_UNIFIED_SOURCES = 41,
            RICH_RESPONSE_UNIFIED_DOMAIN_CITATIONS = 42,
            RICH_RESPONSE_UR_INLINE_REELS_ENABLED = 43,
            RICH_RESPONSE_UR_MEDIA_GRID_ENABLED = 44,
            RICH_RESPONSE_UR_TIMESTAMP_PLACEHOLDER = 45,
            RICH_RESPONSE_IN_APP_SURVEY = 46,
            AI_RESPONSE_MODEL_BRANDING = 47,
            SESSION_TRANSPARENCY_SYSTEM_MESSAGE = 48,
            RICH_RESPONSE_UR_REASONING = 49,
            RICH_RESPONSE_UR_ZEITGEIST_CITATIONS = 50,
            RICH_RESPONSE_UR_ZEITGEIST_CAROUSEL = 51,
            AI_IMAGINE_LOADING_INDICATOR = 52,
            RICH_RESPONSE_UR_IMAGINE = 53,
            AI_IMAGINE_UR_TO_NATIVE_LOADING_INDICATOR = 54,
        }
    }

    namespace BotDocumentMessageMetadata {

        enum DocumentPluginType {
            TEXT_EXTRACTION = 0,
            OCR_AND_IMAGES = 1,
        }
    }

    namespace BotFeedbackMessage {

        enum BotFeedbackKind {
            BOT_FEEDBACK_POSITIVE = 0,
            BOT_FEEDBACK_NEGATIVE_GENERIC = 1,
            BOT_FEEDBACK_NEGATIVE_HELPFUL = 2,
            BOT_FEEDBACK_NEGATIVE_INTERESTING = 3,
            BOT_FEEDBACK_NEGATIVE_ACCURATE = 4,
            BOT_FEEDBACK_NEGATIVE_SAFE = 5,
            BOT_FEEDBACK_NEGATIVE_OTHER = 6,
            BOT_FEEDBACK_NEGATIVE_REFUSED = 7,
            BOT_FEEDBACK_NEGATIVE_NOT_VISUALLY_APPEALING = 8,
            BOT_FEEDBACK_NEGATIVE_NOT_RELEVANT_TO_TEXT = 9,
            BOT_FEEDBACK_NEGATIVE_PERSONALIZED = 10,
            BOT_FEEDBACK_NEGATIVE_CLARITY = 11,
            BOT_FEEDBACK_NEGATIVE_DOESNT_LOOK_LIKE_THE_PERSON = 12,
            BOT_FEEDBACK_NEGATIVE_HALLUCINATION_INTERNAL_ONLY = 13,
            BOT_FEEDBACK_NEGATIVE = 14,
        }

        enum BotFeedbackKindMultipleNegative {
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_GENERIC = 1,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_HELPFUL = 2,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_INTERESTING = 4,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_ACCURATE = 8,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_SAFE = 16,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_OTHER = 32,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_REFUSED = 64,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_NOT_VISUALLY_APPEALING = 128,
            BOT_FEEDBACK_MULTIPLE_NEGATIVE_NOT_RELEVANT_TO_TEXT = 256,
        }

        enum BotFeedbackKindMultiplePositive {
            BOT_FEEDBACK_MULTIPLE_POSITIVE_GENERIC = 1,
        }

        enum ReportKind {
            NONE = 0,
            GENERIC = 1,
        }

        interface ISideBySideSurveyMetadata {
            selectedRequestId?: (string|null);
            surveyId?: (number|null);
            simonSessionFbid?: (string|null);
            responseOtid?: (string|null);
            responseTimestampMsString?: (string|null);
            isSelectedResponsePrimary?: (boolean|null);
            messageIdToEdit?: (string|null);
            analyticsData?: (proto.ISideBySideSurveyAnalyticsData|null);
            metaAiAnalyticsData?: (proto.ISidebySideSurveyMetaAiAnalyticsData|null);
        }

        class SideBySideSurveyMetadata implements ISideBySideSurveyMetadata {
            constructor(p?: ISideBySideSurveyMetadata);
            public selectedRequestId?: (string|null);
            public surveyId?: (number|null);
            public simonSessionFbid?: (string|null);
            public responseOtid?: (string|null);
            public responseTimestampMsString?: (string|null);
            public isSelectedResponsePrimary?: (boolean|null);
            public messageIdToEdit?: (string|null);
            public analyticsData?: (proto.ISideBySideSurveyAnalyticsData|null);
            public metaAiAnalyticsData?: (proto.ISidebySideSurveyMetaAiAnalyticsData|null);
            public static create(properties?: ISideBySideSurveyMetadata): SideBySideSurveyMetadata;
            public static encode(m: ISideBySideSurveyMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyMetadata;
            public static fromObject(d: { [k: string]: any }): SideBySideSurveyMetadata;
            public static toObject(m: SideBySideSurveyMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace SideBySideSurveyMetadata {

            interface ISideBySideSurveyAnalyticsData {
                tessaEvent?: (string|null);
                tessaSessionFbid?: (string|null);
                simonSessionFbid?: (string|null);
            }

            class SideBySideSurveyAnalyticsData implements ISideBySideSurveyAnalyticsData {
                constructor(p?: ISideBySideSurveyAnalyticsData);
                public tessaEvent?: (string|null);
                public tessaSessionFbid?: (string|null);
                public simonSessionFbid?: (string|null);
                public static create(properties?: ISideBySideSurveyAnalyticsData): SideBySideSurveyAnalyticsData;
                public static encode(m: ISideBySideSurveyAnalyticsData, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyAnalyticsData;
                public static fromObject(d: { [k: string]: any }): SideBySideSurveyAnalyticsData;
                public static toObject(m: SideBySideSurveyAnalyticsData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ISidebySideSurveyMetaAiAnalyticsData {
                surveyId?: (number|null);
                primaryResponseId?: (string|null);
                testArmName?: (string|null);
                timestampMsString?: (string|null);
                ctaImpressionEvent?: (proto.ISideBySideSurveyCtaImpressionEventData|null);
                ctaClickEvent?: (proto.ISideBySideSurveyCtaClickEventData|null);
                cardImpressionEvent?: (proto.ISideBySideSurveyCardImpressionEventData|null);
                responseEvent?: (proto.ISideBySideSurveyResponseEventData|null);
                abandonEvent?: (proto.ISideBySideSurveyAbandonEventData|null);
            }

            class SidebySideSurveyMetaAiAnalyticsData implements ISidebySideSurveyMetaAiAnalyticsData {
                constructor(p?: ISidebySideSurveyMetaAiAnalyticsData);
                public surveyId?: (number|null);
                public primaryResponseId?: (string|null);
                public testArmName?: (string|null);
                public timestampMsString?: (string|null);
                public ctaImpressionEvent?: (proto.ISideBySideSurveyCtaImpressionEventData|null);
                public ctaClickEvent?: (proto.ISideBySideSurveyCtaClickEventData|null);
                public cardImpressionEvent?: (proto.ISideBySideSurveyCardImpressionEventData|null);
                public responseEvent?: (proto.ISideBySideSurveyResponseEventData|null);
                public abandonEvent?: (proto.ISideBySideSurveyAbandonEventData|null);
                public static create(properties?: ISidebySideSurveyMetaAiAnalyticsData): SidebySideSurveyMetaAiAnalyticsData;
                public static encode(m: ISidebySideSurveyMetaAiAnalyticsData, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SidebySideSurveyMetaAiAnalyticsData;
                public static fromObject(d: { [k: string]: any }): SidebySideSurveyMetaAiAnalyticsData;
                public static toObject(m: SidebySideSurveyMetaAiAnalyticsData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace SidebySideSurveyMetaAiAnalyticsData {

                interface ISideBySideSurveyAbandonEventData {
                    abandonDwellTimeMsString?: (string|null);
                }

                class SideBySideSurveyAbandonEventData implements ISideBySideSurveyAbandonEventData {
                    constructor(p?: ISideBySideSurveyAbandonEventData);
                    public abandonDwellTimeMsString?: (string|null);
                    public static create(properties?: ISideBySideSurveyAbandonEventData): SideBySideSurveyAbandonEventData;
                    public static encode(m: ISideBySideSurveyAbandonEventData, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyAbandonEventData;
                    public static fromObject(d: { [k: string]: any }): SideBySideSurveyAbandonEventData;
                    public static toObject(m: SideBySideSurveyAbandonEventData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ISideBySideSurveyCtaClickEventData {
                    isSurveyExpired?: (boolean|null);
                    clickDwellTimeMsString?: (string|null);
                }

                class SideBySideSurveyCtaClickEventData implements ISideBySideSurveyCtaClickEventData {
                    constructor(p?: ISideBySideSurveyCtaClickEventData);
                    public isSurveyExpired?: (boolean|null);
                    public clickDwellTimeMsString?: (string|null);
                    public static create(properties?: ISideBySideSurveyCtaClickEventData): SideBySideSurveyCtaClickEventData;
                    public static encode(m: ISideBySideSurveyCtaClickEventData, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyCtaClickEventData;
                    public static fromObject(d: { [k: string]: any }): SideBySideSurveyCtaClickEventData;
                    public static toObject(m: SideBySideSurveyCtaClickEventData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ISideBySideSurveyCtaImpressionEventData {
                    isSurveyExpired?: (boolean|null);
                }

                class SideBySideSurveyCtaImpressionEventData implements ISideBySideSurveyCtaImpressionEventData {
                    constructor(p?: ISideBySideSurveyCtaImpressionEventData);
                    public isSurveyExpired?: (boolean|null);
                    public static create(properties?: ISideBySideSurveyCtaImpressionEventData): SideBySideSurveyCtaImpressionEventData;
                    public static encode(m: ISideBySideSurveyCtaImpressionEventData, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyCtaImpressionEventData;
                    public static fromObject(d: { [k: string]: any }): SideBySideSurveyCtaImpressionEventData;
                    public static toObject(m: SideBySideSurveyCtaImpressionEventData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ISideBySideSurveyCardImpressionEventData {
                }

                class SideBySideSurveyCardImpressionEventData implements ISideBySideSurveyCardImpressionEventData {
                    constructor(p?: ISideBySideSurveyCardImpressionEventData);
                    public static create(properties?: ISideBySideSurveyCardImpressionEventData): SideBySideSurveyCardImpressionEventData;
                    public static encode(m: ISideBySideSurveyCardImpressionEventData, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyCardImpressionEventData;
                    public static fromObject(d: { [k: string]: any }): SideBySideSurveyCardImpressionEventData;
                    public static toObject(m: SideBySideSurveyCardImpressionEventData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ISideBySideSurveyResponseEventData {
                    responseDwellTimeMsString?: (string|null);
                    selectedResponseId?: (string|null);
                }

                class SideBySideSurveyResponseEventData implements ISideBySideSurveyResponseEventData {
                    constructor(p?: ISideBySideSurveyResponseEventData);
                    public responseDwellTimeMsString?: (string|null);
                    public selectedResponseId?: (string|null);
                    public static create(properties?: ISideBySideSurveyResponseEventData): SideBySideSurveyResponseEventData;
                    public static encode(m: ISideBySideSurveyResponseEventData, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideSurveyResponseEventData;
                    public static fromObject(d: { [k: string]: any }): SideBySideSurveyResponseEventData;
                    public static toObject(m: SideBySideSurveyResponseEventData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }
            }
        }
    }

    namespace BotImagineMetadata {

        enum ImagineType {
            UNKNOWN = 0,
            IMAGINE = 1,
            MEMU = 2,
            FLASH = 3,
            EDIT = 4,
        }
    }

    namespace BotLinkedAccount {

        enum BotLinkedAccountType {
            BOT_LINKED_ACCOUNT_TYPE1P = 0,
        }
    }

    namespace BotMediaMetadata {

        enum OrientationType {
            CENTER = 1,
            LEFT = 2,
            RIGHT = 3,
        }
    }

    namespace BotMessageOrigin {

        enum BotMessageOriginType {
            AI_INITIATED = 0,
        }
    }

    namespace BotModeSelectionMetadata {

        enum BotUserSelectionMode {
            UNKNOWN_MODE = 0,
            REASONING_MODE = 1,
        }
    }

    namespace BotModelMetadata {

        enum ModelType {
            UNKNOWN_TYPE = 0,
            LLAMA_PROD = 1,
            LLAMA_PROD_PREMIUM = 2,
        }

        enum PremiumModelStatus {
            UNKNOWN_STATUS = 0,
            AVAILABLE = 1,
            QUOTA_EXCEED_LIMIT = 2,
        }
    }

    namespace BotPluginMetadata {

        enum PluginType {
            UNKNOWN_PLUGIN = 0,
            REELS = 1,
            SEARCH = 2,
        }

        enum SearchProvider {
            UNKNOWN = 0,
            BING = 1,
            GOOGLE = 2,
            SUPPORT = 3,
        }
    }

    namespace BotProgressIndicatorMetadata {

        interface IBotPlanningStepMetadata {
            statusTitle?: (string|null);
            statusBody?: (string|null);
            sourcesMetadata?: proto.IBotPlanningSearchSourcesMetadata[];
            status?: proto.BotPlanningStepMetadata.PlanningStepStatus|null;
            isReasoning?: (boolean|null);
            isEnhancedSearch?: (boolean|null);
            sections?: proto.IBotPlanningStepSectionMetadata[];
        }

        class BotPlanningStepMetadata implements IBotPlanningStepMetadata {
            constructor(p?: IBotPlanningStepMetadata);
            public statusTitle?: (string|null);
            public statusBody?: (string|null);
            public sourcesMetadata: proto.IBotPlanningSearchSourcesMetadata[];
            public status?: proto.BotPlanningStepMetadata.PlanningStepStatus|null;
            public isReasoning?: (boolean|null);
            public isEnhancedSearch?: (boolean|null);
            public sections: proto.IBotPlanningStepSectionMetadata[];
            public static create(properties?: IBotPlanningStepMetadata): BotPlanningStepMetadata;
            public static encode(m: IBotPlanningStepMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPlanningStepMetadata;
            public static fromObject(d: { [k: string]: any }): BotPlanningStepMetadata;
            public static toObject(m: BotPlanningStepMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace BotPlanningStepMetadata {

            enum BotSearchSourceProvider {
                UNKNOWN_PROVIDER = 0,
                OTHER = 1,
                GOOGLE = 2,
                BING = 3,
            }

            enum PlanningStepStatus {
                UNKNOWN = 0,
                PLANNED = 1,
                EXECUTING = 2,
                FINISHED = 3,
            }

            interface IBotPlanningSearchSourceMetadata {
                title?: (string|null);
                provider?: proto.BotSearchSourceProvider|null;
                sourceUrl?: (string|null);
                favIconUrl?: (string|null);
            }

            class BotPlanningSearchSourceMetadata implements IBotPlanningSearchSourceMetadata {
                constructor(p?: IBotPlanningSearchSourceMetadata);
                public title?: (string|null);
                public provider?: proto.BotSearchSourceProvider|null;
                public sourceUrl?: (string|null);
                public favIconUrl?: (string|null);
                public static create(properties?: IBotPlanningSearchSourceMetadata): BotPlanningSearchSourceMetadata;
                public static encode(m: IBotPlanningSearchSourceMetadata, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPlanningSearchSourceMetadata;
                public static fromObject(d: { [k: string]: any }): BotPlanningSearchSourceMetadata;
                public static toObject(m: BotPlanningSearchSourceMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IBotPlanningSearchSourcesMetadata {
                sourceTitle?: (string|null);
                provider?: proto.BotPlanningSearchSourcesMetadata.BotPlanningSearchSourceProvider|null;
                sourceUrl?: (string|null);
            }

            class BotPlanningSearchSourcesMetadata implements IBotPlanningSearchSourcesMetadata {
                constructor(p?: IBotPlanningSearchSourcesMetadata);
                public sourceTitle?: (string|null);
                public provider?: proto.BotPlanningSearchSourcesMetadata.BotPlanningSearchSourceProvider|null;
                public sourceUrl?: (string|null);
                public static create(properties?: IBotPlanningSearchSourcesMetadata): BotPlanningSearchSourcesMetadata;
                public static encode(m: IBotPlanningSearchSourcesMetadata, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPlanningSearchSourcesMetadata;
                public static fromObject(d: { [k: string]: any }): BotPlanningSearchSourcesMetadata;
                public static toObject(m: BotPlanningSearchSourcesMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IBotPlanningStepSectionMetadata {
                sectionTitle?: (string|null);
                sectionBody?: (string|null);
                sourcesMetadata?: proto.IBotPlanningSearchSourceMetadata[];
            }

            class BotPlanningStepSectionMetadata implements IBotPlanningStepSectionMetadata {
                constructor(p?: IBotPlanningStepSectionMetadata);
                public sectionTitle?: (string|null);
                public sectionBody?: (string|null);
                public sourcesMetadata: proto.IBotPlanningSearchSourceMetadata[];
                public static create(properties?: IBotPlanningStepSectionMetadata): BotPlanningStepSectionMetadata;
                public static encode(m: IBotPlanningStepSectionMetadata, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotPlanningStepSectionMetadata;
                public static fromObject(d: { [k: string]: any }): BotPlanningStepSectionMetadata;
                public static toObject(m: BotPlanningStepSectionMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace BotPlanningSearchSourcesMetadata {

                enum BotPlanningSearchSourceProvider {
                    UNKNOWN = 0,
                    OTHER = 1,
                    GOOGLE = 2,
                    BING = 3,
                }
            }
        }
    }

    namespace BotPromotionMessageMetadata {

        enum BotPromotionType {
            UNKNOWN_TYPE = 0,
            C50 = 1,
            SURVEY_PLATFORM = 2,
        }
    }

    namespace BotQuotaMetadata {

        interface IBotFeatureQuotaMetadata {
            featureType?: proto.BotFeatureQuotaMetadata.BotFeatureType|null;
            remainingQuota?: (number|null);
            expirationTimestamp?: (number|Long|null);
        }

        class BotFeatureQuotaMetadata implements IBotFeatureQuotaMetadata {
            constructor(p?: IBotFeatureQuotaMetadata);
            public featureType?: proto.BotFeatureQuotaMetadata.BotFeatureType|null;
            public remainingQuota?: (number|null);
            public expirationTimestamp?: (number|Long|null);
            public static create(properties?: IBotFeatureQuotaMetadata): BotFeatureQuotaMetadata;
            public static encode(m: IBotFeatureQuotaMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotFeatureQuotaMetadata;
            public static fromObject(d: { [k: string]: any }): BotFeatureQuotaMetadata;
            public static toObject(m: BotFeatureQuotaMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace BotFeatureQuotaMetadata {

            enum BotFeatureType {
                UNKNOWN_FEATURE = 0,
                REASONING_FEATURE = 1,
            }
        }
    }

    namespace BotReminderMetadata {

        enum ReminderAction {
            NOTIFY = 1,
            CREATE = 2,
            DELETE = 3,
            UPDATE = 4,
        }

        enum ReminderFrequency {
            ONCE = 1,
            DAILY = 2,
            WEEKLY = 3,
            BIWEEKLY = 4,
            MONTHLY = 5,
        }
    }

    namespace BotRenderingMetadata {

        interface IKeyword {
            value?: (string|null);
            associatedPrompts?: string[];
        }

        class Keyword implements IKeyword {
            constructor(p?: IKeyword);
            public value?: (string|null);
            public associatedPrompts: string[];
            public static create(properties?: IKeyword): Keyword;
            public static encode(m: IKeyword, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Keyword;
            public static fromObject(d: { [k: string]: any }): Keyword;
            public static toObject(m: Keyword, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace BotSignatureVerificationUseCaseProof {

        enum BotSignatureUseCase {
            UNSPECIFIED = 0,
            WA_BOT_MSG = 1,
        }
    }

    namespace BotSourcesMetadata {

        interface IBotSourceItem {
            provider?: proto.BotSourceItem.SourceProvider|null;
            thumbnailCdnUrl?: (string|null);
            sourceProviderUrl?: (string|null);
            sourceQuery?: (string|null);
            faviconCdnUrl?: (string|null);
            citationNumber?: (number|null);
            sourceTitle?: (string|null);
        }

        class BotSourceItem implements IBotSourceItem {
            constructor(p?: IBotSourceItem);
            public provider?: proto.BotSourceItem.SourceProvider|null;
            public thumbnailCdnUrl?: (string|null);
            public sourceProviderUrl?: (string|null);
            public sourceQuery?: (string|null);
            public faviconCdnUrl?: (string|null);
            public citationNumber?: (number|null);
            public sourceTitle?: (string|null);
            public static create(properties?: IBotSourceItem): BotSourceItem;
            public static encode(m: IBotSourceItem, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotSourceItem;
            public static fromObject(d: { [k: string]: any }): BotSourceItem;
            public static toObject(m: BotSourceItem, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace BotSourceItem {

            enum SourceProvider {
                UNKNOWN = 0,
                BING = 1,
                GOOGLE = 2,
                SUPPORT = 3,
                OTHER = 4,
            }
        }
    }

    namespace BotUnifiedResponseMutation {

        interface IMediaDetailsMetadata {
            id?: (string|null);
            highResMedia?: (proto.IBotMediaMetadata|null);
            previewMedia?: (proto.IBotMediaMetadata|null);
        }

        class MediaDetailsMetadata implements IMediaDetailsMetadata {
            constructor(p?: IMediaDetailsMetadata);
            public id?: (string|null);
            public highResMedia?: (proto.IBotMediaMetadata|null);
            public previewMedia?: (proto.IBotMediaMetadata|null);
            public static create(properties?: IMediaDetailsMetadata): MediaDetailsMetadata;
            public static encode(m: IMediaDetailsMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MediaDetailsMetadata;
            public static fromObject(d: { [k: string]: any }): MediaDetailsMetadata;
            public static toObject(m: MediaDetailsMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISideBySideMetadata {
            primaryResponseId?: (string|null);
            surveyCtaHasRendered?: (boolean|null);
        }

        class SideBySideMetadata implements ISideBySideMetadata {
            constructor(p?: ISideBySideMetadata);
            public primaryResponseId?: (string|null);
            public surveyCtaHasRendered?: (boolean|null);
            public static create(properties?: ISideBySideMetadata): SideBySideMetadata;
            public static encode(m: ISideBySideMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SideBySideMetadata;
            public static fromObject(d: { [k: string]: any }): SideBySideMetadata;
            public static toObject(m: SideBySideMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace CallLogRecord {

        enum CallResult {
            CONNECTED = 0,
            REJECTED = 1,
            CANCELLED = 2,
            ACCEPTEDELSEWHERE = 3,
            MISSED = 4,
            INVALID = 5,
            UNAVAILABLE = 6,
            UPCOMING = 7,
            FAILED = 8,
            ABANDONED = 9,
            ONGOING = 10,
        }

        enum CallType {
            REGULAR = 0,
            SCHEDULED_CALL = 1,
            VOICE_CHAT = 2,
        }

        enum SilenceReason {
            NONE = 0,
            SCHEDULED = 1,
            PRIVACY = 2,
            LIGHTWEIGHT = 3,
        }

        interface IParticipantInfo {
            userJid?: (string|null);
            callResult?: proto.CallResult|null;
        }

        class ParticipantInfo implements IParticipantInfo {
            constructor(p?: IParticipantInfo);
            public userJid?: (string|null);
            public callResult?: proto.CallResult|null;
            public static create(properties?: IParticipantInfo): ParticipantInfo;
            public static encode(m: IParticipantInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ParticipantInfo;
            public static fromObject(d: { [k: string]: any }): ParticipantInfo;
            public static toObject(m: ParticipantInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace CertChain {

        interface INoiseCertificate {
            details?: (Uint8Array|null);
            signature?: (Uint8Array|null);
        }

        class NoiseCertificate implements INoiseCertificate {
            constructor(p?: INoiseCertificate);
            public details?: (Uint8Array|null);
            public signature?: (Uint8Array|null);
            public static create(properties?: INoiseCertificate): NoiseCertificate;
            public static encode(m: INoiseCertificate, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NoiseCertificate;
            public static fromObject(d: { [k: string]: any }): NoiseCertificate;
            public static toObject(m: NoiseCertificate, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace NoiseCertificate {

            interface IDetails {
                serial?: (number|null);
                issuerSerial?: (number|null);
                key?: (Uint8Array|null);
                notBefore?: (number|Long|null);
                notAfter?: (number|Long|null);
            }

            class Details implements IDetails {
                constructor(p?: IDetails);
                public serial?: (number|null);
                public issuerSerial?: (number|null);
                public key?: (Uint8Array|null);
                public notBefore?: (number|Long|null);
                public notAfter?: (number|Long|null);
                public static create(properties?: IDetails): Details;
                public static encode(m: IDetails, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Details;
                public static fromObject(d: { [k: string]: any }): Details;
                public static toObject(m: Details, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }
    }

    namespace ChatRowOpaqueData {

        interface IDraftMessage {
            text?: (string|null);
            omittedUrl?: (string|null);
            ctwaContextLinkData?: (proto.ICtwaContextLinkData|null);
            ctwaContext?: (proto.ICtwaContextData|null);
            timestamp?: (number|Long|null);
        }

        class DraftMessage implements IDraftMessage {
            constructor(p?: IDraftMessage);
            public text?: (string|null);
            public omittedUrl?: (string|null);
            public ctwaContextLinkData?: (proto.ICtwaContextLinkData|null);
            public ctwaContext?: (proto.ICtwaContextData|null);
            public timestamp?: (number|Long|null);
            public static create(properties?: IDraftMessage): DraftMessage;
            public static encode(m: IDraftMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DraftMessage;
            public static fromObject(d: { [k: string]: any }): DraftMessage;
            public static toObject(m: DraftMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace DraftMessage {

            interface ICtwaContextData {
                conversionSource?: (string|null);
                conversionData?: (Uint8Array|null);
                sourceUrl?: (string|null);
                sourceId?: (string|null);
                sourceType?: (string|null);
                title?: (string|null);
                description?: (string|null);
                thumbnail?: (string|null);
                thumbnailUrl?: (string|null);
                mediaType?: proto.CtwaContextData.ContextInfoExternalAdReplyInfoMediaType|null;
                mediaUrl?: (string|null);
                isSuspiciousLink?: (boolean|null);
            }

            class CtwaContextData implements ICtwaContextData {
                constructor(p?: ICtwaContextData);
                public conversionSource?: (string|null);
                public conversionData?: (Uint8Array|null);
                public sourceUrl?: (string|null);
                public sourceId?: (string|null);
                public sourceType?: (string|null);
                public title?: (string|null);
                public description?: (string|null);
                public thumbnail?: (string|null);
                public thumbnailUrl?: (string|null);
                public mediaType?: proto.CtwaContextData.ContextInfoExternalAdReplyInfoMediaType|null;
                public mediaUrl?: (string|null);
                public isSuspiciousLink?: (boolean|null);
                public static create(properties?: ICtwaContextData): CtwaContextData;
                public static encode(m: ICtwaContextData, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CtwaContextData;
                public static fromObject(d: { [k: string]: any }): CtwaContextData;
                public static toObject(m: CtwaContextData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ICtwaContextLinkData {
                context?: (string|null);
                sourceUrl?: (string|null);
                icebreaker?: (string|null);
                phone?: (string|null);
            }

            class CtwaContextLinkData implements ICtwaContextLinkData {
                constructor(p?: ICtwaContextLinkData);
                public context?: (string|null);
                public sourceUrl?: (string|null);
                public icebreaker?: (string|null);
                public phone?: (string|null);
                public static create(properties?: ICtwaContextLinkData): CtwaContextLinkData;
                public static encode(m: ICtwaContextLinkData, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CtwaContextLinkData;
                public static fromObject(d: { [k: string]: any }): CtwaContextLinkData;
                public static toObject(m: CtwaContextLinkData, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace CtwaContextData {

                enum ContextInfoExternalAdReplyInfoMediaType {
                    NONE = 0,
                    IMAGE = 1,
                    VIDEO = 2,
                }
            }
        }
    }

    namespace ClientPayload {

        enum AccountType {
            DEFAULT = 0,
            GUEST = 1,
        }

        enum ConnectReason {
            PUSH = 0,
            USER_ACTIVATED = 1,
            SCHEDULED = 2,
            ERROR_RECONNECT = 3,
            NETWORK_SWITCH = 4,
            PING_RECONNECT = 5,
            UNKNOWN = 6,
        }

        enum ConnectType {
            CELLULAR_UNKNOWN = 0,
            WIFI_UNKNOWN = 1,
            CELLULAR_EDGE = 100,
            CELLULAR_IDEN = 101,
            CELLULAR_UMTS = 102,
            CELLULAR_EVDO = 103,
            CELLULAR_GPRS = 104,
            CELLULAR_HSDPA = 105,
            CELLULAR_HSUPA = 106,
            CELLULAR_HSPA = 107,
            CELLULAR_CDMA = 108,
            CELLULAR1XRTT = 109,
            CELLULAR_EHRPD = 110,
            CELLULAR_LTE = 111,
            CELLULAR_HSPAP = 112,
        }

        enum IosAppExtension {
            SHARE_EXTENSION = 0,
            SERVICE_EXTENSION = 1,
            INTENTS_EXTENSION = 2,
        }

        enum Product {
            WHATSAPP = 0,
            MESSENGER = 1,
            INTEROP = 2,
            INTEROP_MSGR = 3,
            WHATSAPP_LID = 4,
        }

        enum TrafficAnonymization {
            OFF = 0,
            STANDARD = 1,
        }

        interface IDnsSource {
            dnsMethod?: proto.DnsSource.DnsResolutionMethod|null;
            appCached?: (boolean|null);
        }

        class DnsSource implements IDnsSource {
            constructor(p?: IDnsSource);
            public dnsMethod?: proto.DnsSource.DnsResolutionMethod|null;
            public appCached?: (boolean|null);
            public static create(properties?: IDnsSource): DnsSource;
            public static encode(m: IDnsSource, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DnsSource;
            public static fromObject(d: { [k: string]: any }): DnsSource;
            public static toObject(m: DnsSource, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDevicePairingRegistrationData {
            eRegid?: (Uint8Array|null);
            eKeytype?: (Uint8Array|null);
            eIdent?: (Uint8Array|null);
            eSkeyId?: (Uint8Array|null);
            eSkeyVal?: (Uint8Array|null);
            eSkeySig?: (Uint8Array|null);
            buildHash?: (Uint8Array|null);
            deviceProps?: (Uint8Array|null);
        }

        class DevicePairingRegistrationData implements IDevicePairingRegistrationData {
            constructor(p?: IDevicePairingRegistrationData);
            public eRegid?: (Uint8Array|null);
            public eKeytype?: (Uint8Array|null);
            public eIdent?: (Uint8Array|null);
            public eSkeyId?: (Uint8Array|null);
            public eSkeyVal?: (Uint8Array|null);
            public eSkeySig?: (Uint8Array|null);
            public buildHash?: (Uint8Array|null);
            public deviceProps?: (Uint8Array|null);
            public static create(properties?: IDevicePairingRegistrationData): DevicePairingRegistrationData;
            public static encode(m: IDevicePairingRegistrationData, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DevicePairingRegistrationData;
            public static fromObject(d: { [k: string]: any }): DevicePairingRegistrationData;
            public static toObject(m: DevicePairingRegistrationData, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInteropData {
            accountId?: (number|Long|null);
            token?: (Uint8Array|null);
            enableReadReceipts?: (boolean|null);
        }

        class InteropData implements IInteropData {
            constructor(p?: IInteropData);
            public accountId?: (number|Long|null);
            public token?: (Uint8Array|null);
            public enableReadReceipts?: (boolean|null);
            public static create(properties?: IInteropData): InteropData;
            public static encode(m: IInteropData, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteropData;
            public static fromObject(d: { [k: string]: any }): InteropData;
            public static toObject(m: InteropData, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUserAgent {
            platform?: proto.UserAgent.Platform|null;
            appVersion?: (proto.IAppVersion|null);
            mcc?: (string|null);
            mnc?: (string|null);
            osVersion?: (string|null);
            manufacturer?: (string|null);
            device?: (string|null);
            osBuildNumber?: (string|null);
            phoneId?: (string|null);
            releaseChannel?: proto.UserAgent.ReleaseChannel|null;
            localeLanguageIso6391?: (string|null);
            localeCountryIso31661Alpha2?: (string|null);
            deviceBoard?: (string|null);
            deviceExpId?: (string|null);
            deviceType?: proto.UserAgent.DeviceType|null;
            deviceModelType?: (string|null);
        }

        class UserAgent implements IUserAgent {
            constructor(p?: IUserAgent);
            public platform?: proto.UserAgent.Platform|null;
            public appVersion?: (proto.IAppVersion|null);
            public mcc?: (string|null);
            public mnc?: (string|null);
            public osVersion?: (string|null);
            public manufacturer?: (string|null);
            public device?: (string|null);
            public osBuildNumber?: (string|null);
            public phoneId?: (string|null);
            public releaseChannel?: proto.UserAgent.ReleaseChannel|null;
            public localeLanguageIso6391?: (string|null);
            public localeCountryIso31661Alpha2?: (string|null);
            public deviceBoard?: (string|null);
            public deviceExpId?: (string|null);
            public deviceType?: proto.UserAgent.DeviceType|null;
            public deviceModelType?: (string|null);
            public static create(properties?: IUserAgent): UserAgent;
            public static encode(m: IUserAgent, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UserAgent;
            public static fromObject(d: { [k: string]: any }): UserAgent;
            public static toObject(m: UserAgent, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IWebInfo {
            refToken?: (string|null);
            version?: (string|null);
            webdPayload?: (proto.IWebdPayload|null);
            webSubPlatform?: proto.WebInfo.WebSubPlatform|null;
            browser?: (string|null);
            browserVersion?: (string|null);
        }

        class WebInfo implements IWebInfo {
            constructor(p?: IWebInfo);
            public refToken?: (string|null);
            public version?: (string|null);
            public webdPayload?: (proto.IWebdPayload|null);
            public webSubPlatform?: proto.WebInfo.WebSubPlatform|null;
            public browser?: (string|null);
            public browserVersion?: (string|null);
            public static create(properties?: IWebInfo): WebInfo;
            public static encode(m: IWebInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WebInfo;
            public static fromObject(d: { [k: string]: any }): WebInfo;
            public static toObject(m: WebInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace DnsSource {

            enum DnsResolutionMethod {
                SYSTEM = 0,
                GOOGLE = 1,
                HARDCODED = 2,
                OVERRIDE = 3,
                FALLBACK = 4,
                MNS = 5,
                MNS_SECONDARY = 6,
                SOCKS_PROXY = 7,
            }
        }

        namespace UserAgent {

            enum DeviceType {
                PHONE = 0,
                TABLET = 1,
                DESKTOP = 2,
                WEARABLE = 3,
                VR = 4,
            }

            enum Platform {
                ANDROID = 0,
                IOS = 1,
                WINDOWS_PHONE = 2,
                BLACKBERRY = 3,
                BLACKBERRYX = 4,
                S40 = 5,
                S60 = 6,
                PYTHON_CLIENT = 7,
                TIZEN = 8,
                ENTERPRISE = 9,
                SMB_ANDROID = 10,
                KAIOS = 11,
                SMB_IOS = 12,
                WINDOWS = 13,
                WEB = 14,
                PORTAL = 15,
                GREEN_ANDROID = 16,
                GREEN_IPHONE = 17,
                BLUE_ANDROID = 18,
                BLUE_IPHONE = 19,
                FBLITE_ANDROID = 20,
                MLITE_ANDROID = 21,
                IGLITE_ANDROID = 22,
                PAGE = 23,
                MACOS = 24,
                OCULUS_MSG = 25,
                OCULUS_CALL = 26,
                MILAN = 27,
                CAPI = 28,
                WEAROS = 29,
                ARDEVICE = 30,
                VRDEVICE = 31,
                BLUE_WEB = 32,
                IPAD = 33,
                TEST = 34,
                SMART_GLASSES = 35,
                BLUE_VR = 36,
                AR_WRIST = 37,
            }

            enum ReleaseChannel {
                RELEASE = 0,
                BETA = 1,
                ALPHA = 2,
                DEBUG = 3,
            }

            interface IAppVersion {
                primary?: (number|null);
                secondary?: (number|null);
                tertiary?: (number|null);
                quaternary?: (number|null);
                quinary?: (number|null);
            }

            class AppVersion implements IAppVersion {
                constructor(p?: IAppVersion);
                public primary?: (number|null);
                public secondary?: (number|null);
                public tertiary?: (number|null);
                public quaternary?: (number|null);
                public quinary?: (number|null);
                public static create(properties?: IAppVersion): AppVersion;
                public static encode(m: IAppVersion, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppVersion;
                public static fromObject(d: { [k: string]: any }): AppVersion;
                public static toObject(m: AppVersion, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace WebInfo {

            enum WebSubPlatform {
                WEB_BROWSER = 0,
                APP_STORE = 1,
                WIN_STORE = 2,
                DARWIN = 3,
                WIN32 = 4,
                WIN_HYBRID = 5,
            }

            interface IWebdPayload {
                usesParticipantInKey?: (boolean|null);
                supportsStarredMessages?: (boolean|null);
                supportsDocumentMessages?: (boolean|null);
                supportsUrlMessages?: (boolean|null);
                supportsMediaRetry?: (boolean|null);
                supportsE2eImage?: (boolean|null);
                supportsE2eVideo?: (boolean|null);
                supportsE2eAudio?: (boolean|null);
                supportsE2eDocument?: (boolean|null);
                documentTypes?: (string|null);
                features?: (Uint8Array|null);
            }

            class WebdPayload implements IWebdPayload {
                constructor(p?: IWebdPayload);
                public usesParticipantInKey?: (boolean|null);
                public supportsStarredMessages?: (boolean|null);
                public supportsDocumentMessages?: (boolean|null);
                public supportsUrlMessages?: (boolean|null);
                public supportsMediaRetry?: (boolean|null);
                public supportsE2eImage?: (boolean|null);
                public supportsE2eVideo?: (boolean|null);
                public supportsE2eAudio?: (boolean|null);
                public supportsE2eDocument?: (boolean|null);
                public documentTypes?: (string|null);
                public features?: (Uint8Array|null);
                public static create(properties?: IWebdPayload): WebdPayload;
                public static encode(m: IWebdPayload, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WebdPayload;
                public static fromObject(d: { [k: string]: any }): WebdPayload;
                public static toObject(m: WebdPayload, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }
    }

    namespace ContextInfo {

        enum ForwardOrigin {
            UNKNOWN = 0,
            CHAT = 1,
            STATUS = 2,
            CHANNELS = 3,
            META_AI = 4,
            UGC = 5,
        }

        enum PairedMediaType {
            NOT_PAIRED_MEDIA = 0,
            SD_VIDEO_PARENT = 1,
            HD_VIDEO_CHILD = 2,
            SD_IMAGE_PARENT = 3,
            HD_IMAGE_CHILD = 4,
            MOTION_PHOTO_PARENT = 5,
            MOTION_PHOTO_CHILD = 6,
            HEVC_VIDEO_PARENT = 7,
            HEVC_VIDEO_CHILD = 8,
        }

        enum QuotedType {
            EXPLICIT = 0,
            AUTO = 1,
        }

        enum StatusAttributionType {
            NONE = 0,
            RESHARED_FROM_MENTION = 1,
            RESHARED_FROM_POST = 2,
            RESHARED_FROM_POST_MANY_TIMES = 3,
            FORWARDED_FROM_STATUS = 4,
        }

        enum StatusSourceType {
            IMAGE = 0,
            VIDEO = 1,
            GIF = 2,
            AUDIO = 3,
            TEXT = 4,
            MUSIC_STANDALONE = 5,
        }

        interface IAdReplyInfo {
            advertiserName?: (string|null);
            mediaType?: proto.AdReplyInfo.MediaType|null;
            jpegThumbnail?: (Uint8Array|null);
            caption?: (string|null);
        }

        class AdReplyInfo implements IAdReplyInfo {
            constructor(p?: IAdReplyInfo);
            public advertiserName?: (string|null);
            public mediaType?: proto.AdReplyInfo.MediaType|null;
            public jpegThumbnail?: (Uint8Array|null);
            public caption?: (string|null);
            public static create(properties?: IAdReplyInfo): AdReplyInfo;
            public static encode(m: IAdReplyInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AdReplyInfo;
            public static fromObject(d: { [k: string]: any }): AdReplyInfo;
            public static toObject(m: AdReplyInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBusinessMessageForwardInfo {
            businessOwnerJid?: (string|null);
        }

        class BusinessMessageForwardInfo implements IBusinessMessageForwardInfo {
            constructor(p?: IBusinessMessageForwardInfo);
            public businessOwnerJid?: (string|null);
            public static create(properties?: IBusinessMessageForwardInfo): BusinessMessageForwardInfo;
            public static encode(m: IBusinessMessageForwardInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BusinessMessageForwardInfo;
            public static fromObject(d: { [k: string]: any }): BusinessMessageForwardInfo;
            public static toObject(m: BusinessMessageForwardInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDataSharingContext {
            showMmDisclosure?: (boolean|null);
            encryptedSignalTokenConsented?: (string|null);
            parameters?: proto.IParameters[];
            dataSharingFlags?: (number|null);
        }

        class DataSharingContext implements IDataSharingContext {
            constructor(p?: IDataSharingContext);
            public showMmDisclosure?: (boolean|null);
            public encryptedSignalTokenConsented?: (string|null);
            public parameters: proto.IParameters[];
            public dataSharingFlags?: (number|null);
            public static create(properties?: IDataSharingContext): DataSharingContext;
            public static encode(m: IDataSharingContext, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DataSharingContext;
            public static fromObject(d: { [k: string]: any }): DataSharingContext;
            public static toObject(m: DataSharingContext, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IExternalAdReplyInfo {
            title?: (string|null);
            body?: (string|null);
            mediaType?: proto.ExternalAdReplyInfo.MediaType|null;
            thumbnailUrl?: (string|null);
            mediaUrl?: (string|null);
            thumbnail?: (Uint8Array|null);
            sourceType?: (string|null);
            sourceId?: (string|null);
            sourceUrl?: (string|null);
            containsAutoReply?: (boolean|null);
            renderLargerThumbnail?: (boolean|null);
            showAdAttribution?: (boolean|null);
            ctwaClid?: (string|null);
            ref?: (string|null);
            clickToWhatsappCall?: (boolean|null);
            adContextPreviewDismissed?: (boolean|null);
            sourceApp?: (string|null);
            automatedGreetingMessageShown?: (boolean|null);
            greetingMessageBody?: (string|null);
            ctaPayload?: (string|null);
            disableNudge?: (boolean|null);
            originalImageUrl?: (string|null);
            automatedGreetingMessageCtaType?: (string|null);
            wtwaAdFormat?: (boolean|null);
            adType?: proto.ExternalAdReplyInfo.AdType|null;
            wtwaWebsiteUrl?: (string|null);
            adPreviewUrl?: (string|null);
        }

        class ExternalAdReplyInfo implements IExternalAdReplyInfo {
            constructor(p?: IExternalAdReplyInfo);
            public title?: (string|null);
            public body?: (string|null);
            public mediaType?: proto.ExternalAdReplyInfo.MediaType|null;
            public thumbnailUrl?: (string|null);
            public mediaUrl?: (string|null);
            public thumbnail?: (Uint8Array|null);
            public sourceType?: (string|null);
            public sourceId?: (string|null);
            public sourceUrl?: (string|null);
            public containsAutoReply?: (boolean|null);
            public renderLargerThumbnail?: (boolean|null);
            public showAdAttribution?: (boolean|null);
            public ctwaClid?: (string|null);
            public ref?: (string|null);
            public clickToWhatsappCall?: (boolean|null);
            public adContextPreviewDismissed?: (boolean|null);
            public sourceApp?: (string|null);
            public automatedGreetingMessageShown?: (boolean|null);
            public greetingMessageBody?: (string|null);
            public ctaPayload?: (string|null);
            public disableNudge?: (boolean|null);
            public originalImageUrl?: (string|null);
            public automatedGreetingMessageCtaType?: (string|null);
            public wtwaAdFormat?: (boolean|null);
            public adType?: proto.ExternalAdReplyInfo.AdType|null;
            public wtwaWebsiteUrl?: (string|null);
            public adPreviewUrl?: (string|null);
            public static create(properties?: IExternalAdReplyInfo): ExternalAdReplyInfo;
            public static encode(m: IExternalAdReplyInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExternalAdReplyInfo;
            public static fromObject(d: { [k: string]: any }): ExternalAdReplyInfo;
            public static toObject(m: ExternalAdReplyInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IFeatureEligibilities {
            cannotBeReactedTo?: (boolean|null);
            cannotBeRanked?: (boolean|null);
            canRequestFeedback?: (boolean|null);
            canBeReshared?: (boolean|null);
            canReceiveMultiReact?: (boolean|null);
        }

        class FeatureEligibilities implements IFeatureEligibilities {
            constructor(p?: IFeatureEligibilities);
            public cannotBeReactedTo?: (boolean|null);
            public cannotBeRanked?: (boolean|null);
            public canRequestFeedback?: (boolean|null);
            public canBeReshared?: (boolean|null);
            public canReceiveMultiReact?: (boolean|null);
            public static create(properties?: IFeatureEligibilities): FeatureEligibilities;
            public static encode(m: IFeatureEligibilities, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FeatureEligibilities;
            public static fromObject(d: { [k: string]: any }): FeatureEligibilities;
            public static toObject(m: FeatureEligibilities, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IForwardedNewsletterMessageInfo {
            newsletterJid?: (string|null);
            serverMessageId?: (number|null);
            newsletterName?: (string|null);
            contentType?: proto.ForwardedNewsletterMessageInfo.ContentType|null;
            accessibilityText?: (string|null);
            profileName?: (string|null);
        }

        class ForwardedNewsletterMessageInfo implements IForwardedNewsletterMessageInfo {
            constructor(p?: IForwardedNewsletterMessageInfo);
            public newsletterJid?: (string|null);
            public serverMessageId?: (number|null);
            public newsletterName?: (string|null);
            public contentType?: proto.ForwardedNewsletterMessageInfo.ContentType|null;
            public accessibilityText?: (string|null);
            public profileName?: (string|null);
            public static create(properties?: IForwardedNewsletterMessageInfo): ForwardedNewsletterMessageInfo;
            public static encode(m: IForwardedNewsletterMessageInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ForwardedNewsletterMessageInfo;
            public static fromObject(d: { [k: string]: any }): ForwardedNewsletterMessageInfo;
            public static toObject(m: ForwardedNewsletterMessageInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IQuestionReplyQuotedMessage {
            serverQuestionId?: (number|null);
            quotedQuestion?: (proto.IMessage|null);
            quotedResponse?: (proto.IMessage|null);
        }

        class QuestionReplyQuotedMessage implements IQuestionReplyQuotedMessage {
            constructor(p?: IQuestionReplyQuotedMessage);
            public serverQuestionId?: (number|null);
            public quotedQuestion?: (proto.IMessage|null);
            public quotedResponse?: (proto.IMessage|null);
            public static create(properties?: IQuestionReplyQuotedMessage): QuestionReplyQuotedMessage;
            public static encode(m: IQuestionReplyQuotedMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): QuestionReplyQuotedMessage;
            public static fromObject(d: { [k: string]: any }): QuestionReplyQuotedMessage;
            public static toObject(m: QuestionReplyQuotedMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusAudienceMetadata {
            audienceType?: proto.StatusAudienceMetadata.AudienceType|null;
        }

        class StatusAudienceMetadata implements IStatusAudienceMetadata {
            constructor(p?: IStatusAudienceMetadata);
            public audienceType?: proto.StatusAudienceMetadata.AudienceType|null;
            public static create(properties?: IStatusAudienceMetadata): StatusAudienceMetadata;
            public static encode(m: IStatusAudienceMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusAudienceMetadata;
            public static fromObject(d: { [k: string]: any }): StatusAudienceMetadata;
            public static toObject(m: StatusAudienceMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUtmInfo {
            utmSource?: (string|null);
            utmCampaign?: (string|null);
        }

        class UtmInfo implements IUtmInfo {
            constructor(p?: IUtmInfo);
            public utmSource?: (string|null);
            public utmCampaign?: (string|null);
            public static create(properties?: IUtmInfo): UtmInfo;
            public static encode(m: IUtmInfo, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UtmInfo;
            public static fromObject(d: { [k: string]: any }): UtmInfo;
            public static toObject(m: UtmInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AdReplyInfo {

            enum MediaType {
                NONE = 0,
                IMAGE = 1,
                VIDEO = 2,
            }
        }

        namespace DataSharingContext {

            enum DataSharingFlags {
                SHOW_MM_DISCLOSURE_ON_CLICK = 1,
                SHOW_MM_DISCLOSURE_ON_READ = 2,
            }

            interface IParameters {
                key?: (string|null);
                stringData?: (string|null);
                intData?: (number|Long|null);
                floatData?: (number|null);
                contents?: (proto.IParameters|null);
            }

            class Parameters implements IParameters {
                constructor(p?: IParameters);
                public key?: (string|null);
                public stringData?: (string|null);
                public intData?: (number|Long|null);
                public floatData?: (number|null);
                public contents?: (proto.IParameters|null);
                public static create(properties?: IParameters): Parameters;
                public static encode(m: IParameters, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Parameters;
                public static fromObject(d: { [k: string]: any }): Parameters;
                public static toObject(m: Parameters, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace ExternalAdReplyInfo {

            enum AdType {
                CTWA = 0,
                CAWC = 1,
            }

            enum MediaType {
                NONE = 0,
                IMAGE = 1,
                VIDEO = 2,
            }
        }

        namespace ForwardedNewsletterMessageInfo {

            enum ContentType {
                UPDATE = 1,
                UPDATE_CARD = 2,
                LINK_CARD = 3,
            }
        }

        namespace StatusAudienceMetadata {

            enum AudienceType {
                UNKNOWN = 0,
                CLOSE_FRIENDS = 1,
            }
        }
    }

    namespace Conversation {

        enum EndOfHistoryTransferType {
            COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY = 0,
            COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY = 1,
            COMPLETE_ON_DEMAND_SYNC_BUT_MORE_MSG_REMAIN_ON_PRIMARY = 2,
            COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS = 3,
        }
    }

    namespace DeviceCapabilities {

        enum ChatLockSupportLevel {
            NONE = 0,
            MINIMAL = 1,
            FULL = 2,
        }

        enum MemberNameTagPrimarySupport {
            DISABLED = 0,
            RECEIVER_ENABLED = 1,
            SENDER_ENABLED = 2,
        }

        interface IAiThread {
            supportLevel?: proto.AiThread.SupportLevel|null;
        }

        class AiThread implements IAiThread {
            constructor(p?: IAiThread);
            public supportLevel?: proto.AiThread.SupportLevel|null;
            public static create(properties?: IAiThread): AiThread;
            public static encode(m: IAiThread, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiThread;
            public static fromObject(d: { [k: string]: any }): AiThread;
            public static toObject(m: AiThread, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBusinessBroadcast {
            importListEnabled?: (boolean|null);
        }

        class BusinessBroadcast implements IBusinessBroadcast {
            constructor(p?: IBusinessBroadcast);
            public importListEnabled?: (boolean|null);
            public static create(properties?: IBusinessBroadcast): BusinessBroadcast;
            public static encode(m: IBusinessBroadcast, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BusinessBroadcast;
            public static fromObject(d: { [k: string]: any }): BusinessBroadcast;
            public static toObject(m: BusinessBroadcast, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILidMigration {
            chatDbMigrationTimestamp?: (number|Long|null);
        }

        class LidMigration implements ILidMigration {
            constructor(p?: ILidMigration);
            public chatDbMigrationTimestamp?: (number|Long|null);
            public static create(properties?: ILidMigration): LidMigration;
            public static encode(m: ILidMigration, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LidMigration;
            public static fromObject(d: { [k: string]: any }): LidMigration;
            public static toObject(m: LidMigration, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUserHasAvatar {
            userHasAvatar?: (boolean|null);
        }

        class UserHasAvatar implements IUserHasAvatar {
            constructor(p?: IUserHasAvatar);
            public userHasAvatar?: (boolean|null);
            public static create(properties?: IUserHasAvatar): UserHasAvatar;
            public static encode(m: IUserHasAvatar, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UserHasAvatar;
            public static fromObject(d: { [k: string]: any }): UserHasAvatar;
            public static toObject(m: UserHasAvatar, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AiThread {

            enum SupportLevel {
                NONE = 0,
                INFRA = 1,
                FULL = 2,
            }
        }
    }

    namespace DeviceProps {

        enum PlatformType {
            UNKNOWN = 0,
            CHROME = 1,
            FIREFOX = 2,
            IE = 3,
            OPERA = 4,
            SAFARI = 5,
            EDGE = 6,
            DESKTOP = 7,
            IPAD = 8,
            ANDROID_TABLET = 9,
            OHANA = 10,
            ALOHA = 11,
            CATALINA = 12,
            TCL_TV = 13,
            IOS_PHONE = 14,
            IOS_CATALYST = 15,
            ANDROID_PHONE = 16,
            ANDROID_AMBIGUOUS = 17,
            WEAR_OS = 18,
            AR_WRIST = 19,
            AR_DEVICE = 20,
            UWP = 21,
            VR = 22,
            CLOUD_API = 23,
            SMARTGLASSES = 24,
        }

        interface IAppVersion {
            primary?: (number|null);
            secondary?: (number|null);
            tertiary?: (number|null);
            quaternary?: (number|null);
            quinary?: (number|null);
        }

        class AppVersion implements IAppVersion {
            constructor(p?: IAppVersion);
            public primary?: (number|null);
            public secondary?: (number|null);
            public tertiary?: (number|null);
            public quaternary?: (number|null);
            public quinary?: (number|null);
            public static create(properties?: IAppVersion): AppVersion;
            public static encode(m: IAppVersion, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppVersion;
            public static fromObject(d: { [k: string]: any }): AppVersion;
            public static toObject(m: AppVersion, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHistorySyncConfig {
            fullSyncDaysLimit?: (number|null);
            fullSyncSizeMbLimit?: (number|null);
            storageQuotaMb?: (number|null);
            inlineInitialPayloadInE2EeMsg?: (boolean|null);
            recentSyncDaysLimit?: (number|null);
            supportCallLogHistory?: (boolean|null);
            supportBotUserAgentChatHistory?: (boolean|null);
            supportCagReactionsAndPolls?: (boolean|null);
            supportBizHostedMsg?: (boolean|null);
            supportRecentSyncChunkMessageCountTuning?: (boolean|null);
            supportHostedGroupMsg?: (boolean|null);
            supportFbidBotChatHistory?: (boolean|null);
            supportAddOnHistorySyncMigration?: (boolean|null);
            supportMessageAssociation?: (boolean|null);
            supportGroupHistory?: (boolean|null);
            onDemandReady?: (boolean|null);
            supportGuestChat?: (boolean|null);
            completeOnDemandReady?: (boolean|null);
            thumbnailSyncDaysLimit?: (number|null);
        }

        class HistorySyncConfig implements IHistorySyncConfig {
            constructor(p?: IHistorySyncConfig);
            public fullSyncDaysLimit?: (number|null);
            public fullSyncSizeMbLimit?: (number|null);
            public storageQuotaMb?: (number|null);
            public inlineInitialPayloadInE2EeMsg?: (boolean|null);
            public recentSyncDaysLimit?: (number|null);
            public supportCallLogHistory?: (boolean|null);
            public supportBotUserAgentChatHistory?: (boolean|null);
            public supportCagReactionsAndPolls?: (boolean|null);
            public supportBizHostedMsg?: (boolean|null);
            public supportRecentSyncChunkMessageCountTuning?: (boolean|null);
            public supportHostedGroupMsg?: (boolean|null);
            public supportFbidBotChatHistory?: (boolean|null);
            public supportAddOnHistorySyncMigration?: (boolean|null);
            public supportMessageAssociation?: (boolean|null);
            public supportGroupHistory?: (boolean|null);
            public onDemandReady?: (boolean|null);
            public supportGuestChat?: (boolean|null);
            public completeOnDemandReady?: (boolean|null);
            public thumbnailSyncDaysLimit?: (number|null);
            public static create(properties?: IHistorySyncConfig): HistorySyncConfig;
            public static encode(m: IHistorySyncConfig, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncConfig;
            public static fromObject(d: { [k: string]: any }): HistorySyncConfig;
            public static toObject(m: HistorySyncConfig, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace DisappearingMode {

        enum Initiator {
            CHANGED_IN_CHAT = 0,
            INITIATED_BY_ME = 1,
            INITIATED_BY_OTHER = 2,
            BIZ_UPGRADE_FB_HOSTING = 3,
        }

        enum Trigger {
            UNKNOWN = 0,
            CHAT_SETTING = 1,
            ACCOUNT_SETTING = 2,
            BULK_CHANGE = 3,
            BIZ_SUPPORTS_FB_HOSTING = 4,
            UNKNOWN_GROUPS = 5,
        }
    }

    namespace GroupHistoryBundleInfo {

        enum ProcessState {
            NOT_INJECTED = 0,
            INJECTED = 1,
            INJECTED_PARTIAL = 2,
            INJECTION_FAILED = 3,
            INJECTION_FAILED_NO_RETRY = 4,
        }
    }

    namespace GroupParticipant {

        enum Rank {
            REGULAR = 0,
            ADMIN = 1,
            SUPERADMIN = 2,
        }
    }

    namespace HandshakeMessage {

        interface IClientFinish {
            static?: (Uint8Array|null);
            payload?: (Uint8Array|null);
            extendedCiphertext?: (Uint8Array|null);
        }

        class ClientFinish implements IClientFinish {
            constructor(p?: IClientFinish);
            public static?: (Uint8Array|null);
            public payload?: (Uint8Array|null);
            public extendedCiphertext?: (Uint8Array|null);
            public static create(properties?: IClientFinish): ClientFinish;
            public static encode(m: IClientFinish, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ClientFinish;
            public static fromObject(d: { [k: string]: any }): ClientFinish;
            public static toObject(m: ClientFinish, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IClientHello {
            ephemeral?: (Uint8Array|null);
            static?: (Uint8Array|null);
            payload?: (Uint8Array|null);
            useExtended?: (boolean|null);
            extendedCiphertext?: (Uint8Array|null);
        }

        class ClientHello implements IClientHello {
            constructor(p?: IClientHello);
            public ephemeral?: (Uint8Array|null);
            public static?: (Uint8Array|null);
            public payload?: (Uint8Array|null);
            public useExtended?: (boolean|null);
            public extendedCiphertext?: (Uint8Array|null);
            public static create(properties?: IClientHello): ClientHello;
            public static encode(m: IClientHello, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ClientHello;
            public static fromObject(d: { [k: string]: any }): ClientHello;
            public static toObject(m: ClientHello, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IServerHello {
            ephemeral?: (Uint8Array|null);
            static?: (Uint8Array|null);
            payload?: (Uint8Array|null);
            extendedStatic?: (Uint8Array|null);
        }

        class ServerHello implements IServerHello {
            constructor(p?: IServerHello);
            public ephemeral?: (Uint8Array|null);
            public static?: (Uint8Array|null);
            public payload?: (Uint8Array|null);
            public extendedStatic?: (Uint8Array|null);
            public static create(properties?: IServerHello): ServerHello;
            public static encode(m: IServerHello, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ServerHello;
            public static fromObject(d: { [k: string]: any }): ServerHello;
            public static toObject(m: ServerHello, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace HistorySync {

        enum BotAiWaitListState {
            IN_WAITLIST = 0,
            AI_AVAILABLE = 1,
        }

        enum HistorySyncType {
            INITIAL_BOOTSTRAP = 0,
            INITIAL_STATUS_V3 = 1,
            FULL = 2,
            RECENT = 3,
            PUSH_NAME = 4,
            NON_BLOCKING_DATA = 5,
            ON_DEMAND = 6,
        }
    }

    namespace HydratedTemplateButton {

        interface IHydratedCallButton {
            displayText?: (string|null);
            phoneNumber?: (string|null);
        }

        class HydratedCallButton implements IHydratedCallButton {
            constructor(p?: IHydratedCallButton);
            public displayText?: (string|null);
            public phoneNumber?: (string|null);
            public static create(properties?: IHydratedCallButton): HydratedCallButton;
            public static encode(m: IHydratedCallButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HydratedCallButton;
            public static fromObject(d: { [k: string]: any }): HydratedCallButton;
            public static toObject(m: HydratedCallButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHydratedQuickReplyButton {
            displayText?: (string|null);
            id?: (string|null);
        }

        class HydratedQuickReplyButton implements IHydratedQuickReplyButton {
            constructor(p?: IHydratedQuickReplyButton);
            public displayText?: (string|null);
            public id?: (string|null);
            public static create(properties?: IHydratedQuickReplyButton): HydratedQuickReplyButton;
            public static encode(m: IHydratedQuickReplyButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HydratedQuickReplyButton;
            public static fromObject(d: { [k: string]: any }): HydratedQuickReplyButton;
            public static toObject(m: HydratedQuickReplyButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHydratedUrlButton {
            displayText?: (string|null);
            url?: (string|null);
            consentedUsersUrl?: (string|null);
            webviewPresentation?: proto.HydratedUrlButton.WebviewPresentationType|null;
        }

        class HydratedUrlButton implements IHydratedUrlButton {
            constructor(p?: IHydratedUrlButton);
            public displayText?: (string|null);
            public url?: (string|null);
            public consentedUsersUrl?: (string|null);
            public webviewPresentation?: proto.HydratedUrlButton.WebviewPresentationType|null;
            public static create(properties?: IHydratedUrlButton): HydratedUrlButton;
            public static encode(m: IHydratedUrlButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HydratedUrlButton;
            public static fromObject(d: { [k: string]: any }): HydratedUrlButton;
            public static toObject(m: HydratedUrlButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace HydratedUrlButton {

            enum WebviewPresentationType {
                FULL = 1,
                TALL = 2,
                COMPACT = 3,
            }
        }
    }

    namespace InThreadSurveyMetadata {

        interface IInThreadSurveyOption {
            stringValue?: (string|null);
            numericValue?: (number|null);
            textTranslated?: (string|null);
        }

        class InThreadSurveyOption implements IInThreadSurveyOption {
            constructor(p?: IInThreadSurveyOption);
            public stringValue?: (string|null);
            public numericValue?: (number|null);
            public textTranslated?: (string|null);
            public static create(properties?: IInThreadSurveyOption): InThreadSurveyOption;
            public static encode(m: IInThreadSurveyOption, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InThreadSurveyOption;
            public static fromObject(d: { [k: string]: any }): InThreadSurveyOption;
            public static toObject(m: InThreadSurveyOption, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInThreadSurveyPrivacyStatementPart {
            text?: (string|null);
            url?: (string|null);
        }

        class InThreadSurveyPrivacyStatementPart implements IInThreadSurveyPrivacyStatementPart {
            constructor(p?: IInThreadSurveyPrivacyStatementPart);
            public text?: (string|null);
            public url?: (string|null);
            public static create(properties?: IInThreadSurveyPrivacyStatementPart): InThreadSurveyPrivacyStatementPart;
            public static encode(m: IInThreadSurveyPrivacyStatementPart, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InThreadSurveyPrivacyStatementPart;
            public static fromObject(d: { [k: string]: any }): InThreadSurveyPrivacyStatementPart;
            public static toObject(m: InThreadSurveyPrivacyStatementPart, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInThreadSurveyQuestion {
            questionText?: (string|null);
            questionId?: (string|null);
            questionOptions?: proto.IInThreadSurveyOption[];
        }

        class InThreadSurveyQuestion implements IInThreadSurveyQuestion {
            constructor(p?: IInThreadSurveyQuestion);
            public questionText?: (string|null);
            public questionId?: (string|null);
            public questionOptions: proto.IInThreadSurveyOption[];
            public static create(properties?: IInThreadSurveyQuestion): InThreadSurveyQuestion;
            public static encode(m: IInThreadSurveyQuestion, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InThreadSurveyQuestion;
            public static fromObject(d: { [k: string]: any }): InThreadSurveyQuestion;
            public static toObject(m: InThreadSurveyQuestion, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace InteractiveAnnotation {

        enum StatusLinkType {
            RASTERIZED_LINK_PREVIEW = 1,
            RASTERIZED_LINK_TRUNCATED = 2,
            RASTERIZED_LINK_FULL_URL = 3,
        }
    }

    namespace LimitSharing {

        enum TriggerType {
            UNKNOWN = 0,
            CHAT_SETTING = 1,
            BIZ_SUPPORTS_FB_HOSTING = 2,
            UNKNOWN_GROUP = 3,
        }
    }

    namespace MediaRetryNotification {

        enum ResultType {
            GENERAL_ERROR = 0,
            SUCCESS = 1,
            NOT_FOUND = 2,
            DECRYPTION_ERROR = 3,
        }
    }

    namespace Message {

        enum HistorySyncType {
            INITIAL_BOOTSTRAP = 0,
            INITIAL_STATUS_V3 = 1,
            FULL = 2,
            RECENT = 3,
            PUSH_NAME = 4,
            NON_BLOCKING_DATA = 5,
            ON_DEMAND = 6,
            NO_HISTORY = 7,
            MESSAGE_ACCESS_STATUS = 8,
        }

        enum MediaKeyDomain {
            UNSET = 0,
            E2EE_CHAT = 1,
            STATUS = 2,
            CAPI = 3,
            BOT = 4,
        }

        enum PeerDataOperationRequestType {
            UPLOAD_STICKER = 0,
            SEND_RECENT_STICKER_BOOTSTRAP = 1,
            GENERATE_LINK_PREVIEW = 2,
            HISTORY_SYNC_ON_DEMAND = 3,
            PLACEHOLDER_MESSAGE_RESEND = 4,
            WAFFLE_LINKING_NONCE_FETCH = 5,
            FULL_HISTORY_SYNC_ON_DEMAND = 6,
            COMPANION_META_NONCE_FETCH = 7,
            COMPANION_SYNCD_SNAPSHOT_FATAL_RECOVERY = 8,
            COMPANION_CANONICAL_USER_NONCE_FETCH = 9,
            HISTORY_SYNC_CHUNK_RETRY = 10,
            GALAXY_FLOW_ACTION = 11,
        }

        enum PollContentType {
            UNKNOWN = 0,
            TEXT = 1,
            IMAGE = 2,
        }

        enum PollType {
            POLL = 0,
            QUIZ = 1,
        }

        interface IAlbumMessage {
            expectedImageCount?: (number|null);
            expectedVideoCount?: (number|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class AlbumMessage implements IAlbumMessage {
            constructor(p?: IAlbumMessage);
            public expectedImageCount?: (number|null);
            public expectedVideoCount?: (number|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IAlbumMessage): AlbumMessage;
            public static encode(m: IAlbumMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AlbumMessage;
            public static fromObject(d: { [k: string]: any }): AlbumMessage;
            public static toObject(m: AlbumMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateFatalExceptionNotification {
            collectionNames?: string[];
            timestamp?: (number|Long|null);
        }

        class AppStateFatalExceptionNotification implements IAppStateFatalExceptionNotification {
            constructor(p?: IAppStateFatalExceptionNotification);
            public collectionNames: string[];
            public timestamp?: (number|Long|null);
            public static create(properties?: IAppStateFatalExceptionNotification): AppStateFatalExceptionNotification;
            public static encode(m: IAppStateFatalExceptionNotification, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateFatalExceptionNotification;
            public static fromObject(d: { [k: string]: any }): AppStateFatalExceptionNotification;
            public static toObject(m: AppStateFatalExceptionNotification, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKey {
            keyId?: (proto.IAppStateSyncKeyId|null);
            keyData?: (proto.IAppStateSyncKeyData|null);
        }

        class AppStateSyncKey implements IAppStateSyncKey {
            constructor(p?: IAppStateSyncKey);
            public keyId?: (proto.IAppStateSyncKeyId|null);
            public keyData?: (proto.IAppStateSyncKeyData|null);
            public static create(properties?: IAppStateSyncKey): AppStateSyncKey;
            public static encode(m: IAppStateSyncKey, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKey;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKey;
            public static toObject(m: AppStateSyncKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKeyData {
            keyData?: (Uint8Array|null);
            fingerprint?: (proto.IAppStateSyncKeyFingerprint|null);
            timestamp?: (number|Long|null);
        }

        class AppStateSyncKeyData implements IAppStateSyncKeyData {
            constructor(p?: IAppStateSyncKeyData);
            public keyData?: (Uint8Array|null);
            public fingerprint?: (proto.IAppStateSyncKeyFingerprint|null);
            public timestamp?: (number|Long|null);
            public static create(properties?: IAppStateSyncKeyData): AppStateSyncKeyData;
            public static encode(m: IAppStateSyncKeyData, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKeyData;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKeyData;
            public static toObject(m: AppStateSyncKeyData, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKeyFingerprint {
            rawId?: (number|null);
            currentIndex?: (number|null);
            deviceIndexes?: number[];
        }

        class AppStateSyncKeyFingerprint implements IAppStateSyncKeyFingerprint {
            constructor(p?: IAppStateSyncKeyFingerprint);
            public rawId?: (number|null);
            public currentIndex?: (number|null);
            public deviceIndexes: number[];
            public static create(properties?: IAppStateSyncKeyFingerprint): AppStateSyncKeyFingerprint;
            public static encode(m: IAppStateSyncKeyFingerprint, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKeyFingerprint;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKeyFingerprint;
            public static toObject(m: AppStateSyncKeyFingerprint, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKeyId {
            keyId?: (Uint8Array|null);
        }

        class AppStateSyncKeyId implements IAppStateSyncKeyId {
            constructor(p?: IAppStateSyncKeyId);
            public keyId?: (Uint8Array|null);
            public static create(properties?: IAppStateSyncKeyId): AppStateSyncKeyId;
            public static encode(m: IAppStateSyncKeyId, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKeyId;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKeyId;
            public static toObject(m: AppStateSyncKeyId, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKeyRequest {
            keyIds?: proto.IAppStateSyncKeyId[];
        }

        class AppStateSyncKeyRequest implements IAppStateSyncKeyRequest {
            constructor(p?: IAppStateSyncKeyRequest);
            public keyIds: proto.IAppStateSyncKeyId[];
            public static create(properties?: IAppStateSyncKeyRequest): AppStateSyncKeyRequest;
            public static encode(m: IAppStateSyncKeyRequest, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKeyRequest;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKeyRequest;
            public static toObject(m: AppStateSyncKeyRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAppStateSyncKeyShare {
            keys?: proto.IAppStateSyncKey[];
        }

        class AppStateSyncKeyShare implements IAppStateSyncKeyShare {
            constructor(p?: IAppStateSyncKeyShare);
            public keys: proto.IAppStateSyncKey[];
            public static create(properties?: IAppStateSyncKeyShare): AppStateSyncKeyShare;
            public static encode(m: IAppStateSyncKeyShare, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AppStateSyncKeyShare;
            public static fromObject(d: { [k: string]: any }): AppStateSyncKeyShare;
            public static toObject(m: AppStateSyncKeyShare, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAudioMessage {
            url?: (string|null);
            mimetype?: (string|null);
            fileSha256?: (Uint8Array|null);
            fileLength?: (number|Long|null);
            seconds?: (number|null);
            ptt?: (boolean|null);
            mediaKey?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            directPath?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            contextInfo?: (proto.IContextInfo|null);
            streamingSidecar?: (Uint8Array|null);
            waveform?: (Uint8Array|null);
            backgroundArgb?: (number|null);
            viewOnce?: (boolean|null);
            accessibilityLabel?: (string|null);
            mediaKeyDomain?: proto.MediaKeyDomain|null;
        }

        class AudioMessage implements IAudioMessage {
            constructor(p?: IAudioMessage);
            public url?: (string|null);
            public mimetype?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public fileLength?: (number|Long|null);
            public seconds?: (number|null);
            public ptt?: (boolean|null);
            public mediaKey?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public directPath?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public contextInfo?: (proto.IContextInfo|null);
            public streamingSidecar?: (Uint8Array|null);
            public waveform?: (Uint8Array|null);
            public backgroundArgb?: (number|null);
            public viewOnce?: (boolean|null);
            public accessibilityLabel?: (string|null);
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public static create(properties?: IAudioMessage): AudioMessage;
            public static encode(m: IAudioMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AudioMessage;
            public static fromObject(d: { [k: string]: any }): AudioMessage;
            public static toObject(m: AudioMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBCallMessage {
            sessionId?: (string|null);
            mediaType?: proto.BCallMessage.MediaType|null;
            masterKey?: (Uint8Array|null);
            caption?: (string|null);
        }

        class BCallMessage implements IBCallMessage {
            constructor(p?: IBCallMessage);
            public sessionId?: (string|null);
            public mediaType?: proto.BCallMessage.MediaType|null;
            public masterKey?: (Uint8Array|null);
            public caption?: (string|null);
            public static create(properties?: IBCallMessage): BCallMessage;
            public static encode(m: IBCallMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BCallMessage;
            public static fromObject(d: { [k: string]: any }): BCallMessage;
            public static toObject(m: BCallMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IButtonsMessage {
            contentText?: (string|null);
            footerText?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            buttons?: proto.IButton[];
            headerType?: proto.ButtonsMessage.HeaderType|null;
            text?: (string|null);
            documentMessage?: (proto.IDocumentMessage|null);
            imageMessage?: (proto.IImageMessage|null);
            videoMessage?: (proto.IVideoMessage|null);
            locationMessage?: (proto.ILocationMessage|null);
            /** Prost oneof field */
            header?: {
                text?: (string|null);
                documentMessage?: (proto.IDocumentMessage|null);
                imageMessage?: (proto.IImageMessage|null);
                videoMessage?: (proto.IVideoMessage|null);
                locationMessage?: (proto.ILocationMessage|null);
            } | null;
        }

        class ButtonsMessage implements IButtonsMessage {
            constructor(p?: IButtonsMessage);
            public contentText?: (string|null);
            public footerText?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public buttons: proto.IButton[];
            public headerType?: proto.ButtonsMessage.HeaderType|null;
            public text?: (string|null);
            public documentMessage?: (proto.IDocumentMessage|null);
            public imageMessage?: (proto.IImageMessage|null);
            public videoMessage?: (proto.IVideoMessage|null);
            public locationMessage?: (proto.ILocationMessage|null);
            public header?: ("text"|"documentMessage"|"imageMessage"|"videoMessage"|"locationMessage");
            public static create(properties?: IButtonsMessage): ButtonsMessage;
            public static encode(m: IButtonsMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ButtonsMessage;
            public static fromObject(d: { [k: string]: any }): ButtonsMessage;
            public static toObject(m: ButtonsMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IButtonsResponseMessage {
            selectedButtonId?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            type?: proto.ButtonsResponseMessage.Type|null;
            selectedDisplayText?: (string|null);
            /** Prost oneof field */
            response?: {
                selectedDisplayText?: (string|null);
            } | null;
        }

        class ButtonsResponseMessage implements IButtonsResponseMessage {
            constructor(p?: IButtonsResponseMessage);
            public selectedButtonId?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public type?: proto.ButtonsResponseMessage.Type|null;
            public selectedDisplayText?: (string|null);
            public response?: ("selectedDisplayText");
            public static create(properties?: IButtonsResponseMessage): ButtonsResponseMessage;
            public static encode(m: IButtonsResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ButtonsResponseMessage;
            public static fromObject(d: { [k: string]: any }): ButtonsResponseMessage;
            public static toObject(m: ButtonsResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICall {
            callKey?: (Uint8Array|null);
            conversionSource?: (string|null);
            conversionData?: (Uint8Array|null);
            conversionDelaySeconds?: (number|null);
            ctwaSignals?: (string|null);
            ctwaPayload?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            nativeFlowCallButtonPayload?: (string|null);
            deeplinkPayload?: (string|null);
            messageContextInfo?: (proto.IMessageContextInfo|null);
        }

        class Call implements ICall {
            constructor(p?: ICall);
            public callKey?: (Uint8Array|null);
            public conversionSource?: (string|null);
            public conversionData?: (Uint8Array|null);
            public conversionDelaySeconds?: (number|null);
            public ctwaSignals?: (string|null);
            public ctwaPayload?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public nativeFlowCallButtonPayload?: (string|null);
            public deeplinkPayload?: (string|null);
            public messageContextInfo?: (proto.IMessageContextInfo|null);
            public static create(properties?: ICall): Call;
            public static encode(m: ICall, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Call;
            public static fromObject(d: { [k: string]: any }): Call;
            public static toObject(m: Call, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICallLogMessage {
            isVideo?: (boolean|null);
            callOutcome?: proto.CallLogMessage.CallOutcome|null;
            durationSecs?: (number|Long|null);
            callType?: proto.CallLogMessage.CallType|null;
            participants?: proto.ICallParticipant[];
        }

        class CallLogMessage implements ICallLogMessage {
            constructor(p?: ICallLogMessage);
            public isVideo?: (boolean|null);
            public callOutcome?: proto.CallLogMessage.CallOutcome|null;
            public durationSecs?: (number|Long|null);
            public callType?: proto.CallLogMessage.CallType|null;
            public participants: proto.ICallParticipant[];
            public static create(properties?: ICallLogMessage): CallLogMessage;
            public static encode(m: ICallLogMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CallLogMessage;
            public static fromObject(d: { [k: string]: any }): CallLogMessage;
            public static toObject(m: CallLogMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICancelPaymentRequestMessage {
            key?: (proto.IMessageKey|null);
        }

        class CancelPaymentRequestMessage implements ICancelPaymentRequestMessage {
            constructor(p?: ICancelPaymentRequestMessage);
            public key?: (proto.IMessageKey|null);
            public static create(properties?: ICancelPaymentRequestMessage): CancelPaymentRequestMessage;
            public static encode(m: ICancelPaymentRequestMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CancelPaymentRequestMessage;
            public static fromObject(d: { [k: string]: any }): CancelPaymentRequestMessage;
            public static toObject(m: CancelPaymentRequestMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IChat {
            displayName?: (string|null);
            id?: (string|null);
        }

        class Chat implements IChat {
            constructor(p?: IChat);
            public displayName?: (string|null);
            public id?: (string|null);
            public static create(properties?: IChat): Chat;
            public static encode(m: IChat, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Chat;
            public static fromObject(d: { [k: string]: any }): Chat;
            public static toObject(m: Chat, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICloudApiThreadControlNotification {
            status?: proto.CloudApiThreadControlNotification.CloudApiThreadControl|null;
            senderNotificationTimestampMs?: (number|Long|null);
            consumerLid?: (string|null);
            consumerPhoneNumber?: (string|null);
            notificationContent?: (proto.ICloudApiThreadControlNotificationContent|null);
            shouldSuppressNotification?: (boolean|null);
        }

        class CloudApiThreadControlNotification implements ICloudApiThreadControlNotification {
            constructor(p?: ICloudApiThreadControlNotification);
            public status?: proto.CloudApiThreadControlNotification.CloudApiThreadControl|null;
            public senderNotificationTimestampMs?: (number|Long|null);
            public consumerLid?: (string|null);
            public consumerPhoneNumber?: (string|null);
            public notificationContent?: (proto.ICloudApiThreadControlNotificationContent|null);
            public shouldSuppressNotification?: (boolean|null);
            public static create(properties?: ICloudApiThreadControlNotification): CloudApiThreadControlNotification;
            public static encode(m: ICloudApiThreadControlNotification, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CloudApiThreadControlNotification;
            public static fromObject(d: { [k: string]: any }): CloudApiThreadControlNotification;
            public static toObject(m: CloudApiThreadControlNotification, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICommentMessage {
            message?: (proto.IMessage|null);
            targetMessageKey?: (proto.IMessageKey|null);
        }

        class CommentMessage implements ICommentMessage {
            constructor(p?: ICommentMessage);
            public message?: (proto.IMessage|null);
            public targetMessageKey?: (proto.IMessageKey|null);
            public static create(properties?: ICommentMessage): CommentMessage;
            public static encode(m: ICommentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CommentMessage;
            public static fromObject(d: { [k: string]: any }): CommentMessage;
            public static toObject(m: CommentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IContactMessage {
            displayName?: (string|null);
            vcard?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class ContactMessage implements IContactMessage {
            constructor(p?: IContactMessage);
            public displayName?: (string|null);
            public vcard?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IContactMessage): ContactMessage;
            public static encode(m: IContactMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ContactMessage;
            public static fromObject(d: { [k: string]: any }): ContactMessage;
            public static toObject(m: ContactMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IContactsArrayMessage {
            displayName?: (string|null);
            contacts?: proto.IContactMessage[];
            contextInfo?: (proto.IContextInfo|null);
        }

        class ContactsArrayMessage implements IContactsArrayMessage {
            constructor(p?: IContactsArrayMessage);
            public displayName?: (string|null);
            public contacts: proto.IContactMessage[];
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IContactsArrayMessage): ContactsArrayMessage;
            public static encode(m: IContactsArrayMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ContactsArrayMessage;
            public static fromObject(d: { [k: string]: any }): ContactsArrayMessage;
            public static toObject(m: ContactsArrayMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDeclinePaymentRequestMessage {
            key?: (proto.IMessageKey|null);
        }

        class DeclinePaymentRequestMessage implements IDeclinePaymentRequestMessage {
            constructor(p?: IDeclinePaymentRequestMessage);
            public key?: (proto.IMessageKey|null);
            public static create(properties?: IDeclinePaymentRequestMessage): DeclinePaymentRequestMessage;
            public static encode(m: IDeclinePaymentRequestMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeclinePaymentRequestMessage;
            public static fromObject(d: { [k: string]: any }): DeclinePaymentRequestMessage;
            public static toObject(m: DeclinePaymentRequestMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDeviceSentMessage {
            destinationJid?: (string|null);
            message?: (proto.IMessage|null);
            phash?: (string|null);
        }

        class DeviceSentMessage implements IDeviceSentMessage {
            constructor(p?: IDeviceSentMessage);
            public destinationJid?: (string|null);
            public message?: (proto.IMessage|null);
            public phash?: (string|null);
            public static create(properties?: IDeviceSentMessage): DeviceSentMessage;
            public static encode(m: IDeviceSentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeviceSentMessage;
            public static fromObject(d: { [k: string]: any }): DeviceSentMessage;
            public static toObject(m: DeviceSentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDocumentMessage {
            url?: (string|null);
            mimetype?: (string|null);
            title?: (string|null);
            fileSha256?: (Uint8Array|null);
            fileLength?: (number|Long|null);
            pageCount?: (number|null);
            mediaKey?: (Uint8Array|null);
            fileName?: (string|null);
            fileEncSha256?: (Uint8Array|null);
            directPath?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            contactVcard?: (boolean|null);
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            thumbnailHeight?: (number|null);
            thumbnailWidth?: (number|null);
            caption?: (string|null);
            accessibilityLabel?: (string|null);
            mediaKeyDomain?: proto.MediaKeyDomain|null;
        }

        class DocumentMessage implements IDocumentMessage {
            constructor(p?: IDocumentMessage);
            public url?: (string|null);
            public mimetype?: (string|null);
            public title?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public fileLength?: (number|Long|null);
            public pageCount?: (number|null);
            public mediaKey?: (Uint8Array|null);
            public fileName?: (string|null);
            public fileEncSha256?: (Uint8Array|null);
            public directPath?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public contactVcard?: (boolean|null);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public thumbnailHeight?: (number|null);
            public thumbnailWidth?: (number|null);
            public caption?: (string|null);
            public accessibilityLabel?: (string|null);
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public static create(properties?: IDocumentMessage): DocumentMessage;
            public static encode(m: IDocumentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DocumentMessage;
            public static fromObject(d: { [k: string]: any }): DocumentMessage;
            public static toObject(m: DocumentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IEncCommentMessage {
            targetMessageKey?: (proto.IMessageKey|null);
            encPayload?: (Uint8Array|null);
            encIv?: (Uint8Array|null);
        }

        class EncCommentMessage implements IEncCommentMessage {
            constructor(p?: IEncCommentMessage);
            public targetMessageKey?: (proto.IMessageKey|null);
            public encPayload?: (Uint8Array|null);
            public encIv?: (Uint8Array|null);
            public static create(properties?: IEncCommentMessage): EncCommentMessage;
            public static encode(m: IEncCommentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EncCommentMessage;
            public static fromObject(d: { [k: string]: any }): EncCommentMessage;
            public static toObject(m: EncCommentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IEncEventResponseMessage {
            eventCreationMessageKey?: (proto.IMessageKey|null);
            encPayload?: (Uint8Array|null);
            encIv?: (Uint8Array|null);
        }

        class EncEventResponseMessage implements IEncEventResponseMessage {
            constructor(p?: IEncEventResponseMessage);
            public eventCreationMessageKey?: (proto.IMessageKey|null);
            public encPayload?: (Uint8Array|null);
            public encIv?: (Uint8Array|null);
            public static create(properties?: IEncEventResponseMessage): EncEventResponseMessage;
            public static encode(m: IEncEventResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EncEventResponseMessage;
            public static fromObject(d: { [k: string]: any }): EncEventResponseMessage;
            public static toObject(m: EncEventResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IEncReactionMessage {
            targetMessageKey?: (proto.IMessageKey|null);
            encPayload?: (Uint8Array|null);
            encIv?: (Uint8Array|null);
        }

        class EncReactionMessage implements IEncReactionMessage {
            constructor(p?: IEncReactionMessage);
            public targetMessageKey?: (proto.IMessageKey|null);
            public encPayload?: (Uint8Array|null);
            public encIv?: (Uint8Array|null);
            public static create(properties?: IEncReactionMessage): EncReactionMessage;
            public static encode(m: IEncReactionMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EncReactionMessage;
            public static fromObject(d: { [k: string]: any }): EncReactionMessage;
            public static toObject(m: EncReactionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IEventMessage {
            contextInfo?: (proto.IContextInfo|null);
            isCanceled?: (boolean|null);
            name?: (string|null);
            description?: (string|null);
            location?: (proto.ILocationMessage|null);
            joinLink?: (string|null);
            startTime?: (number|Long|null);
            endTime?: (number|Long|null);
            extraGuestsAllowed?: (boolean|null);
            isScheduleCall?: (boolean|null);
            hasReminder?: (boolean|null);
            reminderOffsetSec?: (number|Long|null);
        }

        class EventMessage implements IEventMessage {
            constructor(p?: IEventMessage);
            public contextInfo?: (proto.IContextInfo|null);
            public isCanceled?: (boolean|null);
            public name?: (string|null);
            public description?: (string|null);
            public location?: (proto.ILocationMessage|null);
            public joinLink?: (string|null);
            public startTime?: (number|Long|null);
            public endTime?: (number|Long|null);
            public extraGuestsAllowed?: (boolean|null);
            public isScheduleCall?: (boolean|null);
            public hasReminder?: (boolean|null);
            public reminderOffsetSec?: (number|Long|null);
            public static create(properties?: IEventMessage): EventMessage;
            public static encode(m: IEventMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EventMessage;
            public static fromObject(d: { [k: string]: any }): EventMessage;
            public static toObject(m: EventMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IEventResponseMessage {
            response?: proto.EventResponseMessage.EventResponseType|null;
            timestampMs?: (number|Long|null);
            extraGuestCount?: (number|null);
        }

        class EventResponseMessage implements IEventResponseMessage {
            constructor(p?: IEventResponseMessage);
            public response?: proto.EventResponseMessage.EventResponseType|null;
            public timestampMs?: (number|Long|null);
            public extraGuestCount?: (number|null);
            public static create(properties?: IEventResponseMessage): EventResponseMessage;
            public static encode(m: IEventResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EventResponseMessage;
            public static fromObject(d: { [k: string]: any }): EventResponseMessage;
            public static toObject(m: EventResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IExtendedTextMessage {
            text?: (string|null);
            matchedText?: (string|null);
            description?: (string|null);
            title?: (string|null);
            textArgb?: (number|null);
            backgroundArgb?: (number|null);
            font?: proto.ExtendedTextMessage.FontType|null;
            previewType?: proto.ExtendedTextMessage.PreviewType|null;
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            doNotPlayInline?: (boolean|null);
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            mediaKeyTimestamp?: (number|Long|null);
            thumbnailHeight?: (number|null);
            thumbnailWidth?: (number|null);
            inviteLinkGroupType?: proto.ExtendedTextMessage.InviteLinkGroupType|null;
            inviteLinkParentGroupSubjectV2?: (string|null);
            inviteLinkParentGroupThumbnailV2?: (Uint8Array|null);
            inviteLinkGroupTypeV2?: proto.ExtendedTextMessage.InviteLinkGroupType|null;
            viewOnce?: (boolean|null);
            videoHeight?: (number|null);
            videoWidth?: (number|null);
            faviconMmsMetadata?: (proto.IMmsThumbnailMetadata|null);
            linkPreviewMetadata?: (proto.ILinkPreviewMetadata|null);
            paymentLinkMetadata?: (proto.IPaymentLinkMetadata|null);
            endCardTiles?: proto.IVideoEndCard[];
            videoContentUrl?: (string|null);
            musicMetadata?: (proto.IEmbeddedMusic|null);
            paymentExtendedMetadata?: (proto.IPaymentExtendedMetadata|null);
        }

        class ExtendedTextMessage implements IExtendedTextMessage {
            constructor(p?: IExtendedTextMessage);
            public text?: (string|null);
            public matchedText?: (string|null);
            public description?: (string|null);
            public title?: (string|null);
            public textArgb?: (number|null);
            public backgroundArgb?: (number|null);
            public font?: proto.ExtendedTextMessage.FontType|null;
            public previewType?: proto.ExtendedTextMessage.PreviewType|null;
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public doNotPlayInline?: (boolean|null);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public thumbnailHeight?: (number|null);
            public thumbnailWidth?: (number|null);
            public inviteLinkGroupType?: proto.ExtendedTextMessage.InviteLinkGroupType|null;
            public inviteLinkParentGroupSubjectV2?: (string|null);
            public inviteLinkParentGroupThumbnailV2?: (Uint8Array|null);
            public inviteLinkGroupTypeV2?: proto.ExtendedTextMessage.InviteLinkGroupType|null;
            public viewOnce?: (boolean|null);
            public videoHeight?: (number|null);
            public videoWidth?: (number|null);
            public faviconMmsMetadata?: (proto.IMmsThumbnailMetadata|null);
            public linkPreviewMetadata?: (proto.ILinkPreviewMetadata|null);
            public paymentLinkMetadata?: (proto.IPaymentLinkMetadata|null);
            public endCardTiles: proto.IVideoEndCard[];
            public videoContentUrl?: (string|null);
            public musicMetadata?: (proto.IEmbeddedMusic|null);
            public paymentExtendedMetadata?: (proto.IPaymentExtendedMetadata|null);
            public static create(properties?: IExtendedTextMessage): ExtendedTextMessage;
            public static encode(m: IExtendedTextMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExtendedTextMessage;
            public static fromObject(d: { [k: string]: any }): ExtendedTextMessage;
            public static toObject(m: ExtendedTextMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IFullHistorySyncOnDemandRequestMetadata {
            requestId?: (string|null);
        }

        class FullHistorySyncOnDemandRequestMetadata implements IFullHistorySyncOnDemandRequestMetadata {
            constructor(p?: IFullHistorySyncOnDemandRequestMetadata);
            public requestId?: (string|null);
            public static create(properties?: IFullHistorySyncOnDemandRequestMetadata): FullHistorySyncOnDemandRequestMetadata;
            public static encode(m: IFullHistorySyncOnDemandRequestMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FullHistorySyncOnDemandRequestMetadata;
            public static fromObject(d: { [k: string]: any }): FullHistorySyncOnDemandRequestMetadata;
            public static toObject(m: FullHistorySyncOnDemandRequestMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IFutureProofMessage {
            message?: (proto.IMessage|null);
        }

        class FutureProofMessage implements IFutureProofMessage {
            constructor(p?: IFutureProofMessage);
            public message?: (proto.IMessage|null);
            public static create(properties?: IFutureProofMessage): FutureProofMessage;
            public static encode(m: IFutureProofMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FutureProofMessage;
            public static fromObject(d: { [k: string]: any }): FutureProofMessage;
            public static toObject(m: FutureProofMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IGroupInviteMessage {
            groupJid?: (string|null);
            inviteCode?: (string|null);
            inviteExpiration?: (number|Long|null);
            groupName?: (string|null);
            jpegThumbnail?: (Uint8Array|null);
            caption?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            groupType?: proto.GroupInviteMessage.GroupType|null;
        }

        class GroupInviteMessage implements IGroupInviteMessage {
            constructor(p?: IGroupInviteMessage);
            public groupJid?: (string|null);
            public inviteCode?: (string|null);
            public inviteExpiration?: (number|Long|null);
            public groupName?: (string|null);
            public jpegThumbnail?: (Uint8Array|null);
            public caption?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public groupType?: proto.GroupInviteMessage.GroupType|null;
            public static create(properties?: IGroupInviteMessage): GroupInviteMessage;
            public static encode(m: IGroupInviteMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupInviteMessage;
            public static fromObject(d: { [k: string]: any }): GroupInviteMessage;
            public static toObject(m: GroupInviteMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHighlyStructuredMessage {
            namespace?: (string|null);
            elementName?: (string|null);
            params?: string[];
            fallbackLg?: (string|null);
            fallbackLc?: (string|null);
            localizableParams?: proto.IHsmLocalizableParameter[];
            deterministicLg?: (string|null);
            deterministicLc?: (string|null);
            hydratedHsm?: (proto.ITemplateMessage|null);
        }

        class HighlyStructuredMessage implements IHighlyStructuredMessage {
            constructor(p?: IHighlyStructuredMessage);
            public namespace?: (string|null);
            public elementName?: (string|null);
            public params: string[];
            public fallbackLg?: (string|null);
            public fallbackLc?: (string|null);
            public localizableParams: proto.IHsmLocalizableParameter[];
            public deterministicLg?: (string|null);
            public deterministicLc?: (string|null);
            public hydratedHsm?: (proto.ITemplateMessage|null);
            public static create(properties?: IHighlyStructuredMessage): HighlyStructuredMessage;
            public static encode(m: IHighlyStructuredMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HighlyStructuredMessage;
            public static fromObject(d: { [k: string]: any }): HighlyStructuredMessage;
            public static toObject(m: HighlyStructuredMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHistorySyncMessageAccessStatus {
            completeAccessGranted?: (boolean|null);
        }

        class HistorySyncMessageAccessStatus implements IHistorySyncMessageAccessStatus {
            constructor(p?: IHistorySyncMessageAccessStatus);
            public completeAccessGranted?: (boolean|null);
            public static create(properties?: IHistorySyncMessageAccessStatus): HistorySyncMessageAccessStatus;
            public static encode(m: IHistorySyncMessageAccessStatus, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncMessageAccessStatus;
            public static fromObject(d: { [k: string]: any }): HistorySyncMessageAccessStatus;
            public static toObject(m: HistorySyncMessageAccessStatus, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IHistorySyncNotification {
            fileSha256?: (Uint8Array|null);
            fileLength?: (number|Long|null);
            mediaKey?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            directPath?: (string|null);
            syncType?: proto.HistorySyncType|null;
            chunkOrder?: (number|null);
            originalMessageId?: (string|null);
            progress?: (number|null);
            oldestMsgInChunkTimestampSec?: (number|Long|null);
            initialHistBootstrapInlinePayload?: (Uint8Array|null);
            peerDataRequestSessionId?: (string|null);
            fullHistorySyncOnDemandRequestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
            encHandle?: (string|null);
            messageAccessStatus?: (proto.IHistorySyncMessageAccessStatus|null);
        }

        class HistorySyncNotification implements IHistorySyncNotification {
            constructor(p?: IHistorySyncNotification);
            public fileSha256?: (Uint8Array|null);
            public fileLength?: (number|Long|null);
            public mediaKey?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public directPath?: (string|null);
            public syncType?: proto.HistorySyncType|null;
            public chunkOrder?: (number|null);
            public originalMessageId?: (string|null);
            public progress?: (number|null);
            public oldestMsgInChunkTimestampSec?: (number|Long|null);
            public initialHistBootstrapInlinePayload?: (Uint8Array|null);
            public peerDataRequestSessionId?: (string|null);
            public fullHistorySyncOnDemandRequestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
            public encHandle?: (string|null);
            public messageAccessStatus?: (proto.IHistorySyncMessageAccessStatus|null);
            public static create(properties?: IHistorySyncNotification): HistorySyncNotification;
            public static encode(m: IHistorySyncNotification, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncNotification;
            public static fromObject(d: { [k: string]: any }): HistorySyncNotification;
            public static toObject(m: HistorySyncNotification, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IImageMessage {
            url?: (string|null);
            mimetype?: (string|null);
            caption?: (string|null);
            fileSha256?: (Uint8Array|null);
            fileLength?: (number|Long|null);
            height?: (number|null);
            width?: (number|null);
            mediaKey?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            interactiveAnnotations?: proto.IInteractiveAnnotation[];
            directPath?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            firstScanSidecar?: (Uint8Array|null);
            firstScanLength?: (number|null);
            experimentGroupId?: (number|null);
            scansSidecar?: (Uint8Array|null);
            scanLengths?: number[];
            midQualityFileSha256?: (Uint8Array|null);
            midQualityFileEncSha256?: (Uint8Array|null);
            viewOnce?: (boolean|null);
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            staticUrl?: (string|null);
            annotations?: proto.IInteractiveAnnotation[];
            imageSourceType?: proto.ImageMessage.ImageSourceType|null;
            accessibilityLabel?: (string|null);
            mediaKeyDomain?: proto.MediaKeyDomain|null;
            qrUrl?: (string|null);
        }

        class ImageMessage implements IImageMessage {
            constructor(p?: IImageMessage);
            public url?: (string|null);
            public mimetype?: (string|null);
            public caption?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public fileLength?: (number|Long|null);
            public height?: (number|null);
            public width?: (number|null);
            public mediaKey?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public interactiveAnnotations: proto.IInteractiveAnnotation[];
            public directPath?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public firstScanSidecar?: (Uint8Array|null);
            public firstScanLength?: (number|null);
            public experimentGroupId?: (number|null);
            public scansSidecar?: (Uint8Array|null);
            public scanLengths: number[];
            public midQualityFileSha256?: (Uint8Array|null);
            public midQualityFileEncSha256?: (Uint8Array|null);
            public viewOnce?: (boolean|null);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public staticUrl?: (string|null);
            public annotations: proto.IInteractiveAnnotation[];
            public imageSourceType?: proto.ImageMessage.ImageSourceType|null;
            public accessibilityLabel?: (string|null);
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public qrUrl?: (string|null);
            public static create(properties?: IImageMessage): ImageMessage;
            public static encode(m: IImageMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ImageMessage;
            public static fromObject(d: { [k: string]: any }): ImageMessage;
            public static toObject(m: ImageMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInitialSecurityNotificationSettingSync {
            securityNotificationEnabled?: (boolean|null);
        }

        class InitialSecurityNotificationSettingSync implements IInitialSecurityNotificationSettingSync {
            constructor(p?: IInitialSecurityNotificationSettingSync);
            public securityNotificationEnabled?: (boolean|null);
            public static create(properties?: IInitialSecurityNotificationSettingSync): InitialSecurityNotificationSettingSync;
            public static encode(m: IInitialSecurityNotificationSettingSync, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InitialSecurityNotificationSettingSync;
            public static fromObject(d: { [k: string]: any }): InitialSecurityNotificationSettingSync;
            public static toObject(m: InitialSecurityNotificationSettingSync, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInteractiveMessage {
            header?: (proto.IHeader|null);
            body?: (proto.IBody|null);
            footer?: (proto.IFooter|null);
            contextInfo?: (proto.IContextInfo|null);
            urlTrackingMap?: (proto.IUrlTrackingMap|null);
            shopStorefrontMessage?: (proto.IShopMessage|null);
            collectionMessage?: (proto.ICollectionMessage|null);
            nativeFlowMessage?: (proto.INativeFlowMessage|null);
            carouselMessage?: (proto.ICarouselMessage|null);
            /** Prost oneof field */
            interactiveMessage?: {
                shopStorefrontMessage?: (proto.IShopMessage|null);
                collectionMessage?: (proto.ICollectionMessage|null);
                nativeFlowMessage?: (proto.INativeFlowMessage|null);
                carouselMessage?: (proto.ICarouselMessage|null);
            } | null;
        }

        class InteractiveMessage implements IInteractiveMessage {
            constructor(p?: IInteractiveMessage);
            public header?: (proto.IHeader|null);
            public body?: (proto.IBody|null);
            public footer?: (proto.IFooter|null);
            public contextInfo?: (proto.IContextInfo|null);
            public urlTrackingMap?: (proto.IUrlTrackingMap|null);
            public shopStorefrontMessage?: (proto.IShopMessage|null);
            public collectionMessage?: (proto.ICollectionMessage|null);
            public nativeFlowMessage?: (proto.INativeFlowMessage|null);
            public carouselMessage?: (proto.ICarouselMessage|null);
            public interactiveMessage?: ("shopStorefrontMessage"|"collectionMessage"|"nativeFlowMessage"|"carouselMessage");
            public static create(properties?: IInteractiveMessage): InteractiveMessage;
            public static encode(m: IInteractiveMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteractiveMessage;
            public static fromObject(d: { [k: string]: any }): InteractiveMessage;
            public static toObject(m: InteractiveMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInteractiveResponseMessage {
            body?: (proto.IBody|null);
            contextInfo?: (proto.IContextInfo|null);
            nativeFlowResponseMessage?: (proto.INativeFlowResponseMessage|null);
            /** Prost oneof field */
            interactiveResponseMessage?: {
                nativeFlowResponseMessage?: (proto.INativeFlowResponseMessage|null);
            } | null;
        }

        class InteractiveResponseMessage implements IInteractiveResponseMessage {
            constructor(p?: IInteractiveResponseMessage);
            public body?: (proto.IBody|null);
            public contextInfo?: (proto.IContextInfo|null);
            public nativeFlowResponseMessage?: (proto.INativeFlowResponseMessage|null);
            public interactiveResponseMessage?: ("nativeFlowResponseMessage");
            public static create(properties?: IInteractiveResponseMessage): InteractiveResponseMessage;
            public static encode(m: IInteractiveResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteractiveResponseMessage;
            public static fromObject(d: { [k: string]: any }): InteractiveResponseMessage;
            public static toObject(m: InteractiveResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInvoiceMessage {
            note?: (string|null);
            token?: (string|null);
            attachmentType?: proto.InvoiceMessage.AttachmentType|null;
            attachmentMimetype?: (string|null);
            attachmentMediaKey?: (Uint8Array|null);
            attachmentMediaKeyTimestamp?: (number|Long|null);
            attachmentFileSha256?: (Uint8Array|null);
            attachmentFileEncSha256?: (Uint8Array|null);
            attachmentDirectPath?: (string|null);
            attachmentJpegThumbnail?: (Uint8Array|null);
        }

        class InvoiceMessage implements IInvoiceMessage {
            constructor(p?: IInvoiceMessage);
            public note?: (string|null);
            public token?: (string|null);
            public attachmentType?: proto.InvoiceMessage.AttachmentType|null;
            public attachmentMimetype?: (string|null);
            public attachmentMediaKey?: (Uint8Array|null);
            public attachmentMediaKeyTimestamp?: (number|Long|null);
            public attachmentFileSha256?: (Uint8Array|null);
            public attachmentFileEncSha256?: (Uint8Array|null);
            public attachmentDirectPath?: (string|null);
            public attachmentJpegThumbnail?: (Uint8Array|null);
            public static create(properties?: IInvoiceMessage): InvoiceMessage;
            public static encode(m: IInvoiceMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InvoiceMessage;
            public static fromObject(d: { [k: string]: any }): InvoiceMessage;
            public static toObject(m: InvoiceMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IKeepInChatMessage {
            key?: (proto.IMessageKey|null);
            keepType?: proto.KeepType|null;
            timestampMs?: (number|Long|null);
        }

        class KeepInChatMessage implements IKeepInChatMessage {
            constructor(p?: IKeepInChatMessage);
            public key?: (proto.IMessageKey|null);
            public keepType?: proto.KeepType|null;
            public timestampMs?: (number|Long|null);
            public static create(properties?: IKeepInChatMessage): KeepInChatMessage;
            public static encode(m: IKeepInChatMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): KeepInChatMessage;
            public static fromObject(d: { [k: string]: any }): KeepInChatMessage;
            public static toObject(m: KeepInChatMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILinkPreviewMetadata {
            paymentLinkMetadata?: (proto.IPaymentLinkMetadata|null);
            urlMetadata?: (proto.IUrlMetadata|null);
            fbExperimentId?: (number|null);
            linkMediaDuration?: (number|null);
            socialMediaPostType?: proto.LinkPreviewMetadata.SocialMediaPostType|null;
            linkInlineVideoMuted?: (boolean|null);
            videoContentUrl?: (string|null);
            musicMetadata?: (proto.IEmbeddedMusic|null);
            videoContentCaption?: (string|null);
        }

        class LinkPreviewMetadata implements ILinkPreviewMetadata {
            constructor(p?: ILinkPreviewMetadata);
            public paymentLinkMetadata?: (proto.IPaymentLinkMetadata|null);
            public urlMetadata?: (proto.IUrlMetadata|null);
            public fbExperimentId?: (number|null);
            public linkMediaDuration?: (number|null);
            public socialMediaPostType?: proto.LinkPreviewMetadata.SocialMediaPostType|null;
            public linkInlineVideoMuted?: (boolean|null);
            public videoContentUrl?: (string|null);
            public musicMetadata?: (proto.IEmbeddedMusic|null);
            public videoContentCaption?: (string|null);
            public static create(properties?: ILinkPreviewMetadata): LinkPreviewMetadata;
            public static encode(m: ILinkPreviewMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LinkPreviewMetadata;
            public static fromObject(d: { [k: string]: any }): LinkPreviewMetadata;
            public static toObject(m: LinkPreviewMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IListMessage {
            title?: (string|null);
            description?: (string|null);
            buttonText?: (string|null);
            listType?: proto.ListMessage.ListType|null;
            sections?: proto.ISection[];
            productListInfo?: (proto.IProductListInfo|null);
            footerText?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class ListMessage implements IListMessage {
            constructor(p?: IListMessage);
            public title?: (string|null);
            public description?: (string|null);
            public buttonText?: (string|null);
            public listType?: proto.ListMessage.ListType|null;
            public sections: proto.ISection[];
            public productListInfo?: (proto.IProductListInfo|null);
            public footerText?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IListMessage): ListMessage;
            public static encode(m: IListMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ListMessage;
            public static fromObject(d: { [k: string]: any }): ListMessage;
            public static toObject(m: ListMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IListResponseMessage {
            title?: (string|null);
            listType?: proto.ListResponseMessage.ListType|null;
            singleSelectReply?: (proto.ISingleSelectReply|null);
            contextInfo?: (proto.IContextInfo|null);
            description?: (string|null);
        }

        class ListResponseMessage implements IListResponseMessage {
            constructor(p?: IListResponseMessage);
            public title?: (string|null);
            public listType?: proto.ListResponseMessage.ListType|null;
            public singleSelectReply?: (proto.ISingleSelectReply|null);
            public contextInfo?: (proto.IContextInfo|null);
            public description?: (string|null);
            public static create(properties?: IListResponseMessage): ListResponseMessage;
            public static encode(m: IListResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ListResponseMessage;
            public static fromObject(d: { [k: string]: any }): ListResponseMessage;
            public static toObject(m: ListResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILiveLocationMessage {
            degreesLatitude?: (number|null);
            degreesLongitude?: (number|null);
            accuracyInMeters?: (number|null);
            speedInMps?: (number|null);
            degreesClockwiseFromMagneticNorth?: (number|null);
            caption?: (string|null);
            sequenceNumber?: (number|Long|null);
            timeOffset?: (number|null);
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class LiveLocationMessage implements ILiveLocationMessage {
            constructor(p?: ILiveLocationMessage);
            public degreesLatitude?: (number|null);
            public degreesLongitude?: (number|null);
            public accuracyInMeters?: (number|null);
            public speedInMps?: (number|null);
            public degreesClockwiseFromMagneticNorth?: (number|null);
            public caption?: (string|null);
            public sequenceNumber?: (number|Long|null);
            public timeOffset?: (number|null);
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: ILiveLocationMessage): LiveLocationMessage;
            public static encode(m: ILiveLocationMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LiveLocationMessage;
            public static fromObject(d: { [k: string]: any }): LiveLocationMessage;
            public static toObject(m: LiveLocationMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILocationMessage {
            degreesLatitude?: (number|null);
            degreesLongitude?: (number|null);
            name?: (string|null);
            address?: (string|null);
            url?: (string|null);
            isLive?: (boolean|null);
            accuracyInMeters?: (number|null);
            speedInMps?: (number|null);
            degreesClockwiseFromMagneticNorth?: (number|null);
            comment?: (string|null);
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class LocationMessage implements ILocationMessage {
            constructor(p?: ILocationMessage);
            public degreesLatitude?: (number|null);
            public degreesLongitude?: (number|null);
            public name?: (string|null);
            public address?: (string|null);
            public url?: (string|null);
            public isLive?: (boolean|null);
            public accuracyInMeters?: (number|null);
            public speedInMps?: (number|null);
            public degreesClockwiseFromMagneticNorth?: (number|null);
            public comment?: (string|null);
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: ILocationMessage): LocationMessage;
            public static encode(m: ILocationMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LocationMessage;
            public static fromObject(d: { [k: string]: any }): LocationMessage;
            public static toObject(m: LocationMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMmsThumbnailMetadata {
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            mediaKeyTimestamp?: (number|Long|null);
            thumbnailHeight?: (number|null);
            thumbnailWidth?: (number|null);
            mediaKeyDomain?: proto.MediaKeyDomain|null;
        }

        class MmsThumbnailMetadata implements IMmsThumbnailMetadata {
            constructor(p?: IMmsThumbnailMetadata);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public thumbnailHeight?: (number|null);
            public thumbnailWidth?: (number|null);
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public static create(properties?: IMmsThumbnailMetadata): MmsThumbnailMetadata;
            public static encode(m: IMmsThumbnailMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MmsThumbnailMetadata;
            public static fromObject(d: { [k: string]: any }): MmsThumbnailMetadata;
            public static toObject(m: MmsThumbnailMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMessageHistoryBundle {
            mimetype?: (string|null);
            fileSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            directPath?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            contextInfo?: (proto.IContextInfo|null);
            messageHistoryMetadata?: (proto.IMessageHistoryMetadata|null);
        }

        class MessageHistoryBundle implements IMessageHistoryBundle {
            constructor(p?: IMessageHistoryBundle);
            public mimetype?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public directPath?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public contextInfo?: (proto.IContextInfo|null);
            public messageHistoryMetadata?: (proto.IMessageHistoryMetadata|null);
            public static create(properties?: IMessageHistoryBundle): MessageHistoryBundle;
            public static encode(m: IMessageHistoryBundle, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageHistoryBundle;
            public static fromObject(d: { [k: string]: any }): MessageHistoryBundle;
            public static toObject(m: MessageHistoryBundle, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMessageHistoryMetadata {
            historyReceivers?: string[];
            oldestMessageTimestamp?: (number|Long|null);
            messageCount?: (number|Long|null);
        }

        class MessageHistoryMetadata implements IMessageHistoryMetadata {
            constructor(p?: IMessageHistoryMetadata);
            public historyReceivers: string[];
            public oldestMessageTimestamp?: (number|Long|null);
            public messageCount?: (number|Long|null);
            public static create(properties?: IMessageHistoryMetadata): MessageHistoryMetadata;
            public static encode(m: IMessageHistoryMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageHistoryMetadata;
            public static fromObject(d: { [k: string]: any }): MessageHistoryMetadata;
            public static toObject(m: MessageHistoryMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMessageHistoryNotice {
            contextInfo?: (proto.IContextInfo|null);
            messageHistoryMetadata?: (proto.IMessageHistoryMetadata|null);
        }

        class MessageHistoryNotice implements IMessageHistoryNotice {
            constructor(p?: IMessageHistoryNotice);
            public contextInfo?: (proto.IContextInfo|null);
            public messageHistoryMetadata?: (proto.IMessageHistoryMetadata|null);
            public static create(properties?: IMessageHistoryNotice): MessageHistoryNotice;
            public static encode(m: IMessageHistoryNotice, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageHistoryNotice;
            public static fromObject(d: { [k: string]: any }): MessageHistoryNotice;
            public static toObject(m: MessageHistoryNotice, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INewsletterAdminInviteMessage {
            newsletterJid?: (string|null);
            newsletterName?: (string|null);
            jpegThumbnail?: (Uint8Array|null);
            caption?: (string|null);
            inviteExpiration?: (number|Long|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class NewsletterAdminInviteMessage implements INewsletterAdminInviteMessage {
            constructor(p?: INewsletterAdminInviteMessage);
            public newsletterJid?: (string|null);
            public newsletterName?: (string|null);
            public jpegThumbnail?: (Uint8Array|null);
            public caption?: (string|null);
            public inviteExpiration?: (number|Long|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: INewsletterAdminInviteMessage): NewsletterAdminInviteMessage;
            public static encode(m: INewsletterAdminInviteMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NewsletterAdminInviteMessage;
            public static fromObject(d: { [k: string]: any }): NewsletterAdminInviteMessage;
            public static toObject(m: NewsletterAdminInviteMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INewsletterFollowerInviteMessage {
            newsletterJid?: (string|null);
            newsletterName?: (string|null);
            jpegThumbnail?: (Uint8Array|null);
            caption?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class NewsletterFollowerInviteMessage implements INewsletterFollowerInviteMessage {
            constructor(p?: INewsletterFollowerInviteMessage);
            public newsletterJid?: (string|null);
            public newsletterName?: (string|null);
            public jpegThumbnail?: (Uint8Array|null);
            public caption?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: INewsletterFollowerInviteMessage): NewsletterFollowerInviteMessage;
            public static encode(m: INewsletterFollowerInviteMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NewsletterFollowerInviteMessage;
            public static fromObject(d: { [k: string]: any }): NewsletterFollowerInviteMessage;
            public static toObject(m: NewsletterFollowerInviteMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IOrderMessage {
            orderId?: (string|null);
            thumbnail?: (Uint8Array|null);
            itemCount?: (number|null);
            status?: proto.OrderMessage.OrderStatus|null;
            surface?: proto.OrderMessage.OrderSurface|null;
            message?: (string|null);
            orderTitle?: (string|null);
            sellerJid?: (string|null);
            token?: (string|null);
            totalAmount1000?: (number|Long|null);
            totalCurrencyCode?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            messageVersion?: (number|null);
            orderRequestMessageId?: (proto.IMessageKey|null);
            catalogType?: (string|null);
        }

        class OrderMessage implements IOrderMessage {
            constructor(p?: IOrderMessage);
            public orderId?: (string|null);
            public thumbnail?: (Uint8Array|null);
            public itemCount?: (number|null);
            public status?: proto.OrderMessage.OrderStatus|null;
            public surface?: proto.OrderMessage.OrderSurface|null;
            public message?: (string|null);
            public orderTitle?: (string|null);
            public sellerJid?: (string|null);
            public token?: (string|null);
            public totalAmount1000?: (number|Long|null);
            public totalCurrencyCode?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public messageVersion?: (number|null);
            public orderRequestMessageId?: (proto.IMessageKey|null);
            public catalogType?: (string|null);
            public static create(properties?: IOrderMessage): OrderMessage;
            public static encode(m: IOrderMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): OrderMessage;
            public static fromObject(d: { [k: string]: any }): OrderMessage;
            public static toObject(m: OrderMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPaymentExtendedMetadata {
            type?: (number|null);
            platform?: (string|null);
        }

        class PaymentExtendedMetadata implements IPaymentExtendedMetadata {
            constructor(p?: IPaymentExtendedMetadata);
            public type?: (number|null);
            public platform?: (string|null);
            public static create(properties?: IPaymentExtendedMetadata): PaymentExtendedMetadata;
            public static encode(m: IPaymentExtendedMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentExtendedMetadata;
            public static fromObject(d: { [k: string]: any }): PaymentExtendedMetadata;
            public static toObject(m: PaymentExtendedMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPaymentInviteMessage {
            serviceType?: proto.PaymentInviteMessage.ServiceType|null;
            expiryTimestamp?: (number|Long|null);
        }

        class PaymentInviteMessage implements IPaymentInviteMessage {
            constructor(p?: IPaymentInviteMessage);
            public serviceType?: proto.PaymentInviteMessage.ServiceType|null;
            public expiryTimestamp?: (number|Long|null);
            public static create(properties?: IPaymentInviteMessage): PaymentInviteMessage;
            public static encode(m: IPaymentInviteMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentInviteMessage;
            public static fromObject(d: { [k: string]: any }): PaymentInviteMessage;
            public static toObject(m: PaymentInviteMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPaymentLinkMetadata {
            button?: (proto.IPaymentLinkButton|null);
            header?: (proto.IPaymentLinkHeader|null);
            provider?: (proto.IPaymentLinkProvider|null);
        }

        class PaymentLinkMetadata implements IPaymentLinkMetadata {
            constructor(p?: IPaymentLinkMetadata);
            public button?: (proto.IPaymentLinkButton|null);
            public header?: (proto.IPaymentLinkHeader|null);
            public provider?: (proto.IPaymentLinkProvider|null);
            public static create(properties?: IPaymentLinkMetadata): PaymentLinkMetadata;
            public static encode(m: IPaymentLinkMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentLinkMetadata;
            public static fromObject(d: { [k: string]: any }): PaymentLinkMetadata;
            public static toObject(m: PaymentLinkMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPeerDataOperationRequestMessage {
            peerDataOperationRequestType?: proto.PeerDataOperationRequestType|null;
            requestStickerReupload?: proto.IRequestStickerReupload[];
            requestUrlPreview?: proto.IRequestUrlPreview[];
            historySyncOnDemandRequest?: (proto.IHistorySyncOnDemandRequest|null);
            placeholderMessageResendRequest?: proto.IPlaceholderMessageResendRequest[];
            fullHistorySyncOnDemandRequest?: (proto.IFullHistorySyncOnDemandRequest|null);
            syncdCollectionFatalRecoveryRequest?: (proto.ISyncDCollectionFatalRecoveryRequest|null);
            historySyncChunkRetryRequest?: (proto.IHistorySyncChunkRetryRequest|null);
            galaxyFlowAction?: (proto.IGalaxyFlowAction|null);
        }

        class PeerDataOperationRequestMessage implements IPeerDataOperationRequestMessage {
            constructor(p?: IPeerDataOperationRequestMessage);
            public peerDataOperationRequestType?: proto.PeerDataOperationRequestType|null;
            public requestStickerReupload: proto.IRequestStickerReupload[];
            public requestUrlPreview: proto.IRequestUrlPreview[];
            public historySyncOnDemandRequest?: (proto.IHistorySyncOnDemandRequest|null);
            public placeholderMessageResendRequest: proto.IPlaceholderMessageResendRequest[];
            public fullHistorySyncOnDemandRequest?: (proto.IFullHistorySyncOnDemandRequest|null);
            public syncdCollectionFatalRecoveryRequest?: (proto.ISyncDCollectionFatalRecoveryRequest|null);
            public historySyncChunkRetryRequest?: (proto.IHistorySyncChunkRetryRequest|null);
            public galaxyFlowAction?: (proto.IGalaxyFlowAction|null);
            public static create(properties?: IPeerDataOperationRequestMessage): PeerDataOperationRequestMessage;
            public static encode(m: IPeerDataOperationRequestMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PeerDataOperationRequestMessage;
            public static fromObject(d: { [k: string]: any }): PeerDataOperationRequestMessage;
            public static toObject(m: PeerDataOperationRequestMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPeerDataOperationRequestResponseMessage {
            peerDataOperationRequestType?: proto.PeerDataOperationRequestType|null;
            stanzaId?: (string|null);
            peerDataOperationResult?: proto.IPeerDataOperationResult[];
        }

        class PeerDataOperationRequestResponseMessage implements IPeerDataOperationRequestResponseMessage {
            constructor(p?: IPeerDataOperationRequestResponseMessage);
            public peerDataOperationRequestType?: proto.PeerDataOperationRequestType|null;
            public stanzaId?: (string|null);
            public peerDataOperationResult: proto.IPeerDataOperationResult[];
            public static create(properties?: IPeerDataOperationRequestResponseMessage): PeerDataOperationRequestResponseMessage;
            public static encode(m: IPeerDataOperationRequestResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PeerDataOperationRequestResponseMessage;
            public static fromObject(d: { [k: string]: any }): PeerDataOperationRequestResponseMessage;
            public static toObject(m: PeerDataOperationRequestResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPinInChatMessage {
            key?: (proto.IMessageKey|null);
            type?: proto.PinInChatMessage.Type|null;
            senderTimestampMs?: (number|Long|null);
        }

        class PinInChatMessage implements IPinInChatMessage {
            constructor(p?: IPinInChatMessage);
            public key?: (proto.IMessageKey|null);
            public type?: proto.PinInChatMessage.Type|null;
            public senderTimestampMs?: (number|Long|null);
            public static create(properties?: IPinInChatMessage): PinInChatMessage;
            public static encode(m: IPinInChatMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PinInChatMessage;
            public static fromObject(d: { [k: string]: any }): PinInChatMessage;
            public static toObject(m: PinInChatMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPlaceholderMessage {
            type?: proto.PlaceholderMessage.PlaceholderType|null;
        }

        class PlaceholderMessage implements IPlaceholderMessage {
            constructor(p?: IPlaceholderMessage);
            public type?: proto.PlaceholderMessage.PlaceholderType|null;
            public static create(properties?: IPlaceholderMessage): PlaceholderMessage;
            public static encode(m: IPlaceholderMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PlaceholderMessage;
            public static fromObject(d: { [k: string]: any }): PlaceholderMessage;
            public static toObject(m: PlaceholderMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollCreationMessage {
            encKey?: (Uint8Array|null);
            name?: (string|null);
            options?: any[];
            selectableOptionsCount?: (number|null);
            contextInfo?: (proto.IContextInfo|null);
            pollContentType?: proto.PollContentType|null;
            pollType?: proto.PollType|null;
            correctAnswer?: (any|null);
        }

        class PollCreationMessage implements IPollCreationMessage {
            constructor(p?: IPollCreationMessage);
            public encKey?: (Uint8Array|null);
            public name?: (string|null);
            public options: any[];
            public selectableOptionsCount?: (number|null);
            public contextInfo?: (proto.IContextInfo|null);
            public pollContentType?: proto.PollContentType|null;
            public pollType?: proto.PollType|null;
            public correctAnswer?: (any|null);
            public static create(properties?: IPollCreationMessage): PollCreationMessage;
            public static encode(m: IPollCreationMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollCreationMessage;
            public static fromObject(d: { [k: string]: any }): PollCreationMessage;
            public static toObject(m: PollCreationMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollEncValue {
            encPayload?: (Uint8Array|null);
            encIv?: (Uint8Array|null);
        }

        class PollEncValue implements IPollEncValue {
            constructor(p?: IPollEncValue);
            public encPayload?: (Uint8Array|null);
            public encIv?: (Uint8Array|null);
            public static create(properties?: IPollEncValue): PollEncValue;
            public static encode(m: IPollEncValue, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollEncValue;
            public static fromObject(d: { [k: string]: any }): PollEncValue;
            public static toObject(m: PollEncValue, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollResultSnapshotMessage {
            name?: (string|null);
            pollVotes?: proto.IPollVote[];
            contextInfo?: (proto.IContextInfo|null);
            pollType?: proto.PollType|null;
        }

        class PollResultSnapshotMessage implements IPollResultSnapshotMessage {
            constructor(p?: IPollResultSnapshotMessage);
            public name?: (string|null);
            public pollVotes: proto.IPollVote[];
            public contextInfo?: (proto.IContextInfo|null);
            public pollType?: proto.PollType|null;
            public static create(properties?: IPollResultSnapshotMessage): PollResultSnapshotMessage;
            public static encode(m: IPollResultSnapshotMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollResultSnapshotMessage;
            public static fromObject(d: { [k: string]: any }): PollResultSnapshotMessage;
            public static toObject(m: PollResultSnapshotMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollUpdateMessage {
            pollCreationMessageKey?: (proto.IMessageKey|null);
            vote?: (proto.IPollEncValue|null);
            metadata?: (proto.IPollUpdateMessageMetadata|null);
            senderTimestampMs?: (number|Long|null);
        }

        class PollUpdateMessage implements IPollUpdateMessage {
            constructor(p?: IPollUpdateMessage);
            public pollCreationMessageKey?: (proto.IMessageKey|null);
            public vote?: (proto.IPollEncValue|null);
            public metadata?: (proto.IPollUpdateMessageMetadata|null);
            public senderTimestampMs?: (number|Long|null);
            public static create(properties?: IPollUpdateMessage): PollUpdateMessage;
            public static encode(m: IPollUpdateMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollUpdateMessage;
            public static fromObject(d: { [k: string]: any }): PollUpdateMessage;
            public static toObject(m: PollUpdateMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollUpdateMessageMetadata {
        }

        class PollUpdateMessageMetadata implements IPollUpdateMessageMetadata {
            constructor(p?: IPollUpdateMessageMetadata);
            public static create(properties?: IPollUpdateMessageMetadata): PollUpdateMessageMetadata;
            public static encode(m: IPollUpdateMessageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollUpdateMessageMetadata;
            public static fromObject(d: { [k: string]: any }): PollUpdateMessageMetadata;
            public static toObject(m: PollUpdateMessageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollVoteMessage {
            selectedOptions?: Uint8Array[];
        }

        class PollVoteMessage implements IPollVoteMessage {
            constructor(p?: IPollVoteMessage);
            public selectedOptions: Uint8Array[];
            public static create(properties?: IPollVoteMessage): PollVoteMessage;
            public static encode(m: IPollVoteMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollVoteMessage;
            public static fromObject(d: { [k: string]: any }): PollVoteMessage;
            public static toObject(m: PollVoteMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IProductMessage {
            product?: (proto.IProductSnapshot|null);
            businessOwnerJid?: (string|null);
            catalog?: (proto.ICatalogSnapshot|null);
            body?: (string|null);
            footer?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
        }

        class ProductMessage implements IProductMessage {
            constructor(p?: IProductMessage);
            public product?: (proto.IProductSnapshot|null);
            public businessOwnerJid?: (string|null);
            public catalog?: (proto.ICatalogSnapshot|null);
            public body?: (string|null);
            public footer?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IProductMessage): ProductMessage;
            public static encode(m: IProductMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProductMessage;
            public static fromObject(d: { [k: string]: any }): ProductMessage;
            public static toObject(m: ProductMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IProtocolMessage {
            key?: (proto.IMessageKey|null);
            type?: proto.ProtocolMessage.Type|null;
            ephemeralExpiration?: (number|null);
            ephemeralSettingTimestamp?: (number|Long|null);
            historySyncNotification?: (proto.IHistorySyncNotification|null);
            appStateSyncKeyShare?: (proto.IAppStateSyncKeyShare|null);
            appStateSyncKeyRequest?: (proto.IAppStateSyncKeyRequest|null);
            initialSecurityNotificationSettingSync?: (proto.IInitialSecurityNotificationSettingSync|null);
            appStateFatalExceptionNotification?: (proto.IAppStateFatalExceptionNotification|null);
            disappearingMode?: (proto.IDisappearingMode|null);
            editedMessage?: (proto.IMessage|null);
            timestampMs?: (number|Long|null);
            peerDataOperationRequestMessage?: (proto.IPeerDataOperationRequestMessage|null);
            peerDataOperationRequestResponseMessage?: (proto.IPeerDataOperationRequestResponseMessage|null);
            botFeedbackMessage?: (proto.IBotFeedbackMessage|null);
            invokerJid?: (string|null);
            requestWelcomeMessageMetadata?: (proto.IRequestWelcomeMessageMetadata|null);
            mediaNotifyMessage?: (proto.IMediaNotifyMessage|null);
            cloudApiThreadControlNotification?: (proto.ICloudApiThreadControlNotification|null);
            lidMigrationMappingSyncMessage?: (proto.ILidMigrationMappingSyncMessage|null);
            limitSharing?: (proto.ILimitSharing|null);
            aiPsiMetadata?: (Uint8Array|null);
            aiQueryFanout?: (proto.IAiQueryFanout|null);
            memberLabel?: (proto.IMemberLabel|null);
        }

        class ProtocolMessage implements IProtocolMessage {
            constructor(p?: IProtocolMessage);
            public key?: (proto.IMessageKey|null);
            public type?: proto.ProtocolMessage.Type|null;
            public ephemeralExpiration?: (number|null);
            public ephemeralSettingTimestamp?: (number|Long|null);
            public historySyncNotification?: (proto.IHistorySyncNotification|null);
            public appStateSyncKeyShare?: (proto.IAppStateSyncKeyShare|null);
            public appStateSyncKeyRequest?: (proto.IAppStateSyncKeyRequest|null);
            public initialSecurityNotificationSettingSync?: (proto.IInitialSecurityNotificationSettingSync|null);
            public appStateFatalExceptionNotification?: (proto.IAppStateFatalExceptionNotification|null);
            public disappearingMode?: (proto.IDisappearingMode|null);
            public editedMessage?: (proto.IMessage|null);
            public timestampMs?: (number|Long|null);
            public peerDataOperationRequestMessage?: (proto.IPeerDataOperationRequestMessage|null);
            public peerDataOperationRequestResponseMessage?: (proto.IPeerDataOperationRequestResponseMessage|null);
            public botFeedbackMessage?: (proto.IBotFeedbackMessage|null);
            public invokerJid?: (string|null);
            public requestWelcomeMessageMetadata?: (proto.IRequestWelcomeMessageMetadata|null);
            public mediaNotifyMessage?: (proto.IMediaNotifyMessage|null);
            public cloudApiThreadControlNotification?: (proto.ICloudApiThreadControlNotification|null);
            public lidMigrationMappingSyncMessage?: (proto.ILidMigrationMappingSyncMessage|null);
            public limitSharing?: (proto.ILimitSharing|null);
            public aiPsiMetadata?: (Uint8Array|null);
            public aiQueryFanout?: (proto.IAiQueryFanout|null);
            public memberLabel?: (proto.IMemberLabel|null);
            public static create(properties?: IProtocolMessage): ProtocolMessage;
            public static encode(m: IProtocolMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProtocolMessage;
            public static fromObject(d: { [k: string]: any }): ProtocolMessage;
            public static toObject(m: ProtocolMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IQuestionResponseMessage {
            key?: (proto.IMessageKey|null);
            text?: (string|null);
        }

        class QuestionResponseMessage implements IQuestionResponseMessage {
            constructor(p?: IQuestionResponseMessage);
            public key?: (proto.IMessageKey|null);
            public text?: (string|null);
            public static create(properties?: IQuestionResponseMessage): QuestionResponseMessage;
            public static encode(m: IQuestionResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): QuestionResponseMessage;
            public static fromObject(d: { [k: string]: any }): QuestionResponseMessage;
            public static toObject(m: QuestionResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IReactionMessage {
            key?: (proto.IMessageKey|null);
            text?: (string|null);
            groupingKey?: (string|null);
            senderTimestampMs?: (number|Long|null);
        }

        class ReactionMessage implements IReactionMessage {
            constructor(p?: IReactionMessage);
            public key?: (proto.IMessageKey|null);
            public text?: (string|null);
            public groupingKey?: (string|null);
            public senderTimestampMs?: (number|Long|null);
            public static create(properties?: IReactionMessage): ReactionMessage;
            public static encode(m: IReactionMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ReactionMessage;
            public static fromObject(d: { [k: string]: any }): ReactionMessage;
            public static toObject(m: ReactionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRequestPaymentMessage {
            noteMessage?: (proto.IMessage|null);
            currencyCodeIso4217?: (string|null);
            amount1000?: (number|Long|null);
            requestFrom?: (string|null);
            expiryTimestamp?: (number|Long|null);
            amount?: (proto.IMoney|null);
            background?: (proto.IPaymentBackground|null);
        }

        class RequestPaymentMessage implements IRequestPaymentMessage {
            constructor(p?: IRequestPaymentMessage);
            public noteMessage?: (proto.IMessage|null);
            public currencyCodeIso4217?: (string|null);
            public amount1000?: (number|Long|null);
            public requestFrom?: (string|null);
            public expiryTimestamp?: (number|Long|null);
            public amount?: (proto.IMoney|null);
            public background?: (proto.IPaymentBackground|null);
            public static create(properties?: IRequestPaymentMessage): RequestPaymentMessage;
            public static encode(m: IRequestPaymentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RequestPaymentMessage;
            public static fromObject(d: { [k: string]: any }): RequestPaymentMessage;
            public static toObject(m: RequestPaymentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRequestPhoneNumberMessage {
            contextInfo?: (proto.IContextInfo|null);
        }

        class RequestPhoneNumberMessage implements IRequestPhoneNumberMessage {
            constructor(p?: IRequestPhoneNumberMessage);
            public contextInfo?: (proto.IContextInfo|null);
            public static create(properties?: IRequestPhoneNumberMessage): RequestPhoneNumberMessage;
            public static encode(m: IRequestPhoneNumberMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RequestPhoneNumberMessage;
            public static fromObject(d: { [k: string]: any }): RequestPhoneNumberMessage;
            public static toObject(m: RequestPhoneNumberMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRequestWelcomeMessageMetadata {
            localChatState?: proto.RequestWelcomeMessageMetadata.LocalChatState|null;
        }

        class RequestWelcomeMessageMetadata implements IRequestWelcomeMessageMetadata {
            constructor(p?: IRequestWelcomeMessageMetadata);
            public localChatState?: proto.RequestWelcomeMessageMetadata.LocalChatState|null;
            public static create(properties?: IRequestWelcomeMessageMetadata): RequestWelcomeMessageMetadata;
            public static encode(m: IRequestWelcomeMessageMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RequestWelcomeMessageMetadata;
            public static fromObject(d: { [k: string]: any }): RequestWelcomeMessageMetadata;
            public static toObject(m: RequestWelcomeMessageMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IScheduledCallCreationMessage {
            scheduledTimestampMs?: (number|Long|null);
            callType?: proto.ScheduledCallCreationMessage.CallType|null;
            title?: (string|null);
        }

        class ScheduledCallCreationMessage implements IScheduledCallCreationMessage {
            constructor(p?: IScheduledCallCreationMessage);
            public scheduledTimestampMs?: (number|Long|null);
            public callType?: proto.ScheduledCallCreationMessage.CallType|null;
            public title?: (string|null);
            public static create(properties?: IScheduledCallCreationMessage): ScheduledCallCreationMessage;
            public static encode(m: IScheduledCallCreationMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ScheduledCallCreationMessage;
            public static fromObject(d: { [k: string]: any }): ScheduledCallCreationMessage;
            public static toObject(m: ScheduledCallCreationMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IScheduledCallEditMessage {
            key?: (proto.IMessageKey|null);
            editType?: proto.ScheduledCallEditMessage.EditType|null;
        }

        class ScheduledCallEditMessage implements IScheduledCallEditMessage {
            constructor(p?: IScheduledCallEditMessage);
            public key?: (proto.IMessageKey|null);
            public editType?: proto.ScheduledCallEditMessage.EditType|null;
            public static create(properties?: IScheduledCallEditMessage): ScheduledCallEditMessage;
            public static encode(m: IScheduledCallEditMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ScheduledCallEditMessage;
            public static fromObject(d: { [k: string]: any }): ScheduledCallEditMessage;
            public static toObject(m: ScheduledCallEditMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISecretEncryptedMessage {
            targetMessageKey?: (proto.IMessageKey|null);
            encPayload?: (Uint8Array|null);
            encIv?: (Uint8Array|null);
            secretEncType?: proto.SecretEncryptedMessage.SecretEncType|null;
        }

        class SecretEncryptedMessage implements ISecretEncryptedMessage {
            constructor(p?: ISecretEncryptedMessage);
            public targetMessageKey?: (proto.IMessageKey|null);
            public encPayload?: (Uint8Array|null);
            public encIv?: (Uint8Array|null);
            public secretEncType?: proto.SecretEncryptedMessage.SecretEncType|null;
            public static create(properties?: ISecretEncryptedMessage): SecretEncryptedMessage;
            public static encode(m: ISecretEncryptedMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SecretEncryptedMessage;
            public static fromObject(d: { [k: string]: any }): SecretEncryptedMessage;
            public static toObject(m: SecretEncryptedMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISendPaymentMessage {
            noteMessage?: (proto.IMessage|null);
            requestMessageKey?: (proto.IMessageKey|null);
            background?: (proto.IPaymentBackground|null);
            transactionData?: (string|null);
        }

        class SendPaymentMessage implements ISendPaymentMessage {
            constructor(p?: ISendPaymentMessage);
            public noteMessage?: (proto.IMessage|null);
            public requestMessageKey?: (proto.IMessageKey|null);
            public background?: (proto.IPaymentBackground|null);
            public transactionData?: (string|null);
            public static create(properties?: ISendPaymentMessage): SendPaymentMessage;
            public static encode(m: ISendPaymentMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SendPaymentMessage;
            public static fromObject(d: { [k: string]: any }): SendPaymentMessage;
            public static toObject(m: SendPaymentMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISenderKeyDistributionMessage {
            groupId?: (string|null);
            axolotlSenderKeyDistributionMessage?: (Uint8Array|null);
        }

        class SenderKeyDistributionMessage implements ISenderKeyDistributionMessage {
            constructor(p?: ISenderKeyDistributionMessage);
            public groupId?: (string|null);
            public axolotlSenderKeyDistributionMessage?: (Uint8Array|null);
            public static create(properties?: ISenderKeyDistributionMessage): SenderKeyDistributionMessage;
            public static encode(m: ISenderKeyDistributionMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderKeyDistributionMessage;
            public static fromObject(d: { [k: string]: any }): SenderKeyDistributionMessage;
            public static toObject(m: SenderKeyDistributionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusNotificationMessage {
            responseMessageKey?: (proto.IMessageKey|null);
            originalMessageKey?: (proto.IMessageKey|null);
            type?: proto.StatusNotificationMessage.StatusNotificationType|null;
        }

        class StatusNotificationMessage implements IStatusNotificationMessage {
            constructor(p?: IStatusNotificationMessage);
            public responseMessageKey?: (proto.IMessageKey|null);
            public originalMessageKey?: (proto.IMessageKey|null);
            public type?: proto.StatusNotificationMessage.StatusNotificationType|null;
            public static create(properties?: IStatusNotificationMessage): StatusNotificationMessage;
            public static encode(m: IStatusNotificationMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusNotificationMessage;
            public static fromObject(d: { [k: string]: any }): StatusNotificationMessage;
            public static toObject(m: StatusNotificationMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusQuestionAnswerMessage {
            key?: (proto.IMessageKey|null);
            text?: (string|null);
        }

        class StatusQuestionAnswerMessage implements IStatusQuestionAnswerMessage {
            constructor(p?: IStatusQuestionAnswerMessage);
            public key?: (proto.IMessageKey|null);
            public text?: (string|null);
            public static create(properties?: IStatusQuestionAnswerMessage): StatusQuestionAnswerMessage;
            public static encode(m: IStatusQuestionAnswerMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusQuestionAnswerMessage;
            public static fromObject(d: { [k: string]: any }): StatusQuestionAnswerMessage;
            public static toObject(m: StatusQuestionAnswerMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusQuotedMessage {
            type?: proto.StatusQuotedMessage.StatusQuotedMessageType|null;
            text?: (string|null);
            thumbnail?: (Uint8Array|null);
            originalStatusId?: (proto.IMessageKey|null);
        }

        class StatusQuotedMessage implements IStatusQuotedMessage {
            constructor(p?: IStatusQuotedMessage);
            public type?: proto.StatusQuotedMessage.StatusQuotedMessageType|null;
            public text?: (string|null);
            public thumbnail?: (Uint8Array|null);
            public originalStatusId?: (proto.IMessageKey|null);
            public static create(properties?: IStatusQuotedMessage): StatusQuotedMessage;
            public static encode(m: IStatusQuotedMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusQuotedMessage;
            public static fromObject(d: { [k: string]: any }): StatusQuotedMessage;
            public static toObject(m: StatusQuotedMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusStickerInteractionMessage {
            key?: (proto.IMessageKey|null);
            stickerKey?: (string|null);
            type?: proto.StatusStickerInteractionMessage.StatusStickerType|null;
        }

        class StatusStickerInteractionMessage implements IStatusStickerInteractionMessage {
            constructor(p?: IStatusStickerInteractionMessage);
            public key?: (proto.IMessageKey|null);
            public stickerKey?: (string|null);
            public type?: proto.StatusStickerInteractionMessage.StatusStickerType|null;
            public static create(properties?: IStatusStickerInteractionMessage): StatusStickerInteractionMessage;
            public static encode(m: IStatusStickerInteractionMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusStickerInteractionMessage;
            public static fromObject(d: { [k: string]: any }): StatusStickerInteractionMessage;
            public static toObject(m: StatusStickerInteractionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStickerMessage {
            url?: (string|null);
            fileSha256?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            mimetype?: (string|null);
            height?: (number|null);
            width?: (number|null);
            directPath?: (string|null);
            fileLength?: (number|Long|null);
            mediaKeyTimestamp?: (number|Long|null);
            firstFrameLength?: (number|null);
            firstFrameSidecar?: (Uint8Array|null);
            isAnimated?: (boolean|null);
            pngThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            stickerSentTs?: (number|Long|null);
            isAvatar?: (boolean|null);
            isAiSticker?: (boolean|null);
            isLottie?: (boolean|null);
            accessibilityLabel?: (string|null);
            mediaKeyDomain?: proto.MediaKeyDomain|null;
        }

        class StickerMessage implements IStickerMessage {
            constructor(p?: IStickerMessage);
            public url?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public mimetype?: (string|null);
            public height?: (number|null);
            public width?: (number|null);
            public directPath?: (string|null);
            public fileLength?: (number|Long|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public firstFrameLength?: (number|null);
            public firstFrameSidecar?: (Uint8Array|null);
            public isAnimated?: (boolean|null);
            public pngThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public stickerSentTs?: (number|Long|null);
            public isAvatar?: (boolean|null);
            public isAiSticker?: (boolean|null);
            public isLottie?: (boolean|null);
            public accessibilityLabel?: (string|null);
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public static create(properties?: IStickerMessage): StickerMessage;
            public static encode(m: IStickerMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StickerMessage;
            public static fromObject(d: { [k: string]: any }): StickerMessage;
            public static toObject(m: StickerMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStickerPackMessage {
            stickerPackId?: (string|null);
            name?: (string|null);
            publisher?: (string|null);
            stickers?: proto.ISticker[];
            fileLength?: (number|Long|null);
            fileSha256?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            directPath?: (string|null);
            caption?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            packDescription?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            trayIconFileName?: (string|null);
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            thumbnailHeight?: (number|null);
            thumbnailWidth?: (number|null);
            imageDataHash?: (string|null);
            stickerPackSize?: (number|Long|null);
            stickerPackOrigin?: proto.StickerPackMessage.StickerPackOrigin|null;
        }

        class StickerPackMessage implements IStickerPackMessage {
            constructor(p?: IStickerPackMessage);
            public stickerPackId?: (string|null);
            public name?: (string|null);
            public publisher?: (string|null);
            public stickers: proto.ISticker[];
            public fileLength?: (number|Long|null);
            public fileSha256?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public directPath?: (string|null);
            public caption?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public packDescription?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public trayIconFileName?: (string|null);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public thumbnailHeight?: (number|null);
            public thumbnailWidth?: (number|null);
            public imageDataHash?: (string|null);
            public stickerPackSize?: (number|Long|null);
            public stickerPackOrigin?: proto.StickerPackMessage.StickerPackOrigin|null;
            public static create(properties?: IStickerPackMessage): StickerPackMessage;
            public static encode(m: IStickerPackMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StickerPackMessage;
            public static fromObject(d: { [k: string]: any }): StickerPackMessage;
            public static toObject(m: StickerPackMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStickerSyncRmrMessage {
            filehash?: string[];
            rmrSource?: (string|null);
            requestTimestamp?: (number|Long|null);
        }

        class StickerSyncRmrMessage implements IStickerSyncRmrMessage {
            constructor(p?: IStickerSyncRmrMessage);
            public filehash: string[];
            public rmrSource?: (string|null);
            public requestTimestamp?: (number|Long|null);
            public static create(properties?: IStickerSyncRmrMessage): StickerSyncRmrMessage;
            public static encode(m: IStickerSyncRmrMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StickerSyncRmrMessage;
            public static fromObject(d: { [k: string]: any }): StickerSyncRmrMessage;
            public static toObject(m: StickerSyncRmrMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ITemplateButtonReplyMessage {
            selectedId?: (string|null);
            selectedDisplayText?: (string|null);
            contextInfo?: (proto.IContextInfo|null);
            selectedIndex?: (number|null);
            selectedCarouselCardIndex?: (number|null);
        }

        class TemplateButtonReplyMessage implements ITemplateButtonReplyMessage {
            constructor(p?: ITemplateButtonReplyMessage);
            public selectedId?: (string|null);
            public selectedDisplayText?: (string|null);
            public contextInfo?: (proto.IContextInfo|null);
            public selectedIndex?: (number|null);
            public selectedCarouselCardIndex?: (number|null);
            public static create(properties?: ITemplateButtonReplyMessage): TemplateButtonReplyMessage;
            public static encode(m: ITemplateButtonReplyMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TemplateButtonReplyMessage;
            public static fromObject(d: { [k: string]: any }): TemplateButtonReplyMessage;
            public static toObject(m: TemplateButtonReplyMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ITemplateMessage {
            contextInfo?: (proto.IContextInfo|null);
            hydratedTemplate?: (proto.IHydratedFourRowTemplate|null);
            templateId?: (string|null);
            fourRowTemplate?: (proto.IFourRowTemplate|null);
            hydratedFourRowTemplate?: (proto.IHydratedFourRowTemplate|null);
            interactiveMessageTemplate?: (proto.IInteractiveMessage|null);
            /** Prost oneof field */
            format?: {
                fourRowTemplate?: (proto.IFourRowTemplate|null);
                hydratedFourRowTemplate?: (proto.IHydratedFourRowTemplate|null);
                interactiveMessageTemplate?: (proto.IInteractiveMessage|null);
            } | null;
        }

        class TemplateMessage implements ITemplateMessage {
            constructor(p?: ITemplateMessage);
            public contextInfo?: (proto.IContextInfo|null);
            public hydratedTemplate?: (proto.IHydratedFourRowTemplate|null);
            public templateId?: (string|null);
            public fourRowTemplate?: (proto.IFourRowTemplate|null);
            public hydratedFourRowTemplate?: (proto.IHydratedFourRowTemplate|null);
            public interactiveMessageTemplate?: (proto.IInteractiveMessage|null);
            public format?: ("fourRowTemplate"|"hydratedFourRowTemplate"|"interactiveMessageTemplate");
            public static create(properties?: ITemplateMessage): TemplateMessage;
            public static encode(m: ITemplateMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TemplateMessage;
            public static fromObject(d: { [k: string]: any }): TemplateMessage;
            public static toObject(m: TemplateMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUrlMetadata {
            fbExperimentId?: (number|null);
        }

        class UrlMetadata implements IUrlMetadata {
            constructor(p?: IUrlMetadata);
            public fbExperimentId?: (number|null);
            public static create(properties?: IUrlMetadata): UrlMetadata;
            public static encode(m: IUrlMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UrlMetadata;
            public static fromObject(d: { [k: string]: any }): UrlMetadata;
            public static toObject(m: UrlMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IVideoEndCard {
            username?: string;
            caption?: string;
            thumbnailImageUrl?: string;
            profilePictureUrl?: string;
        }

        class VideoEndCard implements IVideoEndCard {
            constructor(p?: IVideoEndCard);
            public username: string;
            public caption: string;
            public thumbnailImageUrl: string;
            public profilePictureUrl: string;
            public static create(properties?: IVideoEndCard): VideoEndCard;
            public static encode(m: IVideoEndCard, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): VideoEndCard;
            public static fromObject(d: { [k: string]: any }): VideoEndCard;
            public static toObject(m: VideoEndCard, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IVideoMessage {
            url?: (string|null);
            mimetype?: (string|null);
            fileSha256?: (Uint8Array|null);
            fileLength?: (number|Long|null);
            seconds?: (number|null);
            mediaKey?: (Uint8Array|null);
            caption?: (string|null);
            gifPlayback?: (boolean|null);
            height?: (number|null);
            width?: (number|null);
            fileEncSha256?: (Uint8Array|null);
            interactiveAnnotations?: proto.IInteractiveAnnotation[];
            directPath?: (string|null);
            mediaKeyTimestamp?: (number|Long|null);
            jpegThumbnail?: (Uint8Array|null);
            contextInfo?: (proto.IContextInfo|null);
            streamingSidecar?: (Uint8Array|null);
            gifAttribution?: proto.VideoMessage.Attribution|null;
            viewOnce?: (boolean|null);
            thumbnailDirectPath?: (string|null);
            thumbnailSha256?: (Uint8Array|null);
            thumbnailEncSha256?: (Uint8Array|null);
            staticUrl?: (string|null);
            annotations?: proto.IInteractiveAnnotation[];
            accessibilityLabel?: (string|null);
            processedVideos?: proto.IProcessedVideo[];
            externalShareFullVideoDurationInSeconds?: (number|null);
            motionPhotoPresentationOffsetMs?: (number|Long|null);
            metadataUrl?: (string|null);
            videoSourceType?: proto.VideoMessage.VideoSourceType|null;
            mediaKeyDomain?: proto.MediaKeyDomain|null;
        }

        class VideoMessage implements IVideoMessage {
            constructor(p?: IVideoMessage);
            public url?: (string|null);
            public mimetype?: (string|null);
            public fileSha256?: (Uint8Array|null);
            public fileLength?: (number|Long|null);
            public seconds?: (number|null);
            public mediaKey?: (Uint8Array|null);
            public caption?: (string|null);
            public gifPlayback?: (boolean|null);
            public height?: (number|null);
            public width?: (number|null);
            public fileEncSha256?: (Uint8Array|null);
            public interactiveAnnotations: proto.IInteractiveAnnotation[];
            public directPath?: (string|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public jpegThumbnail?: (Uint8Array|null);
            public contextInfo?: (proto.IContextInfo|null);
            public streamingSidecar?: (Uint8Array|null);
            public gifAttribution?: proto.VideoMessage.Attribution|null;
            public viewOnce?: (boolean|null);
            public thumbnailDirectPath?: (string|null);
            public thumbnailSha256?: (Uint8Array|null);
            public thumbnailEncSha256?: (Uint8Array|null);
            public staticUrl?: (string|null);
            public annotations: proto.IInteractiveAnnotation[];
            public accessibilityLabel?: (string|null);
            public processedVideos: proto.IProcessedVideo[];
            public externalShareFullVideoDurationInSeconds?: (number|null);
            public motionPhotoPresentationOffsetMs?: (number|Long|null);
            public metadataUrl?: (string|null);
            public videoSourceType?: proto.VideoMessage.VideoSourceType|null;
            public mediaKeyDomain?: proto.MediaKeyDomain|null;
            public static create(properties?: IVideoMessage): VideoMessage;
            public static encode(m: IVideoMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): VideoMessage;
            public static fromObject(d: { [k: string]: any }): VideoMessage;
            public static toObject(m: VideoMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace BCallMessage {

            enum MediaType {
                UNKNOWN = 0,
                AUDIO = 1,
                VIDEO = 2,
            }
        }

        namespace ButtonsMessage {

            enum HeaderType {
                UNKNOWN = 0,
                EMPTY = 1,
                TEXT = 2,
                DOCUMENT = 3,
                IMAGE = 4,
                VIDEO = 5,
                LOCATION = 6,
            }

            interface IButton {
                buttonId?: (string|null);
                buttonText?: (proto.IButtonText|null);
                type?: proto.Button.Type|null;
                nativeFlowInfo?: (proto.INativeFlowInfo|null);
            }

            class Button implements IButton {
                constructor(p?: IButton);
                public buttonId?: (string|null);
                public buttonText?: (proto.IButtonText|null);
                public type?: proto.Button.Type|null;
                public nativeFlowInfo?: (proto.INativeFlowInfo|null);
                public static create(properties?: IButton): Button;
                public static encode(m: IButton, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Button;
                public static fromObject(d: { [k: string]: any }): Button;
                public static toObject(m: Button, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace Button {

                enum Type {
                    UNKNOWN = 0,
                    RESPONSE = 1,
                    NATIVE_FLOW = 2,
                }

                interface IButtonText {
                    displayText?: (string|null);
                }

                class ButtonText implements IButtonText {
                    constructor(p?: IButtonText);
                    public displayText?: (string|null);
                    public static create(properties?: IButtonText): ButtonText;
                    public static encode(m: IButtonText, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ButtonText;
                    public static fromObject(d: { [k: string]: any }): ButtonText;
                    public static toObject(m: ButtonText, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface INativeFlowInfo {
                    name?: (string|null);
                    paramsJson?: (string|null);
                }

                class NativeFlowInfo implements INativeFlowInfo {
                    constructor(p?: INativeFlowInfo);
                    public name?: (string|null);
                    public paramsJson?: (string|null);
                    public static create(properties?: INativeFlowInfo): NativeFlowInfo;
                    public static encode(m: INativeFlowInfo, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NativeFlowInfo;
                    public static fromObject(d: { [k: string]: any }): NativeFlowInfo;
                    public static toObject(m: NativeFlowInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }
            }
        }

        namespace ButtonsResponseMessage {

            enum Type {
                UNKNOWN = 0,
                DISPLAY_TEXT = 1,
            }
        }

        namespace CallLogMessage {

            enum CallOutcome {
                CONNECTED = 0,
                MISSED = 1,
                FAILED = 2,
                REJECTED = 3,
                ACCEPTED_ELSEWHERE = 4,
                ONGOING = 5,
                SILENCED_BY_DND = 6,
                SILENCED_UNKNOWN_CALLER = 7,
            }

            enum CallType {
                REGULAR = 0,
                SCHEDULED_CALL = 1,
                VOICE_CHAT = 2,
            }

            interface ICallParticipant {
                jid?: (string|null);
                callOutcome?: proto.CallOutcome|null;
            }

            class CallParticipant implements ICallParticipant {
                constructor(p?: ICallParticipant);
                public jid?: (string|null);
                public callOutcome?: proto.CallOutcome|null;
                public static create(properties?: ICallParticipant): CallParticipant;
                public static encode(m: ICallParticipant, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CallParticipant;
                public static fromObject(d: { [k: string]: any }): CallParticipant;
                public static toObject(m: CallParticipant, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace CloudApiThreadControlNotification {

            enum CloudApiThreadControl {
                UNKNOWN = 0,
                CONTROL_PASSED = 1,
                CONTROL_TAKEN = 2,
            }

            interface ICloudApiThreadControlNotificationContent {
                handoffNotificationText?: (string|null);
                extraJson?: (string|null);
            }

            class CloudApiThreadControlNotificationContent implements ICloudApiThreadControlNotificationContent {
                constructor(p?: ICloudApiThreadControlNotificationContent);
                public handoffNotificationText?: (string|null);
                public extraJson?: (string|null);
                public static create(properties?: ICloudApiThreadControlNotificationContent): CloudApiThreadControlNotificationContent;
                public static encode(m: ICloudApiThreadControlNotificationContent, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CloudApiThreadControlNotificationContent;
                public static fromObject(d: { [k: string]: any }): CloudApiThreadControlNotificationContent;
                public static toObject(m: CloudApiThreadControlNotificationContent, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace EventResponseMessage {

            enum EventResponseType {
                UNKNOWN = 0,
                GOING = 1,
                NOT_GOING = 2,
                MAYBE = 3,
            }
        }

        namespace ExtendedTextMessage {

            enum FontType {
                SYSTEM = 0,
                SYSTEM_TEXT = 1,
                FB_SCRIPT = 2,
                SYSTEM_BOLD = 6,
                MORNINGBREEZE_REGULAR = 7,
                CALISTOGA_REGULAR = 8,
                EXO2_EXTRABOLD = 9,
                COURIERPRIME_BOLD = 10,
            }

            enum InviteLinkGroupType {
                DEFAULT = 0,
                PARENT = 1,
                SUB = 2,
                DEFAULT_SUB = 3,
            }

            enum PreviewType {
                NONE = 0,
                VIDEO = 1,
                PLACEHOLDER = 4,
                IMAGE = 5,
                PAYMENT_LINKS = 6,
                PROFILE = 7,
            }
        }

        namespace GroupInviteMessage {

            enum GroupType {
                DEFAULT = 0,
                PARENT = 1,
            }
        }

        namespace HighlyStructuredMessage {

            interface IHsmLocalizableParameter {
                default?: (string|null);
                currency?: (proto.IHsmCurrency|null);
                dateTime?: (proto.IHsmDateTime|null);
                /** Prost oneof field */
                paramOneof?: {
                    currency?: (proto.IHsmCurrency|null);
                    dateTime?: (proto.IHsmDateTime|null);
                } | null;
            }

            class HsmLocalizableParameter implements IHsmLocalizableParameter {
                constructor(p?: IHsmLocalizableParameter);
                public default?: (string|null);
                public currency?: (proto.IHsmCurrency|null);
                public dateTime?: (proto.IHsmDateTime|null);
                public paramOneof?: ("currency"|"dateTime");
                public static create(properties?: IHsmLocalizableParameter): HsmLocalizableParameter;
                public static encode(m: IHsmLocalizableParameter, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HsmLocalizableParameter;
                public static fromObject(d: { [k: string]: any }): HsmLocalizableParameter;
                public static toObject(m: HsmLocalizableParameter, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace HsmLocalizableParameter {

                interface IHsmCurrency {
                    currencyCode?: (string|null);
                    amount1000?: (number|Long|null);
                }

                class HsmCurrency implements IHsmCurrency {
                    constructor(p?: IHsmCurrency);
                    public currencyCode?: (string|null);
                    public amount1000?: (number|Long|null);
                    public static create(properties?: IHsmCurrency): HsmCurrency;
                    public static encode(m: IHsmCurrency, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HsmCurrency;
                    public static fromObject(d: { [k: string]: any }): HsmCurrency;
                    public static toObject(m: HsmCurrency, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface IHsmDateTime {
                    component?: (proto.IHsmDateTimeComponent|null);
                    unixEpoch?: (proto.IHsmDateTimeUnixEpoch|null);
                    /** Prost oneof field */
                    datetimeOneof?: {
                        component?: (proto.IHsmDateTimeComponent|null);
                        unixEpoch?: (proto.IHsmDateTimeUnixEpoch|null);
                    } | null;
                }

                class HsmDateTime implements IHsmDateTime {
                    constructor(p?: IHsmDateTime);
                    public component?: (proto.IHsmDateTimeComponent|null);
                    public unixEpoch?: (proto.IHsmDateTimeUnixEpoch|null);
                    public datetimeOneof?: ("component"|"unixEpoch");
                    public static create(properties?: IHsmDateTime): HsmDateTime;
                    public static encode(m: IHsmDateTime, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HsmDateTime;
                    public static fromObject(d: { [k: string]: any }): HsmDateTime;
                    public static toObject(m: HsmDateTime, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                namespace HsmDateTime {

                    interface IHsmDateTimeComponent {
                        dayOfWeek?: proto.HsmDateTimeComponent.DayOfWeekType|null;
                        year?: (number|null);
                        month?: (number|null);
                        dayOfMonth?: (number|null);
                        hour?: (number|null);
                        minute?: (number|null);
                        calendar?: proto.HsmDateTimeComponent.CalendarType|null;
                    }

                    class HsmDateTimeComponent implements IHsmDateTimeComponent {
                        constructor(p?: IHsmDateTimeComponent);
                        public dayOfWeek?: proto.HsmDateTimeComponent.DayOfWeekType|null;
                        public year?: (number|null);
                        public month?: (number|null);
                        public dayOfMonth?: (number|null);
                        public hour?: (number|null);
                        public minute?: (number|null);
                        public calendar?: proto.HsmDateTimeComponent.CalendarType|null;
                        public static create(properties?: IHsmDateTimeComponent): HsmDateTimeComponent;
                        public static encode(m: IHsmDateTimeComponent, w?: $protobuf.Writer): $protobuf.Writer;
                        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HsmDateTimeComponent;
                        public static fromObject(d: { [k: string]: any }): HsmDateTimeComponent;
                        public static toObject(m: HsmDateTimeComponent, o?: $protobuf.IConversionOptions): { [k: string]: any };
                        public toJSON(): { [k: string]: any };
                    }

                    interface IHsmDateTimeUnixEpoch {
                        timestamp?: (number|Long|null);
                    }

                    class HsmDateTimeUnixEpoch implements IHsmDateTimeUnixEpoch {
                        constructor(p?: IHsmDateTimeUnixEpoch);
                        public timestamp?: (number|Long|null);
                        public static create(properties?: IHsmDateTimeUnixEpoch): HsmDateTimeUnixEpoch;
                        public static encode(m: IHsmDateTimeUnixEpoch, w?: $protobuf.Writer): $protobuf.Writer;
                        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HsmDateTimeUnixEpoch;
                        public static fromObject(d: { [k: string]: any }): HsmDateTimeUnixEpoch;
                        public static toObject(m: HsmDateTimeUnixEpoch, o?: $protobuf.IConversionOptions): { [k: string]: any };
                        public toJSON(): { [k: string]: any };
                    }

                    namespace HsmDateTimeComponent {

                        enum CalendarType {
                            GREGORIAN = 1,
                            SOLAR_HIJRI = 2,
                        }

                        enum DayOfWeekType {
                            MONDAY = 1,
                            TUESDAY = 2,
                            WEDNESDAY = 3,
                            THURSDAY = 4,
                            FRIDAY = 5,
                            SATURDAY = 6,
                            SUNDAY = 7,
                        }
                    }
                }
            }
        }

        namespace ImageMessage {

            enum ImageSourceType {
                USER_IMAGE = 0,
                AI_GENERATED = 1,
                AI_MODIFIED = 2,
                RASTERIZED_TEXT_STATUS = 3,
            }
        }

        namespace InteractiveMessage {

            interface IBody {
                text?: (string|null);
            }

            class Body implements IBody {
                constructor(p?: IBody);
                public text?: (string|null);
                public static create(properties?: IBody): Body;
                public static encode(m: IBody, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Body;
                public static fromObject(d: { [k: string]: any }): Body;
                public static toObject(m: Body, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ICarouselMessage {
                cards?: proto.IInteractiveMessage[];
                messageVersion?: (number|null);
                carouselCardType?: proto.CarouselMessage.CarouselCardType|null;
            }

            class CarouselMessage implements ICarouselMessage {
                constructor(p?: ICarouselMessage);
                public cards: proto.IInteractiveMessage[];
                public messageVersion?: (number|null);
                public carouselCardType?: proto.CarouselMessage.CarouselCardType|null;
                public static create(properties?: ICarouselMessage): CarouselMessage;
                public static encode(m: ICarouselMessage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CarouselMessage;
                public static fromObject(d: { [k: string]: any }): CarouselMessage;
                public static toObject(m: CarouselMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ICollectionMessage {
                bizJid?: (string|null);
                id?: (string|null);
                messageVersion?: (number|null);
            }

            class CollectionMessage implements ICollectionMessage {
                constructor(p?: ICollectionMessage);
                public bizJid?: (string|null);
                public id?: (string|null);
                public messageVersion?: (number|null);
                public static create(properties?: ICollectionMessage): CollectionMessage;
                public static encode(m: ICollectionMessage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CollectionMessage;
                public static fromObject(d: { [k: string]: any }): CollectionMessage;
                public static toObject(m: CollectionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IFooter {
                text?: (string|null);
                hasMediaAttachment?: (boolean|null);
                audioMessage?: (proto.IAudioMessage|null);
                /** Prost oneof field */
                media?: {
                    audioMessage?: (proto.IAudioMessage|null);
                } | null;
            }

            class Footer implements IFooter {
                constructor(p?: IFooter);
                public text?: (string|null);
                public hasMediaAttachment?: (boolean|null);
                public audioMessage?: (proto.IAudioMessage|null);
                public media?: ("audioMessage");
                public static create(properties?: IFooter): Footer;
                public static encode(m: IFooter, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Footer;
                public static fromObject(d: { [k: string]: any }): Footer;
                public static toObject(m: Footer, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IHeader {
                title?: (string|null);
                subtitle?: (string|null);
                hasMediaAttachment?: (boolean|null);
                documentMessage?: (proto.IDocumentMessage|null);
                imageMessage?: (proto.IImageMessage|null);
                jpegThumbnail?: (Uint8Array|null);
                videoMessage?: (proto.IVideoMessage|null);
                locationMessage?: (proto.ILocationMessage|null);
                productMessage?: (proto.IProductMessage|null);
                /** Prost oneof field */
                media?: {
                    documentMessage?: (proto.IDocumentMessage|null);
                    imageMessage?: (proto.IImageMessage|null);
                    jpegThumbnail?: (Uint8Array|null);
                    videoMessage?: (proto.IVideoMessage|null);
                    locationMessage?: (proto.ILocationMessage|null);
                    productMessage?: (proto.IProductMessage|null);
                } | null;
            }

            class Header implements IHeader {
                constructor(p?: IHeader);
                public title?: (string|null);
                public subtitle?: (string|null);
                public hasMediaAttachment?: (boolean|null);
                public documentMessage?: (proto.IDocumentMessage|null);
                public imageMessage?: (proto.IImageMessage|null);
                public jpegThumbnail?: (Uint8Array|null);
                public videoMessage?: (proto.IVideoMessage|null);
                public locationMessage?: (proto.ILocationMessage|null);
                public productMessage?: (proto.IProductMessage|null);
                public media?: ("documentMessage"|"imageMessage"|"jpegThumbnail"|"videoMessage"|"locationMessage"|"productMessage");
                public static create(properties?: IHeader): Header;
                public static encode(m: IHeader, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Header;
                public static fromObject(d: { [k: string]: any }): Header;
                public static toObject(m: Header, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface INativeFlowMessage {
                buttons?: proto.INativeFlowButton[];
                messageParamsJson?: (string|null);
                messageVersion?: (number|null);
            }

            class NativeFlowMessage implements INativeFlowMessage {
                constructor(p?: INativeFlowMessage);
                public buttons: proto.INativeFlowButton[];
                public messageParamsJson?: (string|null);
                public messageVersion?: (number|null);
                public static create(properties?: INativeFlowMessage): NativeFlowMessage;
                public static encode(m: INativeFlowMessage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NativeFlowMessage;
                public static fromObject(d: { [k: string]: any }): NativeFlowMessage;
                public static toObject(m: NativeFlowMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IShopMessage {
                id?: (string|null);
                surface?: proto.ShopMessage.Surface|null;
                messageVersion?: (number|null);
            }

            class ShopMessage implements IShopMessage {
                constructor(p?: IShopMessage);
                public id?: (string|null);
                public surface?: proto.ShopMessage.Surface|null;
                public messageVersion?: (number|null);
                public static create(properties?: IShopMessage): ShopMessage;
                public static encode(m: IShopMessage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ShopMessage;
                public static fromObject(d: { [k: string]: any }): ShopMessage;
                public static toObject(m: ShopMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace CarouselMessage {

                enum CarouselCardType {
                    UNKNOWN = 0,
                    HSCROLL_CARDS = 1,
                    ALBUM_IMAGE = 2,
                }
            }

            namespace NativeFlowMessage {

                interface INativeFlowButton {
                    name?: (string|null);
                    buttonParamsJson?: (string|null);
                }

                class NativeFlowButton implements INativeFlowButton {
                    constructor(p?: INativeFlowButton);
                    public name?: (string|null);
                    public buttonParamsJson?: (string|null);
                    public static create(properties?: INativeFlowButton): NativeFlowButton;
                    public static encode(m: INativeFlowButton, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NativeFlowButton;
                    public static fromObject(d: { [k: string]: any }): NativeFlowButton;
                    public static toObject(m: NativeFlowButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }
            }

            namespace ShopMessage {

                enum Surface {
                    UNKNOWN_SURFACE = 0,
                    FB = 1,
                    IG = 2,
                    WA = 3,
                }
            }
        }

        namespace InteractiveResponseMessage {

            interface IBody {
                text?: (string|null);
                format?: proto.Body.Format|null;
            }

            class Body implements IBody {
                constructor(p?: IBody);
                public text?: (string|null);
                public format?: proto.Body.Format|null;
                public static create(properties?: IBody): Body;
                public static encode(m: IBody, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Body;
                public static fromObject(d: { [k: string]: any }): Body;
                public static toObject(m: Body, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface INativeFlowResponseMessage {
                name?: (string|null);
                paramsJson?: (string|null);
                version?: (number|null);
            }

            class NativeFlowResponseMessage implements INativeFlowResponseMessage {
                constructor(p?: INativeFlowResponseMessage);
                public name?: (string|null);
                public paramsJson?: (string|null);
                public version?: (number|null);
                public static create(properties?: INativeFlowResponseMessage): NativeFlowResponseMessage;
                public static encode(m: INativeFlowResponseMessage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NativeFlowResponseMessage;
                public static fromObject(d: { [k: string]: any }): NativeFlowResponseMessage;
                public static toObject(m: NativeFlowResponseMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace Body {

                enum Format {
                    DEFAULT = 0,
                    EXTENSIONS1 = 1,
                }
            }
        }

        namespace InvoiceMessage {

            enum AttachmentType {
                IMAGE = 0,
                PDF = 1,
            }
        }

        namespace LinkPreviewMetadata {

            enum SocialMediaPostType {
                NONE = 0,
                REEL = 1,
                LIVE_VIDEO = 2,
                LONG_VIDEO = 3,
                SINGLE_IMAGE = 4,
                CAROUSEL = 5,
            }
        }

        namespace ListMessage {

            enum ListType {
                UNKNOWN = 0,
                SINGLE_SELECT = 1,
                PRODUCT_LIST = 2,
            }

            interface IProduct {
                productId?: (string|null);
            }

            class Product implements IProduct {
                constructor(p?: IProduct);
                public productId?: (string|null);
                public static create(properties?: IProduct): Product;
                public static encode(m: IProduct, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Product;
                public static fromObject(d: { [k: string]: any }): Product;
                public static toObject(m: Product, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IProductListHeaderImage {
                productId?: (string|null);
                jpegThumbnail?: (Uint8Array|null);
            }

            class ProductListHeaderImage implements IProductListHeaderImage {
                constructor(p?: IProductListHeaderImage);
                public productId?: (string|null);
                public jpegThumbnail?: (Uint8Array|null);
                public static create(properties?: IProductListHeaderImage): ProductListHeaderImage;
                public static encode(m: IProductListHeaderImage, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProductListHeaderImage;
                public static fromObject(d: { [k: string]: any }): ProductListHeaderImage;
                public static toObject(m: ProductListHeaderImage, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IProductListInfo {
                productSections?: proto.IProductSection[];
                headerImage?: (proto.IProductListHeaderImage|null);
                businessOwnerJid?: (string|null);
            }

            class ProductListInfo implements IProductListInfo {
                constructor(p?: IProductListInfo);
                public productSections: proto.IProductSection[];
                public headerImage?: (proto.IProductListHeaderImage|null);
                public businessOwnerJid?: (string|null);
                public static create(properties?: IProductListInfo): ProductListInfo;
                public static encode(m: IProductListInfo, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProductListInfo;
                public static fromObject(d: { [k: string]: any }): ProductListInfo;
                public static toObject(m: ProductListInfo, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IProductSection {
                title?: (string|null);
                products?: proto.IProduct[];
            }

            class ProductSection implements IProductSection {
                constructor(p?: IProductSection);
                public title?: (string|null);
                public products: proto.IProduct[];
                public static create(properties?: IProductSection): ProductSection;
                public static encode(m: IProductSection, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProductSection;
                public static fromObject(d: { [k: string]: any }): ProductSection;
                public static toObject(m: ProductSection, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IRow {
                title?: (string|null);
                description?: (string|null);
                rowId?: (string|null);
            }

            class Row implements IRow {
                constructor(p?: IRow);
                public title?: (string|null);
                public description?: (string|null);
                public rowId?: (string|null);
                public static create(properties?: IRow): Row;
                public static encode(m: IRow, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Row;
                public static fromObject(d: { [k: string]: any }): Row;
                public static toObject(m: Row, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ISection {
                title?: (string|null);
                rows?: proto.IRow[];
            }

            class Section implements ISection {
                constructor(p?: ISection);
                public title?: (string|null);
                public rows: proto.IRow[];
                public static create(properties?: ISection): Section;
                public static encode(m: ISection, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Section;
                public static fromObject(d: { [k: string]: any }): Section;
                public static toObject(m: Section, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace ListResponseMessage {

            enum ListType {
                UNKNOWN = 0,
                SINGLE_SELECT = 1,
            }

            interface ISingleSelectReply {
                selectedRowId?: (string|null);
            }

            class SingleSelectReply implements ISingleSelectReply {
                constructor(p?: ISingleSelectReply);
                public selectedRowId?: (string|null);
                public static create(properties?: ISingleSelectReply): SingleSelectReply;
                public static encode(m: ISingleSelectReply, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SingleSelectReply;
                public static fromObject(d: { [k: string]: any }): SingleSelectReply;
                public static toObject(m: SingleSelectReply, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace OrderMessage {

            enum OrderStatus {
                INQUIRY = 1,
                ACCEPTED = 2,
                DECLINED = 3,
            }

            enum OrderSurface {
                CATALOG = 1,
            }
        }

        namespace PaymentInviteMessage {

            enum ServiceType {
                UNKNOWN = 0,
                FBPAY = 1,
                NOVI = 2,
                UPI = 3,
            }
        }

        namespace PaymentLinkMetadata {

            interface IPaymentLinkButton {
                displayText?: (string|null);
            }

            class PaymentLinkButton implements IPaymentLinkButton {
                constructor(p?: IPaymentLinkButton);
                public displayText?: (string|null);
                public static create(properties?: IPaymentLinkButton): PaymentLinkButton;
                public static encode(m: IPaymentLinkButton, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentLinkButton;
                public static fromObject(d: { [k: string]: any }): PaymentLinkButton;
                public static toObject(m: PaymentLinkButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IPaymentLinkHeader {
                headerType?: proto.PaymentLinkHeader.PaymentLinkHeaderType|null;
            }

            class PaymentLinkHeader implements IPaymentLinkHeader {
                constructor(p?: IPaymentLinkHeader);
                public headerType?: proto.PaymentLinkHeader.PaymentLinkHeaderType|null;
                public static create(properties?: IPaymentLinkHeader): PaymentLinkHeader;
                public static encode(m: IPaymentLinkHeader, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentLinkHeader;
                public static fromObject(d: { [k: string]: any }): PaymentLinkHeader;
                public static toObject(m: PaymentLinkHeader, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IPaymentLinkProvider {
                paramsJson?: (string|null);
            }

            class PaymentLinkProvider implements IPaymentLinkProvider {
                constructor(p?: IPaymentLinkProvider);
                public paramsJson?: (string|null);
                public static create(properties?: IPaymentLinkProvider): PaymentLinkProvider;
                public static encode(m: IPaymentLinkProvider, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentLinkProvider;
                public static fromObject(d: { [k: string]: any }): PaymentLinkProvider;
                public static toObject(m: PaymentLinkProvider, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace PaymentLinkHeader {

                enum PaymentLinkHeaderType {
                    LINK_PREVIEW = 0,
                    ORDER = 1,
                }
            }
        }

        namespace PeerDataOperationRequestMessage {

            interface IFullHistorySyncOnDemandRequest {
                requestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
                historySyncConfig?: (proto.IHistorySyncConfig|null);
            }

            class FullHistorySyncOnDemandRequest implements IFullHistorySyncOnDemandRequest {
                constructor(p?: IFullHistorySyncOnDemandRequest);
                public requestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
                public historySyncConfig?: (proto.IHistorySyncConfig|null);
                public static create(properties?: IFullHistorySyncOnDemandRequest): FullHistorySyncOnDemandRequest;
                public static encode(m: IFullHistorySyncOnDemandRequest, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FullHistorySyncOnDemandRequest;
                public static fromObject(d: { [k: string]: any }): FullHistorySyncOnDemandRequest;
                public static toObject(m: FullHistorySyncOnDemandRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IGalaxyFlowAction {
                type?: proto.GalaxyFlowAction.GalaxyFlowActionType|null;
                flowId?: (string|null);
                stanzaId?: (string|null);
            }

            class GalaxyFlowAction implements IGalaxyFlowAction {
                constructor(p?: IGalaxyFlowAction);
                public type?: proto.GalaxyFlowAction.GalaxyFlowActionType|null;
                public flowId?: (string|null);
                public stanzaId?: (string|null);
                public static create(properties?: IGalaxyFlowAction): GalaxyFlowAction;
                public static encode(m: IGalaxyFlowAction, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GalaxyFlowAction;
                public static fromObject(d: { [k: string]: any }): GalaxyFlowAction;
                public static toObject(m: GalaxyFlowAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IHistorySyncChunkRetryRequest {
                syncType?: proto.HistorySyncType|null;
                chunkOrder?: (number|null);
                chunkNotificationId?: (string|null);
                regenerateChunk?: (boolean|null);
            }

            class HistorySyncChunkRetryRequest implements IHistorySyncChunkRetryRequest {
                constructor(p?: IHistorySyncChunkRetryRequest);
                public syncType?: proto.HistorySyncType|null;
                public chunkOrder?: (number|null);
                public chunkNotificationId?: (string|null);
                public regenerateChunk?: (boolean|null);
                public static create(properties?: IHistorySyncChunkRetryRequest): HistorySyncChunkRetryRequest;
                public static encode(m: IHistorySyncChunkRetryRequest, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncChunkRetryRequest;
                public static fromObject(d: { [k: string]: any }): HistorySyncChunkRetryRequest;
                public static toObject(m: HistorySyncChunkRetryRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IHistorySyncOnDemandRequest {
                chatJid?: (string|null);
                oldestMsgId?: (string|null);
                oldestMsgFromMe?: (boolean|null);
                onDemandMsgCount?: (number|null);
                oldestMsgTimestampMs?: (number|Long|null);
                accountLid?: (string|null);
            }

            class HistorySyncOnDemandRequest implements IHistorySyncOnDemandRequest {
                constructor(p?: IHistorySyncOnDemandRequest);
                public chatJid?: (string|null);
                public oldestMsgId?: (string|null);
                public oldestMsgFromMe?: (boolean|null);
                public onDemandMsgCount?: (number|null);
                public oldestMsgTimestampMs?: (number|Long|null);
                public accountLid?: (string|null);
                public static create(properties?: IHistorySyncOnDemandRequest): HistorySyncOnDemandRequest;
                public static encode(m: IHistorySyncOnDemandRequest, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncOnDemandRequest;
                public static fromObject(d: { [k: string]: any }): HistorySyncOnDemandRequest;
                public static toObject(m: HistorySyncOnDemandRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IPlaceholderMessageResendRequest {
                messageKey?: (proto.IMessageKey|null);
            }

            class PlaceholderMessageResendRequest implements IPlaceholderMessageResendRequest {
                constructor(p?: IPlaceholderMessageResendRequest);
                public messageKey?: (proto.IMessageKey|null);
                public static create(properties?: IPlaceholderMessageResendRequest): PlaceholderMessageResendRequest;
                public static encode(m: IPlaceholderMessageResendRequest, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PlaceholderMessageResendRequest;
                public static fromObject(d: { [k: string]: any }): PlaceholderMessageResendRequest;
                public static toObject(m: PlaceholderMessageResendRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IRequestStickerReupload {
                fileSha256?: (string|null);
            }

            class RequestStickerReupload implements IRequestStickerReupload {
                constructor(p?: IRequestStickerReupload);
                public fileSha256?: (string|null);
                public static create(properties?: IRequestStickerReupload): RequestStickerReupload;
                public static encode(m: IRequestStickerReupload, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RequestStickerReupload;
                public static fromObject(d: { [k: string]: any }): RequestStickerReupload;
                public static toObject(m: RequestStickerReupload, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IRequestUrlPreview {
                url?: (string|null);
                includeHqThumbnail?: (boolean|null);
            }

            class RequestUrlPreview implements IRequestUrlPreview {
                constructor(p?: IRequestUrlPreview);
                public url?: (string|null);
                public includeHqThumbnail?: (boolean|null);
                public static create(properties?: IRequestUrlPreview): RequestUrlPreview;
                public static encode(m: IRequestUrlPreview, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RequestUrlPreview;
                public static fromObject(d: { [k: string]: any }): RequestUrlPreview;
                public static toObject(m: RequestUrlPreview, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface ISyncDCollectionFatalRecoveryRequest {
                collectionName?: (string|null);
                timestamp?: (number|Long|null);
            }

            class SyncDCollectionFatalRecoveryRequest implements ISyncDCollectionFatalRecoveryRequest {
                constructor(p?: ISyncDCollectionFatalRecoveryRequest);
                public collectionName?: (string|null);
                public timestamp?: (number|Long|null);
                public static create(properties?: ISyncDCollectionFatalRecoveryRequest): SyncDCollectionFatalRecoveryRequest;
                public static encode(m: ISyncDCollectionFatalRecoveryRequest, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncDCollectionFatalRecoveryRequest;
                public static fromObject(d: { [k: string]: any }): SyncDCollectionFatalRecoveryRequest;
                public static toObject(m: SyncDCollectionFatalRecoveryRequest, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace GalaxyFlowAction {

                enum GalaxyFlowActionType {
                    NOTIFY_LAUNCH = 1,
                }
            }
        }

        namespace PeerDataOperationRequestResponseMessage {

            interface IPeerDataOperationResult {
                mediaUploadResult?: proto.MediaRetryNotification.ResultType|null;
                stickerMessage?: (proto.IStickerMessage|null);
                linkPreviewResponse?: (proto.ILinkPreviewResponse|null);
                placeholderMessageResendResponse?: (proto.IPlaceholderMessageResendResponse|null);
                waffleNonceFetchRequestResponse?: (proto.IWaffleNonceFetchResponse|null);
                fullHistorySyncOnDemandRequestResponse?: (proto.IFullHistorySyncOnDemandRequestResponse|null);
                companionMetaNonceFetchRequestResponse?: (proto.ICompanionMetaNonceFetchResponse|null);
                syncdSnapshotFatalRecoveryResponse?: (proto.ISyncDSnapshotFatalRecoveryResponse|null);
                companionCanonicalUserNonceFetchRequestResponse?: (proto.ICompanionCanonicalUserNonceFetchResponse|null);
                historySyncChunkRetryResponse?: (proto.IHistorySyncChunkRetryResponse|null);
            }

            class PeerDataOperationResult implements IPeerDataOperationResult {
                constructor(p?: IPeerDataOperationResult);
                public mediaUploadResult?: proto.MediaRetryNotification.ResultType|null;
                public stickerMessage?: (proto.IStickerMessage|null);
                public linkPreviewResponse?: (proto.ILinkPreviewResponse|null);
                public placeholderMessageResendResponse?: (proto.IPlaceholderMessageResendResponse|null);
                public waffleNonceFetchRequestResponse?: (proto.IWaffleNonceFetchResponse|null);
                public fullHistorySyncOnDemandRequestResponse?: (proto.IFullHistorySyncOnDemandRequestResponse|null);
                public companionMetaNonceFetchRequestResponse?: (proto.ICompanionMetaNonceFetchResponse|null);
                public syncdSnapshotFatalRecoveryResponse?: (proto.ISyncDSnapshotFatalRecoveryResponse|null);
                public companionCanonicalUserNonceFetchRequestResponse?: (proto.ICompanionCanonicalUserNonceFetchResponse|null);
                public historySyncChunkRetryResponse?: (proto.IHistorySyncChunkRetryResponse|null);
                public static create(properties?: IPeerDataOperationResult): PeerDataOperationResult;
                public static encode(m: IPeerDataOperationResult, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PeerDataOperationResult;
                public static fromObject(d: { [k: string]: any }): PeerDataOperationResult;
                public static toObject(m: PeerDataOperationResult, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            namespace PeerDataOperationResult {

                enum FullHistorySyncOnDemandResponseCode {
                    REQUEST_SUCCESS = 0,
                    REQUEST_TIME_EXPIRED = 1,
                    DECLINED_SHARING_HISTORY = 2,
                    GENERIC_ERROR = 3,
                    ERROR_REQUEST_ON_NON_SMB_PRIMARY = 4,
                    ERROR_HOSTED_DEVICE_NOT_CONNECTED = 5,
                    ERROR_HOSTED_DEVICE_LOGIN_TIME_NOT_SET = 6,
                }

                enum HistorySyncChunkRetryResponseCode {
                    GENERATION_ERROR = 1,
                    CHUNK_CONSUMED = 2,
                    TIMEOUT = 3,
                    SESSION_EXHAUSTED = 4,
                    CHUNK_EXHAUSTED = 5,
                    DUPLICATED_REQUEST = 6,
                }

                interface ICompanionCanonicalUserNonceFetchResponse {
                    nonce?: (string|null);
                    waFbid?: (string|null);
                    forceRefresh?: (boolean|null);
                }

                class CompanionCanonicalUserNonceFetchResponse implements ICompanionCanonicalUserNonceFetchResponse {
                    constructor(p?: ICompanionCanonicalUserNonceFetchResponse);
                    public nonce?: (string|null);
                    public waFbid?: (string|null);
                    public forceRefresh?: (boolean|null);
                    public static create(properties?: ICompanionCanonicalUserNonceFetchResponse): CompanionCanonicalUserNonceFetchResponse;
                    public static encode(m: ICompanionCanonicalUserNonceFetchResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CompanionCanonicalUserNonceFetchResponse;
                    public static fromObject(d: { [k: string]: any }): CompanionCanonicalUserNonceFetchResponse;
                    public static toObject(m: CompanionCanonicalUserNonceFetchResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ICompanionMetaNonceFetchResponse {
                    nonce?: (string|null);
                }

                class CompanionMetaNonceFetchResponse implements ICompanionMetaNonceFetchResponse {
                    constructor(p?: ICompanionMetaNonceFetchResponse);
                    public nonce?: (string|null);
                    public static create(properties?: ICompanionMetaNonceFetchResponse): CompanionMetaNonceFetchResponse;
                    public static encode(m: ICompanionMetaNonceFetchResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CompanionMetaNonceFetchResponse;
                    public static fromObject(d: { [k: string]: any }): CompanionMetaNonceFetchResponse;
                    public static toObject(m: CompanionMetaNonceFetchResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface IFullHistorySyncOnDemandRequestResponse {
                    requestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
                    responseCode?: proto.FullHistorySyncOnDemandResponseCode|null;
                }

                class FullHistorySyncOnDemandRequestResponse implements IFullHistorySyncOnDemandRequestResponse {
                    constructor(p?: IFullHistorySyncOnDemandRequestResponse);
                    public requestMetadata?: (proto.IFullHistorySyncOnDemandRequestMetadata|null);
                    public responseCode?: proto.FullHistorySyncOnDemandResponseCode|null;
                    public static create(properties?: IFullHistorySyncOnDemandRequestResponse): FullHistorySyncOnDemandRequestResponse;
                    public static encode(m: IFullHistorySyncOnDemandRequestResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FullHistorySyncOnDemandRequestResponse;
                    public static fromObject(d: { [k: string]: any }): FullHistorySyncOnDemandRequestResponse;
                    public static toObject(m: FullHistorySyncOnDemandRequestResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface IHistorySyncChunkRetryResponse {
                    syncType?: proto.HistorySyncType|null;
                    chunkOrder?: (number|null);
                    requestId?: (string|null);
                    responseCode?: proto.HistorySyncChunkRetryResponseCode|null;
                    canRecover?: (boolean|null);
                }

                class HistorySyncChunkRetryResponse implements IHistorySyncChunkRetryResponse {
                    constructor(p?: IHistorySyncChunkRetryResponse);
                    public syncType?: proto.HistorySyncType|null;
                    public chunkOrder?: (number|null);
                    public requestId?: (string|null);
                    public responseCode?: proto.HistorySyncChunkRetryResponseCode|null;
                    public canRecover?: (boolean|null);
                    public static create(properties?: IHistorySyncChunkRetryResponse): HistorySyncChunkRetryResponse;
                    public static encode(m: IHistorySyncChunkRetryResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HistorySyncChunkRetryResponse;
                    public static fromObject(d: { [k: string]: any }): HistorySyncChunkRetryResponse;
                    public static toObject(m: HistorySyncChunkRetryResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ILinkPreviewResponse {
                    url?: (string|null);
                    title?: (string|null);
                    description?: (string|null);
                    thumbData?: (Uint8Array|null);
                    matchText?: (string|null);
                    previewType?: (string|null);
                    hqThumbnail?: (proto.ILinkPreviewHighQualityThumbnail|null);
                    previewMetadata?: (proto.IPaymentLinkPreviewMetadata|null);
                }

                class LinkPreviewResponse implements ILinkPreviewResponse {
                    constructor(p?: ILinkPreviewResponse);
                    public url?: (string|null);
                    public title?: (string|null);
                    public description?: (string|null);
                    public thumbData?: (Uint8Array|null);
                    public matchText?: (string|null);
                    public previewType?: (string|null);
                    public hqThumbnail?: (proto.ILinkPreviewHighQualityThumbnail|null);
                    public previewMetadata?: (proto.IPaymentLinkPreviewMetadata|null);
                    public static create(properties?: ILinkPreviewResponse): LinkPreviewResponse;
                    public static encode(m: ILinkPreviewResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LinkPreviewResponse;
                    public static fromObject(d: { [k: string]: any }): LinkPreviewResponse;
                    public static toObject(m: LinkPreviewResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface IPlaceholderMessageResendResponse {
                    webMessageInfoBytes?: (Uint8Array|null);
                }

                class PlaceholderMessageResendResponse implements IPlaceholderMessageResendResponse {
                    constructor(p?: IPlaceholderMessageResendResponse);
                    public webMessageInfoBytes?: (Uint8Array|null);
                    public static create(properties?: IPlaceholderMessageResendResponse): PlaceholderMessageResendResponse;
                    public static encode(m: IPlaceholderMessageResendResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PlaceholderMessageResendResponse;
                    public static fromObject(d: { [k: string]: any }): PlaceholderMessageResendResponse;
                    public static toObject(m: PlaceholderMessageResendResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface ISyncDSnapshotFatalRecoveryResponse {
                    collectionSnapshot?: (Uint8Array|null);
                    isCompressed?: (boolean|null);
                }

                class SyncDSnapshotFatalRecoveryResponse implements ISyncDSnapshotFatalRecoveryResponse {
                    constructor(p?: ISyncDSnapshotFatalRecoveryResponse);
                    public collectionSnapshot?: (Uint8Array|null);
                    public isCompressed?: (boolean|null);
                    public static create(properties?: ISyncDSnapshotFatalRecoveryResponse): SyncDSnapshotFatalRecoveryResponse;
                    public static encode(m: ISyncDSnapshotFatalRecoveryResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncDSnapshotFatalRecoveryResponse;
                    public static fromObject(d: { [k: string]: any }): SyncDSnapshotFatalRecoveryResponse;
                    public static toObject(m: SyncDSnapshotFatalRecoveryResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                interface IWaffleNonceFetchResponse {
                    nonce?: (string|null);
                    waEntFbid?: (string|null);
                }

                class WaffleNonceFetchResponse implements IWaffleNonceFetchResponse {
                    constructor(p?: IWaffleNonceFetchResponse);
                    public nonce?: (string|null);
                    public waEntFbid?: (string|null);
                    public static create(properties?: IWaffleNonceFetchResponse): WaffleNonceFetchResponse;
                    public static encode(m: IWaffleNonceFetchResponse, w?: $protobuf.Writer): $protobuf.Writer;
                    public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WaffleNonceFetchResponse;
                    public static fromObject(d: { [k: string]: any }): WaffleNonceFetchResponse;
                    public static toObject(m: WaffleNonceFetchResponse, o?: $protobuf.IConversionOptions): { [k: string]: any };
                    public toJSON(): { [k: string]: any };
                }

                namespace LinkPreviewResponse {

                    interface ILinkPreviewHighQualityThumbnail {
                        directPath?: (string|null);
                        thumbHash?: (string|null);
                        encThumbHash?: (string|null);
                        mediaKey?: (Uint8Array|null);
                        mediaKeyTimestampMs?: (number|Long|null);
                        thumbWidth?: (number|null);
                        thumbHeight?: (number|null);
                    }

                    class LinkPreviewHighQualityThumbnail implements ILinkPreviewHighQualityThumbnail {
                        constructor(p?: ILinkPreviewHighQualityThumbnail);
                        public directPath?: (string|null);
                        public thumbHash?: (string|null);
                        public encThumbHash?: (string|null);
                        public mediaKey?: (Uint8Array|null);
                        public mediaKeyTimestampMs?: (number|Long|null);
                        public thumbWidth?: (number|null);
                        public thumbHeight?: (number|null);
                        public static create(properties?: ILinkPreviewHighQualityThumbnail): LinkPreviewHighQualityThumbnail;
                        public static encode(m: ILinkPreviewHighQualityThumbnail, w?: $protobuf.Writer): $protobuf.Writer;
                        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LinkPreviewHighQualityThumbnail;
                        public static fromObject(d: { [k: string]: any }): LinkPreviewHighQualityThumbnail;
                        public static toObject(m: LinkPreviewHighQualityThumbnail, o?: $protobuf.IConversionOptions): { [k: string]: any };
                        public toJSON(): { [k: string]: any };
                    }

                    interface IPaymentLinkPreviewMetadata {
                        isBusinessVerified?: (boolean|null);
                        providerName?: (string|null);
                    }

                    class PaymentLinkPreviewMetadata implements IPaymentLinkPreviewMetadata {
                        constructor(p?: IPaymentLinkPreviewMetadata);
                        public isBusinessVerified?: (boolean|null);
                        public providerName?: (string|null);
                        public static create(properties?: IPaymentLinkPreviewMetadata): PaymentLinkPreviewMetadata;
                        public static encode(m: IPaymentLinkPreviewMetadata, w?: $protobuf.Writer): $protobuf.Writer;
                        public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentLinkPreviewMetadata;
                        public static fromObject(d: { [k: string]: any }): PaymentLinkPreviewMetadata;
                        public static toObject(m: PaymentLinkPreviewMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
                        public toJSON(): { [k: string]: any };
                    }
                }
            }
        }

        namespace PinInChatMessage {

            enum Type {
                UNKNOWN_TYPE = 0,
                PIN_FOR_ALL = 1,
                UNPIN_FOR_ALL = 2,
            }
        }

        namespace PlaceholderMessage {

            enum PlaceholderType {
                MASK_LINKED_DEVICES = 0,
            }
        }

        namespace PollCreationMessage {

            interface IOption {
                optionName?: (string|null);
                optionHash?: (string|null);
            }

            class Option implements IOption {
                constructor(p?: IOption);
                public optionName?: (string|null);
                public optionHash?: (string|null);
                public static create(properties?: IOption): Option;
                public static encode(m: IOption, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Option;
                public static fromObject(d: { [k: string]: any }): Option;
                public static toObject(m: Option, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace PollResultSnapshotMessage {

            interface IPollVote {
                optionName?: (string|null);
                optionVoteCount?: (number|Long|null);
            }

            class PollVote implements IPollVote {
                constructor(p?: IPollVote);
                public optionName?: (string|null);
                public optionVoteCount?: (number|Long|null);
                public static create(properties?: IPollVote): PollVote;
                public static encode(m: IPollVote, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollVote;
                public static fromObject(d: { [k: string]: any }): PollVote;
                public static toObject(m: PollVote, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace ProductMessage {

            interface ICatalogSnapshot {
                catalogImage?: (proto.IImageMessage|null);
                title?: (string|null);
                description?: (string|null);
            }

            class CatalogSnapshot implements ICatalogSnapshot {
                constructor(p?: ICatalogSnapshot);
                public catalogImage?: (proto.IImageMessage|null);
                public title?: (string|null);
                public description?: (string|null);
                public static create(properties?: ICatalogSnapshot): CatalogSnapshot;
                public static encode(m: ICatalogSnapshot, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CatalogSnapshot;
                public static fromObject(d: { [k: string]: any }): CatalogSnapshot;
                public static toObject(m: CatalogSnapshot, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IProductSnapshot {
                productImage?: (proto.IImageMessage|null);
                productId?: (string|null);
                title?: (string|null);
                description?: (string|null);
                currencyCode?: (string|null);
                priceAmount1000?: (number|Long|null);
                retailerId?: (string|null);
                url?: (string|null);
                productImageCount?: (number|null);
                firstImageId?: (string|null);
                salePriceAmount1000?: (number|Long|null);
                signedUrl?: (string|null);
            }

            class ProductSnapshot implements IProductSnapshot {
                constructor(p?: IProductSnapshot);
                public productImage?: (proto.IImageMessage|null);
                public productId?: (string|null);
                public title?: (string|null);
                public description?: (string|null);
                public currencyCode?: (string|null);
                public priceAmount1000?: (number|Long|null);
                public retailerId?: (string|null);
                public url?: (string|null);
                public productImageCount?: (number|null);
                public firstImageId?: (string|null);
                public salePriceAmount1000?: (number|Long|null);
                public signedUrl?: (string|null);
                public static create(properties?: IProductSnapshot): ProductSnapshot;
                public static encode(m: IProductSnapshot, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ProductSnapshot;
                public static fromObject(d: { [k: string]: any }): ProductSnapshot;
                public static toObject(m: ProductSnapshot, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace ProtocolMessage {

            enum Type {
                REVOKE = 0,
                EPHEMERAL_SETTING = 3,
                EPHEMERAL_SYNC_RESPONSE = 4,
                HISTORY_SYNC_NOTIFICATION = 5,
                APP_STATE_SYNC_KEY_SHARE = 6,
                APP_STATE_SYNC_KEY_REQUEST = 7,
                MSG_FANOUT_BACKFILL_REQUEST = 8,
                INITIAL_SECURITY_NOTIFICATION_SETTING_SYNC = 9,
                APP_STATE_FATAL_EXCEPTION_NOTIFICATION = 10,
                SHARE_PHONE_NUMBER = 11,
                MESSAGE_EDIT = 14,
                PEER_DATA_OPERATION_REQUEST_MESSAGE = 16,
                PEER_DATA_OPERATION_REQUEST_RESPONSE_MESSAGE = 17,
                REQUEST_WELCOME_MESSAGE = 18,
                BOT_FEEDBACK_MESSAGE = 19,
                MEDIA_NOTIFY_MESSAGE = 20,
                CLOUD_API_THREAD_CONTROL_NOTIFICATION = 21,
                LID_MIGRATION_MAPPING_SYNC = 22,
                REMINDER_MESSAGE = 23,
                BOT_MEMU_ONBOARDING_MESSAGE = 24,
                STATUS_MENTION_MESSAGE = 25,
                STOP_GENERATION_MESSAGE = 26,
                LIMIT_SHARING = 27,
                AI_PSI_METADATA = 28,
                AI_QUERY_FANOUT = 29,
                GROUP_MEMBER_LABEL_CHANGE = 30,
            }
        }

        namespace RequestWelcomeMessageMetadata {

            enum LocalChatState {
                EMPTY = 0,
                NON_EMPTY = 1,
            }
        }

        namespace ScheduledCallCreationMessage {

            enum CallType {
                UNKNOWN = 0,
                VOICE = 1,
                VIDEO = 2,
            }
        }

        namespace ScheduledCallEditMessage {

            enum EditType {
                UNKNOWN = 0,
                CANCEL = 1,
            }
        }

        namespace SecretEncryptedMessage {

            enum SecretEncType {
                UNKNOWN = 0,
                EVENT_EDIT = 1,
                MESSAGE_EDIT = 2,
            }
        }

        namespace StatusNotificationMessage {

            enum StatusNotificationType {
                UNKNOWN = 0,
                STATUS_ADD_YOURS = 1,
                STATUS_RESHARE = 2,
                STATUS_QUESTION_ANSWER_RESHARE = 3,
            }
        }

        namespace StatusQuotedMessage {

            enum StatusQuotedMessageType {
                QUESTION_ANSWER = 1,
            }
        }

        namespace StatusStickerInteractionMessage {

            enum StatusStickerType {
                UNKNOWN = 0,
                REACTION = 1,
            }
        }

        namespace StickerPackMessage {

            enum StickerPackOrigin {
                FIRST_PARTY = 0,
                THIRD_PARTY = 1,
                USER_CREATED = 2,
            }

            interface ISticker {
                fileName?: (string|null);
                isAnimated?: (boolean|null);
                emojis?: string[];
                accessibilityLabel?: (string|null);
                isLottie?: (boolean|null);
                mimetype?: (string|null);
            }

            class Sticker implements ISticker {
                constructor(p?: ISticker);
                public fileName?: (string|null);
                public isAnimated?: (boolean|null);
                public emojis: string[];
                public accessibilityLabel?: (string|null);
                public isLottie?: (boolean|null);
                public mimetype?: (string|null);
                public static create(properties?: ISticker): Sticker;
                public static encode(m: ISticker, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Sticker;
                public static fromObject(d: { [k: string]: any }): Sticker;
                public static toObject(m: Sticker, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace TemplateMessage {

            interface IFourRowTemplate {
                content?: (proto.IHighlyStructuredMessage|null);
                footer?: (proto.IHighlyStructuredMessage|null);
                buttons?: proto.ITemplateButton[];
                documentMessage?: (proto.IDocumentMessage|null);
                highlyStructuredMessage?: (proto.IHighlyStructuredMessage|null);
                imageMessage?: (proto.IImageMessage|null);
                videoMessage?: (proto.IVideoMessage|null);
                locationMessage?: (proto.ILocationMessage|null);
                /** Prost oneof field */
                title?: {
                    documentMessage?: (proto.IDocumentMessage|null);
                    highlyStructuredMessage?: (proto.IHighlyStructuredMessage|null);
                    imageMessage?: (proto.IImageMessage|null);
                    videoMessage?: (proto.IVideoMessage|null);
                    locationMessage?: (proto.ILocationMessage|null);
                } | null;
            }

            class FourRowTemplate implements IFourRowTemplate {
                constructor(p?: IFourRowTemplate);
                public content?: (proto.IHighlyStructuredMessage|null);
                public footer?: (proto.IHighlyStructuredMessage|null);
                public buttons: proto.ITemplateButton[];
                public documentMessage?: (proto.IDocumentMessage|null);
                public highlyStructuredMessage?: (proto.IHighlyStructuredMessage|null);
                public imageMessage?: (proto.IImageMessage|null);
                public videoMessage?: (proto.IVideoMessage|null);
                public locationMessage?: (proto.ILocationMessage|null);
                public title?: ("documentMessage"|"highlyStructuredMessage"|"imageMessage"|"videoMessage"|"locationMessage");
                public static create(properties?: IFourRowTemplate): FourRowTemplate;
                public static encode(m: IFourRowTemplate, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FourRowTemplate;
                public static fromObject(d: { [k: string]: any }): FourRowTemplate;
                public static toObject(m: FourRowTemplate, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IHydratedFourRowTemplate {
                hydratedContentText?: (string|null);
                hydratedFooterText?: (string|null);
                hydratedButtons?: proto.IHydratedTemplateButton[];
                templateId?: (string|null);
                maskLinkedDevices?: (boolean|null);
                documentMessage?: (proto.IDocumentMessage|null);
                hydratedTitleText?: (string|null);
                imageMessage?: (proto.IImageMessage|null);
                videoMessage?: (proto.IVideoMessage|null);
                locationMessage?: (proto.ILocationMessage|null);
                /** Prost oneof field */
                title?: {
                    documentMessage?: (proto.IDocumentMessage|null);
                    hydratedTitleText?: (string|null);
                    imageMessage?: (proto.IImageMessage|null);
                    videoMessage?: (proto.IVideoMessage|null);
                    locationMessage?: (proto.ILocationMessage|null);
                } | null;
            }

            class HydratedFourRowTemplate implements IHydratedFourRowTemplate {
                constructor(p?: IHydratedFourRowTemplate);
                public hydratedContentText?: (string|null);
                public hydratedFooterText?: (string|null);
                public hydratedButtons: proto.IHydratedTemplateButton[];
                public templateId?: (string|null);
                public maskLinkedDevices?: (boolean|null);
                public documentMessage?: (proto.IDocumentMessage|null);
                public hydratedTitleText?: (string|null);
                public imageMessage?: (proto.IImageMessage|null);
                public videoMessage?: (proto.IVideoMessage|null);
                public locationMessage?: (proto.ILocationMessage|null);
                public title?: ("documentMessage"|"hydratedTitleText"|"imageMessage"|"videoMessage"|"locationMessage");
                public static create(properties?: IHydratedFourRowTemplate): HydratedFourRowTemplate;
                public static encode(m: IHydratedFourRowTemplate, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): HydratedFourRowTemplate;
                public static fromObject(d: { [k: string]: any }): HydratedFourRowTemplate;
                public static toObject(m: HydratedFourRowTemplate, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace VideoMessage {

            enum Attribution {
                NONE = 0,
                GIPHY = 1,
                TENOR = 2,
                KLIPY = 3,
            }

            enum VideoSourceType {
                USER_VIDEO = 0,
                AI_GENERATED = 1,
            }
        }
    }

    namespace MessageAddOn {

        enum MessageAddOnType {
            UNDEFINED = 0,
            REACTION = 1,
            EVENT_RESPONSE = 2,
            POLL_UPDATE = 3,
            PIN_IN_CHAT = 4,
        }
    }

    namespace MessageAssociation {

        enum AssociationType {
            UNKNOWN = 0,
            MEDIA_ALBUM = 1,
            BOT_PLUGIN = 2,
            EVENT_COVER_IMAGE = 3,
            STATUS_POLL = 4,
            HD_VIDEO_DUAL_UPLOAD = 5,
            STATUS_EXTERNAL_RESHARE = 6,
            MEDIA_POLL = 7,
            STATUS_ADD_YOURS = 8,
            STATUS_NOTIFICATION = 9,
            HD_IMAGE_DUAL_UPLOAD = 10,
            STICKER_ANNOTATION = 11,
            MOTION_PHOTO = 12,
            STATUS_LINK_ACTION = 13,
            VIEW_ALL_REPLIES = 14,
            STATUS_ADD_YOURS_AI_IMAGINE = 15,
            STATUS_QUESTION = 16,
            STATUS_ADD_YOURS_DIWALI = 17,
            STATUS_REACTION = 18,
            HEVC_VIDEO_DUAL_UPLOAD = 19,
        }
    }

    namespace MessageContextInfo {

        enum MessageAddonExpiryType {
            STATIC = 1,
            DEPENDENT_ON_PARENT = 2,
        }
    }

    namespace MsgOpaqueData {

        enum PollContentType {
            UNKNOWN = 0,
            TEXT = 1,
            IMAGE = 2,
        }

        enum PollType {
            POLL = 0,
            QUIZ = 1,
        }

        interface IEventLocation {
            degreesLatitude?: (number|null);
            degreesLongitude?: (number|null);
            name?: (string|null);
            address?: (string|null);
            url?: (string|null);
            jpegThumbnail?: (Uint8Array|null);
        }

        class EventLocation implements IEventLocation {
            constructor(p?: IEventLocation);
            public degreesLatitude?: (number|null);
            public degreesLongitude?: (number|null);
            public name?: (string|null);
            public address?: (string|null);
            public url?: (string|null);
            public jpegThumbnail?: (Uint8Array|null);
            public static create(properties?: IEventLocation): EventLocation;
            public static encode(m: IEventLocation, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): EventLocation;
            public static fromObject(d: { [k: string]: any }): EventLocation;
            public static toObject(m: EventLocation, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollOption {
            name?: (string|null);
            hash?: (string|null);
        }

        class PollOption implements IPollOption {
            constructor(p?: IPollOption);
            public name?: (string|null);
            public hash?: (string|null);
            public static create(properties?: IPollOption): PollOption;
            public static encode(m: IPollOption, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollOption;
            public static fromObject(d: { [k: string]: any }): PollOption;
            public static toObject(m: PollOption, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollVoteSnapshot {
            option?: (proto.IPollOption|null);
            optionVoteCount?: (number|null);
        }

        class PollVoteSnapshot implements IPollVoteSnapshot {
            constructor(p?: IPollVoteSnapshot);
            public option?: (proto.IPollOption|null);
            public optionVoteCount?: (number|null);
            public static create(properties?: IPollVoteSnapshot): PollVoteSnapshot;
            public static encode(m: IPollVoteSnapshot, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollVoteSnapshot;
            public static fromObject(d: { [k: string]: any }): PollVoteSnapshot;
            public static toObject(m: PollVoteSnapshot, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPollVotesSnapshot {
            pollVotes?: proto.IPollVoteSnapshot[];
        }

        class PollVotesSnapshot implements IPollVotesSnapshot {
            constructor(p?: IPollVotesSnapshot);
            public pollVotes: proto.IPollVoteSnapshot[];
            public static create(properties?: IPollVotesSnapshot): PollVotesSnapshot;
            public static encode(m: IPollVotesSnapshot, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PollVotesSnapshot;
            public static fromObject(d: { [k: string]: any }): PollVotesSnapshot;
            public static toObject(m: PollVotesSnapshot, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace NoiseCertificate {

        interface IDetails {
            serial?: (number|null);
            issuer?: (string|null);
            expires?: (number|Long|null);
            subject?: (string|null);
            key?: (Uint8Array|null);
        }

        class Details implements IDetails {
            constructor(p?: IDetails);
            public serial?: (number|null);
            public issuer?: (string|null);
            public expires?: (number|Long|null);
            public subject?: (string|null);
            public key?: (Uint8Array|null);
            public static create(properties?: IDetails): Details;
            public static encode(m: IDetails, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Details;
            public static fromObject(d: { [k: string]: any }): Details;
            public static toObject(m: Details, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace PastParticipant {

        enum LeaveReason {
            LEFT = 0,
            REMOVED = 1,
        }
    }

    namespace PatchDebugData {

        enum Platform {
            ANDROID = 0,
            SMBA = 1,
            IPHONE = 2,
            SMBI = 3,
            WEB = 4,
            UWP = 5,
            DARWIN = 6,
            IPAD = 7,
            WEAROS = 8,
            WASG = 9,
            WEARM = 10,
            CAPI = 11,
        }
    }

    namespace PaymentBackground {

        enum Type {
            UNKNOWN = 0,
            DEFAULT = 1,
        }

        interface IMediaData {
            mediaKey?: (Uint8Array|null);
            mediaKeyTimestamp?: (number|Long|null);
            fileSha256?: (Uint8Array|null);
            fileEncSha256?: (Uint8Array|null);
            directPath?: (string|null);
        }

        class MediaData implements IMediaData {
            constructor(p?: IMediaData);
            public mediaKey?: (Uint8Array|null);
            public mediaKeyTimestamp?: (number|Long|null);
            public fileSha256?: (Uint8Array|null);
            public fileEncSha256?: (Uint8Array|null);
            public directPath?: (string|null);
            public static create(properties?: IMediaData): MediaData;
            public static encode(m: IMediaData, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MediaData;
            public static fromObject(d: { [k: string]: any }): MediaData;
            public static toObject(m: MediaData, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace PaymentInfo {

        enum Currency {
            UNKNOWN_CURRENCY = 0,
            INR = 1,
        }

        enum Status {
            UNKNOWN_STATUS = 0,
            PROCESSING = 1,
            SENT = 2,
            NEED_TO_ACCEPT = 3,
            COMPLETE = 4,
            COULD_NOT_COMPLETE = 5,
            REFUNDED = 6,
            EXPIRED = 7,
            REJECTED = 8,
            CANCELLED = 9,
            WAITING_FOR_PAYER = 10,
            WAITING = 11,
        }

        enum TxnStatus {
            UNKNOWN = 0,
            PENDING_SETUP = 1,
            PENDING_RECEIVER_SETUP = 2,
            INIT = 3,
            SUCCESS = 4,
            COMPLETED = 5,
            FAILED = 6,
            FAILED_RISK = 7,
            FAILED_PROCESSING = 8,
            FAILED_RECEIVER_PROCESSING = 9,
            FAILED_DA = 10,
            FAILED_DA_FINAL = 11,
            REFUNDED_TXN = 12,
            REFUND_FAILED = 13,
            REFUND_FAILED_PROCESSING = 14,
            REFUND_FAILED_DA = 15,
            EXPIRED_TXN = 16,
            AUTH_CANCELED = 17,
            AUTH_CANCEL_FAILED_PROCESSING = 18,
            AUTH_CANCEL_FAILED = 19,
            COLLECT_INIT = 20,
            COLLECT_SUCCESS = 21,
            COLLECT_FAILED = 22,
            COLLECT_FAILED_RISK = 23,
            COLLECT_REJECTED = 24,
            COLLECT_EXPIRED = 25,
            COLLECT_CANCELED = 26,
            COLLECT_CANCELLING = 27,
            IN_REVIEW = 28,
            REVERSAL_SUCCESS = 29,
            REVERSAL_PENDING = 30,
            REFUND_PENDING = 31,
        }
    }

    namespace PinInChat {

        enum Type {
            UNKNOWN_TYPE = 0,
            PIN_FOR_ALL = 1,
            UNPIN_FOR_ALL = 2,
        }
    }

    namespace ProcessedVideo {

        enum VideoQuality {
            UNDEFINED = 0,
            LOW = 1,
            MID = 2,
            HIGH = 3,
        }
    }

    namespace SenderKeyStateStructure {

        interface ISenderChainKey {
            iteration?: (number|null);
            seed?: (Uint8Array|null);
        }

        class SenderChainKey implements ISenderChainKey {
            constructor(p?: ISenderChainKey);
            public iteration?: (number|null);
            public seed?: (Uint8Array|null);
            public static create(properties?: ISenderChainKey): SenderChainKey;
            public static encode(m: ISenderChainKey, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderChainKey;
            public static fromObject(d: { [k: string]: any }): SenderChainKey;
            public static toObject(m: SenderChainKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISenderMessageKey {
            iteration?: (number|null);
            seed?: (Uint8Array|null);
        }

        class SenderMessageKey implements ISenderMessageKey {
            constructor(p?: ISenderMessageKey);
            public iteration?: (number|null);
            public seed?: (Uint8Array|null);
            public static create(properties?: ISenderMessageKey): SenderMessageKey;
            public static encode(m: ISenderMessageKey, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderMessageKey;
            public static fromObject(d: { [k: string]: any }): SenderMessageKey;
            public static toObject(m: SenderMessageKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISenderSigningKey {
            public?: (Uint8Array|null);
            private?: (Uint8Array|null);
        }

        class SenderSigningKey implements ISenderSigningKey {
            constructor(p?: ISenderSigningKey);
            public public?: (Uint8Array|null);
            public private?: (Uint8Array|null);
            public static create(properties?: ISenderSigningKey): SenderSigningKey;
            public static encode(m: ISenderSigningKey, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SenderSigningKey;
            public static fromObject(d: { [k: string]: any }): SenderSigningKey;
            public static toObject(m: SenderSigningKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace SessionStructure {

        interface IChain {
            senderRatchetKey?: (Uint8Array|null);
            senderRatchetKeyPrivate?: (Uint8Array|null);
            chainKey?: (proto.IChainKey|null);
            messageKeys?: proto.IMessageKey[];
        }

        class Chain implements IChain {
            constructor(p?: IChain);
            public senderRatchetKey?: (Uint8Array|null);
            public senderRatchetKeyPrivate?: (Uint8Array|null);
            public chainKey?: (proto.IChainKey|null);
            public messageKeys: proto.IMessageKey[];
            public static create(properties?: IChain): Chain;
            public static encode(m: IChain, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Chain;
            public static fromObject(d: { [k: string]: any }): Chain;
            public static toObject(m: Chain, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPendingKeyExchange {
            sequence?: (number|null);
            localBaseKey?: (Uint8Array|null);
            localBaseKeyPrivate?: (Uint8Array|null);
            localRatchetKey?: (Uint8Array|null);
            localRatchetKeyPrivate?: (Uint8Array|null);
            localIdentityKey?: (Uint8Array|null);
            localIdentityKeyPrivate?: (Uint8Array|null);
        }

        class PendingKeyExchange implements IPendingKeyExchange {
            constructor(p?: IPendingKeyExchange);
            public sequence?: (number|null);
            public localBaseKey?: (Uint8Array|null);
            public localBaseKeyPrivate?: (Uint8Array|null);
            public localRatchetKey?: (Uint8Array|null);
            public localRatchetKeyPrivate?: (Uint8Array|null);
            public localIdentityKey?: (Uint8Array|null);
            public localIdentityKeyPrivate?: (Uint8Array|null);
            public static create(properties?: IPendingKeyExchange): PendingKeyExchange;
            public static encode(m: IPendingKeyExchange, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PendingKeyExchange;
            public static fromObject(d: { [k: string]: any }): PendingKeyExchange;
            public static toObject(m: PendingKeyExchange, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPendingPreKey {
            preKeyId?: (number|null);
            signedPreKeyId?: (number|null);
            baseKey?: (Uint8Array|null);
        }

        class PendingPreKey implements IPendingPreKey {
            constructor(p?: IPendingPreKey);
            public preKeyId?: (number|null);
            public signedPreKeyId?: (number|null);
            public baseKey?: (Uint8Array|null);
            public static create(properties?: IPendingPreKey): PendingPreKey;
            public static encode(m: IPendingPreKey, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PendingPreKey;
            public static fromObject(d: { [k: string]: any }): PendingPreKey;
            public static toObject(m: PendingPreKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace Chain {

            interface IChainKey {
                index?: (number|null);
                key?: (Uint8Array|null);
            }

            class ChainKey implements IChainKey {
                constructor(p?: IChainKey);
                public index?: (number|null);
                public key?: (Uint8Array|null);
                public static create(properties?: IChainKey): ChainKey;
                public static encode(m: IChainKey, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ChainKey;
                public static fromObject(d: { [k: string]: any }): ChainKey;
                public static toObject(m: ChainKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }

            interface IMessageKey {
                index?: (number|null);
                cipherKey?: (Uint8Array|null);
                macKey?: (Uint8Array|null);
                iv?: (Uint8Array|null);
            }

            class MessageKey implements IMessageKey {
                constructor(p?: IMessageKey);
                public index?: (number|null);
                public cipherKey?: (Uint8Array|null);
                public macKey?: (Uint8Array|null);
                public iv?: (Uint8Array|null);
                public static create(properties?: IMessageKey): MessageKey;
                public static encode(m: IMessageKey, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MessageKey;
                public static fromObject(d: { [k: string]: any }): MessageKey;
                public static toObject(m: MessageKey, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }
    }

    namespace StatusAttribution {

        enum Type {
            UNKNOWN = 0,
            RESHARE = 1,
            EXTERNAL_SHARE = 2,
            MUSIC = 3,
            STATUS_MENTION = 4,
            GROUP_STATUS = 5,
            RL_ATTRIBUTION = 6,
            AI_CREATED = 7,
            LAYOUTS = 8,
        }

        interface IAiCreatedAttribution {
            source?: proto.AiCreatedAttribution.Source|null;
        }

        class AiCreatedAttribution implements IAiCreatedAttribution {
            constructor(p?: IAiCreatedAttribution);
            public source?: proto.AiCreatedAttribution.Source|null;
            public static create(properties?: IAiCreatedAttribution): AiCreatedAttribution;
            public static encode(m: IAiCreatedAttribution, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiCreatedAttribution;
            public static fromObject(d: { [k: string]: any }): AiCreatedAttribution;
            public static toObject(m: AiCreatedAttribution, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IExternalShare {
            actionUrl?: (string|null);
            source?: proto.ExternalShare.Source|null;
            duration?: (number|null);
            actionFallbackUrl?: (string|null);
        }

        class ExternalShare implements IExternalShare {
            constructor(p?: IExternalShare);
            public actionUrl?: (string|null);
            public source?: proto.ExternalShare.Source|null;
            public duration?: (number|null);
            public actionFallbackUrl?: (string|null);
            public static create(properties?: IExternalShare): ExternalShare;
            public static encode(m: IExternalShare, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExternalShare;
            public static fromObject(d: { [k: string]: any }): ExternalShare;
            public static toObject(m: ExternalShare, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IGroupStatus {
            authorJid?: (string|null);
        }

        class GroupStatus implements IGroupStatus {
            constructor(p?: IGroupStatus);
            public authorJid?: (string|null);
            public static create(properties?: IGroupStatus): GroupStatus;
            public static encode(m: IGroupStatus, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): GroupStatus;
            public static fromObject(d: { [k: string]: any }): GroupStatus;
            public static toObject(m: GroupStatus, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMusic {
            authorName?: (string|null);
            songId?: (string|null);
            title?: (string|null);
            author?: (string|null);
            artistAttribution?: (string|null);
            isExplicit?: (boolean|null);
        }

        class Music implements IMusic {
            constructor(p?: IMusic);
            public authorName?: (string|null);
            public songId?: (string|null);
            public title?: (string|null);
            public author?: (string|null);
            public artistAttribution?: (string|null);
            public isExplicit?: (boolean|null);
            public static create(properties?: IMusic): Music;
            public static encode(m: IMusic, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Music;
            public static fromObject(d: { [k: string]: any }): Music;
            public static toObject(m: Music, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRlAttribution {
            source?: proto.RlAttribution.Source|null;
        }

        class RlAttribution implements IRlAttribution {
            constructor(p?: IRlAttribution);
            public source?: proto.RlAttribution.Source|null;
            public static create(properties?: IRlAttribution): RlAttribution;
            public static encode(m: IRlAttribution, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RlAttribution;
            public static fromObject(d: { [k: string]: any }): RlAttribution;
            public static toObject(m: RlAttribution, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusReshare {
            source?: proto.StatusReshare.Source|null;
            metadata?: (proto.IMetadata|null);
        }

        class StatusReshare implements IStatusReshare {
            constructor(p?: IStatusReshare);
            public source?: proto.StatusReshare.Source|null;
            public metadata?: (proto.IMetadata|null);
            public static create(properties?: IStatusReshare): StatusReshare;
            public static encode(m: IStatusReshare, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusReshare;
            public static fromObject(d: { [k: string]: any }): StatusReshare;
            public static toObject(m: StatusReshare, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AiCreatedAttribution {

            enum Source {
                UNKNOWN = 0,
                STATUS_MIMICRY = 1,
            }
        }

        namespace ExternalShare {

            enum Source {
                UNKNOWN = 0,
                INSTAGRAM = 1,
                FACEBOOK = 2,
                MESSENGER = 3,
                SPOTIFY = 4,
                YOUTUBE = 5,
                PINTEREST = 6,
                THREADS = 7,
                APPLE_MUSIC = 8,
                SHARECHAT = 9,
                GOOGLE_PHOTOS = 10,
            }
        }

        namespace RlAttribution {

            enum Source {
                UNKNOWN = 0,
                RAY_BAN_META_GLASSES = 1,
                OAKLEY_META_GLASSES = 2,
                HYPERNOVA_GLASSES = 3,
            }
        }

        namespace StatusReshare {

            enum Source {
                UNKNOWN = 0,
                INTERNAL_RESHARE = 1,
                MENTION_RESHARE = 2,
                CHANNEL_RESHARE = 3,
                FORWARD = 4,
            }

            interface IMetadata {
                duration?: (number|null);
                channelJid?: (string|null);
                channelMessageId?: (number|null);
                hasMultipleReshares?: (boolean|null);
            }

            class Metadata implements IMetadata {
                constructor(p?: IMetadata);
                public duration?: (number|null);
                public channelJid?: (string|null);
                public channelMessageId?: (number|null);
                public hasMultipleReshares?: (boolean|null);
                public static create(properties?: IMetadata): Metadata;
                public static encode(m: IMetadata, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Metadata;
                public static fromObject(d: { [k: string]: any }): Metadata;
                public static toObject(m: Metadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }
    }

    namespace SyncActionValue {

        interface IAgentAction {
            name?: (string|null);
            deviceId?: (number|null);
            isDeleted?: (boolean|null);
        }

        class AgentAction implements IAgentAction {
            constructor(p?: IAgentAction);
            public name?: (string|null);
            public deviceId?: (number|null);
            public isDeleted?: (boolean|null);
            public static create(properties?: IAgentAction): AgentAction;
            public static encode(m: IAgentAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AgentAction;
            public static fromObject(d: { [k: string]: any }): AgentAction;
            public static toObject(m: AgentAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAiThreadRenameAction {
            newTitle?: (string|null);
        }

        class AiThreadRenameAction implements IAiThreadRenameAction {
            constructor(p?: IAiThreadRenameAction);
            public newTitle?: (string|null);
            public static create(properties?: IAiThreadRenameAction): AiThreadRenameAction;
            public static encode(m: IAiThreadRenameAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AiThreadRenameAction;
            public static fromObject(d: { [k: string]: any }): AiThreadRenameAction;
            public static toObject(m: AiThreadRenameAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAndroidUnsupportedActions {
            allowed?: (boolean|null);
        }

        class AndroidUnsupportedActions implements IAndroidUnsupportedActions {
            constructor(p?: IAndroidUnsupportedActions);
            public allowed?: (boolean|null);
            public static create(properties?: IAndroidUnsupportedActions): AndroidUnsupportedActions;
            public static encode(m: IAndroidUnsupportedActions, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AndroidUnsupportedActions;
            public static fromObject(d: { [k: string]: any }): AndroidUnsupportedActions;
            public static toObject(m: AndroidUnsupportedActions, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IArchiveChatAction {
            archived?: (boolean|null);
            messageRange?: (proto.ISyncActionMessageRange|null);
        }

        class ArchiveChatAction implements IArchiveChatAction {
            constructor(p?: IArchiveChatAction);
            public archived?: (boolean|null);
            public messageRange?: (proto.ISyncActionMessageRange|null);
            public static create(properties?: IArchiveChatAction): ArchiveChatAction;
            public static encode(m: IArchiveChatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ArchiveChatAction;
            public static fromObject(d: { [k: string]: any }): ArchiveChatAction;
            public static toObject(m: ArchiveChatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IAvatarUpdatedAction {
            eventType?: proto.AvatarUpdatedAction.AvatarEventType|null;
            recentAvatarStickers?: proto.IStickerAction[];
        }

        class AvatarUpdatedAction implements IAvatarUpdatedAction {
            constructor(p?: IAvatarUpdatedAction);
            public eventType?: proto.AvatarUpdatedAction.AvatarEventType|null;
            public recentAvatarStickers: proto.IStickerAction[];
            public static create(properties?: IAvatarUpdatedAction): AvatarUpdatedAction;
            public static encode(m: IAvatarUpdatedAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): AvatarUpdatedAction;
            public static fromObject(d: { [k: string]: any }): AvatarUpdatedAction;
            public static toObject(m: AvatarUpdatedAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBotWelcomeRequestAction {
            isSent?: (boolean|null);
        }

        class BotWelcomeRequestAction implements IBotWelcomeRequestAction {
            constructor(p?: IBotWelcomeRequestAction);
            public isSent?: (boolean|null);
            public static create(properties?: IBotWelcomeRequestAction): BotWelcomeRequestAction;
            public static encode(m: IBotWelcomeRequestAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BotWelcomeRequestAction;
            public static fromObject(d: { [k: string]: any }): BotWelcomeRequestAction;
            public static toObject(m: BotWelcomeRequestAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBroadcastListParticipant {
            lidJid?: string;
            pnJid?: (string|null);
        }

        class BroadcastListParticipant implements IBroadcastListParticipant {
            constructor(p?: IBroadcastListParticipant);
            public lidJid: string;
            public pnJid?: (string|null);
            public static create(properties?: IBroadcastListParticipant): BroadcastListParticipant;
            public static encode(m: IBroadcastListParticipant, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BroadcastListParticipant;
            public static fromObject(d: { [k: string]: any }): BroadcastListParticipant;
            public static toObject(m: BroadcastListParticipant, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBusinessBroadcastAssociationAction {
            deleted?: (boolean|null);
        }

        class BusinessBroadcastAssociationAction implements IBusinessBroadcastAssociationAction {
            constructor(p?: IBusinessBroadcastAssociationAction);
            public deleted?: (boolean|null);
            public static create(properties?: IBusinessBroadcastAssociationAction): BusinessBroadcastAssociationAction;
            public static encode(m: IBusinessBroadcastAssociationAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BusinessBroadcastAssociationAction;
            public static fromObject(d: { [k: string]: any }): BusinessBroadcastAssociationAction;
            public static toObject(m: BusinessBroadcastAssociationAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IBusinessBroadcastListAction {
            deleted?: (boolean|null);
            participants?: proto.IBroadcastListParticipant[];
            listName?: (string|null);
            labelIds?: string[];
        }

        class BusinessBroadcastListAction implements IBusinessBroadcastListAction {
            constructor(p?: IBusinessBroadcastListAction);
            public deleted?: (boolean|null);
            public participants: proto.IBroadcastListParticipant[];
            public listName?: (string|null);
            public labelIds: string[];
            public static create(properties?: IBusinessBroadcastListAction): BusinessBroadcastListAction;
            public static encode(m: IBusinessBroadcastListAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): BusinessBroadcastListAction;
            public static fromObject(d: { [k: string]: any }): BusinessBroadcastListAction;
            public static toObject(m: BusinessBroadcastListAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICallLogAction {
            callLogRecord?: (proto.ICallLogRecord|null);
        }

        class CallLogAction implements ICallLogAction {
            constructor(p?: ICallLogAction);
            public callLogRecord?: (proto.ICallLogRecord|null);
            public static create(properties?: ICallLogAction): CallLogAction;
            public static encode(m: ICallLogAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CallLogAction;
            public static fromObject(d: { [k: string]: any }): CallLogAction;
            public static toObject(m: CallLogAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IChatAssignmentAction {
            deviceAgentId?: (string|null);
        }

        class ChatAssignmentAction implements IChatAssignmentAction {
            constructor(p?: IChatAssignmentAction);
            public deviceAgentId?: (string|null);
            public static create(properties?: IChatAssignmentAction): ChatAssignmentAction;
            public static encode(m: IChatAssignmentAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ChatAssignmentAction;
            public static fromObject(d: { [k: string]: any }): ChatAssignmentAction;
            public static toObject(m: ChatAssignmentAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IChatAssignmentOpenedStatusAction {
            chatOpened?: (boolean|null);
        }

        class ChatAssignmentOpenedStatusAction implements IChatAssignmentOpenedStatusAction {
            constructor(p?: IChatAssignmentOpenedStatusAction);
            public chatOpened?: (boolean|null);
            public static create(properties?: IChatAssignmentOpenedStatusAction): ChatAssignmentOpenedStatusAction;
            public static encode(m: IChatAssignmentOpenedStatusAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ChatAssignmentOpenedStatusAction;
            public static fromObject(d: { [k: string]: any }): ChatAssignmentOpenedStatusAction;
            public static toObject(m: ChatAssignmentOpenedStatusAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IClearChatAction {
            messageRange?: (proto.ISyncActionMessageRange|null);
        }

        class ClearChatAction implements IClearChatAction {
            constructor(p?: IClearChatAction);
            public messageRange?: (proto.ISyncActionMessageRange|null);
            public static create(properties?: IClearChatAction): ClearChatAction;
            public static encode(m: IClearChatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ClearChatAction;
            public static fromObject(d: { [k: string]: any }): ClearChatAction;
            public static toObject(m: ClearChatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IContactAction {
            fullName?: (string|null);
            firstName?: (string|null);
            lidJid?: (string|null);
            saveOnPrimaryAddressbook?: (boolean|null);
            pnJid?: (string|null);
            username?: (string|null);
        }

        class ContactAction implements IContactAction {
            constructor(p?: IContactAction);
            public fullName?: (string|null);
            public firstName?: (string|null);
            public lidJid?: (string|null);
            public saveOnPrimaryAddressbook?: (boolean|null);
            public pnJid?: (string|null);
            public username?: (string|null);
            public static create(properties?: IContactAction): ContactAction;
            public static encode(m: IContactAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ContactAction;
            public static fromObject(d: { [k: string]: any }): ContactAction;
            public static toObject(m: ContactAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICtwaPerCustomerDataSharingAction {
            isCtwaPerCustomerDataSharingEnabled?: (boolean|null);
        }

        class CtwaPerCustomerDataSharingAction implements ICtwaPerCustomerDataSharingAction {
            constructor(p?: ICtwaPerCustomerDataSharingAction);
            public isCtwaPerCustomerDataSharingEnabled?: (boolean|null);
            public static create(properties?: ICtwaPerCustomerDataSharingAction): CtwaPerCustomerDataSharingAction;
            public static encode(m: ICtwaPerCustomerDataSharingAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CtwaPerCustomerDataSharingAction;
            public static fromObject(d: { [k: string]: any }): CtwaPerCustomerDataSharingAction;
            public static toObject(m: CtwaPerCustomerDataSharingAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICustomPaymentMethod {
            credentialId?: string;
            country?: string;
            type?: string;
            metadata?: proto.ICustomPaymentMethodMetadata[];
        }

        class CustomPaymentMethod implements ICustomPaymentMethod {
            constructor(p?: ICustomPaymentMethod);
            public credentialId: string;
            public country: string;
            public type: string;
            public metadata: proto.ICustomPaymentMethodMetadata[];
            public static create(properties?: ICustomPaymentMethod): CustomPaymentMethod;
            public static encode(m: ICustomPaymentMethod, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CustomPaymentMethod;
            public static fromObject(d: { [k: string]: any }): CustomPaymentMethod;
            public static toObject(m: CustomPaymentMethod, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICustomPaymentMethodMetadata {
            key?: string;
            value?: string;
        }

        class CustomPaymentMethodMetadata implements ICustomPaymentMethodMetadata {
            constructor(p?: ICustomPaymentMethodMetadata);
            public key: string;
            public value: string;
            public static create(properties?: ICustomPaymentMethodMetadata): CustomPaymentMethodMetadata;
            public static encode(m: ICustomPaymentMethodMetadata, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CustomPaymentMethodMetadata;
            public static fromObject(d: { [k: string]: any }): CustomPaymentMethodMetadata;
            public static toObject(m: CustomPaymentMethodMetadata, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ICustomPaymentMethodsAction {
            customPaymentMethods?: proto.ICustomPaymentMethod[];
        }

        class CustomPaymentMethodsAction implements ICustomPaymentMethodsAction {
            constructor(p?: ICustomPaymentMethodsAction);
            public customPaymentMethods: proto.ICustomPaymentMethod[];
            public static create(properties?: ICustomPaymentMethodsAction): CustomPaymentMethodsAction;
            public static encode(m: ICustomPaymentMethodsAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CustomPaymentMethodsAction;
            public static fromObject(d: { [k: string]: any }): CustomPaymentMethodsAction;
            public static toObject(m: CustomPaymentMethodsAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDeleteChatAction {
            messageRange?: (proto.ISyncActionMessageRange|null);
        }

        class DeleteChatAction implements IDeleteChatAction {
            constructor(p?: IDeleteChatAction);
            public messageRange?: (proto.ISyncActionMessageRange|null);
            public static create(properties?: IDeleteChatAction): DeleteChatAction;
            public static encode(m: IDeleteChatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeleteChatAction;
            public static fromObject(d: { [k: string]: any }): DeleteChatAction;
            public static toObject(m: DeleteChatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDeleteIndividualCallLogAction {
            peerJid?: (string|null);
            isIncoming?: (boolean|null);
        }

        class DeleteIndividualCallLogAction implements IDeleteIndividualCallLogAction {
            constructor(p?: IDeleteIndividualCallLogAction);
            public peerJid?: (string|null);
            public isIncoming?: (boolean|null);
            public static create(properties?: IDeleteIndividualCallLogAction): DeleteIndividualCallLogAction;
            public static encode(m: IDeleteIndividualCallLogAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeleteIndividualCallLogAction;
            public static fromObject(d: { [k: string]: any }): DeleteIndividualCallLogAction;
            public static toObject(m: DeleteIndividualCallLogAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDeleteMessageForMeAction {
            deleteMedia?: (boolean|null);
            messageTimestamp?: (number|Long|null);
        }

        class DeleteMessageForMeAction implements IDeleteMessageForMeAction {
            constructor(p?: IDeleteMessageForMeAction);
            public deleteMedia?: (boolean|null);
            public messageTimestamp?: (number|Long|null);
            public static create(properties?: IDeleteMessageForMeAction): DeleteMessageForMeAction;
            public static encode(m: IDeleteMessageForMeAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DeleteMessageForMeAction;
            public static fromObject(d: { [k: string]: any }): DeleteMessageForMeAction;
            public static toObject(m: DeleteMessageForMeAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IDetectedOutcomesStatusAction {
            isEnabled?: (boolean|null);
        }

        class DetectedOutcomesStatusAction implements IDetectedOutcomesStatusAction {
            constructor(p?: IDetectedOutcomesStatusAction);
            public isEnabled?: (boolean|null);
            public static create(properties?: IDetectedOutcomesStatusAction): DetectedOutcomesStatusAction;
            public static encode(m: IDetectedOutcomesStatusAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): DetectedOutcomesStatusAction;
            public static fromObject(d: { [k: string]: any }): DetectedOutcomesStatusAction;
            public static toObject(m: DetectedOutcomesStatusAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IExternalWebBetaAction {
            isOptIn?: (boolean|null);
        }

        class ExternalWebBetaAction implements IExternalWebBetaAction {
            constructor(p?: IExternalWebBetaAction);
            public isOptIn?: (boolean|null);
            public static create(properties?: IExternalWebBetaAction): ExternalWebBetaAction;
            public static encode(m: IExternalWebBetaAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): ExternalWebBetaAction;
            public static fromObject(d: { [k: string]: any }): ExternalWebBetaAction;
            public static toObject(m: ExternalWebBetaAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IFavoritesAction {
            favorites?: proto.IFavorite[];
        }

        class FavoritesAction implements IFavoritesAction {
            constructor(p?: IFavoritesAction);
            public favorites: proto.IFavorite[];
            public static create(properties?: IFavoritesAction): FavoritesAction;
            public static encode(m: IFavoritesAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): FavoritesAction;
            public static fromObject(d: { [k: string]: any }): FavoritesAction;
            public static toObject(m: FavoritesAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IInteractiveMessageAction {
            type?: proto.InteractiveMessageAction.InteractiveMessageActionMode;
        }

        class InteractiveMessageAction implements IInteractiveMessageAction {
            constructor(p?: IInteractiveMessageAction);
            public type: proto.InteractiveMessageAction.InteractiveMessageActionMode;
            public static create(properties?: IInteractiveMessageAction): InteractiveMessageAction;
            public static encode(m: IInteractiveMessageAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): InteractiveMessageAction;
            public static fromObject(d: { [k: string]: any }): InteractiveMessageAction;
            public static toObject(m: InteractiveMessageAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IKeyExpiration {
            expiredKeyEpoch?: (number|null);
        }

        class KeyExpiration implements IKeyExpiration {
            constructor(p?: IKeyExpiration);
            public expiredKeyEpoch?: (number|null);
            public static create(properties?: IKeyExpiration): KeyExpiration;
            public static encode(m: IKeyExpiration, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): KeyExpiration;
            public static fromObject(d: { [k: string]: any }): KeyExpiration;
            public static toObject(m: KeyExpiration, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILabelAssociationAction {
            labeled?: (boolean|null);
        }

        class LabelAssociationAction implements ILabelAssociationAction {
            constructor(p?: ILabelAssociationAction);
            public labeled?: (boolean|null);
            public static create(properties?: ILabelAssociationAction): LabelAssociationAction;
            public static encode(m: ILabelAssociationAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LabelAssociationAction;
            public static fromObject(d: { [k: string]: any }): LabelAssociationAction;
            public static toObject(m: LabelAssociationAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILabelEditAction {
            name?: (string|null);
            color?: (number|null);
            predefinedId?: (number|null);
            deleted?: (boolean|null);
            orderIndex?: (number|null);
            isActive?: (boolean|null);
            type?: proto.LabelEditAction.ListType|null;
            isImmutable?: (boolean|null);
            muteEndTimeMs?: (number|Long|null);
        }

        class LabelEditAction implements ILabelEditAction {
            constructor(p?: ILabelEditAction);
            public name?: (string|null);
            public color?: (number|null);
            public predefinedId?: (number|null);
            public deleted?: (boolean|null);
            public orderIndex?: (number|null);
            public isActive?: (boolean|null);
            public type?: proto.LabelEditAction.ListType|null;
            public isImmutable?: (boolean|null);
            public muteEndTimeMs?: (number|Long|null);
            public static create(properties?: ILabelEditAction): LabelEditAction;
            public static encode(m: ILabelEditAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LabelEditAction;
            public static fromObject(d: { [k: string]: any }): LabelEditAction;
            public static toObject(m: LabelEditAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILabelReorderingAction {
            sortedLabelIds?: number[];
        }

        class LabelReorderingAction implements ILabelReorderingAction {
            constructor(p?: ILabelReorderingAction);
            public sortedLabelIds: number[];
            public static create(properties?: ILabelReorderingAction): LabelReorderingAction;
            public static encode(m: ILabelReorderingAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LabelReorderingAction;
            public static fromObject(d: { [k: string]: any }): LabelReorderingAction;
            public static toObject(m: LabelReorderingAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILidContactAction {
            fullName?: (string|null);
            firstName?: (string|null);
            username?: (string|null);
        }

        class LidContactAction implements ILidContactAction {
            constructor(p?: ILidContactAction);
            public fullName?: (string|null);
            public firstName?: (string|null);
            public username?: (string|null);
            public static create(properties?: ILidContactAction): LidContactAction;
            public static encode(m: ILidContactAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LidContactAction;
            public static fromObject(d: { [k: string]: any }): LidContactAction;
            public static toObject(m: LidContactAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILocaleSetting {
            locale?: (string|null);
        }

        class LocaleSetting implements ILocaleSetting {
            constructor(p?: ILocaleSetting);
            public locale?: (string|null);
            public static create(properties?: ILocaleSetting): LocaleSetting;
            public static encode(m: ILocaleSetting, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LocaleSetting;
            public static fromObject(d: { [k: string]: any }): LocaleSetting;
            public static toObject(m: LocaleSetting, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ILockChatAction {
            locked?: (boolean|null);
        }

        class LockChatAction implements ILockChatAction {
            constructor(p?: ILockChatAction);
            public locked?: (boolean|null);
            public static create(properties?: ILockChatAction): LockChatAction;
            public static encode(m: ILockChatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): LockChatAction;
            public static fromObject(d: { [k: string]: any }): LockChatAction;
            public static toObject(m: LockChatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMaibaAiFeaturesControlAction {
            aiFeatureStatus?: proto.MaibaAiFeaturesControlAction.MaibaAiFeatureStatus|null;
        }

        class MaibaAiFeaturesControlAction implements IMaibaAiFeaturesControlAction {
            constructor(p?: IMaibaAiFeaturesControlAction);
            public aiFeatureStatus?: proto.MaibaAiFeaturesControlAction.MaibaAiFeatureStatus|null;
            public static create(properties?: IMaibaAiFeaturesControlAction): MaibaAiFeaturesControlAction;
            public static encode(m: IMaibaAiFeaturesControlAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MaibaAiFeaturesControlAction;
            public static fromObject(d: { [k: string]: any }): MaibaAiFeaturesControlAction;
            public static toObject(m: MaibaAiFeaturesControlAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMarkChatAsReadAction {
            read?: (boolean|null);
            messageRange?: (proto.ISyncActionMessageRange|null);
        }

        class MarkChatAsReadAction implements IMarkChatAsReadAction {
            constructor(p?: IMarkChatAsReadAction);
            public read?: (boolean|null);
            public messageRange?: (proto.ISyncActionMessageRange|null);
            public static create(properties?: IMarkChatAsReadAction): MarkChatAsReadAction;
            public static encode(m: IMarkChatAsReadAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MarkChatAsReadAction;
            public static fromObject(d: { [k: string]: any }): MarkChatAsReadAction;
            public static toObject(m: MarkChatAsReadAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMarketingMessageAction {
            name?: (string|null);
            message?: (string|null);
            type?: proto.MarketingMessageAction.MarketingMessagePrototypeType|null;
            createdAt?: (number|Long|null);
            lastSentAt?: (number|Long|null);
            isDeleted?: (boolean|null);
            mediaId?: (string|null);
        }

        class MarketingMessageAction implements IMarketingMessageAction {
            constructor(p?: IMarketingMessageAction);
            public name?: (string|null);
            public message?: (string|null);
            public type?: proto.MarketingMessageAction.MarketingMessagePrototypeType|null;
            public createdAt?: (number|Long|null);
            public lastSentAt?: (number|Long|null);
            public isDeleted?: (boolean|null);
            public mediaId?: (string|null);
            public static create(properties?: IMarketingMessageAction): MarketingMessageAction;
            public static encode(m: IMarketingMessageAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MarketingMessageAction;
            public static fromObject(d: { [k: string]: any }): MarketingMessageAction;
            public static toObject(m: MarketingMessageAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMarketingMessageBroadcastAction {
            repliedCount?: (number|null);
        }

        class MarketingMessageBroadcastAction implements IMarketingMessageBroadcastAction {
            constructor(p?: IMarketingMessageBroadcastAction);
            public repliedCount?: (number|null);
            public static create(properties?: IMarketingMessageBroadcastAction): MarketingMessageBroadcastAction;
            public static encode(m: IMarketingMessageBroadcastAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MarketingMessageBroadcastAction;
            public static fromObject(d: { [k: string]: any }): MarketingMessageBroadcastAction;
            public static toObject(m: MarketingMessageBroadcastAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMerchantPaymentPartnerAction {
            status?: proto.MerchantPaymentPartnerAction.Status;
            country?: string;
            gatewayName?: (string|null);
            credentialId?: (string|null);
        }

        class MerchantPaymentPartnerAction implements IMerchantPaymentPartnerAction {
            constructor(p?: IMerchantPaymentPartnerAction);
            public status: proto.MerchantPaymentPartnerAction.Status;
            public country: string;
            public gatewayName?: (string|null);
            public credentialId?: (string|null);
            public static create(properties?: IMerchantPaymentPartnerAction): MerchantPaymentPartnerAction;
            public static encode(m: IMerchantPaymentPartnerAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MerchantPaymentPartnerAction;
            public static fromObject(d: { [k: string]: any }): MerchantPaymentPartnerAction;
            public static toObject(m: MerchantPaymentPartnerAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMusicUserIdAction {
            musicUserId?: (string|null);
            musicUserIdMap?: proto.IHashMap;
        }

        class MusicUserIdAction implements IMusicUserIdAction {
            constructor(p?: IMusicUserIdAction);
            public musicUserId?: (string|null);
            public musicUserIdMap: proto.IHashMap;
            public static create(properties?: IMusicUserIdAction): MusicUserIdAction;
            public static encode(m: IMusicUserIdAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MusicUserIdAction;
            public static fromObject(d: { [k: string]: any }): MusicUserIdAction;
            public static toObject(m: MusicUserIdAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IMuteAction {
            muted?: (boolean|null);
            muteEndTimestamp?: (number|Long|null);
            autoMuted?: (boolean|null);
        }

        class MuteAction implements IMuteAction {
            constructor(p?: IMuteAction);
            public muted?: (boolean|null);
            public muteEndTimestamp?: (number|Long|null);
            public autoMuted?: (boolean|null);
            public static create(properties?: IMuteAction): MuteAction;
            public static encode(m: IMuteAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): MuteAction;
            public static fromObject(d: { [k: string]: any }): MuteAction;
            public static toObject(m: MuteAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INewsletterSavedInterestsAction {
            newsletterSavedInterests?: (string|null);
        }

        class NewsletterSavedInterestsAction implements INewsletterSavedInterestsAction {
            constructor(p?: INewsletterSavedInterestsAction);
            public newsletterSavedInterests?: (string|null);
            public static create(properties?: INewsletterSavedInterestsAction): NewsletterSavedInterestsAction;
            public static encode(m: INewsletterSavedInterestsAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NewsletterSavedInterestsAction;
            public static fromObject(d: { [k: string]: any }): NewsletterSavedInterestsAction;
            public static toObject(m: NewsletterSavedInterestsAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INoteEditAction {
            type?: proto.NoteEditAction.NoteType|null;
            chatJid?: (string|null);
            createdAt?: (number|Long|null);
            deleted?: (boolean|null);
            unstructuredContent?: (string|null);
        }

        class NoteEditAction implements INoteEditAction {
            constructor(p?: INoteEditAction);
            public type?: proto.NoteEditAction.NoteType|null;
            public chatJid?: (string|null);
            public createdAt?: (number|Long|null);
            public deleted?: (boolean|null);
            public unstructuredContent?: (string|null);
            public static create(properties?: INoteEditAction): NoteEditAction;
            public static encode(m: INoteEditAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NoteEditAction;
            public static fromObject(d: { [k: string]: any }): NoteEditAction;
            public static toObject(m: NoteEditAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INotificationActivitySettingAction {
            notificationActivitySetting?: proto.NotificationActivitySettingAction.NotificationActivitySetting|null;
        }

        class NotificationActivitySettingAction implements INotificationActivitySettingAction {
            constructor(p?: INotificationActivitySettingAction);
            public notificationActivitySetting?: proto.NotificationActivitySettingAction.NotificationActivitySetting|null;
            public static create(properties?: INotificationActivitySettingAction): NotificationActivitySettingAction;
            public static encode(m: INotificationActivitySettingAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NotificationActivitySettingAction;
            public static fromObject(d: { [k: string]: any }): NotificationActivitySettingAction;
            public static toObject(m: NotificationActivitySettingAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface INuxAction {
            acknowledged?: (boolean|null);
        }

        class NuxAction implements INuxAction {
            constructor(p?: INuxAction);
            public acknowledged?: (boolean|null);
            public static create(properties?: INuxAction): NuxAction;
            public static encode(m: INuxAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): NuxAction;
            public static fromObject(d: { [k: string]: any }): NuxAction;
            public static toObject(m: NuxAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPaymentInfoAction {
            cpi?: (string|null);
        }

        class PaymentInfoAction implements IPaymentInfoAction {
            constructor(p?: IPaymentInfoAction);
            public cpi?: (string|null);
            public static create(properties?: IPaymentInfoAction): PaymentInfoAction;
            public static encode(m: IPaymentInfoAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentInfoAction;
            public static fromObject(d: { [k: string]: any }): PaymentInfoAction;
            public static toObject(m: PaymentInfoAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPaymentTosAction {
            paymentNotice?: proto.PaymentTosAction.PaymentNotice;
            accepted?: boolean;
        }

        class PaymentTosAction implements IPaymentTosAction {
            constructor(p?: IPaymentTosAction);
            public paymentNotice: proto.PaymentTosAction.PaymentNotice;
            public accepted: boolean;
            public static create(properties?: IPaymentTosAction): PaymentTosAction;
            public static encode(m: IPaymentTosAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PaymentTosAction;
            public static fromObject(d: { [k: string]: any }): PaymentTosAction;
            public static toObject(m: PaymentTosAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPinAction {
            pinned?: (boolean|null);
        }

        class PinAction implements IPinAction {
            constructor(p?: IPinAction);
            public pinned?: (boolean|null);
            public static create(properties?: IPinAction): PinAction;
            public static encode(m: IPinAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PinAction;
            public static fromObject(d: { [k: string]: any }): PinAction;
            public static toObject(m: PinAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPnForLidChatAction {
            pnJid?: (string|null);
        }

        class PnForLidChatAction implements IPnForLidChatAction {
            constructor(p?: IPnForLidChatAction);
            public pnJid?: (string|null);
            public static create(properties?: IPnForLidChatAction): PnForLidChatAction;
            public static encode(m: IPnForLidChatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PnForLidChatAction;
            public static fromObject(d: { [k: string]: any }): PnForLidChatAction;
            public static toObject(m: PnForLidChatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrimaryFeature {
            flags?: string[];
        }

        class PrimaryFeature implements IPrimaryFeature {
            constructor(p?: IPrimaryFeature);
            public flags: string[];
            public static create(properties?: IPrimaryFeature): PrimaryFeature;
            public static encode(m: IPrimaryFeature, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrimaryFeature;
            public static fromObject(d: { [k: string]: any }): PrimaryFeature;
            public static toObject(m: PrimaryFeature, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrimaryVersionAction {
            version?: (string|null);
        }

        class PrimaryVersionAction implements IPrimaryVersionAction {
            constructor(p?: IPrimaryVersionAction);
            public version?: (string|null);
            public static create(properties?: IPrimaryVersionAction): PrimaryVersionAction;
            public static encode(m: IPrimaryVersionAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrimaryVersionAction;
            public static fromObject(d: { [k: string]: any }): PrimaryVersionAction;
            public static toObject(m: PrimaryVersionAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrivacySettingChannelsPersonalisedRecommendationAction {
            isUserOptedOut?: (boolean|null);
        }

        class PrivacySettingChannelsPersonalisedRecommendationAction implements IPrivacySettingChannelsPersonalisedRecommendationAction {
            constructor(p?: IPrivacySettingChannelsPersonalisedRecommendationAction);
            public isUserOptedOut?: (boolean|null);
            public static create(properties?: IPrivacySettingChannelsPersonalisedRecommendationAction): PrivacySettingChannelsPersonalisedRecommendationAction;
            public static encode(m: IPrivacySettingChannelsPersonalisedRecommendationAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrivacySettingChannelsPersonalisedRecommendationAction;
            public static fromObject(d: { [k: string]: any }): PrivacySettingChannelsPersonalisedRecommendationAction;
            public static toObject(m: PrivacySettingChannelsPersonalisedRecommendationAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrivacySettingDisableLinkPreviewsAction {
            isPreviewsDisabled?: (boolean|null);
        }

        class PrivacySettingDisableLinkPreviewsAction implements IPrivacySettingDisableLinkPreviewsAction {
            constructor(p?: IPrivacySettingDisableLinkPreviewsAction);
            public isPreviewsDisabled?: (boolean|null);
            public static create(properties?: IPrivacySettingDisableLinkPreviewsAction): PrivacySettingDisableLinkPreviewsAction;
            public static encode(m: IPrivacySettingDisableLinkPreviewsAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrivacySettingDisableLinkPreviewsAction;
            public static fromObject(d: { [k: string]: any }): PrivacySettingDisableLinkPreviewsAction;
            public static toObject(m: PrivacySettingDisableLinkPreviewsAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrivacySettingRelayAllCalls {
            isEnabled?: (boolean|null);
        }

        class PrivacySettingRelayAllCalls implements IPrivacySettingRelayAllCalls {
            constructor(p?: IPrivacySettingRelayAllCalls);
            public isEnabled?: (boolean|null);
            public static create(properties?: IPrivacySettingRelayAllCalls): PrivacySettingRelayAllCalls;
            public static encode(m: IPrivacySettingRelayAllCalls, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrivacySettingRelayAllCalls;
            public static fromObject(d: { [k: string]: any }): PrivacySettingRelayAllCalls;
            public static toObject(m: PrivacySettingRelayAllCalls, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPrivateProcessingSettingAction {
            privateProcessingStatus?: proto.PrivateProcessingSettingAction.PrivateProcessingStatus|null;
        }

        class PrivateProcessingSettingAction implements IPrivateProcessingSettingAction {
            constructor(p?: IPrivateProcessingSettingAction);
            public privateProcessingStatus?: proto.PrivateProcessingSettingAction.PrivateProcessingStatus|null;
            public static create(properties?: IPrivateProcessingSettingAction): PrivateProcessingSettingAction;
            public static encode(m: IPrivateProcessingSettingAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PrivateProcessingSettingAction;
            public static fromObject(d: { [k: string]: any }): PrivateProcessingSettingAction;
            public static toObject(m: PrivateProcessingSettingAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IPushNameSetting {
            name?: (string|null);
        }

        class PushNameSetting implements IPushNameSetting {
            constructor(p?: IPushNameSetting);
            public name?: (string|null);
            public static create(properties?: IPushNameSetting): PushNameSetting;
            public static encode(m: IPushNameSetting, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): PushNameSetting;
            public static fromObject(d: { [k: string]: any }): PushNameSetting;
            public static toObject(m: PushNameSetting, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IQuickReplyAction {
            shortcut?: (string|null);
            message?: (string|null);
            keywords?: string[];
            count?: (number|null);
            deleted?: (boolean|null);
        }

        class QuickReplyAction implements IQuickReplyAction {
            constructor(p?: IQuickReplyAction);
            public shortcut?: (string|null);
            public message?: (string|null);
            public keywords: string[];
            public count?: (number|null);
            public deleted?: (boolean|null);
            public static create(properties?: IQuickReplyAction): QuickReplyAction;
            public static encode(m: IQuickReplyAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): QuickReplyAction;
            public static fromObject(d: { [k: string]: any }): QuickReplyAction;
            public static toObject(m: QuickReplyAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRecentEmojiWeightsAction {
            weights?: proto.IRecentEmojiWeight[];
        }

        class RecentEmojiWeightsAction implements IRecentEmojiWeightsAction {
            constructor(p?: IRecentEmojiWeightsAction);
            public weights: proto.IRecentEmojiWeight[];
            public static create(properties?: IRecentEmojiWeightsAction): RecentEmojiWeightsAction;
            public static encode(m: IRecentEmojiWeightsAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RecentEmojiWeightsAction;
            public static fromObject(d: { [k: string]: any }): RecentEmojiWeightsAction;
            public static toObject(m: RecentEmojiWeightsAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IRemoveRecentStickerAction {
            lastStickerSentTs?: (number|Long|null);
        }

        class RemoveRecentStickerAction implements IRemoveRecentStickerAction {
            constructor(p?: IRemoveRecentStickerAction);
            public lastStickerSentTs?: (number|Long|null);
            public static create(properties?: IRemoveRecentStickerAction): RemoveRecentStickerAction;
            public static encode(m: IRemoveRecentStickerAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): RemoveRecentStickerAction;
            public static fromObject(d: { [k: string]: any }): RemoveRecentStickerAction;
            public static toObject(m: RemoveRecentStickerAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISettingsSyncAction {
            startAtLogin?: (boolean|null);
            minimizeToTray?: (boolean|null);
            language?: (string|null);
            replaceTextWithEmoji?: (boolean|null);
            bannerNotificationDisplayMode?: proto.SettingsSyncAction.DisplayMode|null;
            unreadCounterBadgeDisplayMode?: proto.SettingsSyncAction.DisplayMode|null;
            isMessagesNotificationEnabled?: (boolean|null);
            isCallsNotificationEnabled?: (boolean|null);
            isReactionsNotificationEnabled?: (boolean|null);
            isStatusReactionsNotificationEnabled?: (boolean|null);
            isTextPreviewForNotificationEnabled?: (boolean|null);
            defaultNotificationToneId?: (number|null);
            groupDefaultNotificationToneId?: (number|null);
            appTheme?: (number|null);
            wallpaperId?: (number|null);
            isDoodleWallpaperEnabled?: (boolean|null);
            fontSize?: (number|null);
            isPhotosAutodownloadEnabled?: (boolean|null);
            isAudiosAutodownloadEnabled?: (boolean|null);
            isVideosAutodownloadEnabled?: (boolean|null);
            isDocumentsAutodownloadEnabled?: (boolean|null);
            disableLinkPreviews?: (boolean|null);
            notificationToneId?: (number|null);
        }

        class SettingsSyncAction implements ISettingsSyncAction {
            constructor(p?: ISettingsSyncAction);
            public startAtLogin?: (boolean|null);
            public minimizeToTray?: (boolean|null);
            public language?: (string|null);
            public replaceTextWithEmoji?: (boolean|null);
            public bannerNotificationDisplayMode?: proto.SettingsSyncAction.DisplayMode|null;
            public unreadCounterBadgeDisplayMode?: proto.SettingsSyncAction.DisplayMode|null;
            public isMessagesNotificationEnabled?: (boolean|null);
            public isCallsNotificationEnabled?: (boolean|null);
            public isReactionsNotificationEnabled?: (boolean|null);
            public isStatusReactionsNotificationEnabled?: (boolean|null);
            public isTextPreviewForNotificationEnabled?: (boolean|null);
            public defaultNotificationToneId?: (number|null);
            public groupDefaultNotificationToneId?: (number|null);
            public appTheme?: (number|null);
            public wallpaperId?: (number|null);
            public isDoodleWallpaperEnabled?: (boolean|null);
            public fontSize?: (number|null);
            public isPhotosAutodownloadEnabled?: (boolean|null);
            public isAudiosAutodownloadEnabled?: (boolean|null);
            public isVideosAutodownloadEnabled?: (boolean|null);
            public isDocumentsAutodownloadEnabled?: (boolean|null);
            public disableLinkPreviews?: (boolean|null);
            public notificationToneId?: (number|null);
            public static create(properties?: ISettingsSyncAction): SettingsSyncAction;
            public static encode(m: ISettingsSyncAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SettingsSyncAction;
            public static fromObject(d: { [k: string]: any }): SettingsSyncAction;
            public static toObject(m: SettingsSyncAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStarAction {
            starred?: (boolean|null);
        }

        class StarAction implements IStarAction {
            constructor(p?: IStarAction);
            public starred?: (boolean|null);
            public static create(properties?: IStarAction): StarAction;
            public static encode(m: IStarAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StarAction;
            public static fromObject(d: { [k: string]: any }): StarAction;
            public static toObject(m: StarAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusPostOptInNotificationPreferencesAction {
            enabled?: (boolean|null);
        }

        class StatusPostOptInNotificationPreferencesAction implements IStatusPostOptInNotificationPreferencesAction {
            constructor(p?: IStatusPostOptInNotificationPreferencesAction);
            public enabled?: (boolean|null);
            public static create(properties?: IStatusPostOptInNotificationPreferencesAction): StatusPostOptInNotificationPreferencesAction;
            public static encode(m: IStatusPostOptInNotificationPreferencesAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusPostOptInNotificationPreferencesAction;
            public static fromObject(d: { [k: string]: any }): StatusPostOptInNotificationPreferencesAction;
            public static toObject(m: StatusPostOptInNotificationPreferencesAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStatusPrivacyAction {
            mode?: proto.StatusPrivacyAction.StatusDistributionMode|null;
            userJid?: string[];
        }

        class StatusPrivacyAction implements IStatusPrivacyAction {
            constructor(p?: IStatusPrivacyAction);
            public mode?: proto.StatusPrivacyAction.StatusDistributionMode|null;
            public userJid: string[];
            public static create(properties?: IStatusPrivacyAction): StatusPrivacyAction;
            public static encode(m: IStatusPrivacyAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StatusPrivacyAction;
            public static fromObject(d: { [k: string]: any }): StatusPrivacyAction;
            public static toObject(m: StatusPrivacyAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IStickerAction {
            url?: (string|null);
            fileEncSha256?: (Uint8Array|null);
            mediaKey?: (Uint8Array|null);
            mimetype?: (string|null);
            height?: (number|null);
            width?: (number|null);
            directPath?: (string|null);
            fileLength?: (number|Long|null);
            isFavorite?: (boolean|null);
            deviceIdHint?: (number|null);
            isLottie?: (boolean|null);
            imageHash?: (string|null);
            isAvatarSticker?: (boolean|null);
        }

        class StickerAction implements IStickerAction {
            constructor(p?: IStickerAction);
            public url?: (string|null);
            public fileEncSha256?: (Uint8Array|null);
            public mediaKey?: (Uint8Array|null);
            public mimetype?: (string|null);
            public height?: (number|null);
            public width?: (number|null);
            public directPath?: (string|null);
            public fileLength?: (number|Long|null);
            public isFavorite?: (boolean|null);
            public deviceIdHint?: (number|null);
            public isLottie?: (boolean|null);
            public imageHash?: (string|null);
            public isAvatarSticker?: (boolean|null);
            public static create(properties?: IStickerAction): StickerAction;
            public static encode(m: IStickerAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): StickerAction;
            public static fromObject(d: { [k: string]: any }): StickerAction;
            public static toObject(m: StickerAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISubscriptionAction {
            isDeactivated?: (boolean|null);
            isAutoRenewing?: (boolean|null);
            expirationDate?: (number|Long|null);
        }

        class SubscriptionAction implements ISubscriptionAction {
            constructor(p?: ISubscriptionAction);
            public isDeactivated?: (boolean|null);
            public isAutoRenewing?: (boolean|null);
            public expirationDate?: (number|Long|null);
            public static create(properties?: ISubscriptionAction): SubscriptionAction;
            public static encode(m: ISubscriptionAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SubscriptionAction;
            public static fromObject(d: { [k: string]: any }): SubscriptionAction;
            public static toObject(m: SubscriptionAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISyncActionMessage {
            key?: (proto.IMessageKey|null);
            timestamp?: (number|Long|null);
        }

        class SyncActionMessage implements ISyncActionMessage {
            constructor(p?: ISyncActionMessage);
            public key?: (proto.IMessageKey|null);
            public timestamp?: (number|Long|null);
            public static create(properties?: ISyncActionMessage): SyncActionMessage;
            public static encode(m: ISyncActionMessage, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncActionMessage;
            public static fromObject(d: { [k: string]: any }): SyncActionMessage;
            public static toObject(m: SyncActionMessage, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ISyncActionMessageRange {
            lastMessageTimestamp?: (number|Long|null);
            lastSystemMessageTimestamp?: (number|Long|null);
            messages?: proto.ISyncActionMessage[];
        }

        class SyncActionMessageRange implements ISyncActionMessageRange {
            constructor(p?: ISyncActionMessageRange);
            public lastMessageTimestamp?: (number|Long|null);
            public lastSystemMessageTimestamp?: (number|Long|null);
            public messages: proto.ISyncActionMessage[];
            public static create(properties?: ISyncActionMessageRange): SyncActionMessageRange;
            public static encode(m: ISyncActionMessageRange, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): SyncActionMessageRange;
            public static fromObject(d: { [k: string]: any }): SyncActionMessageRange;
            public static toObject(m: SyncActionMessageRange, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface ITimeFormatAction {
            isTwentyFourHourFormatEnabled?: (boolean|null);
        }

        class TimeFormatAction implements ITimeFormatAction {
            constructor(p?: ITimeFormatAction);
            public isTwentyFourHourFormatEnabled?: (boolean|null);
            public static create(properties?: ITimeFormatAction): TimeFormatAction;
            public static encode(m: ITimeFormatAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TimeFormatAction;
            public static fromObject(d: { [k: string]: any }): TimeFormatAction;
            public static toObject(m: TimeFormatAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUgcBot {
            definition?: (Uint8Array|null);
        }

        class UgcBot implements IUgcBot {
            constructor(p?: IUgcBot);
            public definition?: (Uint8Array|null);
            public static create(properties?: IUgcBot): UgcBot;
            public static encode(m: IUgcBot, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UgcBot;
            public static fromObject(d: { [k: string]: any }): UgcBot;
            public static toObject(m: UgcBot, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUnarchiveChatsSetting {
            unarchiveChats?: (boolean|null);
        }

        class UnarchiveChatsSetting implements IUnarchiveChatsSetting {
            constructor(p?: IUnarchiveChatsSetting);
            public unarchiveChats?: (boolean|null);
            public static create(properties?: IUnarchiveChatsSetting): UnarchiveChatsSetting;
            public static encode(m: IUnarchiveChatsSetting, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UnarchiveChatsSetting;
            public static fromObject(d: { [k: string]: any }): UnarchiveChatsSetting;
            public static toObject(m: UnarchiveChatsSetting, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUserStatusMuteAction {
            muted?: (boolean|null);
        }

        class UserStatusMuteAction implements IUserStatusMuteAction {
            constructor(p?: IUserStatusMuteAction);
            public muted?: (boolean|null);
            public static create(properties?: IUserStatusMuteAction): UserStatusMuteAction;
            public static encode(m: IUserStatusMuteAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UserStatusMuteAction;
            public static fromObject(d: { [k: string]: any }): UserStatusMuteAction;
            public static toObject(m: UserStatusMuteAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUsernameChatStartModeAction {
            chatStartMode?: proto.UsernameChatStartModeAction.ChatStartMode|null;
        }

        class UsernameChatStartModeAction implements IUsernameChatStartModeAction {
            constructor(p?: IUsernameChatStartModeAction);
            public chatStartMode?: proto.UsernameChatStartModeAction.ChatStartMode|null;
            public static create(properties?: IUsernameChatStartModeAction): UsernameChatStartModeAction;
            public static encode(m: IUsernameChatStartModeAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UsernameChatStartModeAction;
            public static fromObject(d: { [k: string]: any }): UsernameChatStartModeAction;
            public static toObject(m: UsernameChatStartModeAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IWaffleAccountLinkStateAction {
            linkState?: proto.WaffleAccountLinkStateAction.AccountLinkState|null;
        }

        class WaffleAccountLinkStateAction implements IWaffleAccountLinkStateAction {
            constructor(p?: IWaffleAccountLinkStateAction);
            public linkState?: proto.WaffleAccountLinkStateAction.AccountLinkState|null;
            public static create(properties?: IWaffleAccountLinkStateAction): WaffleAccountLinkStateAction;
            public static encode(m: IWaffleAccountLinkStateAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WaffleAccountLinkStateAction;
            public static fromObject(d: { [k: string]: any }): WaffleAccountLinkStateAction;
            public static toObject(m: WaffleAccountLinkStateAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IWamoUserIdentifierAction {
            identifier?: (string|null);
        }

        class WamoUserIdentifierAction implements IWamoUserIdentifierAction {
            constructor(p?: IWamoUserIdentifierAction);
            public identifier?: (string|null);
            public static create(properties?: IWamoUserIdentifierAction): WamoUserIdentifierAction;
            public static encode(m: IWamoUserIdentifierAction, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): WamoUserIdentifierAction;
            public static fromObject(d: { [k: string]: any }): WamoUserIdentifierAction;
            public static toObject(m: WamoUserIdentifierAction, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace AvatarUpdatedAction {

            enum AvatarEventType {
                UPDATED = 0,
                CREATED = 1,
                DELETED = 2,
            }
        }

        namespace FavoritesAction {

            interface IFavorite {
                id?: (string|null);
            }

            class Favorite implements IFavorite {
                constructor(p?: IFavorite);
                public id?: (string|null);
                public static create(properties?: IFavorite): Favorite;
                public static encode(m: IFavorite, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Favorite;
                public static fromObject(d: { [k: string]: any }): Favorite;
                public static toObject(m: Favorite, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }

        namespace InteractiveMessageAction {

            enum InteractiveMessageActionMode {
                DISABLE_CTA = 1,
            }
        }

        namespace LabelEditAction {

            enum ListType {
                NONE = 0,
                UNREAD = 1,
                GROUPS = 2,
                FAVORITES = 3,
                PREDEFINED = 4,
                CUSTOM = 5,
                COMMUNITY = 6,
                SERVER_ASSIGNED = 7,
                DRAFTED = 8,
                AI_HANDOFF = 9,
            }
        }

        namespace MaibaAiFeaturesControlAction {

            enum MaibaAiFeatureStatus {
                ENABLED = 0,
                ENABLED_HAS_LEARNING = 1,
                DISABLED = 2,
            }
        }

        namespace MarketingMessageAction {

            enum MarketingMessagePrototypeType {
                PERSONALIZED = 0,
            }
        }

        namespace MerchantPaymentPartnerAction {

            enum Status {
                ACTIVE = 0,
                INACTIVE = 1,
            }
        }

        namespace NoteEditAction {

            enum NoteType {
                UNSTRUCTURED = 1,
                STRUCTURED = 2,
            }
        }

        namespace NotificationActivitySettingAction {

            enum NotificationActivitySetting {
                DEFAULT_ALL_MESSAGES = 0,
                ALL_MESSAGES = 1,
                HIGHLIGHTS = 2,
                DEFAULT_HIGHLIGHTS = 3,
            }
        }

        namespace PaymentTosAction {

            enum PaymentNotice {
                BR_PAY_PRIVACY_POLICY = 0,
            }
        }

        namespace PrivateProcessingSettingAction {

            enum PrivateProcessingStatus {
                UNDEFINED = 0,
                ENABLED = 1,
                DISABLED = 2,
            }
        }

        namespace SettingsSyncAction {

            enum DisplayMode {
                UNKNOWN = 0,
                ALWAYS = 1,
                NEVER = 2,
                ONLY_WHEN_APP_IS_OPEN = 3,
            }

            enum SettingKey {
                UNKNOWN = 0,
                START_AT_LOGIN = 1,
                MINIMIZE_TO_TRAY = 2,
                LANGUAGE = 3,
                REPLACE_TEXT_WITH_EMOJI = 4,
                BANNER_NOTIFICATION_DISPLAY_MODE = 5,
                UNREAD_COUNTER_BADGE_DISPLAY_MODE = 6,
                IS_MESSAGES_NOTIFICATION_ENABLED = 7,
                IS_CALLS_NOTIFICATION_ENABLED = 8,
                IS_REACTIONS_NOTIFICATION_ENABLED = 9,
                IS_STATUS_REACTIONS_NOTIFICATION_ENABLED = 10,
                IS_TEXT_PREVIEW_FOR_NOTIFICATION_ENABLED = 11,
                DEFAULT_NOTIFICATION_TONE_ID = 12,
                GROUP_DEFAULT_NOTIFICATION_TONE_ID = 13,
                APP_THEME = 14,
                WALLPAPER_ID = 15,
                IS_DOODLE_WALLPAPER_ENABLED = 16,
                FONT_SIZE = 17,
                IS_PHOTOS_AUTODOWNLOAD_ENABLED = 18,
                IS_AUDIOS_AUTODOWNLOAD_ENABLED = 19,
                IS_VIDEOS_AUTODOWNLOAD_ENABLED = 20,
                IS_DOCUMENTS_AUTODOWNLOAD_ENABLED = 21,
                DISABLE_LINK_PREVIEWS = 22,
                NOTIFICATION_TONE_ID = 23,
            }

            enum SettingPlatform {
                PLATFORM_UNKNOWN = 0,
                WEB = 1,
                HYBRID = 2,
                WINDOWS = 3,
                MAC = 4,
            }
        }

        namespace StatusPrivacyAction {

            enum StatusDistributionMode {
                ALLOW_LIST = 0,
                DENY_LIST = 1,
                CONTACTS = 2,
                CLOSE_FRIENDS = 3,
            }
        }

        namespace UsernameChatStartModeAction {

            enum ChatStartMode {
                LID = 1,
                PN = 2,
            }
        }

        namespace WaffleAccountLinkStateAction {

            enum AccountLinkState {
                ACTIVE = 0,
                PAUSED = 1,
                UNLINKED = 2,
            }
        }
    }

    namespace SyncdMutation {

        enum SyncdOperation {
            SET = 0,
            REMOVE = 1,
        }
    }

    namespace TemplateButton {

        interface ICallButton {
            displayText?: (proto.IHighlyStructuredMessage|null);
            phoneNumber?: (proto.IHighlyStructuredMessage|null);
        }

        class CallButton implements ICallButton {
            constructor(p?: ICallButton);
            public displayText?: (proto.IHighlyStructuredMessage|null);
            public phoneNumber?: (proto.IHighlyStructuredMessage|null);
            public static create(properties?: ICallButton): CallButton;
            public static encode(m: ICallButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): CallButton;
            public static fromObject(d: { [k: string]: any }): CallButton;
            public static toObject(m: CallButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IQuickReplyButton {
            displayText?: (proto.IHighlyStructuredMessage|null);
            id?: (string|null);
        }

        class QuickReplyButton implements IQuickReplyButton {
            constructor(p?: IQuickReplyButton);
            public displayText?: (proto.IHighlyStructuredMessage|null);
            public id?: (string|null);
            public static create(properties?: IQuickReplyButton): QuickReplyButton;
            public static encode(m: IQuickReplyButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): QuickReplyButton;
            public static fromObject(d: { [k: string]: any }): QuickReplyButton;
            public static toObject(m: QuickReplyButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        interface IUrlButton {
            displayText?: (proto.IHighlyStructuredMessage|null);
            url?: (proto.IHighlyStructuredMessage|null);
        }

        class UrlButton implements IUrlButton {
            constructor(p?: IUrlButton);
            public displayText?: (proto.IHighlyStructuredMessage|null);
            public url?: (proto.IHighlyStructuredMessage|null);
            public static create(properties?: IUrlButton): UrlButton;
            public static encode(m: IUrlButton, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UrlButton;
            public static fromObject(d: { [k: string]: any }): UrlButton;
            public static toObject(m: UrlButton, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace ThreadId {

        enum ThreadType {
            UNKNOWN = 0,
            VIEW_REPLIES = 1,
            AI_THREAD = 2,
        }
    }

    namespace UrlTrackingMap {

        interface IUrlTrackingMapElement {
            originalUrl?: (string|null);
            unconsentedUsersUrl?: (string|null);
            consentedUsersUrl?: (string|null);
            cardIndex?: (number|null);
        }

        class UrlTrackingMapElement implements IUrlTrackingMapElement {
            constructor(p?: IUrlTrackingMapElement);
            public originalUrl?: (string|null);
            public unconsentedUsersUrl?: (string|null);
            public consentedUsersUrl?: (string|null);
            public cardIndex?: (number|null);
            public static create(properties?: IUrlTrackingMapElement): UrlTrackingMapElement;
            public static encode(m: IUrlTrackingMapElement, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): UrlTrackingMapElement;
            public static fromObject(d: { [k: string]: any }): UrlTrackingMapElement;
            public static toObject(m: UrlTrackingMapElement, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace UserPassword {

        enum Encoding {
            UTF8 = 0,
            UTF8_BROKEN = 1,
        }

        enum Transformer {
            NONE = 0,
            PBKDF2_HMAC_SHA512 = 1,
            PBKDF2_HMAC_SHA384 = 2,
        }

        interface ITransformerArg {
            key?: (string|null);
            value?: (proto.IValue|null);
        }

        class TransformerArg implements ITransformerArg {
            constructor(p?: ITransformerArg);
            public key?: (string|null);
            public value?: (proto.IValue|null);
            public static create(properties?: ITransformerArg): TransformerArg;
            public static encode(m: ITransformerArg, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): TransformerArg;
            public static fromObject(d: { [k: string]: any }): TransformerArg;
            public static toObject(m: TransformerArg, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }

        namespace TransformerArg {

            interface IValue {
                asBlob?: (Uint8Array|null);
                asUnsignedInteger?: (number|null);
                /** Prost oneof field */
                value?: {
                    asBlob?: (Uint8Array|null);
                    asUnsignedInteger?: (number|null);
                } | null;
            }

            class Value implements IValue {
                constructor(p?: IValue);
                public asBlob?: (Uint8Array|null);
                public asUnsignedInteger?: (number|null);
                public value?: ("asBlob"|"asUnsignedInteger");
                public static create(properties?: IValue): Value;
                public static encode(m: IValue, w?: $protobuf.Writer): $protobuf.Writer;
                public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Value;
                public static fromObject(d: { [k: string]: any }): Value;
                public static toObject(m: Value, o?: $protobuf.IConversionOptions): { [k: string]: any };
                public toJSON(): { [k: string]: any };
            }
        }
    }

    namespace VerifiedNameCertificate {

        interface IDetails {
            serial?: (number|Long|null);
            issuer?: (string|null);
            verifiedName?: (string|null);
            localizedNames?: proto.ILocalizedName[];
            issueTime?: (number|Long|null);
        }

        class Details implements IDetails {
            constructor(p?: IDetails);
            public serial?: (number|Long|null);
            public issuer?: (string|null);
            public verifiedName?: (string|null);
            public localizedNames: proto.ILocalizedName[];
            public issueTime?: (number|Long|null);
            public static create(properties?: IDetails): Details;
            public static encode(m: IDetails, w?: $protobuf.Writer): $protobuf.Writer;
            public static decode(r: ($protobuf.Reader|Uint8Array), l?: number): Details;
            public static fromObject(d: { [k: string]: any }): Details;
            public static toObject(m: Details, o?: $protobuf.IConversionOptions): { [k: string]: any };
            public toJSON(): { [k: string]: any };
        }
    }

    namespace WebFeatures {

        enum Flag {
            NOT_STARTED = 0,
            FORCE_UPGRADE = 1,
            DEVELOPMENT = 2,
            PRODUCTION = 3,
        }
    }

    namespace WebMessageInfo {

        enum BizPrivacyStatus {
            E2EE = 0,
            FB = 2,
            BSP = 1,
            BSP_AND_FB = 3,
        }

        enum Status {
            ERROR = 0,
            PENDING = 1,
            SERVER_ACK = 2,
            DELIVERY_ACK = 3,
            READ = 4,
            PLAYED = 5,
        }

        enum StubType {
            UNKNOWN = 0,
            REVOKE = 1,
            CIPHERTEXT = 2,
            FUTUREPROOF = 3,
            NON_VERIFIED_TRANSITION = 4,
            UNVERIFIED_TRANSITION = 5,
            VERIFIED_TRANSITION = 6,
            VERIFIED_LOW_UNKNOWN = 7,
            VERIFIED_HIGH = 8,
            VERIFIED_INITIAL_UNKNOWN = 9,
            VERIFIED_INITIAL_LOW = 10,
            VERIFIED_INITIAL_HIGH = 11,
            VERIFIED_TRANSITION_ANY_TO_NONE = 12,
            VERIFIED_TRANSITION_ANY_TO_HIGH = 13,
            VERIFIED_TRANSITION_HIGH_TO_LOW = 14,
            VERIFIED_TRANSITION_HIGH_TO_UNKNOWN = 15,
            VERIFIED_TRANSITION_UNKNOWN_TO_LOW = 16,
            VERIFIED_TRANSITION_LOW_TO_UNKNOWN = 17,
            VERIFIED_TRANSITION_NONE_TO_LOW = 18,
            VERIFIED_TRANSITION_NONE_TO_UNKNOWN = 19,
            GROUP_CREATE = 20,
            GROUP_CHANGE_SUBJECT = 21,
            GROUP_CHANGE_ICON = 22,
            GROUP_CHANGE_INVITE_LINK = 23,
            GROUP_CHANGE_DESCRIPTION = 24,
            GROUP_CHANGE_RESTRICT = 25,
            GROUP_CHANGE_ANNOUNCE = 26,
            GROUP_PARTICIPANT_ADD = 27,
            GROUP_PARTICIPANT_REMOVE = 28,
            GROUP_PARTICIPANT_PROMOTE = 29,
            GROUP_PARTICIPANT_DEMOTE = 30,
            GROUP_PARTICIPANT_INVITE = 31,
            GROUP_PARTICIPANT_LEAVE = 32,
            GROUP_PARTICIPANT_CHANGE_NUMBER = 33,
            BROADCAST_CREATE = 34,
            BROADCAST_ADD = 35,
            BROADCAST_REMOVE = 36,
            GENERIC_NOTIFICATION = 37,
            E2E_IDENTITY_CHANGED = 38,
            E2E_ENCRYPTED = 39,
            CALL_MISSED_VOICE = 40,
            CALL_MISSED_VIDEO = 41,
            INDIVIDUAL_CHANGE_NUMBER = 42,
            GROUP_DELETE = 43,
            GROUP_ANNOUNCE_MODE_MESSAGE_BOUNCE = 44,
            CALL_MISSED_GROUP_VOICE = 45,
            CALL_MISSED_GROUP_VIDEO = 46,
            PAYMENT_CIPHERTEXT = 47,
            PAYMENT_FUTUREPROOF = 48,
            PAYMENT_TRANSACTION_STATUS_UPDATE_FAILED = 49,
            PAYMENT_TRANSACTION_STATUS_UPDATE_REFUNDED = 50,
            PAYMENT_TRANSACTION_STATUS_UPDATE_REFUND_FAILED = 51,
            PAYMENT_TRANSACTION_STATUS_RECEIVER_PENDING_SETUP = 52,
            PAYMENT_TRANSACTION_STATUS_RECEIVER_SUCCESS_AFTER_HICCUP = 53,
            PAYMENT_ACTION_ACCOUNT_SETUP_REMINDER = 54,
            PAYMENT_ACTION_SEND_PAYMENT_REMINDER = 55,
            PAYMENT_ACTION_SEND_PAYMENT_INVITATION = 56,
            PAYMENT_ACTION_REQUEST_DECLINED = 57,
            PAYMENT_ACTION_REQUEST_EXPIRED = 58,
            PAYMENT_ACTION_REQUEST_CANCELLED = 59,
            BIZ_VERIFIED_TRANSITION_TOP_TO_BOTTOM = 60,
            BIZ_VERIFIED_TRANSITION_BOTTOM_TO_TOP = 61,
            BIZ_INTRO_TOP = 62,
            BIZ_INTRO_BOTTOM = 63,
            BIZ_NAME_CHANGE = 64,
            BIZ_MOVE_TO_CONSUMER_APP = 65,
            BIZ_TWO_TIER_MIGRATION_TOP = 66,
            BIZ_TWO_TIER_MIGRATION_BOTTOM = 67,
            OVERSIZED = 68,
            GROUP_CHANGE_NO_FREQUENTLY_FORWARDED = 69,
            GROUP_V4_ADD_INVITE_SENT = 70,
            GROUP_PARTICIPANT_ADD_REQUEST_JOIN = 71,
            CHANGE_EPHEMERAL_SETTING = 72,
            E2E_DEVICE_CHANGED = 73,
            VIEWED_ONCE = 74,
            E2E_ENCRYPTED_NOW = 75,
            BLUE_MSG_BSP_FB_TO_BSP_PREMISE = 76,
            BLUE_MSG_BSP_FB_TO_SELF_FB = 77,
            BLUE_MSG_BSP_FB_TO_SELF_PREMISE = 78,
            BLUE_MSG_BSP_FB_UNVERIFIED = 79,
            BLUE_MSG_BSP_FB_UNVERIFIED_TO_SELF_PREMISE_VERIFIED = 80,
            BLUE_MSG_BSP_FB_VERIFIED = 81,
            BLUE_MSG_BSP_FB_VERIFIED_TO_SELF_PREMISE_UNVERIFIED = 82,
            BLUE_MSG_BSP_PREMISE_TO_SELF_PREMISE = 83,
            BLUE_MSG_BSP_PREMISE_UNVERIFIED = 84,
            BLUE_MSG_BSP_PREMISE_UNVERIFIED_TO_SELF_PREMISE_VERIFIED = 85,
            BLUE_MSG_BSP_PREMISE_VERIFIED = 86,
            BLUE_MSG_BSP_PREMISE_VERIFIED_TO_SELF_PREMISE_UNVERIFIED = 87,
            BLUE_MSG_CONSUMER_TO_BSP_FB_UNVERIFIED = 88,
            BLUE_MSG_CONSUMER_TO_BSP_PREMISE_UNVERIFIED = 89,
            BLUE_MSG_CONSUMER_TO_SELF_FB_UNVERIFIED = 90,
            BLUE_MSG_CONSUMER_TO_SELF_PREMISE_UNVERIFIED = 91,
            BLUE_MSG_SELF_FB_TO_BSP_PREMISE = 92,
            BLUE_MSG_SELF_FB_TO_SELF_PREMISE = 93,
            BLUE_MSG_SELF_FB_UNVERIFIED = 94,
            BLUE_MSG_SELF_FB_UNVERIFIED_TO_SELF_PREMISE_VERIFIED = 95,
            BLUE_MSG_SELF_FB_VERIFIED = 96,
            BLUE_MSG_SELF_FB_VERIFIED_TO_SELF_PREMISE_UNVERIFIED = 97,
            BLUE_MSG_SELF_PREMISE_TO_BSP_PREMISE = 98,
            BLUE_MSG_SELF_PREMISE_UNVERIFIED = 99,
            BLUE_MSG_SELF_PREMISE_VERIFIED = 100,
            BLUE_MSG_TO_BSP_FB = 101,
            BLUE_MSG_TO_CONSUMER = 102,
            BLUE_MSG_TO_SELF_FB = 103,
            BLUE_MSG_UNVERIFIED_TO_BSP_FB_VERIFIED = 104,
            BLUE_MSG_UNVERIFIED_TO_BSP_PREMISE_VERIFIED = 105,
            BLUE_MSG_UNVERIFIED_TO_SELF_FB_VERIFIED = 106,
            BLUE_MSG_UNVERIFIED_TO_VERIFIED = 107,
            BLUE_MSG_VERIFIED_TO_BSP_FB_UNVERIFIED = 108,
            BLUE_MSG_VERIFIED_TO_BSP_PREMISE_UNVERIFIED = 109,
            BLUE_MSG_VERIFIED_TO_SELF_FB_UNVERIFIED = 110,
            BLUE_MSG_VERIFIED_TO_UNVERIFIED = 111,
            BLUE_MSG_BSP_FB_UNVERIFIED_TO_BSP_PREMISE_VERIFIED = 112,
            BLUE_MSG_BSP_FB_UNVERIFIED_TO_SELF_FB_VERIFIED = 113,
            BLUE_MSG_BSP_FB_VERIFIED_TO_BSP_PREMISE_UNVERIFIED = 114,
            BLUE_MSG_BSP_FB_VERIFIED_TO_SELF_FB_UNVERIFIED = 115,
            BLUE_MSG_SELF_FB_UNVERIFIED_TO_BSP_PREMISE_VERIFIED = 116,
            BLUE_MSG_SELF_FB_VERIFIED_TO_BSP_PREMISE_UNVERIFIED = 117,
            E2E_IDENTITY_UNAVAILABLE = 118,
            GROUP_CREATING = 119,
            GROUP_CREATE_FAILED = 120,
            GROUP_BOUNCED = 121,
            BLOCK_CONTACT = 122,
            EPHEMERAL_SETTING_NOT_APPLIED = 123,
            SYNC_FAILED = 124,
            SYNCING = 125,
            BIZ_PRIVACY_MODE_INIT_FB = 126,
            BIZ_PRIVACY_MODE_INIT_BSP = 127,
            BIZ_PRIVACY_MODE_TO_FB = 128,
            BIZ_PRIVACY_MODE_TO_BSP = 129,
            DISAPPEARING_MODE = 130,
            E2E_DEVICE_FETCH_FAILED = 131,
            ADMIN_REVOKE = 132,
            GROUP_INVITE_LINK_GROWTH_LOCKED = 133,
            COMMUNITY_LINK_PARENT_GROUP = 134,
            COMMUNITY_LINK_SIBLING_GROUP = 135,
            COMMUNITY_LINK_SUB_GROUP = 136,
            COMMUNITY_UNLINK_PARENT_GROUP = 137,
            COMMUNITY_UNLINK_SIBLING_GROUP = 138,
            COMMUNITY_UNLINK_SUB_GROUP = 139,
            GROUP_PARTICIPANT_ACCEPT = 140,
            GROUP_PARTICIPANT_LINKED_GROUP_JOIN = 141,
            COMMUNITY_CREATE = 142,
            EPHEMERAL_KEEP_IN_CHAT = 143,
            GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST = 144,
            GROUP_MEMBERSHIP_JOIN_APPROVAL_MODE = 145,
            INTEGRITY_UNLINK_PARENT_GROUP = 146,
            COMMUNITY_PARTICIPANT_PROMOTE = 147,
            COMMUNITY_PARTICIPANT_DEMOTE = 148,
            COMMUNITY_PARENT_GROUP_DELETED = 149,
            COMMUNITY_LINK_PARENT_GROUP_MEMBERSHIP_APPROVAL = 150,
            GROUP_PARTICIPANT_JOINED_GROUP_AND_PARENT_GROUP = 151,
            MASKED_THREAD_CREATED = 152,
            MASKED_THREAD_UNMASKED = 153,
            BIZ_CHAT_ASSIGNMENT = 154,
            CHAT_PSA = 155,
            CHAT_POLL_CREATION_MESSAGE = 156,
            CAG_MASKED_THREAD_CREATED = 157,
            COMMUNITY_PARENT_GROUP_SUBJECT_CHANGED = 158,
            CAG_INVITE_AUTO_ADD = 159,
            BIZ_CHAT_ASSIGNMENT_UNASSIGN = 160,
            CAG_INVITE_AUTO_JOINED = 161,
            SCHEDULED_CALL_START_MESSAGE = 162,
            COMMUNITY_INVITE_RICH = 163,
            COMMUNITY_INVITE_AUTO_ADD_RICH = 164,
            SUB_GROUP_INVITE_RICH = 165,
            SUB_GROUP_PARTICIPANT_ADD_RICH = 166,
            COMMUNITY_LINK_PARENT_GROUP_RICH = 167,
            COMMUNITY_PARTICIPANT_ADD_RICH = 168,
            SILENCED_UNKNOWN_CALLER_AUDIO = 169,
            SILENCED_UNKNOWN_CALLER_VIDEO = 170,
            GROUP_MEMBER_ADD_MODE = 171,
            GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD = 172,
            COMMUNITY_CHANGE_DESCRIPTION = 173,
            SENDER_INVITE = 174,
            RECEIVER_INVITE = 175,
            COMMUNITY_ALLOW_MEMBER_ADDED_GROUPS = 176,
            PINNED_MESSAGE_IN_CHAT = 177,
            PAYMENT_INVITE_SETUP_INVITER = 178,
            PAYMENT_INVITE_SETUP_INVITEE_RECEIVE_ONLY = 179,
            PAYMENT_INVITE_SETUP_INVITEE_SEND_AND_RECEIVE = 180,
            LINKED_GROUP_CALL_START = 181,
            REPORT_TO_ADMIN_ENABLED_STATUS = 182,
            EMPTY_SUBGROUP_CREATE = 183,
            SCHEDULED_CALL_CANCEL = 184,
            SUBGROUP_ADMIN_TRIGGERED_AUTO_ADD_RICH = 185,
            GROUP_CHANGE_RECENT_HISTORY_SHARING = 186,
            PAID_MESSAGE_SERVER_CAMPAIGN_ID = 187,
            GENERAL_CHAT_CREATE = 188,
            GENERAL_CHAT_ADD = 189,
            GENERAL_CHAT_AUTO_ADD_DISABLED = 190,
            SUGGESTED_SUBGROUP_ANNOUNCE = 191,
            BIZ_BOT1P_MESSAGING_ENABLED = 192,
            CHANGE_USERNAME = 193,
            BIZ_COEX_PRIVACY_INIT_SELF = 194,
            BIZ_COEX_PRIVACY_TRANSITION_SELF = 195,
            SUPPORT_AI_EDUCATION = 196,
            BIZ_BOT3P_MESSAGING_ENABLED = 197,
            REMINDER_SETUP_MESSAGE = 198,
            REMINDER_SENT_MESSAGE = 199,
            REMINDER_CANCEL_MESSAGE = 200,
            BIZ_COEX_PRIVACY_INIT = 201,
            BIZ_COEX_PRIVACY_TRANSITION = 202,
            GROUP_DEACTIVATED = 203,
            COMMUNITY_DEACTIVATE_SIBLING_GROUP = 204,
            EVENT_UPDATED = 205,
            EVENT_CANCELED = 206,
            COMMUNITY_OWNER_UPDATED = 207,
            COMMUNITY_SUB_GROUP_VISIBILITY_HIDDEN = 208,
            CAPI_GROUP_NE2EE_SYSTEM_MESSAGE = 209,
            STATUS_MENTION = 210,
            USER_CONTROLS_SYSTEM_MESSAGE = 211,
            SUPPORT_SYSTEM_MESSAGE = 212,
            CHANGE_LID = 213,
            BIZ_CUSTOMER3PD_DATA_SHARING_OPT_IN_MESSAGE = 214,
            BIZ_CUSTOMER3PD_DATA_SHARING_OPT_OUT_MESSAGE = 215,
            CHANGE_LIMIT_SHARING = 216,
            GROUP_MEMBER_LINK_MODE = 217,
            BIZ_AUTOMATICALLY_LABELED_CHAT_SYSTEM_MESSAGE = 218,
            PHONE_NUMBER_HIDING_CHAT_DEPRECATED_MESSAGE = 219,
            QUARANTINED_MESSAGE = 220,
            GROUP_MEMBER_SHARE_GROUP_HISTORY_MODE = 221,
            GROUP_OPEN_BOT_ADDED = 222,
            GROUP_TEE_BOT_ADDED = 223,
        }
    }
}
