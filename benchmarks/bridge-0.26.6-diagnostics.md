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
benchmark metric. The earlier seven-point study includes plain runs of both rebuilt variants.
The corrected post-GC native job has three observed windows only; it does not
independently measure its observer overhead. The separate published-version job
contains the repeated plain/observed controls. These cohorts must remain distinct.

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

### Corrected post-GC controls

At `547848080e7a049cfb8b5cc66dcce24862f88975`,
[workflow 42452482141](https://github.com/oxidezap/baileyrs/actions/runs/42452482141)
completed both jobs and verified one post-GC record per observed window. The
published pair uses separate dependency directories, the same consumer source,
one physical runner and mock service. The native attribution job uses a second
runner; its measurements cannot be paired numerically with the published job.
[CodSpeed 6af00e995f0d6951f2214652](https://app.codspeed.io/oxidezap/baileyrs/runs/6af00e995f0d6951f2214652)
contains the eleven executed points:

| Published package |      Plain peaks |   Observed peaks |
| ----------------- | ---------------: | ---------------: |
| 0.26.4            | 101.1 / 102.3 KB | 101.0 / 102.6 KB |
| 0.26.6            | 170.9 / 166.0 KB | 102.9 / 165.4 KB |

The unobserved version difference reproduces while consumer implementation,
hardware, instrument and mock are held constant. Observation changes one new
sample materially, but not the other. A favorable observed sample is not evidence
that the published regression is fixed.

For the four published observed windows, WASM capacity, V8 heap capacity and every
reported V8 space capacity/physical-size endpoint remain unchanged. Worker JS
heap usage increases by roughly 0.93 MB on 0.26.4 and 1.29 MB on 0.26.6. Worker
ArrayBuffer endpoint increases are:

| Window                  | ArrayBuffer increase during operation |
| ----------------------- | ------------------------------------: |
| Old first               |                          15,841 bytes |
| Old second              |                          15,876 bytes |
| New first, lower peak   |                          28,899 bytes |
| New second, higher peak |                          94,430 bytes |

The new-version spread is 65,531 bytes, approximately one 64-KiB block minus five
bytes of other variation. These are endpoint snapshots, not allocation timelines
or official CodSpeed peak metrics. They identify retained host ArrayBuffers as a
major correlate of the observed spread, without identifying the allocator owner.
Snapshots alone cannot exclude transient RSS changes. Worker RSS is not the same
scope as the benchmark process-tree physical peak.

The journal records ten outbound frames on old versus eleven/twelve on new. New
also performs an extra session enumeration, two extra identity reads, three
32-byte identity writes, and a second 40-byte message-secret batch. Total recorded
write inputs are 3,978 bytes on old and 4,073 bytes on new; these are row inputs,
not all bytes rewritten by full-snapshot persistence. Core trust work and callbacks
must not be dropped to reduce these counts. Delivery/receipt assertions pass.

The corrected native windows report CodSpeed peaks of npm 160.6 KB, matched
rebuild 165.8 KB and profiled rebuild 166.3 KB. All three retain roughly 94.5 KB
of extra worker ArrayBuffers at the endpoint and have zero WASM capacity growth.
In the enabled profiler window:

- Largest requested Rust allocation after reset: 5,224 bytes.
- No WASM memory-grow event; no dropped grow/span/large-allocation records.
- Requested Rust heap churn: 177,742 bytes allocated and 4,874,659 bytes freed.
- Live heap: 6,765,557 before, 2,068,640 after, 1,653,292 after cleanup.
- Peak requested live heap: 6,776,031 bytes; this is not the CodSpeed malloc peak.
- The large-allocation recorder threshold is **1 MiB**, not 64 KiB. Its empty
  event list alone cannot exclude a 64-KiB allocation; the largest-allocation
  counter provides that bound in this instrumented window.
- Leading native spans include `wa.send.impl` (11,790 bytes),
  `wa.session.fetch_establish` (11,718), `wa.recv.message_enqueue` (11,445),
  `wa.usync.process_device_list` (8,689), and `wa.iq` (8,355).

The bulk native freeing demonstrates carryover lifetimes across the measurement
boundary; it must not be subtracted from host peak memory to claim an improvement.
Counters include diagnostic work, with a separately reported diagnostics bucket.
These data bound behavior in the instrumented build. They do not prove identical
allocation sequences inside the optimized npm artifact. They do show that the
observed host 64-KiB spread is not a matching 64-KiB Rust allocator request or a
WASM capacity increase in that controlled diagnostic window.

### Timeline and retention evidence from an identical-code pair

The public CodSpeed Stats timeline for the earlier same-bridge pair was inspected
read-only after the MCP queries. The larger sample rises from 70.55 KB at 77.15 ms
to 136.03 KB at 79.35 ms and retains the raised level through measurement end.
The smaller sample has no comparable late step. These are observed plot samples,
not proof that a particular allocation request was exactly that difference.

Exact MCP totals corroborate the endpoint lifetime difference:

| Identical consumer source | Peak bytes | Allocated bytes | Freed bytes | Net bytes | Allocation calls |
| ------------------------- | ---------: | --------------: | ----------: | --------: | ---------------: |
| Higher sample             |    167,395 |       1,195,937 |   1,049,910 |   146,027 |            3,269 |
| Lower sample              |    104,787 |       1,149,590 |   1,067,007 |    82,583 |            3,283 |

The higher sample has fewer allocation calls yet 63,444 more net bytes at the
boundary. Combined with the `persist` stack difference, this supports a large
host-allocation/lifetime contribution; it does not identify a faulty serializer
or an unavoidable protocol cost. The collector/GC control and the native profiler
must remain separate from the unobserved published result.

[CodSpeed's Memory documentation](https://codspeed.io/docs/instruments/memory)
distinguishes allocator-requested peak from resident physical peak and describes
tracking allocator calls with eBPF. Rust allocations within existing WASM memory,
worker ArrayBuffers, V8 heap usage and process-tree RSS are different measures;
none should be substituted for the others.

### Final Buffer/GC discriminator: incomplete attribution

[Workflow 42453570102](https://github.com/oxidezap/baileyrs/actions/runs/42453570102/job/128647717677),
commit `d97330d9ca3e3f0fa50acd6261277d33ad0f3ada`, executes one unchanged
published-0.26.6 first DM with additional attribution only. It observes exported
Buffer.from/alloc/allocUnsafe/allocUnsafeSlow results at least 32 KiB, stores only
sizes and process-local backing-store labels, and preserves the original returned
values. It never stores the buffers themselves. The observer can affect allocation
shape and is not a proposed optimization or production replacement.

After the original cleanup completes and the measurement has stopped, two full
GC calls separated by event-loop turns test release. They are not added inside
the measured operation, change no guard and are not used to improve its score.
The original message/receipt assertions pass and the required record is present.

- No observed exported Buffer call returns a view of at least 32 KiB. This is not
  exhaustive native allocation coverage: Node internals and captured function
  aliases can bypass these exported methods, and small views can share a larger
  backing store.
- ArrayBuffers: 1,315,793 bytes before, 1,344,756 after the operation, 1,398,755
  after cleanup, 1,031,716 after the additional GC. The GC frees ordinary/carryover
  buffers; the endpoint 64-KiB extra block is absent in this particular sample.
- WASM capacity remains 9,764,864 bytes throughout.
- Crucially, [CodSpeed 6af0126237973273e44510f7](https://app.codspeed.io/oxidezap/baileyrs/runs/6af0126237973273e44510f7)
  still reports a high **168.7 KB** peak (172,722 bytes), despite that low endpoint.
  It records 1,550,074 allocated bytes and 1,468,250 freed, leaving 81,824 net bytes.
  Its flamegraph is unavailable; an MCP flamegraph request confirms no data.

This is a negative discriminator. It refutes a complete explanation based on
retained endpoint ArrayBuffers: a high peak also occurs with a low endpoint.
A transient host-allocation contribution remains unlocalized. Earlier late-retained
and persist-associated samples remain evidence for those samples, but cannot be
used as the sole causal explanation for every published first-DM peak. No TLS,
mock, serializer or Rust defect is presumed from these observations.

## Outcome and smallest next steps

No new production optimization or legacy restoration fix is demonstrated. The
consumer retains the existing 0.26.6 adaptations, durability, isolation, checks,
workloads and gates. Temporary observers/workflows are removed from the final
tree; the diagnostic commits and this report preserve reproduction evidence.

- Legacy: the not-connected error is downstream of the delivery guard and explicit
  teardown in the reproduced cases. Coordinate the still-pending send and the
  hundreds of fresh transactional reads with the existing core investigation.
  A fix must preserve complete state observation and trust; no callback cache or
  deadline increase was introduced. The latency observer itself is not proof of
  storage as the only pre-deadline bottleneck.
- Memory: the published version difference reproduces under controlled conditions.
  Instrumentation changes some peaks. A 64-KiB endpoint ArrayBuffer difference
  explains part of the observed variability, while the final high-peak/low-endpoint
  sample proves that endpoint correlation is insufficient for full attribution.
  The enabled native build has no matching large Rust request or linear growth,
  but is not numerically interchangeable with npm. No consumer optimization is
  supported as both causal and beneficial.
- Next memory discriminator: an unobserved published high sample with a symbolized
  native allocation/free event stack at its transient peak. Available MCP results
  expose aggregate allocation stacks/totals, and the dashboard exposes the timeline;
  the final sample has no flamegraph or per-allocation native owner data. Further
  JS allocation observers already demonstrably perturb the allocator state and
  are not a substitute for that missing correlation.
- The mock-source 404 remains respected. No alternate source route, upstream
  implementation, publication, merge, deploy or CodSpeed acceptance/reclassification
  was attempted in this round. A new bridge release alone is not established as
  sufficient for either remaining qualification problem.

## Published ACK and callback scheduling, 2026-11-09

These controls use the published npm 0.26.6 artifact, exact bridge/core pins and
mock digest in Fixed inputs. No #1869 build is substituted. npm `latest` was
rechecked on November 9 and remains 0.26.6. The original reconnect test's five
assertions, sequence, timeouts, signature/trust verification and teardown remain
unchanged. Diagnostic variants do not qualify the original file-store workload.

The temporary workflow attaches to the mock's live stdout with Docker logging
still disabled. A bounded filter emits fixed categories and booleans only. It
never writes raw lines, keys, fingerprints, routing identifiers, payloads or QR.
Client message identifiers are mapped privately to process-local labels. The safe
Node reporter preserves the test's exit status and numeric outcomes without
printing assertion data. Mock logging is set to warn for these controls; this is
an observer/timing difference from ordinary CI.

### File and reusable-memory contrast

[ACK diagnostic 42603334149](https://github.com/oxidezap/baileyrs/actions/runs/42603334149/job/129112904236),
head `6213dd4cca4a1b85d278ebb2c162d3f14627394b`, runs the original file store:
4 passed, 1 failed, 0 skipped. Send 5, the second post-recreation forward send,
receives a correlated class=error ACK with a 19-byte body. Mock MAC/decryption
categories occur within one millisecond. Reverse send 6 is delivered. The
category filter does not correlate server message IDs, so simultaneity alone
cannot identify the failed server session or establish packet-level causality.
Generic Uint8Array/ArrayBuffer/Object string coercions are rejected by exact
comparisons. No raw ACK body is exposed.

[Reusable-memory control 42605799939](https://github.com/oxidezap/baileyrs/actions/runs/42605799939/job/129121362217),
head `7240808df1e11becc2de1384bb695c872c6d9c3a`, passes all 5 tests. A host
`useMemoryStore()` owns copied bytes across socket destruction/recreation. Each
factory call creates fresh credential/key wrappers, hydrates device/account from
that store before projecting Signal codecs, and never reuses a live credential
object. The ephemeral core-native backend is not selected. No categorized mock
errors were observed.

[Repeated contrast 42606091307](https://github.com/oxidezap/baileyrs/actions/runs/42606091307),
head `979cffd6256a08d982590cb2e6ba3021334ed918`, uses a fresh pinned mock per job:

| Variant              | Repetition 1    | Repetition 2    |
| -------------------- | --------------- | --------------- |
| Original file store  | 4 pass / 1 fail | 4 pass / 1 fail |
| Reusable host memory | 5 pass / 0 fail | 5 pass / 0 fail |

Both file failures are the second-roundtrip delivery guard. Categorized mock
lines mention Whisper, ratchet and message counter, with MAC verification and
decryption failures; those lines do not mention prekeys. These are literal log
category observations, not a decoded or inspected server session. Different
hosts/timing mean this contrast alone cannot establish a file-store defect.

### Yielding callbacks without files

[Callback-turn control 42606399703](https://github.com/oxidezap/baileyrs/actions/runs/42606399703),
head `55fa59326556dad1717cc73173a228a546f18b5e`, keeps the reusable memory bytes,
then awaits one `setImmediate()` after each get/getMany/set/setMany/delete/
deleteMany result. Return bytes and errors are unchanged. The original
assertions and deadlines remain. This diagnostic changes callback scheduling;
it is not an optimization or an allowed production workaround.

Both yielded-memory repetitions fail 4 pass / 1 fail at the same second-roundtrip
guard, with send 5 receiving class=error and mock Whisper/MAC/decryption categories.
Both contemporaneous file controls also fail 4 pass / 1 fail. Therefore filesystem
persistence is not necessary to reproduce this failure. Plain-memory success
does not qualify restore or justify removing durability. The result narrows the
next question to callback/interleaving-dependent session behavior across the
client and mock; it does not identify which implementation violates its contract.

The native core's existing `test_session_survives_reconnect` is not an equivalent
control: it reconnects the same Client and sends several forward messages before
the final reverse message. This consumer test destroys/recreates Alice and
alternates the ratchet before the second forward send. Native passes cannot be
used to dismiss this reproduction.

Reproduction lives in the diagnostic commits above. Run with Node 24:

```sh
NODE_OPTIONS=--import=./scripts/diagnostics/ack-reason.mjs \
node --expose-gc --test --test-concurrency=1 \
  --test-reporter=./scripts/diagnostics/safe-node-reporter.mjs \
  src/__tests__/e2e/reconnect.test-e2e.ts
```

The workflow sets loopback SOCKET_URL, the synthetic ADV secret, and the exact
service digest. `DIAGNOSTIC_REUSABLE_MEMORY=1` selects the reusable host store;
`DIAGNOSTIC_MEMORY_YIELD=1` adds the scheduling control. Missing/other secrets or
non-loopback endpoints are rejected. No private mock source route is attempted.

### Qualification boundaries

At `6213dd4`, group Memory job
[129112904742](https://github.com/oxidezap/baileyrs/actions/runs/42603333945/job/129112904742)
fails with `device list account identity unavailable`. This is an unmeasured
functional failure, not a memory-regression measurement. Group Simulation also
fails. The prior paired first-DM memory findings remain unresolved and separate.

Core #1869 remains at `a467e345a9e89066b76468e759519094c4b5ab7b` in this
observation. Its description calls for isolating a different tree after a failed
size experiment; it is not a stable diagnostic candidate yet. No new Group
Simulation comparison or ACK-fix claim is made. A stable pinned head is the
prerequisite for the requested controlled Group Simulation experiment. No
upstream implementation, merge or release is performed here.

### Participant and restore-phase controls

Each result below is a diagnostic variant with fresh mocks, published 0.26.6 and
unchanged five-test sequence. Only the indicated memory callbacks yield. There
is no callback cache, key replacement, signature bypass or deadline extension.

[Participant run 42606675470](https://github.com/oxidezap/baileyrs/actions/runs/42606675470),
head `02a144870795a7b2c469a5c63a4024341d7045e9`:

| Callback target                      | Repetition 1    | Repetition 2    |
| ------------------------------------ | --------------- | --------------- |
| Alice, original and recreated socket | 4 pass / 1 fail | 4 pass / 1 fail |
| Bob only                             | 5 pass / 0 fail | 5 pass / 0 fail |

[Restore-phase run 42606935976](https://github.com/oxidezap/baileyrs/actions/runs/42606935976),
head `9003ec8e7ea86ef2280320b5cb24dc093146b80f`, yields Alice callbacks only:

| Yielding phase                     | Repetition 1    | Repetition 2    |
| ---------------------------------- | --------------- | --------------- |
| Before destruction/recreation only | 5 pass / 0 fail | 5 pass / 0 fail |
| After recreation only              | 4 pass / 1 fail | 4 pass / 1 fail |

Failing cases retain delivery before destruction and the first post-recreation
roundtrip, then send 5 receives class=error with the same 19-byte classification
and reverse send 6 is delivered. The mock logs MAC/Whisper decryption categories.
This identifies scheduling on restored Alice as sufficient in these controls;
it does not establish server ratchet ownership or which peer/session row is
wrong. Server log IDs were not matched to client IDs. Neither the ASCII body
nor synthetic message content is published.

The phase control increments a per-folder generation when a new auth wrapper is
created. Original Alice is generation 1; restored Alice is generation 2. Bob has
its own folder/store/generation. The same Map-owned bytes survive recreation;
only callback completion scheduling changes. `DIAGNOSTIC_MEMORY_YIELD_TARGET`
selects the local fixture label, and `DIAGNOSTIC_MEMORY_YIELD_PHASE=before|after`
selects the generation. The guard retains the synthetic loopback restriction.

[Read/write run 42607233286](https://github.com/oxidezap/baileyrs/actions/runs/42607233286),
head `3c1c51ecfccd031752a75cb38e9fd8056f1380ff`, targets restored Alice only:

| Yielded callbacks             | Repetition 1    | Repetition 2    |
| ----------------------------- | --------------- | --------------- |
| get/getMany                   | 5 pass / 0 fail | 5 pass / 0 fail |
| set/setMany/delete/deleteMany | 4 pass / 1 fail | 4 pass / 1 fail |

The memory backend copies/applies the incoming mutation before the observer yields;
its resolution is delayed by one event-loop turn, not the mutation itself. Each
failing write control again rejects send 5 and delivers send 6. Read-only yielding
passes with no categorized mock output. `DIAGNOSTIC_MEMORY_YIELD_GROUP=read|write`
selects this control. This is evidence of dependence on async mutation completion
scheduling after restoration, not proof of a specific lost update or ratchet bug.

[Session-write control 42607504400](https://github.com/oxidezap/baileyrs/actions/runs/42607504400),
head `081fb3ca17c75472627ff4d2a4a56d2f737def11`, again targets restored Alice's
mutation completions only:

| Yielded mutation namespace | Repetition 1    | Repetition 2    |
| -------------------------- | --------------- | --------------- |
| session only               | 5 pass / 0 fail | 5 pass / 0 fail |
| All except session         | 4 pass / 1 fail | 4 pass / 1 fail |

This negative result rejects the narrower claim that asynchronous session-write
completion alone suffices. It does not prove session bytes are always correct.
The all-except-session variant still produces the same second-roundtrip error
ACK and mock decryption categories. Follow-up traces use only fixed namespace
names, method names and local generation numbers; no row keys or values are
logged. The remaining question is which non-session mutation completion exposes
the interleaving, rather than assuming lost Signal writes.

[Topology/identity control 42607763138](https://github.com/oxidezap/baileyrs/actions/runs/42607763138),
head `a16dc1cc067fb1d2220088d2eecc86021f37b98d`:

| Yielded restored-Alice mutation namespaces | Repetition 1    | Repetition 2    |
| ------------------------------------------ | --------------- | --------------- |
| identity, lid_mapping, device_list         | 5 pass / 0 fail | 5 pass / 0 fail |
| All remaining namespaces                   | 4 pass / 1 fail | 4 pass / 1 fail |

In the passing trace, only device_list mutations actually yield, so this does not
exercise a delayed identity or lid_mapping write. In a failing trace, mutations
observed before/during send 5 include device, sent_message, session, msg_secret,
meta and sync_key, followed by prekey deletions. A burst of sync_key/meta writes
overlaps the second forward send. Temporal overlap does not establish those
writes as the cause. The six non-session candidates are tested individually in
the follow-up instead of repeating a version matrix or assuming ADV migration.
The remaining-namespace group includes session; the earlier session-only control
is the independent negative evidence for that namespace.

### Individual namespace controls and repeated positives

[Individual run 42608060399](https://github.com/oxidezap/baileyrs/actions/runs/42608060399),
head `76b3cec739dbb244f1826aa9bd45855635ce83a3`, runs one fresh mock per selected
restored-Alice mutation namespace:

| Sole yielding namespace | Outcome         |
| ----------------------- | --------------- |
| device                  | 5 pass / 0 fail |
| sent_message            | 5 pass / 0 fail |
| msg_secret              | 5 pass / 0 fail |
| prekey                  | 5 pass / 0 fail |
| meta                    | 4 pass / 1 fail |
| sync_key                | 4 pass / 1 fail |

[Positive confirmation 42608496441](https://github.com/oxidezap/baileyrs/actions/runs/42608496441),
head `383bd0e636eb74a8611913d4bf3be6da304dcd8a`, repeats each positive twice.
Both meta repeats and both sync_key repeats fail 4 pass / 1 fail at send 5,
with reverse delivery successful and the same mock Whisper/MAC categories.

Row labels are private to the one account's store closure and reused across its
socket generations. They never compare accounts or disclose row keys. Meta has
71 observed mutation yields: one local row once and a second local row 70 times.
Sync_key has 70 distinct local rows, each written once. No bytes, key IDs,
fingerprints or value digests are emitted. These are counts, not an inspection
of the encrypted message that produced those writes.

The exact published bridge source
[src/js_backend.rs](https://github.com/oxidezap/whatsapp-rust-bridge/blob/04f014aefbf248f2ecbf7551cc73e67b949c9e73/src/js_backend.rs)
defines `set_sync_key` as an awaited sync_key JSON write followed by an awaited
meta/latest_sync_key_id write. The exact core source
[src/message/special.rs](https://github.com/oxidezap/whatsapp-rust/blob/f077a5d4a5dc12d7c51e79e46598740648c3824f/src/message/special.rs)
loops over key-share entries and awaits `set_sync_key` for each entry. This is
source-level call-path evidence; it does not prove which incoming packet caused
the observed writes or that either implementation caused the server MAC failure.
A final fixed-row control selects only the public latest_sync_key_id constant
versus other meta rows, without exposing any row values.

### Fixed-row result and coordination boundary

[Fixed-row run 42608749242](https://github.com/oxidezap/baileyrs/actions/runs/42608749242),
head `dad38863c6ff6a5d00d898153c01929350f04a93`:

| Only yielded restored-Alice meta writes | Repetition 1    | Repetition 2    |
| --------------------------------------- | --------------- | --------------- |
| latest_sync_key_id                      | 4 pass / 1 fail | 4 pass / 1 fail |
| Every other meta row                    | 5 pass / 0 fail | 5 pass / 0 fail |

The exact fixed-row cases each observe 70 mutation completions and one class=error
ACK for send 5; the other-meta cases each observe one completion and no error ACK.
The incoming value is already copied/applied before `setImmediate()` and returned
unchanged. Core source line 64 and bridge source line 833 identify the relevant
published call path above. No upstream source was changed or built in this round.

Minimal coordinated reproduction: published bridge 0.26.6 and the pinned mock;
reusable host byte store; fresh socket/credential wrappers on Alice recreation;
unchanged bidirectional pre-roundtrip, recreation, first bidirectional
post-roundtrip, then second roundtrip. After recreation only, let
`set('meta', 'latest_sync_key_id', value)` copy/apply normally, then await one
`setImmediate()` before resolving. All other callbacks remain normal. The
existing 10-second delivery guard fails for the second forward message while the
reverse arrives. Both repeated cases retain mock Whisper/MAC/decryption log
categories. This is a concrete interleaving input, not a completed diagnosis of
the server's rejected session or client Signal state.

The next implementation-level discriminator belongs with the existing core
front: reproduce this callback-completion interleaving while observing its
inbound key-share handling and Signal session commit/publication ordering, then
compare with the mock's corresponding packet/session if authorized logs can
supply that association. Current filtered logs do not carry an exact server
message-ID match; the accessible historical native log errors also lack a
message/frame-ID field. Their mixed negative fixtures are not evidence that the
consumer's packet was rejected for the same reason. The private mock-source 404
remains respected. No JavaScript cache, deferred trust check, dropped message,
callback short-circuit or durability reduction is justified by this result.

No consumer production fix is demonstrated. The exact input above can be
forwarded to the existing core thread without opening a duplicate upstream PR.
The #1869 ADV migration reproduction remains separate; these callbacks do not
establish an actual PN/LID migration at the ACK rejection. A stable core head
is still needed before the requested Group Simulation comparison. This round
makes no new performance measurement or allocation attribution claim.

All temporary workflow, observer scripts, host-memory selection and callback
hooks are removed from the final tree. Diagnostic commit URLs preserve the
reproduction; production code and original test scenarios match clean 49f2cf1.
