/** Node-facing socket message methods; preserves the historical deep-import default codec. */
import { encodeProtoCompat } from '../Compatibility/encode-proto.ts'
import { makeMessageMethodsCore, type EncodeProto } from './messages-core.ts'
import type { SocketContext } from './types.ts'

export const makeMessageMethods = (ctx: SocketContext, encode: EncodeProto = encodeProtoCompat) =>
	makeMessageMethodsCore(ctx, encode)
