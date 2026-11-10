import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostRuntime } from '../Runtime/host.ts'
import { setLoggerSink } from '../host-surface.ts'
import { createRuntimeLogger } from '../Utils/logger.ts'

describe('host logger sink', () => {
	it('automatically acknowledges a one-argument sink', async () => {
		const lines: string[] = []
		setLoggerSink(line => lines.push(line))
		try {
			const logger = createRuntimeLogger((line, delivered) => hostRuntime.loggerSink(line, delivered))
			logger.info({ event: 'host-log' })
			await new Promise<void>(resolve => logger.flush(resolve))
			assert.equal(lines.length, 1)
		} finally {
			setLoggerSink(undefined)
		}
	})

	it('keeps explicit delivery control for two-argument sinks', async () => {
		let acknowledge: (() => void) | undefined
		setLoggerSink((_line, delivered) => {
			acknowledge = delivered
		})
		try {
			const logger = createRuntimeLogger((line, delivered) => hostRuntime.loggerSink(line, delivered))
			logger.info({ event: 'deferred-host-log' })
			let flushed = false
			const flush = new Promise<void>(resolve => logger.flush(resolve)).then(() => {
				flushed = true
			})
			await Promise.resolve()
			assert.equal(flushed, false)
			acknowledge!()
			await flush
			assert.equal(flushed, true)
		} finally {
			setLoggerSink(undefined)
		}
	})
})
