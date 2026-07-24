import { rmSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'lib')

if (dirname(target) !== root || basename(target) !== 'lib') {
	throw new Error(`Refusing to clean unexpected build target: ${target}`)
}

rmSync(target, { recursive: true, force: true })
