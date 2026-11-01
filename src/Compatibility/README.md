# Compatibility boundary

This directory translates neutral bridge operations into the public Baileys API.

- Protocol adapters own Baileys field names, optionality, aliases and defaults.
- `proto-runtime.ts` applies the pinned protobuf object contract, including
  `Long`, enums and constructors. Its generated schema table is conversion
  metadata, not a second wire codec.
- `public-api/` contains standalone helpers that must work before a socket exists.
- `internal/` contains dependency-light implementation details for those helpers.

Rust owns protocol parsing, Signal/session state, retries, media encryption and
streaming, and cache policy. The bridge exposes neutral operations without
Baileys names. Socket code orchestrates them without duplicating the engine or
silently dropping writes. Historical `src/Utils/` imports remain re-exports.

## References

Wire field numbers, presence and encodability follow WhatsApp Web, extracted by
[whatspec](https://github.com/oxidezap/whatspec) through the Rust core and bridge.
Do not fabricate fields the client dropped to match stale Baileys declarations.
The [proto audit](../../scripts/compatibility/proto-runtime-audit.ts) records
those gaps, including legacy `mediaKeyDomain`,
`SyncActionValue.businessBroadcastAssociationAction` and `BotAvatarMetadata`.

Public property names, optionality and object shapes follow Baileys.
`FIELD_ALIASES` in `proto-runtime.ts` translates spelling differences in both
directions. Resolve naming differences here; resolve field existence and wire
numbers against the client.
