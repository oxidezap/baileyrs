# Performance benchmarks

The suite uses Vitest 5 and `@codspeed/vitest-plugin` 6.1.0. The `test`/`bench` fixture API is supported by this pair. These development dependencies do not
change the published API or runtime dependencies.

Benchmark development requires Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`, the
range supported by the pinned Vitest version and compatible with Vite. Use Node 24
to match CI. This applies to `npm ci --ignore-scripts`, `npm run bench` and
`npm run bench:e2e`; Node 23 and 25 are unsupported by this toolchain. The
published library's runtime requirement remains Node.js >=22.3.0.

Run through the [CodSpeed CLI](https://codspeed.io/docs/cli) after authentication:

```sh
npm ci --ignore-scripts
npm run typecheck:bench
codspeed run -m simulation -- npm run bench
codspeed run -m memory -- npm run bench
```

For local validation without a CodSpeed account or API/upload access, CLI 5.6.3
also has a hidden debug option:

```sh
codspeed run --skip-upload -m simulation -- npm run bench
codspeed run --skip-upload -m memory -- npm run bench
```

`--skip-upload` bypasses remote repository/token validation and result upload.
It is not a complete offline installer: the runner may download instruments or
system packages on first use. Install/cache the instruments before disconnecting.
The debug flag is verified in the pinned
[CLI source](https://github.com/CodSpeedHQ/codspeed/blob/v5.6.3/src/cli/shared.rs).
Local profiles remain on disk; no dashboard comparison is produced.

CI runs an independent matrix job for each instrument through the pinned CodSpeed action, with OIDC
and Node 24. Pushes to `main` establish the baseline; PR runs compare against it.
Enable the repository in CodSpeed before relying on its performance checks. The
workflow also supports manual dispatch for backtesting. A new suite has no
historical baseline until CodSpeed has collected one.

The microbenchmark suite and workflow start from CodSpeed bot commit
`554b4ee63e1e6b1e70c834311a1b8141a0e8edb7` in PR #185, which is included in
this branch's ancestry. Its `bench/` fixtures cover JIDs, binary nodes, BufferJSON,
message helpers, polls, protobuf and batched bridge events. They use the current
Vitest 5 fixture API so lifecycle hooks work consistently in native and
instrumented execution. Fixed warmup options also apply to these rows.

## What each row measures

| Rows                         | Measured operation                                                  | Setup outside measurement                                                           |
| ---------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Local outgoing, 64 B / 4 KiB | Public message envelope generation and protobuf serialization       | Fixed IDs, timestamps and payloads                                                  |
| Local incoming, 64 B / 4 KiB | Protobuf decode and bridge metadata adaptation                      | Encoded bytes and metadata                                                          |
| Local encode / decode        | Protobuf facade alone                                               | Payload or encoded bytes                                                            |
| Auth                         | Fresh credential mirror and host store hydration                    | Module/WASM import                                                                  |
| Host store, 256 B / 4 KiB    | One row ×100 or 32-row batch ×10, write then defensive-copy read    | Store and fixed keys/bytes                                                          |
| Fresh session                | QR pairing, connect and pending-notification sync                   | Module import; cleanup after each invocation                                        |
| Resume session               | Connect and sync from persisted file auth                           | Paired session warmed with bidirectional DMs, graceful close, preserved auth folder |
| First DM                     | First send through delivery, including Signal session establishment | Two newly paired clients, no DM warmup                                              |
| Steady DM, 64 B / 4 KiB      | Send through receiver event and sender's delivery receipt           | Two connected clients, eight roundtrips in both directions                          |
| Burst                        | 16 sequential sends through delivery receipt                        | Same warmup as steady DM                                                            |
| Idle                         | One second connected after 32 delivered 4 KiB messages              | Connected warmed pair, activity and one initial idle window                         |

`single-idle.bench.ts` also records a single connected session without peer traffic,
including a runtime baseline before connection and snapshots around the last idle window.
The one-second windows do not guarantee a 30-second periodic keepalive fires; they
measure short quiet periods, not a full keepalive cycle.

Local adapter/serialization rows do not measure Signal, Noise, transport or a full
`sendMessage`. Bartender rows exercise those real library paths through the mock.
A roundtrip includes sender and receiver work in the same Node process, along
with ACK/receipt background work. It does not isolate receive-only CPU. The mock
server is a separate process and is outside client instrumentation.

Each E2E file runs in its own CI job with a fresh Bartender instance. Server-side
accounts, devices and Signal state cannot carry over from another file or worker.
For local E2E validation, select one file and start a fresh mock before the next file.

## Keeping results stable

CodSpeed simulation and memory measure a single call, so anything that happens
once inside that call, rather than per operation, moves the result.

- **Micro rows.** A single protobuf decode, store write or credential parse is
  sub-millisecond; one scavenge, page commit or cold cache line inside it moved
  these rows by 40-150% between runs of unchanged code. Those rows now repeat
  the operation (`opsPerSample` in `options.ts`, 100 by default; 10 for the
  32-row store batch). The row names carry the count (`(100 ops)`, `x100`), and
  the value is the cost of the whole batch.
- **Complete exchanges.** `roundtrip` returns only after every receiver has
  published the message and the sender has processed a delivery receipt from
  each of them. Group rows wait for both members. The receipt work is always
  inside the call instead of sometimes spilling into the next one.
- **Quiet start.** `settle()` waits, outside measurement, until no socket has
  sent or received a frame for 750 ms and the event loop is mostly idle (at most
  20 s). It runs before every Bartender measurement, after warmup and after
  pairing, so late receipts, pre-key uploads and server notifications from
  setup do not land in the measured call.
- **Empty resume backlog.** The resume row resumes the account once, unmeasured,
  before the measured resume, so whatever the server still queued after pairing
  is delivered and acknowledged first.

## Warmup and isolation

Local walltime rows request 32 warmup iterations and at least 100 ms. Bartender
walltime rows use fixed counts, with no duration-driven growth of message queues.
The CodSpeed simulation/memory runner independently executes seven optimization
warmups, then one measured invocation. Per-benchmark `beforeEach`/`afterEach` hooks run around every warmup and measured
invocation in both modes, keeping lifecycle setup and teardown outside measurement. Every fresh/resume/
first-DM warmup has fresh clients; it warms code, not the session under test.

The runner uses one fork at a time, no file parallelism, and exposed GC. Fixed
payload widths avoid payload-size drift. Every E2E message body has a monotonically
increasing sequence to avoid mock deduplication. Delivery checks content, direction
and message ID. Receivers drain events immediately and do not retain a backlog.
Stores overwrite a bounded set of keys. Socket teardown precedes removal of auth
files. Each message and connection wait has a deadline; failures fail the run.

Warming reduces JIT and first-use effects; it cannot eliminate scheduling, GC,
network or randomized crypto variation. Read small async memory changes cautiously,
particularly when only one sample differs. The Rust reference suite also documents
async memory noise. No production allocator, cache policy or protocol behavior is
changed to improve benchmark stability.

## Running against Bartender

Use the same pinned private image and configuration as `.github/workflows/ci.yml`.
The CodSpeed workflow starts it automatically for same-repository PRs and `main`.
Fork PRs run the local suite but skip the private mock job. Never use
`pull_request_target` to execute benchmark code with secrets.

```sh
SOCKET_URL=wss://127.0.0.1:8080/ws/chat \
ADV_SECRET_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
NODE_TLS_REJECT_UNAUTHORIZED=0 LOG_LEVEL=silent \
codspeed run -m simulation -- npm run bench:e2e -- benchmarks/e2e/messaging.bench.ts
```

Repeat with `-m memory` for memory profiling. `SOCKET_URL` must point at a loopback
host, and the mock secret must match. The test-only TLS bypass is scoped to this
mock process. Never set it in an application or against a real account. No live
WhatsApp version fetch or production credentials are required.

## Reading memory and idle results

CodSpeed reports CPU simulation and allocator memory as separate instruments.
Simulation measures executed client work during the fixed idle window, not one
second of CPU time or latency. The idle liveness check runs after measurement.
Walltime includes the intentional one-second wait and should not be used as a
throughput regression threshold.

The memory instrument tracks the Node allocator and process physical memory. V8
and WASM manage their own arenas, so malloc allocation counts are not JavaScript
object counts or Rust allocations within WASM linear memory. Pre-existing session
memory lies outside the operation's allocation window. Peak process memory includes
runtime and shared WASM overhead; it is not a per-session byte count.

`benchmark-results/idle.json` and `single-idle.json`, uploaded as `benchmark-idle-{simulation,memory}` and `benchmark-single-idle-{simulation,memory}`, supplement
those metrics with process-wide RSS, heap, external and ArrayBuffer snapshots
after explicit GC, before and after idle. The files describe two sessions after activity and one quiet session, respectively,
and include the shared WASM instance. They are diagnostic retention observations, not a leak
assertion or subtraction of a reliable per-session cost. Each file/instrument job uploads its own artifact for the last measured window.

References: [Vitest integration](https://codspeed.io/docs/benchmarks/nodejs/vitest),
[memory instrument](https://codspeed.io/docs/instruments/memory), and
[whatsapp-rust benchmarks](https://github.com/oxidezap/whatsapp-rust/blob/main/.github/workflows/codspeed.yml).
