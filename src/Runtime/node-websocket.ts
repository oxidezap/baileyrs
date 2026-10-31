import { DEFAULT_ORIGIN } from '../Defaults/index.ts'

interface RuntimeUndici {
	Agent: new (options: unknown) => unknown
	WebSocket: typeof WebSocket
}

export interface NodeWebSocketConfig {
	options?: RequestInit
	dangerSkipCertChainVerify?: boolean
	webSocketCtor?: typeof WebSocket
}

let defaultDispatcher: unknown

/** Pair an Agent with the WebSocket from the same undici implementation. */
const loadUndici = async (): Promise<RuntimeUndici | undefined> => {
	const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
	if (builtin) {
		try {
			const mod = builtin.call(process, 'undici') as RuntimeUndici | undefined
			if (mod?.Agent && mod?.WebSocket) return mod
		} catch {
			/* Fall back to the npm copy. */
		}
	}
	try {
		const mod = (await import('undici')) as unknown as RuntimeUndici
		return mod.Agent && mod.WebSocket ? mod : undefined
	} catch {
		return undefined
	}
}

const getDispatcher = (undici: RuntimeUndici, insecure: boolean): unknown => {
	if (!insecure && defaultDispatcher !== undefined) return defaultDispatcher
	try {
		// Node 22+ can attempt HTTP/2 WebSocket, unsupported by WhatsApp Web.
		// A custom insecure agent is never shared with secure connections.
		const agent = new undici.Agent({
			allowH2: false,
			...(insecure ? { connect: { rejectUnauthorized: false } } : {})
		})
		if (!insecure) defaultDispatcher = agent
		return agent
	} catch {
		if (!insecure) defaultDispatcher = null
		return null
	}
}

export const createNodeWebSocket = async (url: string, config: NodeWebSocketConfig): Promise<WebSocket> => {
	const undici = await loadUndici()
	const insecure = config.dangerSkipCertChainVerify === true || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
	const dispatcher = config.options?.dispatcher ?? (undici ? getDispatcher(undici, insecure) : null)
	const options: Record<string, unknown> = { headers: { Origin: DEFAULT_ORIGIN } }
	if (dispatcher) options.dispatcher = dispatcher
	const ctor = config.webSocketCtor ?? undici?.WebSocket ?? WebSocket
	return new ctor(url, options as never)
}
