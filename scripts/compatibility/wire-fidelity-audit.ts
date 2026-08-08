#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
	auditWireFidelity,
	buildFieldCases,
	buildFuzzCases,
	fidelityAuditFailed,
	renderFidelityReport
} from './wire-fidelity-core.ts'

const usage = `Baileyrs send-path wire fidelity auditor

Checks that every proto field a caller sets reaches the bridge unchanged. The
declaration auditor cannot see this: relayMessage keeps its upstream signature
whatever the send path does to the bytes.

Usage:
  node scripts/compatibility/wire-fidelity-audit.ts [options]

Options:
  --seed <number>    Fuzz seed (default: 20260808)
  --fuzz <number>    Fuzz cases on top of the schema sweep (default: 200)
  --details          List skipped cases too
  --strict           Exit 1 when a field is dropped or altered
  --help             Show this help
`

export const runCli = async (argv: string[]): Promise<number> => {
	let seed = 20260808
	let fuzz = 200
	let details = false
	let strict = false

	for (let index = 0; index < argv.length; index++) {
		const option = argv[index]!
		const [name, inline] = option.includes('=') ? [option.slice(0, option.indexOf('=')), option.slice(option.indexOf('=') + 1)] : [option, undefined]
		const takeValue = () => {
			if (inline !== undefined) return inline
			const value = argv[index + 1]
			if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
			index++
			return value
		}
		switch (name) {
			case '--help':
			case '-h':
				process.stdout.write(usage)
				return 0
			case '--details':
				details = true
				break
			case '--strict':
				strict = true
				break
			case '--seed':
				seed = Number(takeValue())
				break
			case '--fuzz':
				fuzz = Number(takeValue())
				break
			default:
				throw new Error(`unknown option: ${option}`)
		}
	}

	if (!Number.isInteger(seed) || !Number.isInteger(fuzz) || fuzz < 0) {
		throw new Error('--seed and --fuzz must be integers, and --fuzz must not be negative')
	}

	const report = await auditWireFidelity([...buildFieldCases(), ...buildFuzzCases(seed, fuzz)])
	process.stdout.write(`${renderFidelityReport(report, details)}\nfuzz seed: ${seed}\n`)
	return strict && fidelityAuditFailed(report) ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await runCli(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 2
	}
}
