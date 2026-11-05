import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const bytes = readFileSync(
	fileURLToPath(
		new URL('../../../node_modules/@oxidezap/whatsapp-rust-bridge/dist/whatsapp_rust_bridge_bg.wasm', import.meta.url)
	)
)
console.log('bridge WASM validates:', WebAssembly.validate(bytes))
const module = new WebAssembly.Module(bytes)
console.log('bridge WASM exports:', WebAssembly.Module.exports(module).length)
