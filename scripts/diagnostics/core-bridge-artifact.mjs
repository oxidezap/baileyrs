import { readFile, writeFile, cp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const published = 'f077a5d4a5dc12d7c51e79e46598740648c3824f'
const merged = 'cef244e914affabbd5ee62be67b2e34eba97338e'
const [mode, revision] = process.argv.slice(2)
if (mode === 'prepare') {
  if (![published, merged].includes(revision)) throw new Error('unexpected diagnostic core revision')
  const path = '.diagnostic-bridge/Cargo.toml'
  const source = await readFile(path, 'utf8')
  if (!source.includes(published)) throw new Error('published core pin missing')
  await writeFile(path, source.replaceAll(published, revision))
} else if (mode === 'record') {
  if (![published, merged].includes(revision)) throw new Error('unexpected diagnostic core revision')
  const root = '.diagnostic-bridge'
  const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
  pkg.version = `0.26.6-diagnostic.${revision.slice(0,12)}`
  await writeFile(`${root}/package.json`, JSON.stringify(pkg, null, 2) + '\n')
  const digest = createHash('sha256').update(await readFile(`${root}/dist/whatsapp_rust_bridge_bg.wasm`)).digest('hex')
  const provenance = { diagnostic: true, bridge: '04f014aefbf248f2ecbf7551cc73e67b949c9e73', core: revision, build: 'bun run build', runnerImage: process.env.ImageOS ?? null, runnerImageVersion: process.env.ImageVersion ?? null, wasmSha256: digest, version: pkg.version }
  await writeFile(`${root}/diagnostic-provenance.json`, JSON.stringify(provenance, null, 2) + '\n')
  console.log(JSON.stringify(provenance))
} else if (mode === 'install') {
  const artifact = '.diagnostic-artifact'
  const provenance = JSON.parse(await readFile(`${artifact}/diagnostic-provenance.json`, 'utf8'))
  if (!provenance.diagnostic || provenance.core !== revision || provenance.bridge !== '04f014aefbf248f2ecbf7551cc73e67b949c9e73') throw new Error('unexpected diagnostic provenance')
  const digest = createHash('sha256').update(await readFile(`${artifact}/dist/whatsapp_rust_bridge_bg.wasm`)).digest('hex')
  if (digest !== provenance.wasmSha256) throw new Error('diagnostic artifact digest mismatch')
  const installed = resolve('node_modules/@oxidezap/whatsapp-rust-bridge')
  await rm(`${installed}/dist`, { recursive: true, force: true })
  await cp(`${artifact}/dist`, `${installed}/dist`, { recursive: true })
  const pkg = JSON.parse(await readFile(`${installed}/package.json`, 'utf8'))
  pkg.version = provenance.version
  await writeFile(`${installed}/package.json`, JSON.stringify(pkg, null, 2) + '\n')
  console.log(JSON.stringify(provenance))
} else throw new Error('unexpected diagnostic operation')
