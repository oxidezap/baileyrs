#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	auditLifecycleScenarios,
	DEFAULT_LIFECYCLE_OPTIONS,
	evaluateLifecycle,
	lifecycleAuditFailed,
	renderLifecycleReport,
	unexercisedInvariants,
	type LifecycleTrace
} from './lifecycle-contract-core.ts'

const usage = `Baileyrs lifecycle contract auditor

Checks the order upstream Baileys promises on 'connection.update', which the
declaration auditor cannot see: a socket that publishes nothing at all still
matches every '.d.ts' shape. Runs the real dispatcher through the sessions the
engine produces, or judges a trace recorded from a live socket.

Usage:
  node scripts/compatibility/lifecycle-contract-audit.ts [options]

Options:
  --trace <file>          Judge recorded traces (JSON array of LifecycleTrace)
                          instead of the built-in scenarios
  --open-deadline <ms>    Silence after authenticating that counts as evidence
                          (default: ${DEFAULT_LIFECYCLE_OPTIONS.openDeadlineMs})
  --details               List every trace, not just the violations
  --strict                Exit 1 on a violation, and on an invariant no scenario
                          exercised (coverage loss is silent otherwise)
  --help                  Show this help
`

const readTraces = (file: string): LifecycleTrace[] => {
	const parsed: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'))
	if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of traces`)
	return parsed as LifecycleTrace[]
}

export const runCli = (argv: string[]): number => {
	let details = false
	let strict = false
	let traceFile: string | undefined
	let openDeadlineMs = DEFAULT_LIFECYCLE_OPTIONS.openDeadlineMs

	for (let index = 0; index < argv.length; index++) {
		const option = argv[index]!
		const inlineAt = option.indexOf('=')
		const [name, inline] = inlineAt >= 0 ? [option.slice(0, inlineAt), option.slice(inlineAt + 1)] : [option, undefined]
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
			case '--trace':
				traceFile = takeValue()
				break
			case '--open-deadline':
				openDeadlineMs = Number(takeValue())
				break
			default:
				throw new Error(`unknown option: ${option}`)
		}
	}

	if (!Number.isInteger(openDeadlineMs) || openDeadlineMs <= 0) {
		throw new Error('--open-deadline must be a positive integer')
	}

	const options = { openDeadlineMs }
	const report = traceFile
		? evaluateLifecycle(readTraces(traceFile), options)
		: auditLifecycleScenarios(undefined, options)
	process.stdout.write(`${renderLifecycleReport(report, details)}\n`)

	if (!strict) return 0
	if (lifecycleAuditFailed(report)) return 1
	// Only for the built-in suite: a recorded trace is one session and is not
	// expected to reach every state, but the scenarios are the coverage claim.
	return !traceFile && unexercisedInvariants(report).length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = runCli(process.argv.slice(2))
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 2
	}
}
