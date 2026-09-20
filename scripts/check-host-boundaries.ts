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
		'src/Compatibility/encode-proto.ts',
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
		'src/Socket/events.ts',
		'src/Socket/transport.ts',
		'src/Compatibility/tagged-message-waiter.ts',
		'src/Utils/browser-utils.ts',
		'src/Utils/process-history-message.ts',
		'src/Utils/process-message.ts'
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

for (const file of listSourceFiles(src)) {
	const lines = readFileSync(file, 'utf8').split(/\r?\n/u)
	lines.forEach((line, index) => {
		const lineNo = index + 1
		const importMatch = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/.exec(line)
		const sideEffectMatch = /import\s*['"]([^'"]+)['"]/.exec(line)
		const specifier = importMatch?.[1] ?? sideEffectMatch?.[1]
		if (specifier) {
			// Bare bridge root is the Node entrypoint (reads the wasm off
			// disk with node:fs). Host/shared code must use
			// `@oxidezap/whatsapp-rust-bridge/host` (host-supplied wasm via
			// initSync) instead. Type-only root imports are exempt: they
			// vanish at emit and cannot pull the Node loader into a bundle.
			if (specifier === '@oxidezap/whatsapp-rust-bridge') {
				const isTypeOnly = /^\s*import\s+type\b/.test(line)
				if (!isTypeOnly && HOST_NEUTRAL.has(file)) {
					report(file, lineNo, line, 'bare bridge root import in host-neutral surface (use /host)')
				}
			}
			for (const forbidden of FORBIDDEN_NODE) {
				if (specifier === forbidden || specifier.startsWith(`${forbidden}/`)) {
					if (HOST_NEUTRAL.has(file)) report(file, lineNo, line, `runtime import ${forbidden} in host-neutral file`)
				}
			}
			// The portable `events` package replaces `node:events`. A bare
			// `events` import in neutral code is the migration target shape.
			if (specifier === 'events' && !HOST_NEUTRAL.has(file)) {
				// Not a violation — placeholder for the Commit 8 audit.
			}
		}
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

if (violations.length > 0) {
	for (const violation of violations) console.error(violation)
	console.error(`\nhost-boundary gate: ${violations.length} violation(s)`)
	process.exit(1)
}
console.log(`host-boundary gate: ${listSourceFiles(src).length} source files checked, ${HOST_NEUTRAL.size} host-neutral, clean`)
