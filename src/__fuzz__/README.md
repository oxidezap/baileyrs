# Fuzzing

Differential and property-based fuzzing of baileyrs against upstream Baileys.

## Why this exists

The repository already compares itself to Baileys in three ways, and all three
use inputs somebody wrote down:

| Layer        | Where                                         | What it compares                            |
| ------------ | --------------------------------------------- | ------------------------------------------- |
| Declarations | `scripts/compatibility/audit-core.ts`         | `.d.ts` shapes against `baileys`            |
| Send path    | `scripts/compatibility/wire-fidelity-core.ts` | planted proto fields survive `relayMessage` |
| Behaviour    | ~50 `src/**/*-compatibility.test.ts`          | fixed fixtures against `import('baileys')`  |

They find what someone thought to write down. This directory generates the
inputs instead — from the proto schema, from the bridge event table, from a JID
grammar — and asks whether the two libraries still agree.

The first runs found 21 differences: 18 still open, 3 deliberate. They are
recorded in `harness/divergence.ts` with a reason and a review date, and the
ones with a minimised reproducer carry it in `corpus/`.

## Running it

```sh
npm test            # included; fixed seed, small budgets, deterministic
npm run fuzz        # just the fuzz suite
npm run fuzz:deep   # bigger budgets, longer, plus the WASM leak probe
```

A failure prints the seed, the minimised input, both results, and the command to
replay it.

### Environment

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

## The targets

| File                             | Asks                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pure-differential.fuzz.test.ts` | do the shared pure helpers agree with upstream, on values and on throwing (the count lives in `targets.ts`) |
| `proto-codec.fuzz.test.ts`       | do the Rust/WASM codec and protobufjs agree, across all 498 message types                                   |
| `proto-robustness.fuzz.test.ts`  | what does the decoder do with bytes a hostile peer chose                                                    |
| `wire-fidelity.fuzz.test.ts`     | does `relayMessage` hand the bridge everything the message carried                                          |
| `bridge-events.fuzz.test.ts`     | does the anti-corruption layer drop what it cannot parse, and does the buffer lose events                   |
| `argument-boundary.fuzz.test.ts` | is an off-domain argument rejected before it reaches WASM, with a usable stack                              |
| `coverage.fuzz.test.ts`          | is every shared export either fuzzed or excused in writing                                                  |

## Design

**Determinism first.** Nothing here calls `Math.random`. A failure nobody can
replay is a failure nobody can fix, so `npm test` runs a fixed seed and the
nightly job varies it.

**Shrink before reporting.** A 400-node generated message that diverges is a
haystack. Every failing input is minimised first — usually to two or three
fields.

**A corpus, not luck.** Minimised failures are committed to `corpus/` and
replayed before any fresh generation, so a fixed bug stays fixed when the seed
moves on.

**Findings are recorded, not muted.** `harness/divergence.ts` separates
`intended` (baileyrs is deliberately different, and here is why) from `open` (a
real difference nobody has decided about). Open entries keep the suite green so
the next run does not re-report them as news, and they are printed on _every_
run so they cannot quietly become "fine". Both carry a review date; past it the
nightly job fails.

**Classification over volume.** Field ordering and packed-vs-unpacked repeated
scalars are legal protobuf and differ on nearly every message. They are their own
targets, so excusing them never blinds the checks that matter. Likewise, a
difference that is structurally a _subset_ is reported as an omission, which
means "the bridge dropped a field" can never share an allowlist entry with "the
bridge wrote a different value".

**Coverage is a claim, not a hope.** `targets.ts` accounts for every shared
export — fuzzed, or excused with a reason. A new export fails the suite until
someone decides which it is. `argument-boundary.fuzz.test.ts` does the same by
scanning the source for `assertArgumentDomain` call sites.

**No silent caps.** A target that runs out of time says so, and finite sweeps
are marked `exhaustive` so the budget cannot truncate them. A run that checked
747 of 1734 inputs and printed nothing reads exactly like one that checked
them all — that happened during development, and the warning exists because of it.

## What this does not cover

Two lists of known gaps, and this section exists because neither was findable
from outside the source. The `open` entries in `harness/divergence.ts` are the
first: real differences nobody has decided about, printed on every run and
carrying a review date. This is the second — surfaces the suite does not reach
at all, which no run will ever remind anyone about.

| Surface                                                                           | Why it is not fuzzed                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBufferedFunction`                                                          | A differential was written and withdrawn. It surfaced consolidation differences that are real findings needing characterisation — `groups.update` entries with no `id`, and blank fields kept on one side but not the other — and landing it would have meant an allowlist entry broad enough to excuse whatever else turned up. `Socket/groups.ts` and `Socket/internals.ts` use it in production, so this is worth closing. |
| `generateWAMessage`, `generateWAMessageContent`                                   | Both are async and reach media upload. A differential needs a paired upload stub that returns identically on both sides first, or every draw diverges on an upload URL. Only the synchronous `generateWAMessageFromContent` is covered, by `wire-fidelity.fuzz.test.ts`.                                                                                                                                                      |
| Keyed crypto (`decryptPollVote`, `decryptEventResponse`, `decryptMediaRetryData`) | Random input only ever reaches the shared reject branch, so the differential proves nothing. Needs real key material fixtures.                                                                                                                                                                                                                                                                                                |

`targets.ts` carries the same reasons per export, since that is where the
suite enforces them; this table is the version somebody planning work can find.

## Adding a target

```ts
await fuzz({
  target: 'area:property',        // names the corpus file and the allowlist key
  runs: 200,
  generate: random => ...,        // consume `random` only
  check: input => {               // return the differences; [] means agreement
    ...
    return { target: 'area:property', input, local, upstream, detail: '...' }
  }
})
```

Two rules. `check` must be **total** over the shrinker's candidate space — it
proposes `{}` and `undefined`, and a property that throws on those reports a
crash in the fuzzer instead of a finding in the library. And a target that
answers a finite question should set `exhaustive: true` and iterate rather than
sample.
