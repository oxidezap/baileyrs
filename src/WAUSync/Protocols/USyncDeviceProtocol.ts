import type { USyncQueryProtocol } from '../../Types/USync.ts'
import type { BinaryNode } from '../../Types/index.ts'
import { assertNodeErrorFree, getBinaryNodeChild } from '../../WABinary/generic-utils.ts'

export type KeyIndexData = { timestamp: number; signedKeyIndex?: Uint8Array; expectedTimestamp?: number }
export type DeviceListData = { id: number; keyIndex?: number; isHosted?: boolean }
export type ParsedDeviceInfo = { deviceList?: DeviceListData[]; keyIndex?: KeyIndexData }

export class USyncDeviceProtocol implements USyncQueryProtocol {
	name = 'devices'

	getQueryElement(): BinaryNode {
		return { tag: 'devices', attrs: { version: '2' } }
	}

	getUserElement(): BinaryNode | null {
		return null
	}

	parser(node: BinaryNode): ParsedDeviceInfo {
		const deviceList: DeviceListData[] = []
		let keyIndex: KeyIndexData | undefined
		if (node.tag === 'devices') {
			assertNodeErrorFree(node)
			const deviceListNode = getBinaryNodeChild(node, 'device-list')
			const keyIndexNode = getBinaryNodeChild(node, 'key-index-list')
			if (Array.isArray(deviceListNode?.content)) {
				for (const { tag, attrs } of deviceListNode.content) {
					if (tag === 'device') {
						deviceList.push({
							id: +attrs.id!,
							keyIndex: +attrs['key-index']!,
							isHosted: attrs.is_hosted === 'true'
						})
					}
				}
			}
			if (keyIndexNode?.tag === 'key-index-list') {
				keyIndex = {
					timestamp: +keyIndexNode.attrs.ts!,
					signedKeyIndex: keyIndexNode.content as Uint8Array,
					expectedTimestamp: keyIndexNode.attrs.expected_ts ? +keyIndexNode.attrs.expected_ts : undefined
				}
			}
		}
		return { deviceList, keyIndex }
	}
}
