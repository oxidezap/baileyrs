// Reads attached server stdout privately; emits only fixed category names, booleans and counts.
import { StringDecoder } from 'node:string_decoder'
import { performance } from 'node:perf_hooks'
const decoder = new StringDecoder('utf8')
const start = performance.now()
process.stdout.write(JSON.stringify({ event: 'mock-filter-start', observedAtMs: Date.now() }) + '\n')
let pending = ''
let lines = 0
const patterns = [
	['mac', /bad\s*mac|mac\s+verification\s+failed|authentication failed/i],
	['decrypt', /decrypt(?:ion)?[^\n]{0,60}fail|fail[^\n]{0,60}decrypt/i],
	['missing-session', /no session|session not found/i],
	['missing-prekey', /unknown (?:signed )?prekey|prekey not found/i],
	['duplicate', /duplicate message|already (?:used|consumed)/i],
	['untrusted-identity', /untrusted identity/i],
	['invalid-signature', /invalid signature/i],
	['invalid-protobuf', /invalid protobuf encoding/i],
	['generic-coercion', /\[object (?:Uint8Array|ArrayBuffer|Object)\]/],
	['handler-error', /handler[^\n]{0,40}error|error[^\n]{0,40}handler/i]
]
const accept = line => {
	lines++
	const categories = patterns.filter(([, pattern]) => pattern.test(line)).map(([name]) => name)
	if (categories.length)
		process.stdout.write(
			JSON.stringify({
				event: 'mock-category',
				observedAtMs: Date.now(),
				elapsedMs: Math.round(performance.now() - start),
				categories,
				warning: /\bwarn\b/i.test(line),
				error: /\berror\b/i.test(line)
			}) + '\n'
		)
	else if (lines % 256 === 0) process.stdout.write(JSON.stringify({ event: 'mock-line-count', lines }) + '\n')
}
process.stdin.on('data', bytes => {
	pending += decoder.write(bytes)
	for (;;) {
		const end = pending.indexOf('\n')
		if (end < 0) break
		accept(pending.slice(0, end))
		pending = pending.slice(end + 1)
	}
	if (pending.length > 8192) {
		accept(pending.slice(0, 8192))
		pending = ''
	}
})
process.stdin.on('end', () => {
	if (pending) accept(pending)
	process.stdout.write(JSON.stringify({ event: 'mock-stream-end', lines }) + '\n')
})

process.once('SIGTERM', () => {
	process.stdout.write(JSON.stringify({ event: 'mock-filter-stop', lines, observedAtMs: Date.now() }) + '\n', () =>
		process.exit(0)
	)
})
