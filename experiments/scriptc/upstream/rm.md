`fs.promises.rm(path, { recursive: true, force: true })` fails to compile even though the synchronous options form already has lowering and runtime support. This is a request to extend the promise API's supported overloads, not a claim that scriptc promises full Node compatibility.

Reproduced with scriptc 0.4.0 and an unmodified source build of main at `94aa7065f17fdeeb31094ffcb71885b0d671b5ba`. Platform: Linux x86_64, Debian glibc 2.41, Node 24.19.0. The reproduction uses no application dependencies or network connection at runtime.

### Reproduction

In an empty directory, create these files.

`package.json`:

```json
{
	"private": true,
	"type": "module",
	"devDependencies": {
		"scriptc": "0.4.0",
		"@types/node": "26.1.1"
	}
}
```

`tsconfig.json`:

```json
{
	"compilerOptions": {
		"strict": true,
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "Bundler"
	}
}
```

`repro.ts`:

```ts
import { rm } from 'node:fs/promises'
await rm('missing', { recursive: true, force: true })
console.log('ok')
```

Run:

```sh
npm install
node repro.ts
./node_modules/.bin/scriptc --version
./node_modules/.bin/scriptc build repro.ts --emit ir -o repro.ir.json
```

Node prints `ok` and exits 0. scriptc reports version `0.4.0`, then exits 1 with:

```text
SC2020: 'rm with 2 arguments' is part of the standard library types but has no scriptc lowering yet
hint: the supported form takes 1 argument (no options objects)
```

Using IR output avoids requiring a linker. The expected behavior is to support this overload and preserve `recursive` and `force`, including rejection of filesystem failures. Dropping the options or replacing the call with synchronous removal would not be equivalent. The [Node 24 API](https://nodejs.org/docs/v24.22.0/api/fs.html#fspromisesrmpath-options) defines both options.

For the main check I installed the workspace with `pnpm install --frozen-lockfile --ignore-scripts`, ran `pnpm -r build`, and used:

```sh
node /path/to/scriptc/packages/cli/dist/main.js build repro.ts --emit ir -o main.ir.json
```

It reports the same SC2020 in the clean reproduction directory.

### Cause and proposed implementation

At the tested main commit:

- [`surfaces.ts`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/frontend/lowering/surfaces.ts#L1325) gives `fs/promises.rm` one parameter. The generic arity gate rejects the second argument.
- [`module-calls.ts`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/frontend/lowering/builtins/module-calls.ts#L294) routes the options parser only for `fs.rmSync`.
- [`scr_fsp_rm`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/runtime/src/scr_async.c#L2898) wraps only the one-argument operation. The option-aware removal and retry functions already exist in [`scr_lib.c`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/runtime/src/scr_lib.c#L4866).

A local prototype routes the promise form through the existing literal options parser, adds `fsp.rmOpts` and `fsp.rmRetry` signatures and LLVM symbol mappings, and wraps the option-aware runtime operations with `scr_promise_settled_void()`. That last step matters: a pending filesystem exception must become a rejected promise, as it does for the existing fs/promises wrappers.

The runtime wrapper in that prototype is:

```c
ScrPromise *scr_fsp_rm_opts(ScrStr *path, bool recursive, bool force) {
  scr_fs_rm_opts(path, recursive, force);
  return scr_promise_settled_void();
}
```

The frontend regression fails without the patch and passes with it, including recursive/force and retry-argument forms. The emitted IR validates, the compiler builds, lint passes, and the added C wrappers pass GCC syntax checking. This is not a fully validated native fix: main requires runtime ABI 23, while the installed 0.4.0 pack is ABI 22. I did not bypass that mismatch. Native differential tests, retry fault injection, fallback declaration updates and compatibility regeneration remain necessary before landing a change.

I checked existing issues and PRs for `fs/promises`, `rm`, `rmSync`, and recursive removal. Merged #1504 implements an fs-extra shim with its own removal path; it does not add this Node API overload. I found no open report or pending fix for this case. The original application context is oxidezap/baileyrs#176, but the reproduction above is independent of it.
