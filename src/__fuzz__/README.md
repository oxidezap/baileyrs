# Fuzzing

Differential and property-based tests compare baileyrs with the pinned Baileys
version using generated proto, bridge-event and JID inputs.

## Running

```sh
npm test            # includes deterministic smoke tests
npm run fuzz        # fuzz suite only
npm run fuzz:deep   # larger budgets and WASM leak probe
```

Unexcused divergences report a seed, input, both results and a replay command.
Crash reports may lack results or an input; shrinking is not always possible.

| Variable                | Meaning                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FUZZ_SEED`             | Seed string. Default `baileyrs-fuzz-v1`.                                                                                                         |
| `FUZZ_RUNS`             | Iterations per target. Ignored by targets marked `exhaustive`, which sweep a finite set and would otherwise report a partial pass as a full one. |
| `FUZZ_MODE`             | `smoke` (default) or `deep`.                                                                                                                     |
| `FUZZ_TIME_BUDGET_MS`   | Per-target wall-clock ceiling.                                                                                                                   |
| `FUZZ_ONLY`             | Substring filter over target names, for triage.                                                                                                  |
| `FUZZ_RECORD`           | `1` appends minimised failures to the corpus.                                                                                                    |
| `FUZZ_STRICT_ALLOWLIST` | `1` fails on registry entries past review.                                                                                                       |
| `FUZZ_REPORT_DIR`       | Directory for per-target JSON reports.                                                                                                           |

## Coverage and findings

[targets.ts](targets.ts) lists shared exports and reasons for exclusions.
Tests cover pure helpers, protobuf encoding and hostile input, relay wire
fidelity, bridge events and argument validation. Coverage checks reject
unclassified exports and untested `assertArgumentDomain` call sites.

[harness/divergence.ts](harness/divergence.ts) records `open` and `intended`
differences with reasons and review dates. Known open findings print on every
run; nightly CI enforces review dates. Do not broaden an allowlist entry to
hide unrelated failures. Field ordering, packed encoding and omitted fields
are classified separately.

Minimized reproducers in [corpus](corpus) replay before generated inputs.
Use the registry for current findings rather than a count in this document.

## What this does not cover

Known coverage gaps are recorded per export in `targets.ts`:

- `createBufferedFunction` needs characterization of consolidation differences,
  including group updates without IDs and blank-field retention. It is used in
  `Socket/groups.ts` and `Socket/internals.ts`.
- `generateWAMessage` and `generateWAMessageContent` need paired media-upload stubs.
  Only the synchronous `generateWAMessageFromContent` is covered.
- `decryptPollVote`, `decryptEventResponse` and `decryptMediaRetryData` need valid
  key fixtures; random invalid input only tests rejection.

## Adding a target

Use [harness/runner.ts](harness/runner.ts) and existing `*.fuzz.test.ts` targets as
references. Consume only the supplied random generator so seeds replay.
Minimize failures and commit regression inputs to `corpus`.

The `check` function must handle every shrink candidate, including `{}` and
`undefined`, without throwing. Return differences for mismatches. For finite
sets, set `exhaustive: true` and iterate instead of sampling. Report exhausted
time budgets; do not present partial sweeps as complete passes.
