# Working on baileyrs

## Priorities

1. Baileys compatibility first. Preserve imports, types, object shapes, errors, event ordering, wire data, and persisted sessions.
2. Performance second. Measure CPU, latency, allocations, memory retention, or I/O on the affected path. Never trade compatibility or durability for speed.

The pinned `baileys` dependency in `package.json` is the API and behavior reference. Check protocol changes against WhatsApp Web evidence when available. State evidence gaps and raise security conflicts instead of guessing or copying unsafe behavior.

## Working rules

- Read callers, tests, data ownership, and async boundaries before editing. Reproduce bugs with a focused regression test and fix the cause with the smallest change.
- Check `git status` and `git worktree list`. Isolate parallel tasks on the agreed base; never revert unrelated work or share writable dependency/build directories between worktrees.
- Follow strict ESM TypeScript, existing `.ts` imports, and the repository formatter. Validate external payloads rather than hiding uncertainty with casts.
- Keep consumer behavior and migration guidance in [README.md](README.md). Update it when those contracts change.

## Ownership

Rust owns protocol parsing, Signal/session state, operational retries, media encryption/streaming, and cache policy. The bridge exposes neutral operations without Baileys names. Do not build a competing engine in JS.

- `src/Socket/` orchestrates operations; `src/Bridge/` normalizes incoming events.
- `src/Compatibility/` owns Baileys translations and object contracts. Its `public-api/` helpers must work without a socket. Preserve historical exports and deep imports when moving code.
- Follow [src/Compatibility/README.md](src/Compatibility/README.md). If a capability is missing, identify the core/bridge change it needs.
- Never hand-edit generated WAProto declarations or schema metadata. Use `npm run compat:sync-waproto`, inspect the diff, then `npm run compat:check-waproto`. Regenerate `lib/` with `npm run build`.

## Compatibility and safety

- Check types, runtime behavior, and wire fidelity separately. Preserve optionality, defaults, enum coercion, `Long` precision, and reader/writer interoperability. Do not silently ignore socket options.
- Compare affected audits on base and head. Do not weaken assertions, coverage requirements, or divergence allowlists to make a change pass. Reproduce existing failures on the base and report them separately.
- For dependency upgrades, check release changes and transitive overrides. Keep fixed fixtures or an independent reference so upgrading both sides of a differential test cannot conceal regressions.
- Preserve client ownership and teardown ordering. Never free a WASM client while operations use it. Transient retries report `connecting`; terminal `close` is once-only. Do not add a competing reconnect loop.
- Native binary auth and upstream JSON auth need different loaders. Preserve migration paths and `bridge-` rows in backups. Keep per-key ordering, required byte snapshots, durability barriers, and honest flush errors.
- Never expose real credentials, session keys, QR data, or auth folders. Keep mock TLS/certificate bypasses out of production defaults.

## Verification

Use npm and the committed lockfile. CI uses Node 24; check `package.json` before using APIs outside the supported consumer Node range.

Install with `npm ci --ignore-scripts`, run focused regressions, then:

```sh
npm run lint
npm run format:check
npm test
npm run build
node scripts/check-pack.ts
```

Run affected `compat:audit:*` scripts from `package.json`. `compat:layers` needs sibling core and bridge checkouts; `typecheck:compat-auditor` includes it. Report missing prerequisites rather than calling a blocked check a pass.

`npm test` includes deterministic fuzz smoke tests. Keep minimized reproducers and narrowly justified differences as described in [src/__fuzz__/README.md](src/__fuzz__/README.md).

E2E setup lives in [.github/workflows/ci.yml](.github/workflows/ci.yml). It requires the private Bartender mock; the full suite also includes live WhatsApp Web requests. Run `SOCKET_URL=wss://127.0.0.1:8080/ws/chat npm run test:e2e` against the configured local mock. A fork CI run can skip E2E and still be green.

Profile performance work before editing. Compare base and head with the same workload and environment, warmup, and repeated samples. Target redundant copies, JS/WASM crossings, serialization, retained handles, and I/O without removing ownership or persistence safeguards. Inspect `Example/benchmark.ts` before using the integration benchmark; use a focused benchmark when needed.

Report passed, failed, skipped, and blocked checks. For documentation-only changes, verify references and commands; do not imply runtime tests ran. Keep large test artifacts on disk, not RAM-backed temporary storage.

## Pull requests and releases

- Keep PRs scoped, with compatibility evidence and performance measurements when applicable. Use English titles and bodies. Commit or publish only when requested; never include trailers or tool signatures.
- PR titles become squash commit titles. Follow [.github/workflows/release.yml](.github/workflows/release.yml) and [release-please-config.json](release-please-config.json). `feat`, `fix`, and `perf` trigger releases. Use `fix(deps): ...` for runtime upgrades intended for release; keep documentation-only changes as `docs`.
- Let release-please manage versions and release notes unless asked otherwise. Preserve publication of the exact CI-verified build. Do not ship preview URLs as runtime dependency pins.
