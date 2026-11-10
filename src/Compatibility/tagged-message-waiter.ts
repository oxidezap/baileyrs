import type { EventEmitter } from 'events'
import { unrefTimer } from '../Runtime/bytes.ts'
import { DisconnectReason } from '../Types/index.ts'
import { Boom } from '../Utils/boom.ts'
import type { ILogger } from '../Utils/logger.ts'

/** Build the low-level tagged-response waiter with upstream timeout semantics. */
export const makeTaggedMessageWaiter = (
	ws: EventEmitter,
	logger: ILogger,
	defaultTimeoutMs: number | undefined,
	timers: {
		setTimeout: (callback: () => void, ms: number) => unknown
		clearTimeout: (handle: unknown) => void
	}
) =>
	async function waitForMessage<T>(msgId: string, timeoutMs = defaultTimeoutMs): Promise<T | undefined> {
		const tag = `TAG:${msgId}`
		let timer: unknown
		let onRecv: ((data: T) => void) | undefined
		let onError: ((error?: unknown) => void) | undefined

		try {
			return await new Promise<T>((resolve, reject) => {
				onRecv = resolve
				onError = error =>
					reject(
						error instanceof Error
							? error
							: new Boom('Connection Closed', { statusCode: DisconnectReason.connectionClosed })
					)
				ws.on(tag, onRecv as (...args: unknown[]) => void)
				ws.on('close', onError)
				ws.on('error', onError)

				if (timeoutMs) {
					timer = unrefTimer(
						timers.setTimeout(
							() => reject(new Boom('Timed out waiting for message', { statusCode: DisconnectReason.timedOut })),
							timeoutMs
						)
					)
				}
			})
		} catch (error) {
			if (error instanceof Boom && error.output.statusCode === DisconnectReason.timedOut) {
				logger.warn({ msgId }, 'timed out waiting for message')
				return undefined
			}
			throw error
		} finally {
			if (timer !== undefined) timers.clearTimeout(timer)
			if (onRecv) ws.off(tag, onRecv as (...args: unknown[]) => void)
			if (onError) {
				ws.off('close', onError)
				ws.off('error', onError)
			}
		}
	}
