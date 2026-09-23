import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'scripts/fixtures/upstream-alias')
const work = mkdtempSync(join(root, '.packaged-alias-'))
try {
	const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work, '--json'], { cwd: root, encoding: 'utf8' })) as [{ filename: string }]
	const tarball = join(work, packed[0].filename)
	for (const filename of ['consumer.ts', 'runtime.mjs', 'tsconfig.json', 'worker.ts', 'wrangler.toml']) {
		writeFileSync(join(work, filename), readFileSync(join(fixture, filename)))
	}
	writeFileSync(join(work, 'package.json'), JSON.stringify({
		private: true,
		type: 'module',
		dependencies: { '@whiskeysockets/baileys': `file:${tarball}` }
	}, null, 2))
	execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: 'inherit' })
	execFileSync(join(root, 'node_modules/.bin/tsc'), ['--project', join(work, 'tsconfig.json')], { cwd: work, stdio: 'inherit' })
	execFileSync(process.execPath, [join(work, 'runtime.mjs')], { cwd: work, stdio: 'inherit' })
	cpSync(join(work, 'node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge_bg.wasm'), join(work, 'bridge.wasm'))
	await runWorkerdSmoke(work)
} finally {
	rmSync(work, { recursive: true, force: true })
}

async function runWorkerdSmoke(cwd: string): Promise<void> {
	const probe = createServer()
	await new Promise<void>(listening => probe.listen(0, '127.0.0.1', listening))
	const port = (probe.address() as { port: number }).port
	await new Promise<void>(closed => probe.close(closed))
	const child = spawn('npx', ['--yes', 'wrangler@4.15.2', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)], {
		cwd,
		stdio: 'inherit',
		detached: true,
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
	})
	try {
		for (let attempt = 0; attempt < 90; attempt++) {
			if (child.exitCode !== null) throw new Error(`Wrangler exited with status ${child.exitCode}`)
			try {
				const response = await fetch(`http://127.0.0.1:${port}`)
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
