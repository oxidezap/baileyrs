# Compatibility boundary

This directory contains code whose purpose is to translate a neutral
`whatsapp-rust-bridge` contract into the public Baileys API.

- `group-metadata.ts` and other protocol adapters own Baileys field names,
  optionality, aliases and defaults.
- `proto-runtime.ts` applies the generated, version-pinned protobuf object
  contract (`Long`, enums, defaults and constructors) around the neutral bridge
  codec. Its compact schema table is generated with the declaration facade;
  it is conversion metadata, not a second wire implementation.
- `public-api/` contains standalone constructors/helpers required by the
  upstream export surface. They may run before a socket exists and therefore
  cannot depend on the bridge client's internal state.
- `internal/` contains dependency-light implementation details used only by
  those compatibility facades.

Protocol parsing, Signal/session state, operational retry state, media
encryption/streaming and cache policy belong to `whatsapp-rust`. The bridge
may expose those capabilities through neutral operations and DTOs; it must not
know Baileys names. Socket code should orchestrate those operations and must
not maintain a second implementation or silently drop writes.

## Which reference wins

Two references meet at this boundary and they are not the same one:

- **The wire follows the client.** Field numbers, presence and encodability come
  from WhatsApp Web, extracted by [whatspec](https://github.com/oxidezap/whatspec)
  and carried through `whatsapp-rust` into the bridge. Where upstream Baileys still
  declares a field the client dropped — the six legacy `mediaKeyDomain` fields,
  `SyncActionValue.businessBroadcastAssociationAction`, `BotAvatarMetadata` —
  nothing here fabricates it, and `scripts/compatibility/proto-runtime-audit.ts`
  records it as a gap that closes upstream rather than a gap to close here.
- **The public surface follows Baileys.** Property names, optionality and object
  shapes stay a drop-in for consumers even where the bridge spells a field
  differently (`deviceId`, `faviconMmsMetadata`,
  `oldestMessageTimestampInWindow`). Those translations are `FIELD_ALIASES` in
  `proto-runtime.ts`, applied in both directions.

A disagreement that is only a name is this directory's job. A disagreement about
which field exists, or at which number, is the client's to settle — and a fix that
put a field the client does not read on the wire would trade a compatibility gap
for a protocol defect.

Stable historical imports under `src/Utils/` remain thin re-export files so a
source-compatible move does not break consumers.
