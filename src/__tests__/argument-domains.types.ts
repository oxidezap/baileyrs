/**
 * The domains the socket checks against are public, and the checks read them
 * live. A consumer able to edit one could make a valid call start failing, or
 * an invalid one start passing, everywhere at once. They are readonly to say
 * so, and these assertions fail the build if that stops being true.
 */

import { MEDIA_TYPES, type MediaType } from '../Defaults/index.ts'
import { GROUP_SETTINGS, type GroupSetting } from '../Socket/groups.ts'
import { PARTICIPANT_ACTIONS } from '../Types/index.ts'

// @ts-expect-error the exported media domain is readonly
export const mutableMediaTypes: MediaType[] = MEDIA_TYPES

// @ts-expect-error the group-setting domain is readonly, and two methods read it
export const mutableGroupSettings: GroupSetting[] = GROUP_SETTINGS

// @ts-expect-error the domains declared `as const` are readonly already
export const mutableParticipantActions: string[] = PARTICIPANT_ACTIONS
