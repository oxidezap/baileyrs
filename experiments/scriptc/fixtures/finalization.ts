// wasm-bindgen's closure ownership uses this API in the real bridge glue.
const registry = new FinalizationRegistry<number>(value => console.log(value))
registry.register({}, 1)
