export interface Model {
	id: string
	optional?: number
	nested: {
		enabled: boolean
	}
}

export interface BaileysEventMap {
	'thing.update': {
		id: string
		count?: number
	}
	'thing.delete': {
		id: string
	}
	'same-name.update': SameNamePayload
}

export interface SameNamePayload {
	value: string
}

export declare function createThing<T extends string>(id: T, options?: { retry: number }): Promise<Model>

export declare function overloaded(id: string): Model
export declare function overloaded(id: number): Model

export declare class Client {
	constructor(token: string)
	send(id: string): Promise<void>
}

export declare class PublicStore {
	private readonly upstreamState
	protected readonly upstreamHook: string
	readonly visible: string
	get(id: string): string
	chain(): this
}

export interface StoreHolder {
	store: PublicStore
}

export interface DuplicateMethod {
	validate(id: string): Promise<boolean>
	validate(id: string): Promise<boolean>
}

export interface UpstreamOnly {
	value: string
}

export declare enum RuntimeMode {
	FAST = 'fast',
	SAFE = 'safe'
}
