A module that the build finds and rejects for SIMD produces the same runtime explanation as bytes the build never saw. The failure is expected because SIMD is outside the documented WASM feature set. The diagnostic loses the reason the compiler already knows, which makes a feature limitation look like an asset-discovery problem.

Tested natively with the official scriptc 0.4.0 Linux x64 glibc archive. Node: 24.19.0; host: Linux x86_64, Debian glibc 2.41. On main `94aa7065f17fdeeb31094ffcb71885b0d671b5ba`, I confirmed the same coverage classification and the unchanged source path that drops this information. I have not run a main-ABI native executable.

### Standalone reproduction

This is a valid 29-byte WASM module with `i32.const 0`, `i8x16.splat`, and `drop`. It has no imports or sidecar files. Save as `repro.ts`:

```ts
const bytes = Buffer.from('AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAP0PGgs=', 'base64')
console.log(WebAssembly.validate(bytes))
new WebAssembly.Module(bytes)
```

With scriptc 0.4.0 installed:

```sh
node repro.ts
scriptc coverage repro.ts --print diagnostics > coverage.json
scriptc build repro.ts --print native-link-info -o repro.o > link.json
```

Node prints `true` and exits 0. Coverage identifies the exact inline bytes:

```json
{
	"sha256": "ad9e35963986d455947710f374671b307caeaec42ba7fb9ee271e2acc3df28a9",
	"size": 29,
	"status": "unsupported",
	"unsupported": ["simd"]
}
```

My host had GCC rather than clang, so I linked the emitted object with the exact reported runtime inputs, using the documented external-link interface:

```sh
python3 - <<'PY'
import json, subprocess
r = json.load(open('link.json'))
assert r['compiler_version'] == '0.4.0'
assert r['target']['name'] == 'linux-x64-gnu'
link = r['link']
assert link['driver_flags'][:2] == ['-target', 'x86_64-unknown-linux-gnu']
subprocess.run([
    'gcc', *link['driver_flags'][2:], *link['input_order'],
    *['-l' + name for name in link['system_libraries']], '-o', 'repro'
], check=True)
PY
./repro
```

The executable prints `false`, then exits 1 with:

```text
Uncaught CompileError: WebAssembly.Module(): this module was not translated when the program was built (scriptc compiles WebAssembly ahead of time and cannot compile modules whose bytes it did not see; see https://scriptc.dev/limitations)
```

Here the build did see the bytes. Coverage even gives their hash and unsupported feature.

### Cause

In [`lowerer.ts`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/frontend/lowering/lowerer.ts#L1205), discovery returns the module and its status, but the build skips every report whose status is not `valid`. Only translated modules enter the emitted registry.

At runtime, [`scr_wasm_lookup`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/runtime/src/scr_wasm.c#L1656) searches that registry. A miss reaches the single [`scr_wasm_not_translated`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/runtime/src/scr_wasm.c#L1671) message. It cannot distinguish a known unsupported module from an undiscovered one because the rejected module's metadata was not retained.

### Proposed change

Keep a small hash-indexed record for discovered but untranslated modules, including their unsupported features or validation error. On a registry miss, check that record before using the generic unseen-bytes message. For this example the error could say that the module was found during the build but was not translated because it uses SIMD.

This should stay a catchable `CompileError`, and `validate` should retain its current result. A package such as undici may intentionally catch the failure and use a scalar fallback, so failing the whole build for every unsupported module would change useful behavior.

A regression should pair this known-SIMD module with a module whose bytes really were unavailable at build time and assert distinct reasons. The prototype work here establishes discovery, the native error and the code path that loses the metadata; I have not implemented the extra registry or claimed SIMD support.

I searched existing issues and PRs for `CompileError`, `not translated`, SIMD and unsupported WebAssembly modules. #1395 documents the current fallback behavior, but I found no report or pending change for preserving this diagnostic reason. The real-world context was oxidezap/baileyrs#176; the reproduction above does not depend on it.
