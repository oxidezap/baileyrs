import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const facadeSource = resolve(root, 'src/WAProto/index.d.ts')
const nestedProtobuf = resolve(root, 'node_modules/baileys/node_modules/protobufjs')

const consumerProgram = `import { proto } from './facade.js'
import { Reader as UpstreamReader, Writer as UpstreamWriter } from './upstream76.js'

const created = proto.Message.create({})
const writer = proto.Message.encode(created)
const bytes: Uint8Array = writer.finish()
const back = proto.Message.decode(bytes)
const backAgain = proto.Message.decode(bytes.subarray(0))
const plain = proto.Message.toObject(back, {
	longs: String,
	enums: String,
	bytes: String,
	defaults: true,
	arrays: true,
	objects: true,
	oneofs: true,
	json: true
})
const roundTrip = proto.Message.fromObject(plain)
const typeUrl: string = proto.Message.getTypeUrl('custom.prefix')
declare const upstreamWriter: UpstreamWriter
declare const upstreamReader: UpstreamReader
const chained = proto.Message.encode(created, upstreamWriter)
const storedBack: UpstreamWriter = chained
const fromUpstream = proto.Message.decode(upstreamReader)
void backAgain
void roundTrip
void typeUrl
void storedBack
void fromUpstream
`

const negativeProgram = `import 'protobufjs'
`

const consumerTsconfig = JSON.stringify({
	compilerOptions: {
		target: 'ES2022',
		module: 'nodenext',
		moduleResolution: 'nodenext',
		strict: true,
		noEmit: true,
		skipLibCheck: false,
		types: ['node']
	},
	include: ['consumer.ts']
})

const negativeTsconfig = JSON.stringify({
	compilerOptions: {
		target: 'ES2022',
		module: 'nodenext',
		moduleResolution: 'nodenext',
		strict: true,
		noEmit: true,
		skipLibCheck: false,
		types: []
	},
	include: ['negative.ts']
})

const runTsc = (dir: string, project: string): { ok: boolean; output: string } => {
	try {
		const output = execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', project], {
			cwd: dir,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		})
		return { ok: true, output: output as string }
	} catch (error) {
		const failure = error as { stdout?: unknown; stderr?: unknown }
		return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
	}
}

describe('consumer without protobufjs', () => {
	it('ships no protobufjs import in dependencies or the published facade', () => {
		const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>
		}
		assert.ok(!manifest.dependencies?.['protobufjs'], 'protobufjs must not remain a runtime dependency')
		const facade = readFileSync(facadeSource, 'utf8')
		assert.ok(!facade.includes('protobufjs'), 'published facade must not reference protobufjs')
	})

	it('typechecks a consumer program with protobufjs unresolvable', () => {
		const nestedDeclaration = join(nestedProtobuf, 'index.d.ts')
		let nestedVersion: unknown
		try {
			nestedVersion = (JSON.parse(readFileSync(join(nestedProtobuf, 'package.json'), 'utf8')) as { version?: unknown }).version
		} catch {
			nestedVersion = undefined
		}
		assert.ok(
			typeof nestedVersion === 'string' && nestedVersion.startsWith('7.'),
			'Baileys must resolve protobufjs 7.x for the cross-compat check; reinstall with npm ci'
		)
		const dir = mkdtempSync(join(tmpdir(), 'baileyrs-consumer-'))
		try {
			mkdirSync(join(dir, 'node_modules'), { recursive: true })
			symlinkSync(resolve(root, 'node_modules/long'), join(dir, 'node_modules/long'))
			mkdirSync(join(dir, 'node_modules/@types'), { recursive: true })
			symlinkSync(resolve(root, 'node_modules/@types/node'), join(dir, 'node_modules/@types/node'))
			writeFileSync(join(dir, 'facade.d.ts'), readFileSync(facadeSource, 'utf8'))
			writeFileSync(join(dir, 'upstream76.d.ts'), readFileSync(nestedDeclaration, 'utf8'))
			writeFileSync(join(dir, 'consumer.ts'), consumerProgram)
			writeFileSync(join(dir, 'tsconfig.json'), consumerTsconfig)
			const positive = runTsc(dir, 'tsconfig.json')
			assert.ok(positive.ok, `consumer program must compile without protobufjs:\n${positive.output}`)

			writeFileSync(join(dir, 'negative.ts'), negativeProgram)
			writeFileSync(join(dir, 'tsconfig.negative.json'), negativeTsconfig)
			const negative = runTsc(dir, 'tsconfig.negative.json')
			assert.ok(!negative.ok, 'control import of protobufjs must fail to resolve')
			assert.ok(
				negative.output.includes('Cannot find module'),
				`control failure must be the missing module, got:\n${negative.output}`
			)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
