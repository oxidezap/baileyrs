import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const coreRoot = resolve(projectRoot, '../whatsapp-rust')
const bridgeRoot = resolve(projectRoot, '../whatsapp-rust-bridge')

const sourceFiles = async (root, extensions) => {
	const files = []
	const visit = async directory => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === 'target' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'pkg') {
				continue
			}
			const path = resolve(directory, entry.name)
			if (entry.isDirectory()) await visit(path)
			else if (extensions.has(extname(entry.name))) files.push(path)
		}
	}
	await visit(root)
	return files
}

const violations = []
const inspect = async (root, files, forbidden) => {
	for (const file of files) {
		const lines = (await readFile(file, 'utf8')).split(/\r?\n/u)
		for (const [index, line] of lines.entries()) {
			for (const { label, pattern } of forbidden) {
				if (pattern.test(line)) {
					violations.push(`${relative(root, file)}:${index + 1}: forbidden ${label}: ${line.trim()}`)
				}
			}
		}
	}
}

const coreFiles = [
	...(await sourceFiles(resolve(coreRoot, 'src'), new Set(['.rs']))),
	...(await sourceFiles(resolve(coreRoot, 'wacore/src'), new Set(['.rs']))),
	...(await sourceFiles(resolve(coreRoot, 'wacore/libsignal/src'), new Set(['.rs'])))
]
await inspect(coreRoot, coreFiles, [
	{ label: 'consumer-library coupling', pattern: /baileys/iu },
	{ label: 'host-runtime coupling', pattern: /javascript/iu }
])

const bridgeFiles = []
for (const path of ['src', 'ts', 'codegen', 'tests']) {
	bridgeFiles.push(...(await sourceFiles(resolve(bridgeRoot, path), new Set(['.rs', '.ts']))))
}
bridgeFiles.push(resolve(bridgeRoot, 'README.md'), resolve(bridgeRoot, 'package.json'))
await inspect(bridgeRoot, bridgeFiles, [
	{ label: 'consumer-library coupling', pattern: /baileys/iu },
	{
		label: 'bridge-owned write-back cache',
		pattern: /\b(?:WriteBackCache|cap_write_back|write_back_flush|flush_cache)\b/u
	},
	{
		label: 'bridge-owned USync model',
		pattern: /\bpub\s+(?:struct|enum)\s+Usync[A-Z][A-Za-z0-9_]*/u
	},
	{
		label: 'bridge-owned USync result translation',
		pattern: /\b(?:core_usync|whatsapp_rust::usync)::Usync(?:ProtocolResult|Outcome)::/u
	},
	{
		label: 'bridge-owned ACK/retry stanza construction',
		pattern: /NodeBuilder::new\("(?:ack|receipt|retry)"\)|\.attr\("type",\s*"(?:retry|enc_rekey_retry)"\)/u
	}
])

await inspect(
	bridgeRoot,
	[resolve(bridgeRoot, 'src/signal_records.rs')],
	[
		{ label: 'serialized migration document', pattern: /(?:base64|serde_json|json!)/iu },
		{ label: 'bridge-owned Signal derivation', pattern: /(?:hkdf|create_hmac|derive_secrets)/iu }
	]
)

const bridgePackage = JSON.parse(await readFile(resolve(bridgeRoot, 'package.json'), 'utf8'))
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
	for (const name of Object.keys(bridgePackage[section] ?? {})) {
		if (/baileys/iu.test(name))
			violations.push(`package.json: dependency ${section}.${name} couples the bridge to a consumer`)
	}
}

const socketFiles = await sourceFiles(resolve(projectRoot, 'src/Socket'), new Set(['.ts']))
await inspect(projectRoot, socketFiles, [
	{
		label: 'standalone compatibility helper in an operational socket path',
		pattern:
			/from\s+['"]\.\.\/(?:Utils|Compatibility\/public-api)\/(?:auth-utils|identity-change-handler|message-retry-manager|pre-key-manager)\.ts['"]/u
	},
	{
		label: 'public ACK builder in an operational socket path',
		pattern: /\bbuildAckStanza\b/u
	},
	{
		label: 'ACK/retry stanza construction in the socket layer',
		pattern: /\btag\s*:\s*['"](?:ack|receipt|retry)['"]|\btype\s*:\s*['"](?:retry|enc_rekey_retry)['"]/u
	}
])

await inspect(
	projectRoot,
	[resolve(projectRoot, 'src/Socket/usync.ts')],
	[
		{
			label: 'official USync stanza construction in the socket layer',
			pattern: /(?:\btag\s*:|\b(?:getQueryElement|getUserElement|parseUSyncQueryResult)\b)/u
		}
	]
)

await inspect(
	projectRoot,
	[resolve(projectRoot, 'src/Compatibility/legacy-store/codecs/signal.ts')],
	[
		{ label: 'consumer-owned Signal cryptography', pattern: /(?:node:crypto|createHmac|createHash|hkdf)/u },
		{
			label: 'consumer-owned canonical Signal record codec',
			pattern: /(?:RecordStructure|SenderKeyRecordStructure|extractLocalRecordFields|bridgeProto|proto\.)/u
		}
	]
)
await inspect(
	projectRoot,
	[resolve(projectRoot, 'src/Compatibility/legacy-store/adapter.ts')],
	[{ label: 'adapter-local exact-record cache', pattern: /ExactRecordCache/u }]
)

if (violations.length) {
	console.error(['Layer-boundary violations:', ...violations.map(value => `- ${value}`)].join('\n'))
	process.exitCode = 1
} else {
	console.log(
		`Layer boundaries clean (${coreFiles.length} core files, ${bridgeFiles.length} bridge files, ${socketFiles.length} socket files)`
	)
}
