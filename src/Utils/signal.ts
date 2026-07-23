import { KEY_BUNDLE_TYPE } from '../Defaults/index.ts'
import type { BinaryNode, SignalRepositoryWithLIDStore } from '../Types/index.ts'
import type { SignalIdentity, SignalKeyStore, SignedKeyPair } from '../Types/Auth.ts'
import type { FullJid } from '../WABinary/index.ts'
import {
	assertNodeErrorFree,
	getBinaryNodeChild,
	getBinaryNodeChildBuffer,
	getBinaryNodeChildren,
	getBinaryNodeChildUInt,
	getServerFromDomainType,
	jidDecode,
	WAJIDDomains
} from '../WABinary/index.ts'
import type { DeviceListData, ParsedDeviceInfo } from '../WAUSync/Protocols/USyncDeviceProtocol.ts'
import type { USyncQueryResultList } from '../WAUSync/USyncQuery.ts'
import { generateSignalPubKey } from './crypto.ts'
import { encodeBigEndian } from './generics.ts'

const chunk = <T>(array: T[], size: number): T[][] => {
	const chunks: T[][] = []
	for (let index = 0; index < array.length; index += size) chunks.push(array.slice(index, index + size))
	return chunks
}

export const createSignalIdentity = (wid: string, accountSignatureKey: Uint8Array): SignalIdentity => ({
	identifier: { name: wid, deviceId: 0 },
	identifierKey: generateSignalPubKey(accountSignatureKey)
})

export const getPreKeys = async ({ get }: SignalKeyStore, min: number, limit: number) => {
	const idList: string[] = []
	for (let id = min; id < limit; id++) idList.push(id.toString())
	return get('pre-key', idList)
}

export const xmppSignedPreKey = (key: SignedKeyPair): BinaryNode => ({
	tag: 'skey',
	attrs: {},
	content: [
		{ tag: 'id', attrs: {}, content: encodeBigEndian(key.keyId, 3) },
		{ tag: 'value', attrs: {}, content: key.keyPair.public },
		{ tag: 'signature', attrs: {}, content: key.signature }
	]
})

export const xmppPreKey = (pair: { public: Uint8Array; private: Uint8Array }, id: number): BinaryNode => ({
	tag: 'key',
	attrs: {},
	content: [
		{ tag: 'id', attrs: {}, content: encodeBigEndian(id, 3) },
		{ tag: 'value', attrs: {}, content: pair.public }
	]
})

const isValidUInt = (value: number | undefined): value is number => typeof value === 'number' && Number.isInteger(value)

export const extractE2ESessionFromRetryReceipt = (receipt: BinaryNode) => {
	const keysNode = getBinaryNodeChild(receipt, 'keys')
	if (!keysNode) return null
	const typeBuffer = getBinaryNodeChildBuffer(keysNode, 'type')
	if (!typeBuffer || typeBuffer.length !== 1 || typeBuffer[0] !== KEY_BUNDLE_TYPE[0]) return null
	const identity = getBinaryNodeChildBuffer(keysNode, 'identity')
	const signedKey = getBinaryNodeChild(keysNode, 'skey')
	if (!identity || identity.length !== 32 || !signedKey) return null
	const registrationId = getBinaryNodeChildUInt(receipt, 'registration', 4)
	if (!isValidUInt(registrationId)) return null
	const signedPublicKey = getBinaryNodeChildBuffer(signedKey, 'value')
	const signedSignature = getBinaryNodeChildBuffer(signedKey, 'signature')
	const signedKeyId = getBinaryNodeChildUInt(signedKey, 'id', 3)
	if (!signedPublicKey || signedPublicKey.length !== 32 || !signedSignature || !isValidUInt(signedKeyId)) return null

	const preKeyNode = getBinaryNodeChild(keysNode, 'key')
	let preKey: { keyId: number; publicKey: Uint8Array } | undefined
	if (preKeyNode) {
		const publicKey = getBinaryNodeChildBuffer(preKeyNode, 'value')
		const keyId = getBinaryNodeChildUInt(preKeyNode, 'id', 3)
		if (!publicKey || publicKey.length !== 32 || !isValidUInt(keyId)) return null
		preKey = { keyId, publicKey: generateSignalPubKey(publicKey) }
	}

	return {
		registrationId,
		identityKey: generateSignalPubKey(identity),
		signedPreKey: {
			keyId: signedKeyId,
			publicKey: generateSignalPubKey(signedPublicKey),
			signature: signedSignature
		},
		preKey
	}
}

export const parseAndInjectE2ESessions = async (node: BinaryNode, repository: SignalRepositoryWithLIDStore) => {
	const extractKey = (key: BinaryNode) =>
		key
			? {
					keyId: getBinaryNodeChildUInt(key, 'id', 3)!,
					publicKey: generateSignalPubKey(getBinaryNodeChildBuffer(key, 'value')!),
					signature: getBinaryNodeChildBuffer(key, 'signature')!
				}
			: undefined
	const nodes = getBinaryNodeChildren(getBinaryNodeChild(node, 'list'), 'user')
	for (const userNode of nodes) assertNodeErrorFree(userNode)
	for (const nodesChunk of chunk(nodes, 100)) {
		for (const userNode of nodesChunk) {
			const signedKey = getBinaryNodeChild(userNode, 'skey')!
			const key = getBinaryNodeChild(userNode, 'key')!
			await repository.injectE2ESession({
				jid: userNode.attrs.jid!,
				session: {
					registrationId: getBinaryNodeChildUInt(userNode, 'registration', 4)!,
					identityKey: generateSignalPubKey(getBinaryNodeChildBuffer(userNode, 'identity')!),
					signedPreKey: extractKey(signedKey)!,
					preKey: extractKey(key)!
				}
			})
		}
	}
}

export const extractDeviceJids = (
	result: USyncQueryResultList[],
	myJid: string,
	myLid: string,
	excludeZeroDevices: boolean
) => {
	const { user: myUser, device: myDevice } = jidDecode(myJid)!
	const extracted: FullJid[] = []
	for (const userResult of result) {
		const { devices, id } = userResult as { devices: ParsedDeviceInfo; id: string }
		const decoded = jidDecode(id)!
		const { user, server } = decoded
		let { domainType } = decoded
		const deviceList = devices?.deviceList as DeviceListData[]
		if (!Array.isArray(deviceList)) continue
		for (const { id: device, keyIndex, isHosted } of deviceList) {
			if (
				(!excludeZeroDevices || device !== 0) &&
				((myUser !== user && myLid !== user) || myDevice !== device) &&
				(device === 0 || !!keyIndex)
			) {
				if (isHosted) domainType = domainType === WAJIDDomains.LID ? WAJIDDomains.HOSTED_LID : WAJIDDomains.HOSTED
				extracted.push({
					user,
					device,
					domainType,
					server: getServerFromDomainType(server, domainType as WAJIDDomains | undefined)
				})
			}
		}
	}
	return extracted
}
