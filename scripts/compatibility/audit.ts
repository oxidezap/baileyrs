#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	renderCompatibilityReport,
	runCompatibilityAudit,
	strictAuditFailed,
	type AuditCategory,
	type RenderOptions
} from './audit-core.ts'

interface CliOptions extends RenderOptions {
	local?: string
	upstream?: string
	output?: string
	strict?: boolean
	scopes?: AuditCategory[]
	maxDepth?: number
	maxItems?: number
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const categories = new Set<AuditCategory>(['exports', 'functions', 'fields', 'events'])

const usage = `Baileyrs public compatibility auditor

Usage:
  node scripts/compatibility/audit.ts [options]

Options:
  --local <file>           Local declaration entry (default: lib/index.d.ts)
  --upstream <file|pkg>    Upstream declaration entry or package (default: baileys)
  --scope <list>           exports,functions,fields,events
  --format <kind>          table, markdown or json (default: table)
  --details                Include mismatched and missing items
  --only-missing           Include only missing/mismatched items
  --show-extra             Include local-only items in detailed output
  --output <file>          Write the report to a file
  --max-depth <number>     Recursive field depth (default: 3)
  --max-items <number>     Safety limit for compared items (default: 50000)
  --strict                 Exit 1 when a gap or compiler diagnostic exists
  --help                   Show this help
`

const takeValue = (arguments_: string[], index: number, option: string) => {
	const current = arguments_[index]!
	const inline = current.indexOf('=')
	if (inline >= 0) return { value: current.slice(inline + 1), consumed: 0 }
	const value = arguments_[index + 1]
	if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
	return { value, consumed: 1 }
}

const positiveInteger = (value: string, option: string, allowZero = false) => {
	const number = Number(value)
	if (!Number.isInteger(number) || (allowZero ? number < 0 : number <= 0)) {
		throw new Error(`${option} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`)
	}
	return number
}

export const parseCliArguments = (arguments_: string[]): CliOptions & { help?: boolean } => {
	const options: CliOptions & { help?: boolean } = {}
	for (let index = 0; index < arguments_.length; index++) {
		const option = arguments_[index]!
		if (option === '--help' || option === '-h') {
			options.help = true
			continue
		}
		if (option === '--details') {
			options.details = true
			continue
		}
		if (option === '--only-missing') {
			options.onlyMissing = true
			continue
		}
		if (option === '--show-extra') {
			options.showExtra = true
			continue
		}
		if (option === '--strict') {
			options.strict = true
			continue
		}

		const name = option.split('=', 1)[0]
		if (
			!name ||
			!['--local', '--upstream', '--scope', '--format', '--output', '--max-depth', '--max-items'].includes(name)
		) {
			throw new Error(`unknown option: ${option}`)
		}
		const { value, consumed } = takeValue(arguments_, index, name)
		index += consumed
		switch (name) {
			case '--local':
				options.local = value
				break
			case '--upstream':
				options.upstream = value
				break
			case '--scope': {
				const scopes = value.split(',').filter(Boolean) as AuditCategory[]
				const invalid = scopes.filter(scope => !categories.has(scope))
				if (!scopes.length || invalid.length) throw new Error(`invalid --scope value: ${value}`)
				options.scopes = scopes
				break
			}
			case '--format':
				if (value !== 'table' && value !== 'markdown' && value !== 'json') {
					throw new Error(`invalid --format value: ${value}`)
				}
				options.format = value
				break
			case '--output':
				options.output = value
				break
			case '--max-depth':
				options.maxDepth = positiveInteger(value, '--max-depth', true)
				break
			case '--max-items':
				options.maxItems = positiveInteger(value, '--max-items')
				break
		}
	}
	return options
}

const resolveFile = (value: string) => (isAbsolute(value) ? value : resolve(root, value))

const packageDeclarationEntry = (packageName: string) => {
	const manifestPath = require.resolve(`${packageName}/package.json`, { paths: [root] })
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { types?: string; typings?: string }
	const declaration = manifest.types ?? manifest.typings
	if (!declaration) throw new Error(`${packageName} does not declare a types entry in package.json`)
	return resolve(dirname(manifestPath), declaration)
}

const resolveUpstream = (value: string) => {
	const possibleFile = resolveFile(value)
	return existsSync(possibleFile) ? possibleFile : packageDeclarationEntry(value)
}

export const runCli = (arguments_: string[]) => {
	const options = parseCliArguments(arguments_)
	if (options.help) {
		process.stdout.write(usage)
		return 0
	}

	const localEntry = resolveFile(options.local ?? 'lib/index.d.ts')
	const upstreamEntry = resolveUpstream(options.upstream ?? 'baileys')
	if (!existsSync(localEntry)) {
		throw new Error(`local declaration entry does not exist: ${localEntry}; run npm run build first`)
	}

	const report = runCompatibilityAudit({
		localEntry,
		upstreamEntry,
		maxDepth: options.maxDepth,
		maxItems: options.maxItems,
		scopes: options.scopes
	})
	const rendered = `${renderCompatibilityReport(report, options)}\n`
	if (options.output) {
		const output = resolveFile(options.output)
		mkdirSync(dirname(output), { recursive: true })
		writeFileSync(output, rendered)
		process.stdout.write(`compatibility report written to ${output}\n`)
	} else {
		process.stdout.write(rendered)
	}

	if (report.diagnostics.length) {
		process.stderr.write(`TypeScript diagnostics (${report.diagnostics.length}):\n${report.diagnostics.join('\n')}\n`)
	}
	return options.strict && strictAuditFailed(report) ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = runCli(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 2
	}
}
