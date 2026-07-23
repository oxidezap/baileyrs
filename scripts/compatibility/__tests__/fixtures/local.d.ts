export interface Model {
	id: string
	nested: {
		enabled: string
	}
	localOnly: boolean
}

export interface BaileysEventMap {
	'thing.update': {
		id: string
		count: string
	}
	'thing.local': {
		value: boolean
	}
	'same-name.update': SameNamePayload
}

export interface SameNamePayload {
	value: number
}

export declare function createThing<T>(identifier: T, options: { retry: string }): Model

export declare function overloaded(id: string): Model

export declare class Client {
	constructor(token: number)
	send(identifier: number): void
}

export declare class PublicStore {
	private readonly localState
	protected readonly localHook: number
	readonly visible: string
	get(id: string): string
	chain(): this
}

export interface StoreHolder {
	store: PublicStore
}

export interface DuplicateMethod {
	validate(id: string): Promise<boolean>
}

export interface LocalOnly {
	value: number
}

declare enum RuntimeModeType {
	FAST = 'fast',
	SAFE = 'safe'
}
export declare const RuntimeMode: typeof RuntimeModeType
export type RuntimeMode = RuntimeModeType
