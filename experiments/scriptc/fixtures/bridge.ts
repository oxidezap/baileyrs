// Real package import, including eager WASM initialization. No socket or account.
import { sha256 } from '@oxidezap/whatsapp-rust-bridge'
console.log(Buffer.from(sha256(new Uint8Array([97, 98, 99]))).toString('hex'))
