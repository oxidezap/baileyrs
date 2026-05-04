import Redis from "ioredis";

export type BridgeStore = {
	get(store: string, key: string): Promise<Uint8Array | null>;
	set(store: string, key: string, value: Uint8Array): Promise<void>;
	delete(store: string, key: string): Promise<void>;
	flush(): Promise<void>;
};

/**
 * Creates a BridgeStore backed by Redis.
 * Each entry is stored under the key `{store}:{key}` as a binary Buffer.
 *
 * @param redis - An existing ioredis client, or a Redis URL string (defaults to redis://127.0.0.1:6379)
 */
export function makeRedisStore(redis: Redis | string = "redis://default:redis123@localhost:6379"): BridgeStore {
	const client = typeof redis === "string" ? new Redis(redis) : redis;

	const redisKey = (store: string, key: string) => `baileyrs:${store}:${key}`;

	return {
		async get(store, key): Promise<Uint8Array | null> {
			const buf = await client.getBuffer(redisKey(store, key));
			if (buf === null) return null;
			return new Uint8Array(buf);
		},

		async set(store, key, value): Promise<void> {
			await client.set(redisKey(store, key), Buffer.from(value));
		},

		async delete(store, key): Promise<void> {
			await client.del(redisKey(store, key));
		},

		async flush(): Promise<void> {
			// ioredis writes are not batched by default; no-op unless you add pipelining
		},
	};
}
