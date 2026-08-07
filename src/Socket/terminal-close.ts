/**
 * Which bridge disconnects end the socket for good.
 *
 * This mirrors one decision that lives in the Rust engine, so keep it honest:
 * `whatsapp-rust` clears `enable_auto_reconnect` and breaks out of its run loop
 * on exactly these, and retries everything else on the WA Web Fibonacci backoff
 * (`client/lifecycle.rs`).
 *
 * The socket layer needs the answer because `WasmWhatsAppClient.run()` returns
 * `void` — it spawns the loop as a background task, so the loop's exit is not
 * observable from JS (`whatsapp_rust_bridge.d.ts`, `run(): void`). Until the
 * bridge exposes loop completion, this table is how the socket knows a client
 * has become dead weight that only `free()` can reclaim.
 *
 * The upstream Baileys contract this buys us: `connection.update { close }`
 * means "this socket is finished, build a new one" — which is what every
 * consumer written against upstream already assumes, because upstream has no
 * auto-reconnect at all. Transient drops therefore never surface as `close`;
 * they surface as `connecting`.
 *
 * Events deliberately absent from the terminal set, and why:
 *  - `disconnected` — the engine only dispatches `Event::Disconnected` for an
 *    *unexpected* loop exit, and every terminal path sets `expected_disconnect`
 *    first, which suppresses it (`client/lifecycle.rs`). So this one is the
 *    "engine is retrying" signal — with one exception the dispatcher handles:
 *    under `setAutoReconnect(false)` the run loop dispatches `Disconnected`
 *    and only *then* tests the flag and breaks out, which makes the very same
 *    event terminal. Absence from this list means "not terminal on its own",
 *    not "never terminal".
 *  - `streamError` — reaches JS only from the engine's catch-all `<stream:error>`
 *    branch (unknown code, `<ack/>`, `<xml-not-well-formed>`); the coded ones
 *    (401/409/515/516/429/503) dispatch their own events instead. Every case
 *    that gets here keeps the connection or recycles it deliberately.
 *  - `pairError` — pairing failed, but the engine keeps its loop and re-emits a
 *    QR; nothing about the client is dead.
 */

/**
 * `ConnectFailureReason` wire codes the engine retries — the JS mirror of
 * `ConnectFailureReason::should_reconnect()`, which matches only
 * `InternalServerError | ServiceUnavailable`.
 *
 * A `<failure>` with no reason at all is NOT retried: the engine parses it as
 * `Unknown(0)`, which fails `should_reconnect()`.
 */
const RECONNECTABLE_CONNECT_FAILURE_REASONS: ReadonlySet<number> = new Set([
	500, // InternalServerError
	503 // ServiceUnavailable
])

/** True when the engine will keep retrying after this `<failure>`. */
export const isReconnectableConnectFailure = (reason: number | undefined): boolean =>
	reason !== undefined && RECONNECTABLE_CONNECT_FAILURE_REASONS.has(reason)
