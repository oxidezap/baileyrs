/**
 * Runtime codec implementation. The production build replaces this module's
 * emitted declaration with the version-pinned type-only WAProto facade. The
 * compatibility layer below translates constructor/object semantics while the
 * bridge remains the single protobuf codec shipped by this package.
 */
import { proto as bridgeProto } from 'whatsapp-rust-bridge/proto-types'
import { createProtoCompatibilityFacade } from '../Compatibility/proto-runtime.ts'

const facade = createProtoCompatibilityFacade(bridgeProto)

// Re-exporting the original namespace alias preserves its generated type
// namespace for internal `proto.IMessage` references. The facade already
// captured every neutral codec before these top-level values are replaced.
//
// Descriptors, not values: the facade's entries are lazy getters, and
// Object.assign would read — and therefore build — every one of them.
Object.defineProperties(bridgeProto, Object.getOwnPropertyDescriptors(facade.proto))

export { bridgeProto as proto }

/** Internal audit signal; intentionally absent from the public package root. */
export const unsupportedProtoCodecs = facade.unsupportedCodecs
