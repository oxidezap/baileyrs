/**
 * Node-facing wrapper for the historical public deep import.
 *
 * The shared socket graph imports `messages-core.ts` directly; consumers of
 * this Node deep import get the same filesystem/media initialization as the
 * package root without introducing Node runtime code into `/host`.
 */
import { nodeRuntime as initializedNodeRuntime } from '../Runtime/node.ts'

void initializedNodeRuntime

export * from './messages-core.ts'
