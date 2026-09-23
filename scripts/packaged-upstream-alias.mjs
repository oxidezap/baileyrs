import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'scripts/fixtures/upstream-alias')
const work = mkdtempSync(join(tmpdir(), 'baileyrs-packaged-alias-'))
try {
	const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work, '--json'], { cwd: root, encoding: 'utf8' }))
	const tarball = join(work, packed[0].filename)
	for (const filename of ['consumer.ts', 'runtime.mjs', 'worker.ts', 'wrangler.toml']) {
		writeFileSync(join(work, filename), readFileSync(join(fixture, filename)))
	}
	writeFileSync(join(work, 'tsconfig.json'), readFileSync(join(fixture, 'tsconfig.json')))
	const nodeTypesVersion = JSON.parse(readFileSync(join(root, 'node_modules/@types/node/package.json'), 'utf8')).version
	writeFileSync(join(work, 'package.json'), JSON.stringify({
		private: true,
		type: 'module',
		dependencies: { '@whiskeysockets/baileys': `file:${tarball}` },
		devDependencies: { '@types/node': nodeTypesVersion }
	}, null, 2))
	execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: 'inherit' })
	execFileSync(join(root, 'node_modules/.bin/tsc'), ['--project', join(work, 'tsconfig.json')], { cwd: work, stdio: 'inherit' })
	execFileSync(process.execPath, [join(work, 'runtime.mjs')], { cwd: work, stdio: 'inherit' })
	cpSync(join(work, 'node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge_bg.wasm'), join(work, 'bridge.wasm'))
	await runWorkerdSmoke(work)
} finally {
	rmSync(work, { recursive: true, force: true })
}

async function runWorkerdSmoke(cwd) {
	const probe = createServer()
	await new Promise(listening => probe.listen(0, '127.0.0.1', listening))
	const port = probe.address().port
	await new Promise(closed => probe.close(closed))
	const child = spawn(join(root, 'node_modules/.bin/wrangler'), ['dev', '--local', '--ip', '127.0.0.1', '--port', String(port)], {
		cwd,
		stdio: 'inherit',
		detached: true,
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
	})
	try {
		const deadline = Date.now() + 90_000
		for (let attempt = 0; attempt < 90; attempt++) {
			if (child.exitCode !== null) throw new Error(`Wrangler exited with status ${child.exitCode}`)
			try {
				const response = await fetch(`http://127.0.0.1:${port}`, {
					signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deadline - Date.now())))
				})
				if (!response.ok || (await response.text()) !== 'host initialized') throw new Error('unexpected workerd response')
				console.log('packaged workerd host smoke passed (nodejs_compat disabled)')
				return
			} catch (error) {
				if (error instanceof Error && error.message === 'unexpected workerd response') throw error
			}
			await new Promise(done => setTimeout(done, 1000))
		}
		throw new Error('Wrangler workerd smoke did not become ready')
	} finally {
		if (child.pid) process.kill(-child.pid, 'SIGTERM')
	}
}
