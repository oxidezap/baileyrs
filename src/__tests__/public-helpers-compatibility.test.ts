import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { deflateSync } from 'node:zlib'
import { describe, it } from 'node:test'
import { toBridgeMediaType } from '../Compatibility/media-type.ts'
import {
	DEFAULT_CACHE_TTLS,
	DEF_CALLBACK_PREFIX,
	DEF_TAG_PREFIX,
	HISTORY_SYNC_PAUSED_TIMEOUT_MS,
	MEDIA_HKDF_KEY_MAPPING,
	MEDIA_KEYS,
	MEDIA_PATH_MAP,
	PROCESSABLE_HISTORY_TYPES,
	WA_ADV_ACCOUNT_SIG_PREFIX,
	WA_ADV_DEVICE_SIG_PREFIX
} from '../Defaults/index.ts'
import { proto } from '../WAProto/runtime.ts'
import type { BaileysEventEmitter, BinaryNode } from '../Types/index.ts'
import {
	bindWaitForConnectionUpdate,
	bytesToCrockford,
	debouncedTimeout,
	delayCancellable,
	encodeBigEndian,
	encodeNewsletterMessage,
	encodeWAMessage,
	generateMessageID,
	generateMessageIDV2,
	generateParticipantHashV2,
	generateRegistrationId,
	getCallStatusFromNode,
	getCodeFromWSError,
	getErrorCodeFromStreamError,
	getKeyAuthor,
	getStatusFromReceiptType,
	isStringNullOrEmpty,
	promiseTimeout,
	unpadRandomMax16,
	writeRandomPadMax16
} from '../Utils/generics.ts'
import { getPlatformId } from '../Utils/browser-utils.ts'
import {
	CompanionWebClientType,
	buildPairingQRData,
	getCompanionPlatformId,
	getCompanionWebClientType
} from '../Utils/companion-reg-client-utils.ts'
import {
	downloadAndProcessHistorySyncNotification,
	getHistoryMsg,
	processHistoryMessage
} from '../Utils/process-history-message.ts'
import {
	aggregateMessageKeysNotFromMe,
	assertMediaContent,
	getAggregateResponsesInEventMessage,
	getAggregateVotesInPollMessage,
	getDevice,
	updateMessageWithEventResponse,
	updateMessageWithPollUpdate
} from '../Utils/messages.ts'
import { aesEncryptGCM, hkdf, sha256 } from '../Utils/crypto.ts'
import {
	DEF_MEDIA_HOST,
	decodeMediaRetryNode,
	decryptMediaRetryData,
	encodeBase64EncodedStringForUpload,
	encryptMediaRetryRequest,
	extensionForMediaMessage,
	getMediaKeys,
	getStatusCodeForMediaRetry,
	getUrlFromDirectPath,
	hkdfInfoKey,
	mediaMessageSHA256B64
} from '../Utils/messages-media.ts'
import {
	binaryNodeToString,
	getAllBinaryNodeChildren,
	getBinaryNodeChildBuffer,
	getBinaryNodeChildString,
	getBinaryNodeChildUInt,
	getBinaryNodeMessages,
	reduceBinaryNodeToDictionary
} from '../WABinary/generic-utils.ts'
import {
	META_AI_JID,
	OFFICIAL_BIZ_JID,
	S_WHATSAPP_NET,
	WAJIDDomains,
	getServerFromDomainType,
	isJidBot,
	isJidBroadcast,
	isJidMetaAI,
	isPnUser,
	transferDevice
} from '../WABinary/jid-utils.ts'

describe('public defaults compatibility', () => {
	it('exports canonical callback and history constants', () => {
		assert.equal(DEF_CALLBACK_PREFIX, 'CB:')
		assert.equal(DEF_TAG_PREFIX, 'TAG:')
		assert.equal(HISTORY_SYNC_PAUSED_TIMEOUT_MS, 120_000)
		assert.deepEqual(DEFAULT_CACHE_TTLS, {
			SIGNAL_STORE: 300,
			MSG_RETRY: 3600,
			CALL_OFFER: 300,
			USER_DEVICES: 300
		})
		assert.deepEqual([...WA_ADV_ACCOUNT_SIG_PREFIX], [6, 0])
		assert.deepEqual([...WA_ADV_DEVICE_SIG_PREFIX], [6, 1])
	})

	it('keeps MediaType, path and HKDF inventories single-source', () => {
		assert.deepEqual(MEDIA_KEYS, Object.keys(MEDIA_PATH_MAP))
		assert.equal(MEDIA_HKDF_KEY_MAPPING.gif, 'Video')
		assert.equal(MEDIA_HKDF_KEY_MAPPING['thumbnail-document'], 'Document Thumbnail')
		assert.equal(MEDIA_PATH_MAP['product-catalog-image'], '/product/image')
	})

	it('lists every processable upstream history sync type', () => {
		assert.deepEqual(PROCESSABLE_HISTORY_TYPES, [
			proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP,
			proto.HistorySync.HistorySyncType.PUSH_NAME,
			proto.HistorySync.HistorySyncType.RECENT,
			proto.HistorySync.HistorySyncType.FULL,
			proto.HistorySync.HistorySyncType.ON_DEMAND,
			proto.HistorySync.HistorySyncType.NON_BLOCKING_DATA,
			proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3
		])
	})
})

describe('public helper compatibility', () => {
	it('maps browser descriptors and constructs upstream pairing QR data', () => {
		assert.equal(getPlatformId('chrome'), '1')
		assert.equal(getCompanionWebClientType(['Windows', 'Desktop', '10']), CompanionWebClientType.UWP)
		assert.equal(getCompanionWebClientType(['Mac OS', 'Desktop', '14']), CompanionWebClientType.ELECTRON)
		assert.equal(getCompanionPlatformId(['Ubuntu', 'Firefox', '22']), '3')
		assert.equal(
			buildPairingQRData('ref', 'noise', 'identity', 'adv', ['Ubuntu', 'Chrome', '22']),
			'https://wa.me/settings/linked_devices#ref,noise,identity,adv,1'
		)
	})

	it('getKeyAuthor follows upstream alternate-JID priority', () => {
		assert.equal(getKeyAuthor({ fromMe: true, participant: 'other@s.whatsapp.net' }), 'me')
		assert.equal(
			getKeyAuthor({
				participantAlt: 'alt@s.whatsapp.net',
				remoteJidAlt: 'remote-alt@s.whatsapp.net',
				participant: 'participant@s.whatsapp.net',
				remoteJid: 'remote@s.whatsapp.net'
			}),
			'alt@s.whatsapp.net'
		)
		assert.equal(getKeyAuthor(null), '')
	})

	it('normalizes only bridge-equivalent media aliases and rejects lossy mappings', () => {
		assert.equal(toBridgeMediaType('image'), 'image')
		assert.equal(toBridgeMediaType('gif'), 'video')
		assert.equal(toBridgeMediaType('ptt'), 'audio')
		assert.throws(() => toBridgeMediaType('thumbnail-document'), /not supported/)
	})

	it('matches media key derivation and pure media helpers', async () => {
		const upstream = await import('baileys')
		const mediaKey = Buffer.from('44'.repeat(32), 'hex')
		assert.equal(hkdfInfoKey('image'), 'WhatsApp Image Keys')
		assert.deepEqual(await getMediaKeys(mediaKey, 'image'), await upstream.getMediaKeys(mediaKey, 'image'))
		assert.equal(DEF_MEDIA_HOST, 'mmg.whatsapp.net')
		assert.equal(getUrlFromDirectPath('/mms/image/token'), 'https://mmg.whatsapp.net/mms/image/token')
		assert.equal(encodeBase64EncodedStringForUpload('a+b/c=='), 'a-b_c')
		assert.equal(extensionForMediaMessage({ imageMessage: { mimetype: 'image/jpeg; charset=binary' } }), 'jpeg')
		assert.equal(extensionForMediaMessage({ locationMessage: {} }), '.jpeg')
		assert.equal(mediaMessageSHA256B64({ imageMessage: { fileSha256: Uint8Array.from([1, 2, 3]) } }), 'AQID')
	})

	it('builds, decodes and decrypts media retry payloads', () => {
		const mediaKey = Buffer.from('55'.repeat(32), 'hex')
		const request = encryptMediaRetryRequest(
			{ id: 'MSG-RETRY', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
			mediaKey,
			'5511888888888:2@s.whatsapp.net'
		)
		assert.equal(request.tag, 'receipt')
		assert.equal(request.attrs.to, '5511888888888@s.whatsapp.net')
		assert.equal((request.content as BinaryNode[])[0]?.tag, 'encrypt')

		const decoded = decodeMediaRetryNode({
			tag: 'notification',
			attrs: { id: 'MSG-RETRY' },
			content: [
				{ tag: 'rmr', attrs: { jid: 'chat@s.whatsapp.net', from_me: 'false', participant: 'p@s.whatsapp.net' } },
				{
					tag: 'encrypt',
					attrs: {},
					content: [
						{ tag: 'enc_p', attrs: {}, content: Uint8Array.from([1, 2]) },
						{ tag: 'enc_iv', attrs: {}, content: Uint8Array.from([3, 4]) }
					]
				}
			]
		})
		assert.equal(decoded.key.remoteJid, 'chat@s.whatsapp.net')
		assert.deepEqual(decoded.media, { ciphertext: Uint8Array.from([1, 2]), iv: Uint8Array.from([3, 4]) })
		assert.equal(getStatusCodeForMediaRetry(proto.MediaRetryNotification.ResultType.NOT_FOUND), 404)

		const msgId = 'MSG-RETRY'
		const retryKey = hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })
		const iv = Buffer.from('66'.repeat(12), 'hex')
		const wire = proto.MediaRetryNotification.encode({
			result: proto.MediaRetryNotification.ResultType.SUCCESS,
			directPath: '/mms/image/new'
		}).finish()
		const ciphertext = aesEncryptGCM(wire, retryKey, iv, Buffer.from(msgId))
		const notification = decryptMediaRetryData({ ciphertext, iv }, mediaKey, msgId)
		assert.equal(notification.directPath, '/mms/image/new')
	})

	it('round-trips random padding and protobuf message encoding', () => {
		const raw = Uint8Array.from([1, 2, 3, 4])
		const padded = writeRandomPadMax16(raw)
		assert.ok(padded.length >= raw.length + 1 && padded.length <= raw.length + 16)
		assert.deepEqual([...unpadRandomMax16(padded)], [...raw])
		assert.deepEqual([...encodeBigEndian(0x01020304)], [1, 2, 3, 4])

		const encoded = encodeWAMessage({ conversation: 'compat' })
		const decoded = proto.Message.decode(unpadRandomMax16(encoded))
		assert.equal(decoded.conversation, 'compat')
		assert.equal(
			proto.Message.decode(encodeNewsletterMessage({ conversation: 'newsletter' })).conversation,
			'newsletter'
		)
	})

	it('generates upstream-shaped ids, participant hashes and registration ids', () => {
		const participants = ['b@s.whatsapp.net', 'a@s.whatsapp.net']
		assert.match(generateParticipantHashV2(participants), /^2:.{6}$/)
		assert.deepEqual(participants, ['a@s.whatsapp.net', 'b@s.whatsapp.net'])
		assert.match(generateMessageID(), /^3EB0[0-9A-F]{36}$/)
		assert.match(generateMessageIDV2('5511999999999@s.whatsapp.net'), /^3EB0[0-9A-F]{18}$/)
		const registrationId = generateRegistrationId()
		assert.ok(registrationId >= 0 && registrationId <= 16_383)
		assert.equal(isStringNullOrEmpty(''), true)
		assert.equal(isStringNullOrEmpty('x'), false)
		assert.equal(bytesToCrockford(Buffer.from([0])), '11')
	})

	it('matches receipt, call and websocket error mapping helpers', () => {
		assert.equal(getStatusFromReceiptType(undefined), proto.WebMessageInfo.Status.DELIVERY_ACK)
		assert.equal(getStatusFromReceiptType('played'), proto.WebMessageInfo.Status.PLAYED)
		assert.equal(getCallStatusFromNode({ tag: 'preaccept', attrs: {} }), 'preaccept')
		assert.equal(getCallStatusFromNode({ tag: 'terminate', attrs: { reason: 'timeout' } }), 'timeout')
		assert.deepEqual(
			getErrorCodeFromStreamError({
				tag: 'stream:error',
				attrs: {},
				content: [{ tag: 'conflict', attrs: {} }]
			}),
			{ reason: 'conflict', statusCode: 440 }
		)
		assert.equal(getCodeFromWSError(new Error('Unexpected server response: 503')), 503)
		assert.equal(getCodeFromWSError(Object.assign(new Error('socket'), { code: 'ETIMEDOUT' })), 408)
	})

	it('implements cancellable/debounced timeouts and event waits', async () => {
		const timeout = delayCancellable(1000)
		timeout.cancel()
		await assert.rejects(timeout.delay, /Cancelled/)
		await assert.rejects(
			promiseTimeout(1, () => {}),
			(error: unknown) => (error as { output?: { statusCode?: number } }).output?.statusCode === 408
		)

		let calls = 0
		const debounce = debouncedTimeout(1, () => calls++)
		debounce.start()
		debounce.start()
		await new Promise(resolve => setTimeout(resolve, 5))
		assert.equal(calls, 1)

		const emitter = new EventEmitter() as unknown as BaileysEventEmitter
		const waiting = bindWaitForConnectionUpdate(emitter)(async update => update.connection === 'open', 100)
		emitter.emit('connection.update', { connection: 'open' })
		await waiting
	})

	it('extracts wrapped history notifications', () => {
		const notification = { syncType: proto.HistorySync.HistorySyncType.RECENT }
		assert.deepEqual(getHistoryMsg({ protocolMessage: { historySyncNotification: notification } }), notification)
		// Upstream returns undefined here. Throwing broke `const h = getHistoryMsg(m); if (!h) return`,
		// which is the shape a drop-in caller writes.
		assert.equal(getHistoryMsg({ conversation: 'not a history sync' }), undefined)
		assert.equal(getHistoryMsg({}), undefined)
		assert.equal(getHistoryMsg(undefined as never), undefined)
	})

	it('matches message-device inference and bulk receipt grouping', () => {
		assert.equal(getDevice(`3A${'A'.repeat(18)}`), 'ios')
		assert.equal(getDevice(`3E${'A'.repeat(20)}`), 'web')
		assert.equal(getDevice('A'.repeat(21)), 'android')
		assert.deepEqual(
			aggregateMessageKeysNotFromMe([
				{ remoteJid: 'group@g.us', participant: 'a@s.whatsapp.net', id: '1', fromMe: false },
				{ remoteJid: 'group@g.us', participant: 'a@s.whatsapp.net', id: '2', fromMe: false },
				{ remoteJid: 'group@g.us', participant: 'me@s.whatsapp.net', id: '3', fromMe: true }
			]),
			[{ jid: 'group@g.us', participant: 'a@s.whatsapp.net', messageIds: ['1', '2'] }]
		)
	})

	it('aggregates and replaces poll/event responses by author', () => {
		const selected = sha256(Buffer.from('Yes'))
		const pollUpdate = {
			pollUpdateMessageKey: { participant: 'voter@s.whatsapp.net' },
			vote: { selectedOptions: [selected] }
		}
		const pollMessage = {
			message: { pollCreationMessage: { options: [{ optionName: 'Yes' }, { optionName: 'No' }] } },
			pollUpdates: [pollUpdate]
		}
		assert.deepEqual(getAggregateVotesInPollMessage(pollMessage), [
			{ name: 'Yes', voters: ['voter@s.whatsapp.net'] },
			{ name: 'No', voters: [] }
		])

		const mutablePoll: { pollUpdates?: (typeof pollUpdate)[] } = { pollUpdates: [pollUpdate] }
		updateMessageWithPollUpdate(mutablePoll, {
			pollUpdateMessageKey: { participant: 'voter@s.whatsapp.net' },
			vote: { selectedOptions: [] }
		})
		assert.deepEqual(mutablePoll.pollUpdates, [])

		const event = {
			eventResponseMessageKey: { participant: 'guest@s.whatsapp.net' },
			eventResponse: 'GOING'
		}
		const mutableEvent: { eventResponses?: (typeof event)[] } = { eventResponses: [] }
		updateMessageWithEventResponse(mutableEvent, event)
		assert.deepEqual(getAggregateResponsesInEventMessage(mutableEvent), [
			{ response: 'GOING', responders: ['guest@s.whatsapp.net'] },
			{ response: 'NOT_GOING', responders: [] },
			{ response: 'MAYBE', responders: [] }
		])
	})

	it('unwraps media content and rejects non-media messages with Boom', () => {
		const image = { mimetype: 'image/jpeg' }
		assert.equal(assertMediaContent({ viewOnceMessage: { message: { imageMessage: image } } }), image)
		assert.throws(() => assertMediaContent({ conversation: 'not media' }), /not a media message/)
	})

	it('processes inline compressed history and preserves nullable metadata', async () => {
		const loggerCalls: unknown[] = []
		const logger = {
			level: 'trace',
			child: () => logger,
			trace: (value: unknown) => loggerCalls.push(value),
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {}
		}
		const nullable = processHistoryMessage({ syncType: null, progress: null }, logger)
		assert.equal(nullable.syncType, null)
		assert.equal(nullable.progress, null)
		assert.equal(loggerCalls.length, 1)

		const encoded = proto.HistorySync.encode({
			syncType: proto.HistorySync.HistorySyncType.PUSH_NAME,
			pushnames: [{ id: '5511999999999@s.whatsapp.net', pushname: 'Compat' }]
		}).finish()
		const result = await downloadAndProcessHistorySyncNotification(
			{ initialHistBootstrapInlinePayload: deflateSync(encoded) },
			{}
		)
		assert.deepEqual(result.contacts, [{ id: '5511999999999@s.whatsapp.net', notify: 'Compat' }])
	})
})

describe('WABinary public helpers', () => {
	it('exports and classifies canonical JID domains', () => {
		assert.equal(S_WHATSAPP_NET, '@s.whatsapp.net')
		assert.equal(OFFICIAL_BIZ_JID, '16505361212@c.us')
		assert.equal(META_AI_JID, '13135550002@c.us')
		assert.equal(getServerFromDomainType('s.whatsapp.net', WAJIDDomains.HOSTED_LID), 'hosted.lid')
		assert.equal(isJidMetaAI('123@bot'), true)
		assert.equal(isJidBroadcast('status@broadcast'), true)
		assert.equal(isPnUser('123@s.whatsapp.net'), true)
		assert.equal(isPnUser('123@c.us'), false)
		assert.equal(isJidBot('13135551234@c.us'), true)
		assert.equal(transferDevice('123:7@s.whatsapp.net', '456@s.whatsapp.net'), '456:7@s.whatsapp.net')
	})

	it('reads child content and reduces stanza dictionaries', () => {
		const node: BinaryNode = {
			tag: 'root',
			attrs: {},
			content: [
				{ tag: 'bytes', attrs: {}, content: Uint8Array.from([1, 2]) },
				{ tag: 'text', attrs: {}, content: 'hello' },
				{ tag: 'entry', attrs: { name: 'mode', value: 'on' } }
			]
		}
		assert.equal(getAllBinaryNodeChildren(node).length, 3)
		assert.deepEqual([...getBinaryNodeChildBuffer(node, 'bytes')!], [1, 2])
		assert.equal(getBinaryNodeChildUInt(node, 'bytes', 2), 258)
		assert.equal(getBinaryNodeChildString(node, 'text'), 'hello')
		assert.deepEqual(reduceBinaryNodeToDictionary(node, 'entry'), { mode: 'on' })
		assert.match(binaryNodeToString(node), /<text >/)
	})

	it('decodes message children from binary stanzas', () => {
		const encoded = proto.WebMessageInfo.encode({ key: { id: 'MSG-1' }, message: { conversation: 'hello' } }).finish()
		const messages = getBinaryNodeMessages({
			tag: 'messages',
			attrs: {},
			content: [{ tag: 'message', attrs: {}, content: encoded }]
		})
		assert.equal(messages[0]?.key?.id, 'MSG-1')
		assert.equal(messages[0]?.message?.conversation, 'hello')
	})
})
