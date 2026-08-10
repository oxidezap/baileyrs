import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { proto as upstreamProto } from 'baileys'
import { decodeProto, encodeProto, type WasmWhatsAppClient } from '@oxidezap/whatsapp-rust-bridge'
import { makeMessageMethods } from '../../src/Socket/messages.ts'
import type { SocketContext } from '../../src/Socket/types.ts'
import type { WAProto } from '../../src/Types/index.ts'
import {
	PROTO_ENUM_SCHEMAS,
	PROTO_FIELD_FLAG,
	PROTO_FIELD_KIND,
	PROTO_MESSAGE_SCHEMAS,
	type ProtoFieldSchema,
	type ProtoMessageSchema
} from '../../src/WAProto/compatibility-schema.ts'

/**
 * Behavioural companion to the declaration auditor. That auditor compares
 * `.d.ts` shapes, so a send path that quietly deletes a proto field scores 100%
 * compatible: the signature is identical and only the bytes differ. This one
 * plants proto fields on a message, pushes it through the real send path with a
 * capturing bridge client, and reports every field that does not come out the
 * other side.
 */

export type FidelityStatus = 'preserved' | 'dropped' | 'altered' | 'divergent' | 'errored' | 'skipped'

export interface FidelityCase {
	label: string
	message: Record<string, unknown>
	/** Dotted paths planted on the message; each must survive the send path. */
	paths: string[]
}

export interface FidelityFinding {
	label: string
	path: string
	status: FidelityStatus
	detail?: string
}

export interface FidelityReport {
	findings: FidelityFinding[]
	summary: Record<FidelityStatus, number> & { cases: number }
}

const messageSchemas = PROTO_MESSAGE_SCHEMAS as readonly ProtoMessageSchema[]
const enumSchemas = PROTO_ENUM_SCHEMAS as readonly (readonly [string, readonly (string | number)[]])[]

const schemaByPath = new Map(messageSchemas.map(entry => [entry[0], entry] as const))

const fieldsOf = (path: string): readonly ProtoFieldSchema[] => schemaByPath.get(path)?.[1] ?? []

const isRepeated = (field: ProtoFieldSchema) => (field[3] & PROTO_FIELD_FLAG.repeated) !== 0
const isMap = (field: ProtoFieldSchema) => (field[3] & PROTO_FIELD_FLAG.map) !== 0

/** First non-zero member, so the sample is never a proto3 default that the encoder omits. */
const enumSample = (reference: number): number | undefined => {
	const entries = enumSchemas[reference]?.[1] ?? []
	for (let index = 0; index + 1 < entries.length; index += 2) {
		const value = entries[index + 1]
		if (typeof value === 'number' && value > 0) return value
	}
	return undefined
}

const scalarSample = (field: ProtoFieldSchema): unknown => {
	switch (field[1]) {
		case PROTO_FIELD_KIND.string:
			return 'fidelity'
		case PROTO_FIELD_KIND.bool:
			return true
		case PROTO_FIELD_KIND.bytes:
			return new Uint8Array([1, 2, 3, 4])
		case PROTO_FIELD_KIND.float:
			return 1.5
		case PROTO_FIELD_KIND.enum:
			return enumSample(field[2])
		default:
			return 7
	}
}

const messageSample = (reference: number, depth: number): Record<string, unknown> | undefined => {
	const schema = messageSchemas[reference]
	if (!schema) return undefined
	const sample: Record<string, unknown> = {}
	for (const field of schema[1]) {
		if (isMap(field) || isRepeated(field)) continue
		const value =
			field[1] === PROTO_FIELD_KIND.message
				? depth > 0
					? messageSample(field[2], depth - 1)
					: undefined
				: scalarSample(field)
		if (value === undefined) continue
		sample[field[0]] = value
		// A couple of populated members is enough to prove the subtree travels.
		if (Object.keys(sample).length === 2) break
	}
	return sample
}

const fieldSample = (field: ProtoFieldSchema, depth = 2): unknown => {
	const value = field[1] === PROTO_FIELD_KIND.message ? messageSample(field[2], depth) : scalarSample(field)
	if (value === undefined) return undefined
	return isRepeated(field) ? [value] : value
}

const valueAt = (target: unknown, path: string): unknown => {
	let cursor = target
	for (const key of path.split('.')) {
		if (cursor === null || typeof cursor !== 'object') return undefined
		cursor = (cursor as Record<string, unknown>)[key]
	}
	return cursor
}

const plant = (container: Record<string, unknown>, path: string, value: unknown) => {
	const keys = path.split('.')
	const leaf = keys.pop()!
	let cursor = container
	for (const key of keys) {
		cursor[key] ??= {}
		cursor = cursor[key] as Record<string, unknown>
	}
	cursor[leaf] = value
}

/** One case per field of `Message` and of `MessageContextInfo`, straight from the upstream-derived schema. */
export const buildFieldCases = (): FidelityCase[] => {
	const cases: FidelityCase[] = []
	const sweep = (owner: string, prefix: string) => {
		for (const field of fieldsOf(owner)) {
			if (isMap(field)) continue
			const sample = fieldSample(field)
			if (sample === undefined) continue
			const path = prefix ? `${prefix}.${field[0]}` : field[0]
			const message: Record<string, unknown> = {}
			plant(message, path, sample)
			cases.push({ label: `${owner}.${field[0]}`, message, paths: [path] })
		}
	}
	sweep('Message', '')
	sweep('MessageContextInfo', 'messageContextInfo')
	return cases
}

// xorshift32: a seeded generator keeps a failing fuzz case reproducible from its seed alone.
// Zero is rejected rather than remapped: it is a fixed point of the shift, and a
// silently substituted seed would not reproduce the run it is printed with.
const randomSource = (seed: number) => {
	if (!Number.isInteger(seed) || seed === 0) throw new Error('fuzz seed must be a non-zero integer')
	let state = seed
	return () => {
		state ^= state << 13
		state ^= state >>> 17
		state ^= state << 5
		return ((state >>> 0) % 1_000_000) / 1_000_000
	}
}

/**
 * Random field combinations rather than one field at a time: a send path can
 * preserve every field alone and still lose one when a neighbour is present.
 */
export const buildFuzzCases = (seed: number, count: number): FidelityCase[] => {
	const random = randomSource(seed)
	const contentFields = fieldsOf('Message').filter(field => !isMap(field) && field[0] !== 'messageContextInfo')
	const contextFields = fieldsOf('MessageContextInfo').filter(field => !isMap(field))
	const cases: FidelityCase[] = []

	for (let index = 0; index < count; index++) {
		const message: Record<string, unknown> = {}
		const paths: string[] = []
		const content = contentFields[Math.floor(random() * contentFields.length)]
		if (content) {
			const sample = fieldSample(content)
			if (sample !== undefined) {
				plant(message, content[0], sample)
				paths.push(content[0])
			}
		}
		for (const field of contextFields) {
			if (random() < 0.5) continue
			const sample = fieldSample(field)
			if (sample === undefined) continue
			const path = `messageContextInfo.${field[0]}`
			plant(message, path, sample)
			paths.push(path)
		}
		if (!paths.length) continue
		cases.push({ label: `fuzz#${index}`, message, paths })
	}
	return cases
}

const capturingContext = (captured: Uint8Array[]): SocketContext => {
	const client = {
		relayMessageBytesWithOptions: async (_jid: string, bytes: Uint8Array, messageId: string) => {
			captured.push(bytes)
			return messageId
		}
	} as unknown as WasmWhatsAppClient
	const logger = {
		level: 'silent',
		child: () => logger,
		trace: () => undefined,
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined
	}
	return {
		ev: Object.assign(new EventEmitter(), {
			createBufferedFunction: <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) => work
		}),
		logger,
		fullConfig: { options: {}, emitOwnEvents: false },
		getUser: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		getMe: () => ({ id: '15550000000@s.whatsapp.net', lid: '100000000000000@lid' }),
		getClient: async () => client
	} as unknown as SocketContext
}

export type WireSender = (message: Record<string, unknown>) => Promise<Uint8Array>

export const relayedBytes: WireSender = async message => {
	const captured: Uint8Array[] = []
	const ctx = capturingContext(captured)
	await makeMessageMethods(ctx).relayMessage('120363000000000000@g.us', structuredClone(message) as WAProto.IMessage, {
		messageId: '3EB0FIDELITY000000'
	})
	const bytes = captured[0]
	if (!bytes) throw new Error('the send path handed no bytes to the bridge')
	return bytes
}

const upstreamSees = (bytes: Uint8Array, path: string): boolean => {
	const decoded = upstreamProto.Message.toObject(upstreamProto.Message.decode(bytes), {
		longs: Number,
		enums: Number,
		bytes: Uint8Array,
		defaults: false,
		arrays: false,
		objects: false,
		oneofs: false
	}) as Record<string, unknown>
	return valueAt(decoded, path) !== undefined
}

/**
 * Runs every case through `relayMessage` and compares what the bridge received
 * with a plain encode of the same input. Same encoder on both sides, so any
 * difference is the send path's doing.
 */
export const auditWireFidelity = async (
	cases: readonly FidelityCase[],
	send: WireSender = relayedBytes
): Promise<FidelityReport> => {
	const findings: FidelityFinding[] = []

	for (const testCase of cases) {
		const reference = decodeProto('Message', encodeProto('Message', testCase.message))
		let sent: unknown
		let sentBytes: Uint8Array
		try {
			sentBytes = await send(testCase.message)
			sent = decodeProto('Message', sentBytes)
		} catch (error) {
			// A send path that throws produces no auditable bytes at all, which is a
			// harder failure than a dropped field, not a reason to skip the case.
			for (const path of testCase.paths) {
				findings.push({
					label: testCase.label,
					path,
					status: 'errored',
					detail: error instanceof Error ? error.message : String(error)
				})
			}
			continue
		}

		for (const path of testCase.paths) {
			if (valueAt(reference, path) === undefined) {
				findings.push({ label: testCase.label, path, status: 'skipped', detail: 'sample does not survive the codec' })
				continue
			}
			if (valueAt(sent, path) === undefined) {
				findings.push({
					label: testCase.label,
					path,
					status: 'dropped',
					detail: 'absent from the bytes sent to the bridge'
				})
				continue
			}
			try {
				assert.deepStrictEqual(valueAt(sent, path), valueAt(reference, path))
			} catch {
				findings.push({ label: testCase.label, path, status: 'altered', detail: 'value differs from a plain encode' })
				continue
			}
			if (!upstreamSees(sentBytes, path)) {
				findings.push({
					label: testCase.label,
					path,
					status: 'divergent',
					detail: 'upstream protobufjs reads this field at another number'
				})
				continue
			}
			findings.push({ label: testCase.label, path, status: 'preserved' })
		}
	}

	const summary = { cases: cases.length, preserved: 0, dropped: 0, altered: 0, divergent: 0, errored: 0, skipped: 0 }
	for (const finding of findings) summary[finding.status]++
	return { findings, summary }
}

export const fidelityAuditFailed = (report: FidelityReport): boolean =>
	report.summary.dropped > 0 || report.summary.altered > 0 || report.summary.errored > 0

/** Fields both codecs accept but place at different numbers; a codec gap, not a send-path one. */
export const divergentPaths = (report: FidelityReport): string[] => [
	...new Set(report.findings.filter(finding => finding.status === 'divergent').map(finding => finding.path))
]

export const renderFidelityReport = (report: FidelityReport, details = false): string => {
	const lines = [
		'send-path wire fidelity',
		`cases: ${report.summary.cases}`,
		`preserved: ${report.summary.preserved}  dropped: ${report.summary.dropped}  altered: ${report.summary.altered}  divergent: ${report.summary.divergent}  errored: ${report.summary.errored}  skipped: ${report.summary.skipped}`
	]
	for (const finding of report.findings) {
		if (finding.status === 'preserved') continue
		if (finding.status === 'skipped' && !details) continue
		lines.push(
			`- [${finding.status}] ${finding.label} :: ${finding.path}${finding.detail ? ` (${finding.detail})` : ''}`
		)
	}
	return lines.join('\n')
}
