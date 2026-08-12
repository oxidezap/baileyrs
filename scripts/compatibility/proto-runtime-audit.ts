#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util'
import { proto as upstreamProto } from 'baileys'
import {
	PROTO_ENUM_SCHEMAS,
	PROTO_FIELD_FLAG,
	PROTO_FIELD_KIND,
	PROTO_MESSAGE_SCHEMAS,
	PROTO_SCHEMA_SOURCE,
	type ProtoFieldSchema
} from '../../src/WAProto/compatibility-schema.ts'
import { proto as localProto, unsupportedProtoCodecs } from '../../src/WAProto/runtime.ts'

interface RuntimeMessageType {
	name: string
	create(properties?: Record<string, unknown>): Record<string, unknown>
	decode(input: unknown): Record<string, unknown>
	encode(message: unknown): { finish(): Uint8Array }
	fromObject(message: unknown): Record<string, unknown>
	getTypeUrl(prefix?: string): string
	toObject(message: unknown, options?: Record<string, unknown>): Record<string, unknown>
}

interface Coverage {
	coverage: number
	matched: number
	total: number
}

export interface ProtoRuntimeCompatibilityReport {
	schemaSource: string
	objectContracts: Coverage & { gaps: string[] }
	enums: Coverage & { gaps: string[] }
	codecTypes: Coverage & { unsupported: readonly string[] }
	wireFields: Coverage & {
		gaps: string[]
		unexpectedGaps: string[]
		resolvedKnownGaps: string[]
	}
}

const KNOWN_UNSUPPORTED_CODECS = ['BotAvatarMetadata'] as const

const KNOWN_WIRE_GAPS = [
	'BotAvatarMetadata.action',
	'BotAvatarMetadata.behaviorGraph',
	'BotAvatarMetadata.intensity',
	'BotAvatarMetadata.sentiment',
	'BotAvatarMetadata.wordCount',
	'BotMetadata.avatarMetadata',
	'Message.AudioMessage.mediaKeyDomain',
	'Message.DocumentMessage.mediaKeyDomain',
	// Renamed rather than absent: WhatsApp schema 2.3000.1044659339 spells field
	// 33 `faviconMmsMetadata`, which bridge 0.10.0 regenerated against, while
	// baileys 7.0.0-rc13 still declares `faviconMMSMetadata`. The wire is
	// identical; the gap closes when upstream regenerates its proto.
	'Message.ExtendedTextMessage.faviconMMSMetadata',
	'Message.ImageMessage.mediaKeyDomain',
	'Message.MMSThumbnailMetadata.mediaKeyDomain',
	'Message.MessageHistoryMetadata.oldestMessageTimestamp',
	'Message.StickerMessage.mediaKeyDomain',
	'Message.VideoMessage.mediaKeyDomain',
	'Message.pollResultSnapshotMessageV3',
	'SyncActionValue.AgentAction.deviceID',
	'SyncActionValue.ChatAssignmentAction.deviceAgentID',
	'SyncActionValue.businessBroadcastAssociationAction'
] as const

const objectOptions = [
	{},
	{ defaults: true },
	{ arrays: true, objects: true },
	{ longs: String, enums: String, bytes: String, defaults: true, oneofs: true }
]
const wireOptions = { longs: String, enums: Number, bytes: String }

const percent = (matched: number, total: number): number =>
	total === 0 ? 100 : Number(((matched / total) * 100).toFixed(2))

const lookup = (root: unknown, path: string): unknown => {
	let value = root
	for (const segment of path.split('.')) value = (value as Record<string, unknown>)[segment]
	return value
}

const messageType = (root: unknown, path: string): RuntimeMessageType => lookup(root, path) as RuntimeMessageType

const fieldValue = (field: ProtoFieldSchema): unknown => {
	switch (field[1]) {
		case PROTO_FIELD_KIND.message:
			return {}
		case PROTO_FIELD_KIND.enum:
			return PROTO_ENUM_SCHEMAS[field[2]]?.[1][3] ?? PROTO_ENUM_SCHEMAS[field[2]]?.[1][1] ?? 0
		case PROTO_FIELD_KIND.string:
			return 'value'
		case PROTO_FIELD_KIND.bool:
			return true
		case PROTO_FIELD_KIND.bytes:
			return Uint8Array.of(1, 2)
		case PROTO_FIELD_KIND.float:
			return 1.5
		case PROTO_FIELD_KIND.signed32:
			return -7
		case PROTO_FIELD_KIND.unsigned32:
			return 7
		case PROTO_FIELD_KIND.signed64:
			return '-7'
		case PROTO_FIELD_KIND.unsigned64:
			return '7'
		default:
			throw new Error(`unknown generated field kind: ${field[1]}`)
	}
}

const fixtureForField = (field: ProtoFieldSchema): Record<string, unknown> => {
	const value = fieldValue(field)
	if (field[3] & PROTO_FIELD_FLAG.map) return { [field[0]]: { '1': value } }
	return { [field[0]]: field[3] & PROTO_FIELD_FLAG.repeated ? [value] : value }
}

const coverage = (matched: number, total: number): Coverage => ({ matched, total, coverage: percent(matched, total) })

export const runProtoRuntimeCompatibilityAudit = (): ProtoRuntimeCompatibilityReport => {
	const objectGaps: string[] = []
	for (const [path] of PROTO_MESSAGE_SCHEMAS) {
		try {
			const upstream = messageType(upstreamProto, path)
			const local = messageType(localProto, path)
			if (local.name !== upstream.name || local.getTypeUrl() !== upstream.getTypeUrl()) throw new Error('constructor')
			for (const make of [
				(type: RuntimeMessageType) => type.create(),
				(type: RuntimeMessageType) => type.fromObject({})
			]) {
				const expected = make(upstream)
				const actual = make(local)
				if (!isDeepStrictEqual(Object.keys(actual), Object.keys(expected))) throw new Error('object keys')
				for (const options of objectOptions) {
					if (!isDeepStrictEqual(local.toObject(actual, options), upstream.toObject(expected, options))) {
						throw new Error('conversion')
					}
				}
			}
		} catch {
			objectGaps.push(path)
		}
	}

	const enumGaps: string[] = []
	for (const [path] of PROTO_ENUM_SCHEMAS) {
		if (!isDeepStrictEqual(lookup(localProto, path), lookup(upstreamProto, path))) enumGaps.push(path)
	}

	const wireGaps: string[] = []
	let fieldCount = 0
	for (const [path, fields] of PROTO_MESSAGE_SCHEMAS) {
		const upstream = messageType(upstreamProto, path)
		const local = messageType(localProto, path)
		for (const field of fields) {
			fieldCount++
			const fixture = fixtureForField(field)
			try {
				const upstreamBytes = upstream.encode(upstream.fromObject(fixture)).finish()
				const localBytes = local.encode(local.fromObject(fixture)).finish()
				const expected = upstream.toObject(upstream.decode(upstreamBytes), wireOptions)
				const decodedLocalWire = upstream.toObject(upstream.decode(localBytes), wireOptions)
				const decodedUpstreamWire = local.toObject(local.decode(upstreamBytes), wireOptions)
				if (!isDeepStrictEqual(decodedLocalWire, expected) || !isDeepStrictEqual(decodedUpstreamWire, expected)) {
					wireGaps.push(`${path}.${field[0]}`)
				}
			} catch {
				wireGaps.push(`${path}.${field[0]}`)
			}
		}
	}

	const knownWireGaps = new Set(KNOWN_WIRE_GAPS)
	const actualWireGaps = new Set(wireGaps)
	return {
		schemaSource: PROTO_SCHEMA_SOURCE,
		objectContracts: {
			...coverage(PROTO_MESSAGE_SCHEMAS.length - objectGaps.length, PROTO_MESSAGE_SCHEMAS.length),
			gaps: objectGaps
		},
		enums: { ...coverage(PROTO_ENUM_SCHEMAS.length - enumGaps.length, PROTO_ENUM_SCHEMAS.length), gaps: enumGaps },
		codecTypes: {
			...coverage(PROTO_MESSAGE_SCHEMAS.length - unsupportedProtoCodecs.length, PROTO_MESSAGE_SCHEMAS.length),
			unsupported: unsupportedProtoCodecs
		},
		wireFields: {
			...coverage(fieldCount - wireGaps.length, fieldCount),
			gaps: wireGaps,
			unexpectedGaps: wireGaps.filter(path => !knownWireGaps.has(path as (typeof KNOWN_WIRE_GAPS)[number])),
			resolvedKnownGaps: KNOWN_WIRE_GAPS.filter(path => !actualWireGaps.has(path))
		}
	}
}

const reportIsStable = (report: ProtoRuntimeCompatibilityReport): boolean =>
	report.objectContracts.gaps.length === 0 &&
	report.enums.gaps.length === 0 &&
	isDeepStrictEqual([...report.codecTypes.unsupported].toSorted(), KNOWN_UNSUPPORTED_CODECS.toSorted()) &&
	report.wireFields.unexpectedGaps.length === 0 &&
	report.wireFields.resolvedKnownGaps.length === 0

const render = (report: ProtoRuntimeCompatibilityReport, details: boolean, onlyMissing: boolean): string => {
	const lines = [
		'WAProto runtime compatibility',
		`schema: ${report.schemaSource}`,
		`object contracts: ${report.objectContracts.matched}/${report.objectContracts.total} (${report.objectContracts.coverage.toFixed(2)}%)`,
		`enum values: ${report.enums.matched}/${report.enums.total} (${report.enums.coverage.toFixed(2)}%)`,
		`codec types: ${report.codecTypes.matched}/${report.codecTypes.total} (${report.codecTypes.coverage.toFixed(2)}%)`,
		`wire fields: ${report.wireFields.matched}/${report.wireFields.total} (${report.wireFields.coverage.toFixed(2)}%)`
	]
	if (details || onlyMissing) {
		if (report.codecTypes.unsupported.length)
			lines.push(`unsupported codecs: ${report.codecTypes.unsupported.join(', ')}`)
		if (report.objectContracts.gaps.length) lines.push(`object gaps: ${report.objectContracts.gaps.join(', ')}`)
		if (report.enums.gaps.length) lines.push(`enum gaps: ${report.enums.gaps.join(', ')}`)
		if (report.wireFields.gaps.length) lines.push(`wire gaps:\n  ${report.wireFields.gaps.join('\n  ')}`)
		if (report.wireFields.unexpectedGaps.length) {
			lines.push(`unexpected wire gaps: ${report.wireFields.unexpectedGaps.join(', ')}`)
		}
		if (report.wireFields.resolvedKnownGaps.length) {
			lines.push(`resolved baseline gaps: ${report.wireFields.resolvedKnownGaps.join(', ')}`)
		}
	}
	return `${lines.join('\n')}\n`
}

if (process.argv[1]?.endsWith('proto-runtime-audit.ts')) {
	const arguments_ = new Set(process.argv.slice(2))
	const report = runProtoRuntimeCompatibilityAudit()
	process.stdout.write(
		arguments_.has('--format=json')
			? `${JSON.stringify(report, null, 2)}\n`
			: render(report, arguments_.has('--details'), arguments_.has('--only-missing'))
	)
	if (arguments_.has('--strict') && !reportIsStable(report)) process.exitCode = 1
}
