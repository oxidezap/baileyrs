import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { describe, it } from 'node:test'
import protobuf from 'protobufjs/minimal.js'
import { proto as upstreamProto } from 'baileys'
import { PROTO_ENUM_SCHEMAS, PROTO_MESSAGE_SCHEMAS } from '../WAProto/compatibility-schema.ts'
import { proto as localProto } from '../WAProto/runtime.ts'

interface RuntimeMessageType {
	new (properties?: Record<string, unknown>): Record<string, unknown>
	create(properties?: Record<string, unknown>): Record<string, unknown>
	decode(input: unknown, length?: number): Record<string, unknown>
	encode(message: unknown, writer?: unknown): { finish(): Uint8Array }
	fromObject(message: unknown): Record<string, unknown>
	getTypeUrl(prefix?: string): string
	toObject(message: unknown, options?: Record<string, unknown>): Record<string, unknown>
}

const lookup = (root: unknown, path: string): unknown => {
	let value = root
	for (const segment of path.split('.')) value = (value as Record<string, unknown>)[segment]
	return value
}

const messageType = (root: unknown, path: string): RuntimeMessageType => lookup(root, path) as RuntimeMessageType

const conversionOptions = [
	{},
	{ defaults: true },
	{ arrays: true, objects: true },
	{ longs: String, enums: String, bytes: String, defaults: true, oneofs: true }
]

describe('generated protobuf runtime facade', () => {
	it('matches constructor, empty-object and enum contracts across the complete pinned surface', () => {
		for (const [path] of PROTO_MESSAGE_SCHEMAS) {
			const upstream = messageType(upstreamProto, path)
			const local = messageType(localProto, path)
			assert.equal(typeof local, 'function', path)
			assert.equal(local.name, upstream.name, path)

			for (const make of [
				(type: RuntimeMessageType) => type.create(),
				(type: RuntimeMessageType) => type.fromObject({})
			]) {
				const expected = make(upstream)
				const actual = make(local)
				assert.equal(actual instanceof local, true, path)
				assert.deepEqual(Object.keys(actual), Object.keys(expected), path)
				for (const options of conversionOptions) {
					assert.deepEqual(local.toObject(actual, options), upstream.toObject(expected, options), path)
				}
			}
			assert.equal(local.getTypeUrl(), upstream.getTypeUrl(), path)
		}

		for (const [path] of PROTO_ENUM_SCHEMAS) {
			assert.deepEqual(lookup(localProto, path), lookup(upstreamProto, path), path)
		}
	})

	it('normalizes nested messages, maps, bytes, enums, oneofs and conversion options', () => {
		const fixtures: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
			[
				'Message.ImageMessage',
				{ mediaKey: 'AQID', fileLength: '9007199254740993', width: '42', interactiveAnnotations: [] }
			],
			[
				'WebMessageInfo',
				{
					status: 'READ',
					messageTimestamp: '9007199254740993',
					key: { remoteJid: 'contact@s.whatsapp.net', fromMe: true, id: 'id' }
				}
			],
			[
				'Message.ButtonsMessage',
				{
					text: 'heading',
					imageMessage: { caption: 'image' },
					buttons: [{ buttonId: 'id', buttonText: { displayText: 'go' }, type: 1 }]
				}
			],
			[
				'Config',
				{ field: { '1': { minVersion: 1, maxVersion: 2, subfield: { '9': { isMessage: true } } } }, version: 3 }
			],
			['Message.LocationMessage', { degreesLatitude: Infinity, degreesLongitude: -Infinity, jpegThumbnail: 'AQID' }],
			['HistorySync', { syncType: 'RECENT', conversations: [{ id: 'chat', name: 'name', messages: [] }] }]
		]

		for (const [path, fixture] of fixtures) {
			const upstream = messageType(upstreamProto, path)
			const local = messageType(localProto, path)
			const expected = upstream.fromObject(structuredClone(fixture))
			const actual = local.fromObject(structuredClone(fixture))
			for (const options of [
				{},
				{ longs: String, enums: String, bytes: String, oneofs: true },
				{ longs: Number, enums: Number, bytes: Array, defaults: true, oneofs: true },
				{ json: true }
			]) {
				assert.deepEqual(local.toObject(actual, options), upstream.toObject(expected, options), path)
			}
			assert.deepEqual(
				(actual as { toJSON(): Record<string, unknown> }).toJSON(),
				(expected as { toJSON(): Record<string, unknown> }).toJSON(),
				path
			)
		}
	})

	it('preserves all 64 bits through the existing codec and interoperates with protobufjs readers and writers', () => {
		const fixture = {
			requestPaymentMessage: {
				amount1000: '9007199254740993',
				expiryTimestamp: '-9007199254740993',
				currencyCodeIso4217: 'BRL'
			}
		}
		const upstream = upstreamProto.Message.fromObject(fixture)
		const bytes = upstreamProto.Message.encode(upstream).finish()
		const reader = protobuf.Reader.create(bytes)
		const decoded = localProto.Message.decode(reader as unknown as Uint8Array)

		assert.equal(reader.pos, reader.len)
		assert.equal(decoded instanceof localProto.Message, true)
		assert.equal(decoded.requestPaymentMessage?.amount1000?.toString(), '9007199254740993')
		assert.equal(decoded.requestPaymentMessage?.expiryTimestamp?.toString(), '-9007199254740993')
		assert.deepEqual(
			localProto.Message.toObject(decoded, { longs: String, oneofs: true }),
			upstreamProto.Message.toObject(upstream, { longs: String, oneofs: true })
		)

		const writer = protobuf.Writer.create()
		assert.equal(localProto.Message.encode(decoded, writer), writer)
		assert.deepEqual(
			upstreamProto.Message.toObject(upstreamProto.Message.decode(writer.finish()), { longs: String }),
			upstreamProto.Message.toObject(upstream, { longs: String })
		)
	})

	it('preserves wire fixtures captured with Baileys rc14 and protobufjs 7.6.5', () => {
		const fixtures: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
			['Message', { conversation: '' }, '0a00'],
			[
				'Message',
				{
					requestPaymentMessage: {
						amount1000: '18446744073709551615',
						expiryTimestamp: '-9007199254740993',
						currencyCodeIso4217: 'BRL'
					}
				},
				'b2011b0a0342524c10ffffffffffffffffff0128ffffffffffffffefff01'
			],
			[
				'Config',
				{ field: { '1': { minVersion: 1, maxVersion: 2, subfield: { '9': { isMessage: true } } } }, version: 3 },
				'0a100801120c080110022a060809120220011003'
			],
			[
				'Message',
				{ imageMessage: { caption: 'hello', mediaKey: 'AQID', fileLength: '9007199254740993', width: 0 } },
				'1a171a0568656c6c6f28818080808080801038004203010203'
			]
		]
		for (const [path, input, hex] of fixtures) {
			for (const root of [localProto, upstreamProto]) {
				const type = messageType(root, path)
				const message = type.fromObject(input)
				assert.equal(Buffer.from(type.encode(message).finish()).toString('hex'), hex, path)
				assert.deepEqual(
					type.toObject(type.decode(Buffer.from(hex, 'hex')), { longs: String, bytes: String }),
					type.toObject(message, { longs: String, bytes: String }),
					path
				)
			}
		}
	})

	it('preserves forked writer state and length-bounded reader positions', () => {
		for (const writer of [new protobuf.Writer(), protobuf.Writer.create()]) {
			writer.uint32(42).fork()
			assert.equal(localProto.Message.encode({ conversation: 'hello' }, writer), writer)
			writer.ldelim().uint32(99)
			assert.equal(Buffer.from(writer.finish()).toString('hex'), '2a070a0568656c6c6f63')
			const reader = protobuf.Reader.create(writer.finish())
			assert.equal(reader.uint32(), 42)
			const length = reader.uint32()
			assert.equal(localProto.Message.decode(reader as unknown as Uint8Array, length).conversation, 'hello')
			assert.equal(reader.pos, 9)
			assert.equal(reader.uint32(), 99)
			assert.equal(reader.pos, reader.len)
		}
	})

	it('measures every upstream field on the wire and rejects unreviewed drift', () => {
		const script = new URL('../../scripts/compatibility/proto-runtime-audit.ts', import.meta.url)
		const result = spawnSync(process.execPath, [script.pathname, '--format=json', '--strict'], {
			cwd: new URL('../..', import.meta.url),
			encoding: 'utf8'
		})
		assert.equal(result.status, 0, result.stderr)
		const report = JSON.parse(result.stdout) as {
			objectContracts: { coverage: number }
			enums: { coverage: number }
			codecTypes: { coverage: number; unsupported: string[] }
			wireFields: {
				coverage: number
				matched: number
				total: number
				gaps: string[]
				unexpectedGaps: string[]
				resolvedKnownGaps: string[]
			}
		}
		assert.equal(report.objectContracts.coverage, 100)
		assert.equal(report.enums.coverage, 100)
		assert.equal(report.codecTypes.coverage, 99.8)
		assert.deepEqual(report.codecTypes.unsupported, ['BotAvatarMetadata'])
		assert.equal(report.wireFields.coverage, 99.26)
		assert.equal(report.wireFields.matched, 2406)
		assert.equal(report.wireFields.total, 2424)
		assert.equal(report.wireFields.gaps.length, 18)
		assert.deepEqual(report.wireFields.unexpectedGaps, [])
		assert.deepEqual(report.wireFields.resolvedKnownGaps, [])
	})

	it('keeps compatibility metadata compact and ships no second codec runtime', () => {
		const runtimeSource = readFileSync(new URL('../Compatibility/proto-runtime.ts', import.meta.url), 'utf8')
		assert.doesNotMatch(runtimeSource, /import .* from ['"](?:baileys|protobufjs)/)
		assert.ok(statSync(new URL('../WAProto/compatibility-schema.ts', import.meta.url)).size < 160_000)
	})
})
