# Bridge 0.26.6 diagnostic evidence

This document records investigation evidence for PR #190. Diagnostic commits and
instrumented artifacts do not qualify the published npm package or a real account.
No trust checks, workloads, deadlines, durability barriers or CI gates were relaxed.

## Fixed inputs

- Consumer base: `d9c6ba84d0903ed6e9c24484dc0a9b3c8f392adc`.
- Consumer clean production tree: `7cb085a91ab4547d28fb705539e56ee718a2b4cf`.
- Published package: `@oxidezap/whatsapp-rust-bridge@0.26.6`.
- Exact bridge source: `04f014aefbf248f2ecbf7551cc73e67b949c9e73`.
- Exact core source: `f077a5d4a5dc12d7c51e79e46598740648c3824f`.
- Mock: `ghcr.io/whiskeysockets-devtools/bartender@sha256:56cbabbc2bba22a3306bfdf7bf02f0fbd6041483a7cac8b0c6217ac4cfa58f75`.
- Node 24; CodSpeed runner 5.6.3; GitHub `ubuntu-24.04` runners.

The mock source returned 404. No alternate route to its sources was attempted.
Its previously observed OCI source/revision labels identify
`whiskeysockets-devtools/bartender`, `e69a2ed931f1a6ec93355543220f38bb6b6e6058`.
This evidence does not establish the builder or cause of its rejection ACK.

## Legacy restoration transition

The original `process-restart.test-e2e.ts` scenario is selected by name, not edited:

```sh
node --expose-gc --test --test-concurrency=1 \
  --test-name-pattern='restores legacy auth' \
  src/__tests__/e2e/process-restart.test-e2e.ts
```

Use the synthetic loopback service and existing test environment from the diagnostic
workflow. This selection is a targeted diagnostic, not the full E2E qualification.
Other scenarios and their assertions remain unchanged.

At diagnostic commit `919e6fb5aa538da09123232ff9890e1e5e7f391b`,
[run 42450811054, legacy job](https://github.com/oxidezap/baileyrs/actions/runs/42450811054/job/128639432228)
executes unobserved–observed–observed–unobserved on the same physical runner and
mock service. All four fail with the existing message-delivery timeout. The two
observed restores show:

| Event                                                  | First observed restore | Second observed restore |
| ------------------------------------------------------ | ---------------------: | ----------------------: |
| Four relay calls enter                                 |                 457 ms |              434–435 ms |
| Test disables reconnect and calls first end/disconnect |              15,454 ms |        15,434–15,435 ms |
| First pending relay rejects `not connected`            |              21,224 ms |               21,991 ms |
| Final reported error                                   |       delivery timeout |        delivery timeout |

These are within-process ordering timestamps, not benchmark latency measurements.
There is no observed core disconnected event or stream-end event before the first
explicit end call. All four relays are still pending at that call. Thus the
`not connected` rejection in these cases follows explicit teardown; it is not the
first failure and cannot be used as evidence of an earlier server disconnect.

A single follow-up at `f56db9d41e31bdcf28ad88a8f2bc1e002201e5dc`,
[run 42451175326](https://github.com/oxidezap/baileyrs/actions/runs/42451175326/job/128640521966),
adds aggregate callback latency and observes the original timer without changing
its arguments, callback, cancellation handle or 15-second deadline:

- Four delivery guards are scheduled at 466 ms and fire at 15,470–15,471 ms.
- Teardown starts at 15,471 ms. The first `not connected` appears at 26,411 ms.
- Each account completes about 405–409 session reads and 403–407 identity reads.
- Per-account callback duration sums are about 23–25 seconds for each namespace.
  Reads overlap; these sums must not be added or interpreted as wall-clock delay.
- At approximately 14 seconds each account has finished only about 448 of its
  approximately 1,020 eventual callbacks. Work continues after teardown begins.

The callback observer records only static method/namespace names, counts and
elapsed durations. It keeps no key, fingerprint, routing identifier, message
content or QR data. Account labels are process-local numbers. It neither decodes
message batches nor reads or mutates additional auth state. Generic cross-account
`equalsPrevious` values from an older observer are not used as evidence.

Source inspection explains why this path can issue many reads without proving
which core operation caused the observed wait: core `src/client/lid_pn.rs`
`migrate_signal_sessions_with_backend` scans 100 device IDs for each address
family, reading session and identity state; regular and hosted families are
covered. The consumer's legacy adapter wraps each callback in a backend-wide
snapshot transaction with a process lock and a fresh authoritative read. Replacing
those observations with an adapter cache or dropping publication barriers would
change consistency semantics and was not attempted.

The new timing observer's total restore window is longer than the first observer's.
Instrumentation and runner variability therefore remain limits. The evidence
establishes the guard–teardown–rejection order and substantial outstanding storage
work, not that storage alone explains the original timeout or that it shares a
cause with the native ACK rejection or ADV error. No legacy implementation fix
was demonstrated by these tests.

## Memory controls

The earlier same-runner comparison of original main/0.26.4 and consumer/0.26.6,
[CodSpeed 6aeff558eb4bda89c820d48d](https://app.codspeed.io/oxidezap/baileyrs/runs/6aeff558eb4bda89c820d48d),
measured base–head–head–base first-DM peaks of 103.1, 167.7, 164.9 and 102.3 KB.
This establishes a difference between complete revisions under that control,
not attribution to a particular consumer function.

A subsequent same-bridge control,
[6aeffcd4e89b1dbcbb7e446c](https://app.codspeed.io/oxidezap/baileyrs/runs/6aeffcd4e89b1dbcbb7e446c),
measured identical consumer source at 163.5 and 102.3 KB. MCP flamegraph queries
re-rooted at `persist` show 86.2 KB/18 allocations in the higher sample versus
22.0 KB/13 allocations in the lower sample. Its two visible child subtrees are
about 4.2–4.3 KB and 1.7 KB in both. A roughly 64-KiB allocation difference is
associated with this host stack, but allocation totals are not a lifetime/peak
proof and do not identify the allocator request or imply a faulty serializer.

The previous view/copy candidate was rejected and reverted. It did not improve
the first DM and regressed the isolated 4-KiB case. It is not repeated here.

### Explicit native diagnostic builds

Builds use the existing feature only; no upstream implementation or pin changes:

```sh
rustup toolchain install nightly-2026-06-16 --profile minimal \
  --target wasm32-unknown-unknown
cargo +nightly-2026-06-16 install wasm-bindgen-cli --version 0.2.130 --locked
cargo +nightly-2026-06-16 build --locked --profile profiling \
  --target wasm32-unknown-unknown --features memory-profiling
wasm-bindgen --target web --out-dir /separate/path/profiled \
  target/wasm32-unknown-unknown/profiling/whatsapp_rust_bridge.wasm
cargo +nightly-2026-06-16 build --locked --profile profiling \
  --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir /separate/path/rebuilt \
  target/wasm32-unknown-unknown/profiling/whatsapp_rust_bridge.wasm
```

Both local builds succeeded and left the bridge checkout unchanged. Their functional
feature lists and WASM exported names match npm. Allocation profiling reports
`enabled: true` only on the instrumented build. Local generated WASM SHA-256:

- Profiled: `66b46e9666e7e573c872acaa7fe30cd83bb2347a9edb1dbebacfbfd9a466a052`.
- Matched rebuild: `f12589dc47806c3bcb0d12a6ce4b77a66becb7cc33f41998ddb23fe2e96c1b8d`.

The `profiling` profile differs from the published release pipeline: it retains
function information, disables LTO and does not apply the release wasm-opt passes.
Its results must not be presented as measurements of the published artifact.
The CI build records its own hashes; paths/toolchain layout can change debug bytes.

A temporary module explicitly overlays generated WASM exports onto the runtime;
it does not overwrite the npm installation. The same first-DM benchmark preserves
pairing, quiet-period setup, delivery, receipt assertion, warmups, iterations,
deadline and cleanup. The only additions are out-of-window before/after snapshots
and an observed-mode callback journal of method, namespace, byte length and WASM
capacity. It records no auth keys or message content. CodSpeed Memory is the sole
performance instrument; snapshots are diagnostic attribution, not a replacement
benchmark metric. The observer is also tested against npm and matched rebuilds,
and each rebuilt variant runs without it to expose observer/profile effects.

Snapshot allocation and lifetime overhead is a limitation: diagnostic structures
are retained outside the measured call and may affect later GC. Allocator totals
are cumulative, requiring before/after differences. `beginWasmAllocationProfile`
resets peak, per-span and grow-event counters; it does not zero cumulative churn.
The diagnostics bucket is separate, but global peak cannot be corrected by simply
subtracting diagnostic totals. Native heap churn inside already committed WASM
pages must not be equated with new host allocation; linear-growth events and
host Memory profiles must be considered together.

### First diagnostic collection: negative result

[CodSpeed 6af00b685f0d6951f221462c](https://app.codspeed.io/oxidezap/baileyrs/runs/6af00b685f0d6951f221462c)
completed seven Memory benchmark points at f56db9d, on one physical runner:

| Artifact / observer        |     Peak |
| -------------------------- | -------: |
| npm, plain before          | 163.9 KB |
| npm, observed              | 101.9 KB |
| matched rebuild, observed  | 107.3 KB |
| profiled rebuild, observed | 107.3 KB |
| profiled rebuild, plain    | 105.5 KB |
| matched rebuild, plain     | 106.0 KB |
| npm, plain after           | 149.8 KB |

Delivery and receipt assertions passed for all seven, but this does not establish
numeric performance equivalence: observation/build shape clearly changes the npm
Memory result. These samples cannot be used to claim the published regression is
fixed or to subtract instrumented counters from the published peak.

The expected native snapshot files were absent. The worker's exit handler did not
preserve them, and the initial collection step did not assert their presence.
There is no allocator-counter evidence from that first run despite its job success.
The corrected collector writes immediately after cleanup, emits a redacted record
outside measurement, and requires exactly one observed measurement window.

Installed @codspeed/vitest-plugin 6.1.0, dist/v5/provider.mjs runAnalysisTask, calls
beforeEach, then global.gc, then startBenchmark/operation/stopBenchmark, then
afterEach. Therefore a beforeEach host snapshot is before the forced GC, not the
actual measured start. The corrected observer arms in beforeEach and samples after
the plugin's existing GC returns; it neither adds a GC nor changes the measured
operation. Native peak/span counters reset after the initial snapshot so its own
setup allocation is not mistaken for a workload memory-grow event.

The follow-up has two independent jobs: published 0.26.4/0.26.6 checkouts with
observer/plain controls on one runner; and three npm/rebuilt/profiled native
attribution windows on another runner. Only comparisons within each runner are
controlled. Observations from the diagnostic build remain separate from npm.
