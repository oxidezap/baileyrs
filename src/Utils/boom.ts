/**
 * Use the same public error implementation as upstream Baileys. Besides
 * making `lastDisconnect.error` and `messages.media-update.error` exactly
 * assignable, this preserves the full Boom runtime contract (`reformat`,
 * `typeof`, mutable output headers and standard payload handling).
 */
export { Boom, boomify, isBoom } from '@hapi/boom'
export type { Options as BoomOptions, Output as BoomOutput, Payload as BoomPayload } from '@hapi/boom'
