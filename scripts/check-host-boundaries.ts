/**
 * Host-boundary gate: the files published under `@oxidezap/baileyrs/host`
 * must stay free of Node-only imports, and host/shared code must reach the
 * bridge only through its host-loaded entrypoint.
 *
 * Run with `node scripts/check-host-boundaries.ts`. Exits non-zero on the
 * first violation class found, listing every offending line.
 *
 * This script runs against the TypeScript sources (no build needed). The
 * `compat:*` audits remain the built-output gates; this one keeps the host
 * surface closed while the portable graph is still being extracted.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript-compat-auditor'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')

// Modules that already exist AND are host-neutral (no runtime imports, only
// types from the bridge or pure domain logic). A file lands here when it has
// been reviewed; everything else under src/ stays Node-assumed until ported.
const HOST_NEUTRAL = new Set(
	[
		'src/Bridge/adapt.ts',
		'src/Bridge/history-sync-wire.ts',
		'src/Bridge/index.ts',
		'src/Bridge/primitives.ts',
		'src/Bridge/schema.ts',
		'src/Bridge/types.ts',
		'src/Compatibility/encode-proto-core.ts',
		'src/Compatibility/group-metadata.ts',
		'src/Compatibility/history-sync-admission.ts',
		'src/Compatibility/media-type.ts',
		'src/Compatibility/message-ids.ts',
		'src/Compatibility/message-relay.ts',
		'src/Compatibility/auth-state.ts',
		'src/Compatibility/newsletter-results.ts',
		'src/Compatibility/proto-runtime.ts',
		'src/Runtime/bridge.ts',
		'src/Runtime/bytes.ts',
		'src/Runtime/types.ts',
		'src/Media/content.ts',
		'src/Media/mutations.ts',
		'src/WABinary/generic-utils.ts',
		'src/Media/core.ts',
		'src/Socket/core.ts',
		'src/Socket/events-core.ts',
		'src/Socket/transport.ts',
		'src/Compatibility/tagged-message-waiter.ts',
		'src/Utils/browser-utils.ts',
		'src/Utils/process-history-message-core.ts',
		'src/Utils/process-message-core.ts'
	].map(p => resolve(root, p))
)

// `node:` specifiers no host-neutral module may import. `node:events` is
// absent on purpose: the portable `events` package (see Commit 8) is the
// replacement, and bare `events` is allowed below. `node:url` (global URL)
// and `node:buffer` (boundary-only Buffer) are handled as separate classes.
const FORBIDDEN_NODE = [
	'node:fs',
	'node:path',
	'node:os',
	'node:crypto',
	'node:buffer',
	'node:events',
	'node:stream',
	'node:module',
	'node:child_process',
	'node:https',
	'node:http',
	'node:net',
	'node:dns',
	'node:async_hooks',
	'node:util',
	'node:process',
	'node:worker_threads',
	'node:cluster',
	'node:dgram',
	'node:tls',
	'node:zlib',
	'node:readline',
	'node:repl',
	'node:vm',
	'node:sqlite'
]

const listSourceFiles = (directory: string): string[] => {
	const out: string[] = []
	for (const entry of readdirSync(directory)) {
		if (entry === '__tests__' || entry === '__fuzz__' || entry === 'node_modules') continue
		const path = join(directory, entry)
		if (statSync(path).isDirectory()) out.push(...listSourceFiles(path))
		else if (path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.test-e2e.ts')) out.push(path)
	}
	return out
}

const violations: string[] = []
const report = (file: string, line: number, text: string, message: string) =>
	violations.push(`${relative(root, file)}:${line}: ${message}: ${text.trim()}`)

type ModuleReference = { specifier: string; typeOnly: boolean; dynamic: boolean; line: number; text: string }

const moduleReferences = (file: string, source: string): ModuleReference[] => {
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const lines = source.split(/\r?\n/u)
	const references: ModuleReference[] = []
	const add = (node: ts.Node, specifier: string, typeOnly: boolean, dynamic = false) => {
		const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
		references.push({ specifier, typeOnly, dynamic, line, text: lines[line - 1] ?? '' })
	}
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause
			const named = clause?.namedBindings
			const typeOnly =
				!!clause?.isTypeOnly ||
				(!!named && ts.isNamedImports(named) && !clause?.name && named.elements.every(element => element.isTypeOnly))
			add(node, node.moduleSpecifier.text, typeOnly)
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.exportClause
			const typeOnly =
				node.isTypeOnly ||
				(!!clause && ts.isNamedExports(clause) && clause.elements.every(element => element.isTypeOnly))
			add(node, node.moduleSpecifier.text, typeOnly)
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1 &&
			ts.isStringLiteral(node.arguments[0]!)
		) {
			add(node, node.arguments[0]!.text, false, true)
		}
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return references
}

const multilineProbe = moduleReferences(
	'host-boundary-multiline-probe.ts',
	"import {\n\tvalue\n} from './multiline-value.ts'\nimport type {\n\tTypeOnly\n} from './multiline-type.ts'\n"
)
if (
	multilineProbe[0]?.specifier !== './multiline-value.ts' ||
	multilineProbe[0].typeOnly ||
	multilineProbe[1]?.specifier !== './multiline-type.ts' ||
	!multilineProbe[1].typeOnly
) {
	violations.push('scripts/check-host-boundaries.ts: module parser failed its multiline import self-check')
}

for (const file of listSourceFiles(src)) {
	const source = readFileSync(file, 'utf8')
	const lines = source.split(/\r?\n/u)
	for (const reference of moduleReferences(file, source)) {
		if (reference.typeOnly) continue
		if (reference.specifier === '@oxidezap/whatsapp-rust-bridge' && HOST_NEUTRAL.has(file)) {
			report(file, reference.line, reference.text, 'bare bridge root import in host-neutral surface (use /host)')
		}
		for (const forbidden of FORBIDDEN_NODE) {
			if (
				(reference.specifier === forbidden || reference.specifier.startsWith(`${forbidden}/`)) &&
				HOST_NEUTRAL.has(file)
			) {
				report(file, reference.line, reference.text, `runtime import ${forbidden} in host-neutral file`)
			}
		}
	}
	lines.forEach((line, index) => {
		const lineNo = index + 1
		// Legacy `require()` of a runtime module, in case one creeps in.
		const requireMatch = /require\(\s*['"]([^'"]+)['"]\s*\)/.exec(line)
		if (requireMatch?.[1] && (FORBIDDEN_NODE as string[]).includes(requireMatch[1])) {
			if (HOST_NEUTRAL.has(file)) report(file, lineNo, line, `runtime require ${requireMatch[1]} in host-neutral file`)
		}
		// Direct process/global Node API uses that survive without an import.
		if (/\bprocess\.(env|stdout|stderr|exit|argv|cwd)\b/.test(line) && HOST_NEUTRAL.has(file)) {
			report(file, lineNo, line, 'process global use in host-neutral file')
		}
	})
}

// The gate itself must stay honest: every HOST_NEUTRAL entry has to name a
// file that exists, otherwise a rename silently drops a file from the audit.
for (const file of HOST_NEUTRAL) {
	try {
		statSync(file)
	} catch {
		violations.push(`scripts/check-host-boundaries.ts: HOST_NEUTRAL lists missing file ${relative(root, file)}`)
	}
}

// Second gate: the host entry closure. Walk relative imports from
// `src/host.ts` and fail on any runtime `node:` import or bare bridge-root
// value import — those would bundle Node-only code into the portable
// graph. Type-only imports (`import type`, `export type`) vanish at emit
// and are exempt, as are comments.
const hostClosure = new Set<string>()
const resolveRelative = (fromFile: string, specifier: string): string | undefined => {
	const base = resolve(dirname(fromFile), specifier)
	const candidates = [`${base}.ts`, join(base, 'index.ts'), base]
	for (const candidate of candidates) {
		try {
			if (!statSync(candidate).isDirectory()) return candidate
		} catch {
			/* try the next candidate */
		}
	}
	return undefined
}
const visitHostFile = (file: string): void => {
	if (hostClosure.has(file)) return
	hostClosure.add(file)
	let source: string
	try {
		source = readFileSync(file, 'utf8')
	} catch {
		return
	}
	for (const reference of moduleReferences(file, source)) {
		if (reference.typeOnly || !reference.specifier.startsWith('.')) continue
		const next = resolveRelative(file, reference.specifier)
		if (next && next.endsWith('.ts')) visitHostFile(next)
	}
}
visitHostFile(resolve(src, 'host.ts'))
for (const file of hostClosure) {
	if (!file.endsWith('.ts')) continue
	const source = readFileSync(file, 'utf8')
	const lines = source.split(/\r?\n/u)
	lines.forEach((line, index) => {
		const trimmed = line.trim()
		if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
		const code = line.split('//')[0]!
		if (/\bprocess\.(env|stdout|stderr|exit|argv|cwd)\b/.test(code)) {
			report(file, index + 1, line, 'host closure reads a process global')
		}
		if (/\bBuffer\s*(?:[.(])/u.test(code) && !/\bBufferRuntime\b/u.test(code)) {
			report(file, index + 1, line, 'host closure uses the Node Buffer global')
		}
		if (/\brequire\s*\(|\b(?:__dirname|__filename)\b/u.test(code)) {
			report(file, index + 1, line, 'host closure uses a Node-only global')
		}
	})
	for (const reference of moduleReferences(file, source)) {
		if (reference.typeOnly) continue
		if (reference.specifier === '@oxidezap/whatsapp-rust-bridge') {
			report(file, reference.line, reference.text, 'host closure pulls the bare bridge root (use /host)')
		}
		for (const forbidden of FORBIDDEN_NODE) {
			if (reference.specifier === forbidden || reference.specifier.startsWith(`${forbidden}/`)) {
				report(file, reference.line, reference.text, `host closure pulls runtime import ${forbidden}`)
			}
		}
	}
}

if (violations.length > 0) {
	for (const violation of violations) console.error(violation)
	console.error(`\nhost-boundary gate: ${violations.length} violation(s)`)
	process.exit(1)
}
console.log(
	`host-boundary gate: ${listSourceFiles(src).length} source files checked, ${HOST_NEUTRAL.size} host-neutral, host closure ${hostClosure.size} files, clean`
)
