import { createWASocketFactory } from './core.ts'
import { nodeRuntime } from '../Runtime/node.ts'
import type { BaileysRuntime } from '../Runtime/types.ts'

/**
 * Node entrypoint: the factory every consumer has always called, bound to
 * the Node runtime (bare bridge entrypoint, node:crypto randomness,
 * portable emitter, OpenSSL native crypto, stdout logger sink).
 */
export const makeNodeWASocket = createWASocketFactory(nodeRuntime)
/** Bind the socket core to a custom runtime (host entrypoints use this). */
export const createWASocketFactoryFor = (runtime: BaileysRuntime) => createWASocketFactory(runtime)
const makeWASocket = makeNodeWASocket
export default makeWASocket
export { createWASocketFactory }
