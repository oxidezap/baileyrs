# Upstream follow-up

Issue creation in `vercel-labs/scriptc` was attempted on 2026-10-21 and denied by GitHub with `403 Resource not accessible by integration`. No issue was created. Publication is pending an appropriately authorized GitHub connection. No alternate identity or publication route was tried after the denial.

The reviewed English drafts are:

- [Promise rm options](rm.md), an unsupported overload that has a corresponding synchronous implementation.
- [File URL reads](url.md), a typed URL path refused by `readFileSync` despite existing file-URL conversion support.
- [WASM rejection diagnostics](wasm-diagnostic.md), a request to retain the known feature reason for a discovered but untranslated module. This does not claim that SIMD should already compile.

Each draft contains a standalone reproduction, pinned dependencies, commands, observed and expected results, source permalinks, related issue/PR searches and a proposed implementation. The filesystem reproductions were installed and executed in separate clean directories. Both fail on official scriptc 0.4.0 and on an unmodified source build of main at `94aa7065f17fdeeb31094ffcb71885b0d671b5ba`. The main SHA was checked again before publication was attempted. The WASM case was run natively on 0.4.0; main coverage and the source path that loses the rejection reason were checked separately.

## Local prototype

[filesystem-prototype.patch](filesystem-prototype.patch) applies to scriptc main at that SHA. It is an investigation patch, not a submitted upstream PR or a completed compatibility implementation. It adds promise rm options lowering and wrappers, typed file-URL read lowering, operand staging, and `packages/compiler/test/fs-inputs-experiment.test.ts`.

From a scriptc checkout at the exact base, after installing workspace dependencies:

```sh
git apply /path/to/filesystem-prototype.patch
pnpm --filter @scriptc/compiler build
SCRIPTC_TEST_WORKERS=2 pnpm exec vitest run packages/compiler/test/fs-inputs-experiment.test.ts
```

The compiler build passes. The regression fails without the patch with SC1090 for URL paths and SC2020 for rm options, then passes with the patch and validates the generated IR. The main checkout uses @types/node 24.13.3. `pnpm lint`, formatting of the changed TypeScript files and GCC syntax checking of `scr_async.c` pass. The standalone consumer reproductions use @types/node 26.1.1 and Node 24.19.0 on Linux x86_64, glibc 2.41.

Native execution of the patched main runtime was blocked. Its runtime ABI is 23, while the available official 0.4.0 runtime pack is ABI 22. The compiler rejected that pack, and the mismatch was not bypassed. A matching main runtime/helper build, native differential tests, filesystem error and retry tests, declaration updates and compatibility regeneration are still required. No full or sanitized upstream gate is claimed.

## Other blockers checked

- SIMD is explicitly outside the v0.4.0 WASM feature set. Merged #1395 and #1410 describe the staged WASM implementation and later work. The new diagnostic draft addresses the loss of a known reason, not a duplicate request to implement the existing stage plan.
- `FinalizationRegistry` is explicitly refused in the constructor lowering. A no-op replacement would break wasm-bindgen lifetime semantics. No verified small fix was found, so no bug report asserting one was drafted.
- Hand-written predicate narrowing has open PR #1543. No duplicate issue was prepared.
- Builtin default-import configuration has issue #467 and PR #469. Simple local JS default-import reproductions, including adjacent declarations, compiled. The broader application's default-import failures were not minimized sufficiently to justify another issue.
- V8 heap-space methods remain an intentional unsupported engine-specific API in the changes described by merged PR #1318. No generic array-method bug is claimed from those diagnostics.

Existing reports #577 and #34 and the merged URL and fs-extra work #645 and #1504 were reviewed while checking the filesystem cases. Searches covered open and closed issues and PRs; no matching pending fix was found for the three drafted reports. Recheck the tracker before a later publication, since upstream may have moved.
