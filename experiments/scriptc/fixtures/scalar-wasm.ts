// Scalar module exporting add(): i32 = 42. This is a compiler control only.
const bytes = Buffer.from('AGFzbQEAAAABBQFgAAF/AwIBAAcHAQNhZGQAAAoGAQQAQSoL', 'base64')
if (!WebAssembly.validate(bytes)) throw new Error('scalar WASM was not translated')
const module = new WebAssembly.Module(bytes)
if (WebAssembly.Module.exports(module).length !== 1) throw new Error('scalar WASM exports missing')
const instance = new WebAssembly.Instance(module)
const add = instance.exports.add as () => number
if (add() !== 42) throw new Error('scalar WASM execution failed')
console.log('SCALAR_WASM_OK result=42')
