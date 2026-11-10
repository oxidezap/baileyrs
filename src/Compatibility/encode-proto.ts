/** Node-facing deep-import wrapper; preserves bridge auto-initialization. */
import { encodeProto } from '@oxidezap/whatsapp-rust-bridge'
import { encodeProtoCompat as encodeProtoCompatCore } from './encode-proto-core.ts'

export const encodeProtoCompat = (path: string, message: unknown): Uint8Array =>
	encodeProtoCompatCore(path, message, encodeProto)
