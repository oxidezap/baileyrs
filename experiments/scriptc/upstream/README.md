# Upstream follow-up

These are historical notes from the v0.4.0 investigation on 2026-10-21, not current blockers or pending publication requests. The current integration checkpoint is [the PR comment](https://github.com/oxidezap/baileyrs/pull/176#issuecomment-6562285500). Old publication/access and runtime-ABI observations below do not describe the rebuilt current compiler.

The reviewed English drafts are:

- [Promise rm options](rm.md), an unsupported overload that has a corresponding synchronous implementation.
- [File URL reads](url.md), a typed URL path refused by `readFileSync` despite existing file-URL conversion support.
- [WASM rejection diagnostics](wasm-diagnostic.md), a request to retain the known feature reason for a discovered but untranslated module. This does not claim that SIMD should already compile.

Each draft contains a standalone reproduction, pinned dependencies, commands, observed and expected results, source permalinks, related issue/PR searches and a proposed implementation. The filesystem reproductions were installed and executed in separate clean directories. Both fail on official scriptc 0.4.0 and on an unmodified source build of main at `94aa7065f17fdeeb31094ffcb71885b0d671b5ba`. The main SHA was checked again before publication was attempted. The WASM case was run natively on 0.4.0; main coverage and the source path that loses the rejection reason were checked separately.

## Superseded local prototype

The old `filesystem-prototype.patch` targeted main `94aa7065f17fdeeb31094ffcb71885b0d671b5ba` and is no longer shipped. The updated compiler at `5ae71eafa6dbe6a004df245872e28a2be45a849c` was built with its matching helper/runtime: the isolated `fs.promises.rm` options fixture builds and runs, and a typed `file:` URL passed to `readFileSync` builds and reads `hello` natively. The old patch and its IR-only regression are not needed for this integration. Git history preserves the investigation; do not apply it to current Scriptc.

## Other blockers checked

- SIMD is explicitly outside the v0.4.0 WASM feature set. Merged #1395 and #1410 describe the staged WASM implementation and later work. The new diagnostic draft addresses the loss of a known reason, not a duplicate request to implement the existing stage plan.
- `FinalizationRegistry` is explicitly refused in the constructor lowering. A no-op replacement would break wasm-bindgen lifetime semantics. No verified small fix was found, so no bug report asserting one was drafted.
- Hand-written predicate narrowing has open PR #1543. No duplicate issue was prepared.
- Builtin default-import configuration has issue #467 and PR #469. Simple local JS default-import reproductions, including adjacent declarations, compiled. The broader application's default-import failures were not minimized sufficiently to justify another issue.
- V8 heap-space methods remain an intentional unsupported engine-specific API in the changes described by merged PR #1318. No generic array-method bug is claimed from those diagnostics.

Existing reports #577 and #34 and the merged URL and fs-extra work #645 and #1504 were reviewed while checking the filesystem cases. Searches covered open and closed issues and PRs; no matching pending fix was found for the three drafted reports. Recheck the tracker before a later publication, since upstream may have moved.

## CI checkout correction

The first follow-up run failed its unchanged WASM hash assertion because GitHub tested a synthetic merge with a newer base containing bridge 0.26.1. At that checkpoint the experiment head pinned 0.26.0. The current branch now pins 0.26.4 and its updated SHA-256. Its workflow now checks out `github.event.pull_request.head.sha`, preserving the integrity check and the declared inputs. The normal repository CI retains its existing merge-context checks.
