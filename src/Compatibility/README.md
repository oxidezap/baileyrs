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

Stable historical imports under `src/Utils/` remain thin re-export files so a
source-compatible move does not break consumers.
