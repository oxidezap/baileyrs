# scriptc 0.4.0 native compilation experiment

This experiment is **blocked**, not a supported distribution target. It builds the actual `Example/example.ts` dependency graph and retains the normal Node example. A passing experiment job means that the documented failures were reproduced, not that the example works natively.

## Reproduce on Linux x64 glibc

The compiler is fixed to the official v0.4.0 archive and SHA-256. Node dependencies come from the committed lockfile, including bridge 0.26.0. CI uses Node 24.19.0 and Ubuntu 24.04. Install clang using your operating system's package manager, then run:

```sh
npm ci --ignore-scripts
npm run build
bash experiments/scriptc/install.sh /tmp/scriptc-0.4.0
SCRIPTC=/tmp/scriptc-0.4.0/bin/scriptc node experiments/scriptc/run.mjs
```

The runner saves compiler diagnostics, coverage, native object/link recipes, executable output, exit statuses and a verdict in `.scriptc/results`. The dedicated GitHub Actions workflow uploads these as `scriptc-0.4.0-evidence`, including on failure. Unknown compiler errors, timeouts, signals, failed positive controls and changed negative reproductions fail the job. There is no blanket `continue-on-error`.

The investigation environment had GCC but no clang or sudo. For local reproduction only, `SCRIPTC_POC_GCC=1` consumes the compiler's official `native-link-info` recipe with GCC, removing its clang-specific `-target x86_64-unknown-linux-gnu` pair. It asserts the recipe's compiler version and Linux x64 target. CI uses clang and the unchanged recipe. This is linking the emitted native objects, not running JavaScript through Node.

To run only the safe Node integration:

```sh
node --test experiments/scriptc/offline-check.mjs
# Or manually, with the network guard:
node --import ./experiments/scriptc/network-guard.mjs Example/example.ts --offline-smoke
```

`--offline-smoke` keeps the example's static imports and full bot implementation. It selects an offline entry branch before opening readline, creating Pino transports, fetching a version or constructing a socket. It compares bridge SHA-256 with Node crypto, checks two-party key agreement, round-trips the public protobuf facade, and writes/flushes/reopens/deletes synthetic session bytes through the real file auth store. It creates a unique temporary directory and removes it in `finally`. It rejects pairing and migration flags. It never reads the usual auth directory, prints keys, pairs a device or connects an account. The regression test uses a sentinel at the normal auth path, checks cleanup and intercepts fetch, WebSocket, TCP, TLS and HTTP connection entrypoints. This JavaScript guard is a regression detector, not an OS security boundary.

## Observed results

Investigated on 2026-10-21 against baileyrs base `54827e01a26c8c245c1682ba8a4d35e13e86601e` and official scriptc tag commit `4bc8a4711c358ca09edaa758f5efd296bc6d2730`.

| Stage                                       | Result                                    | Evidence / interpretation                                                                                                                     |
| ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Node full-example offline integration       | Pass                                      | `BAILEYRS_OFFLINE_SMOKE_OK`; real WASM crypto, protobuf and file persistence, no socket                                                       |
| Scalar WASM native control                  | Pass                                      | Native object and executable; `SCALAR_WASM_OK result=42`                                                                                      |
| Default full-example native build           | Blocked                                   | SC2013, published bridge JS looks minified                                                                                                    |
| Explicit bridge package selection           | Advances                                  | `--npm-static=@oxidezap/whatsapp-rust-bridge...` bypasses eligibility heuristic, not unsupported operations                                   |
| Full example after small source adjustments | Blocked                                   | Build also reports SC1012 at library default imports; coverage reports SC1090, SC1031, SC2004 and SC2020. See complete `example-build.stdout` |
| Real bridge minimal import                  | Compiles, initialization fails            | Native executable throws deferred SC2020 at `new FinalizationRegistry` in bridge glue, before SHA-256 runs                                    |
| Published bridge WASM alone                 | Compiles probe, rejects module at runtime | Coverage reports unsupported SIMD; `validate` is false and `new WebAssembly.Module` throws `CompileError`                                     |
| Native socket / TLS / account session       | Not reached                               | Earlier independent blockers prevent a meaningful native client integration                                                                   |
| Real-account end-to-end                     | Not tested                                | Outside this experiment's authorization                                                                                                       |

The published bridge WASM is 6,316,375 bytes with SHA-256 `7f563e4853e056a3063d3d82d7e3ee94004efa6ad267185040eca32fef1897b4`. scriptc identifies sign extension, nontrapping float conversion, bulk memory and **SIMD**. SIMD is outside v0.4.0's supported WASM proposal set. Coverage can report `success: true` for the tiny loader while listing its module as `unsupported`; the runtime test is necessary.

The source adjustments use named `readline` imports, a namespace `process` import, an explicit Pino `Logger` type and property access instead of union destructuring. Node behavior is preserved. We retained the memory-report command and recursive cleanup rather than deleting them to make the full entry look compilable. Build and coverage expose different first blockers. The build reports default-import lowering failures in the generated library entry, runtime and compatibility modules. Coverage reached failures include the default-config binding, event destructuring, V8 `HeapSpaceInfo[]` operations, the memory diagnostic filter predicate and `fs/promises.rm(path, options)`. `fixtures/rm.ts` minimizes the cleanup failure; `fixtures/finalization.ts` minimizes the unsupported finalization API independently of the bridge. `fixtures/bridge.ts` and `fixtures/wasm.ts` reproduce the two bridge failures without replacing the full-example build with a trivial program. `fixtures/scalar-wasm.ts` is explicitly a positive compiler control.

## Integration findings and remaining work

- **WASM loading and assets.** The bridge Node entry eagerly reads `new URL('whatsapp_rust_bridge_bg.wasm', import.meta.url)` and calls `initSync`. Its host entry permits explicit initialization, but choosing that entry would not remove SIMD or the glue's finalization requirements. The minimal loader uses `fileURLToPath` because scriptc rejected a URL passed directly to `readFileSync`. `coverage --wasm path` is coverage-only; builds use discoverable literal paths or `package.json`'s `scriptc.wasm`. Do not claim embedding alone solves deployment: v0.4.0 still reads the original WASM file bytes at runtime and looks up their hash in its translated-module registry.
- **Bridge glue lifetime.** The compiled import reaches `FinalizationRegistry` before any crypto call. Replacing it with a no-op would alter wasm-bindgen ownership and leak/drop behavior. A proper compiler/runtime implementation or an upstream bridge build with a verified lifetime strategy is needed. This experiment does neither.
- **SIMD.** The [bridge v0.26.0 Cargo configuration](https://github.com/oxidezap/whatsapp-rust-bridge/blob/981450c3d0a80c3951f1134693ef249b061a7257/.cargo/config.toml) explicitly enables `target-feature=+simd128`, consistent with the published bytes. Request or build a separate scalar bridge artifact from the exact upstream Rust sources, preserving the current Node artifact. Verify its proposals, hash, ABI, glue and differential crypto/protobuf tests before retrying. Merely removing a target-features custom section does not remove SIMD instructions. Alternatively, wait for scriptc SIMD translation. No WASM instructions were patched here.
- **Persistence.** `src/Utils/process-file-lock.ts` dynamically loads `fs-native-extensions`, whose kernel lock is required for snapshot transactions. scriptc coverage reports the CommonJS dynamic-import namespace as deferred unsupported code, and official documentation excludes Node-API addons. Preserve the real lock and fsync barriers. A separately tested native C-ABI lock adapter via scriptc FFI would be a further experiment, not a silent fallback to unlocked files.
- **Dynamic imports and logging.** The example's literal `import('v8')` is distinct from computed optional-media imports in `src/Runtime/node-media.ts`, optional-peer loading and Pino transport workers. Official v0.4.0 supports literal imports of compiled ESM and supported builtins; computed specifiers and CommonJS namespace synthesis have restrictions. Full coverage contains deferred SC2012 imports and other package operations. An explicit logger type removes the initial logger method diagnostics but does not prove that the normal transport workers work natively. `fixtures/logger.ts` retains a small typed logger case for manual exploration.
- **Sockets/TLS.** `src/Socket/transport.ts` uses global WebSocket and fetch. Native networking in scriptc uses its runtime and mbedTLS, not Node's OpenSSL. Node unit integration tests use local listeners, but native socket creation, certificate verification, reconnect, timers, event ordering and teardown remain unverified. After the bridge and frontend blockers are resolved, use a disposable loopback WSS server with an explicit trusted test CA before the private Bartender suite. Do not disable certificate validation in production defaults.
- **Crypto.** The Node offline test exercises actual Rust/WASM SHA-256 and key agreement against independent checks. Native bridge crypto never runs because initialization fails. The normal Node runtime also binds native crypto through `src/Utils/native-crypto-provider.ts`; coverage lists a deferred `crypto.subtle.deriveBits` limitation. No claim is made for all crypto APIs or algorithms from the availability of `node:crypto` alone.

Next steps are therefore compiler/frontend reproductions, a supported bridge WASM/glue build, durable native locking, then native offline integration and loopback transport/TLS tests. Account pairing, authenticated server behavior and a release require separate authorization and validation.

## Official references read

- [Complete v0.4.0 release notes](https://github.com/vercel-labs/scriptc/releases/tag/v0.4.0), including breaking changes, WASM, async lowering, npm selection, Node APIs, performance and fixes.
- [Pinned README and installation](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/README.md).
- [WASM support and runtime differences](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/limitations/webassembly-modules.mdx), [WASM decoder](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/packages/compiler/src/wasm/binary.ts), and [module discovery](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/packages/compiler/src/wasm/discover.ts).
- [CLI options](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/docs/cli.mdx), [npm compilation](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/docs/dependencies.mdx), [dynamic imports](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/limitations/language-features/dynamic-imports.mdx), [native addons](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/limitations/native-addons.mdx), and [external native linking](https://github.com/vercel-labs/scriptc/blob/4bc8a4711c358ca09edaa758f5efd296bc6d2730/docs/content/docs/native-objects.mdx).

## Upstream investigation

The [upstream follow-up](upstream/README.md) contains independent clean-project reproductions, duplicate checks, source analysis and a local filesystem prototype with a regression test. The issue publication attempts were denied by the GitHub integration with HTTP 403; these are reviewed drafts, not published issues. The CI runner also builds and executes the independent 29-byte SIMD reproduction.
