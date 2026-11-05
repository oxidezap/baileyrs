`readFileSync` rejects a statically typed `file:` URL before code generation. A string from `fileURLToPath` works, and the compiler already has that URL conversion. This requests support for the direct Node overload, with the same path checks and argument evaluation order.

Reproduced with scriptc 0.4.0 and an unmodified source build of main at `94aa7065f17fdeeb31094ffcb71885b0d671b5ba`. Platform: Linux x86_64, Debian glibc 2.41, Node 24.19.0.

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
import { readFileSync } from 'node:fs'
console.log(readFileSync(new URL('./fixture.txt', import.meta.url), 'utf8'))
```

Run:

```sh
printf hello > fixture.txt
npm install
node repro.ts
./node_modules/.bin/scriptc --version
./node_modules/.bin/scriptc build repro.ts --emit ir -o repro.ir.json
```

Node prints `hello` and exits 0. scriptc reports `0.4.0`, then exits 1 with:

```text
SC1090: 'URL' values where 'string' is expected is not supported yet
```

No socket or application package is involved. The expected behavior is to accept the [documented Node URL path](https://nodejs.org/docs/v24.22.0/api/fs.html#fsreadfilesyncpath-options), and preserve errors for invalid schemes, hosts and encoded separators. The one-argument Buffer form also rejects the direct URL.

After `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm -r build` in the main checkout, this command gives the same SC1090 from the clean reproduction directory:

```sh
node /path/to/scriptc/packages/cli/dist/main.js build repro.ts --emit ir -o main.ir.json
```

### Cause and proposed implementation

[`lowerFsEncodedRead`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/frontend/lowering/builtins/filesystem-calls.ts#L622) chooses `STRING` for every non-descriptor source. The one-argument branch in [`module-calls.ts`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/frontend/lowering/builtins/module-calls.ts#L237) also lowers its path as `STRING`. A native URL therefore reaches the URL-to-string refusal, even though [`url.fileURLToPathUrl`](https://github.com/vercel-labs/scriptc/blob/94aa7065f17fdeeb31094ffcb71885b0d671b5ba/packages/compiler/src/ir/builtin-signatures.ts#L972) is already available.

A local frontend prototype selects that existing conversion for a typed URL, then feeds the resulting path to the existing encoded or Buffer read. For an encoding-bearing call, it first stages the URL and encoding operands in hidden locals, in source order, and only then converts the URL. Converting it while evaluating the first operand would throw too early when the encoding expression has side effects.

The regression fails on unpatched main and passes with the prototype. It checks both encoded and Buffer reads and validates the generated IR. The compiler build, lint and formatting checks pass. These are frontend results, not a native parity claim: the available 0.4.0 runtime pack has ABI 22, while main requires ABI 23, and I did not link them together. Native tests still need to cover Unicode and space-containing paths, invalid schemes/hosts/escapes, operand side effects, and encoded and Buffer results.

I searched issues and PRs for `readFileSync`, URL paths and file URLs. #645 added URL conversion APIs, and #577 and #34 describe older, broader lowering gaps; I found no report or pending fix for this direct readFileSync overload. Application context: oxidezap/baileyrs#176. The reproduction does not depend on that project.
