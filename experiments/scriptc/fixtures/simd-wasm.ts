const bytes = Buffer.from('AGFzbQEAAAABBAFgAAADAgEACgkBBwBBAP0PGgs=', 'base64')
console.log(WebAssembly.validate(bytes))
const module = new WebAssembly.Module(bytes)
console.log(WebAssembly.Module.exports(module).length)
