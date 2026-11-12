# baileyrs

[![npm version](https://img.shields.io/npm/v/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![npm downloads](https://img.shields.io/npm/dm/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/oxidezap/baileyrs)
[![pkg.pr.new](https://pkg.pr.new/badge/oxidezap/baileyrs)](https://pkg.pr.new/~/oxidezap/baileyrs)
[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/oxidezap/baileyrs?utm_source=badge)

A WhatsApp Web library for JavaScript with a Baileys-compatible API, backed by
[whatsapp-rust](https://github.com/oxidezap/whatsapp-rust) through the
[@oxidezap/whatsapp-rust-bridge](https://www.npmjs.com/package/@oxidezap/whatsapp-rust-bridge) WASM package.

See [ATTRIBUTION.md](ATTRIBUTION.md) for upstream attribution.

[Guides and API overview](https://deepwiki.com/oxidezap/baileyrs) ·
[Examples](Example) · [Changelog](CHANGELOG.md) · [Contributing](AGENTS.md)

## Installation

Requires Node.js 22.3 or newer for the Node API.

```sh
npm install @oxidezap/baileyrs
```

To keep existing Baileys imports, install an alias instead:

```sh
npm install @whiskeysockets/baileys@npm:@oxidezap/baileyrs
```

The API targets [Baileys 7.0.0-rc14](https://github.com/WhiskeySockets/Baileys).
Compatibility has known gaps; see [migration notes](#migrating-from-upstream-baileys)
and the [compatibility audits](scripts/compatibility).

## Quick start

This example prints a pairing code for a new session and logs incoming messages.
Save it as `bot.mjs`. Set `PHONE_NUMBER` to your number with country
code, digits only, and enter the code in WhatsApp's linked-devices screen.

```sh
PHONE_NUMBER=1234567890 node bot.mjs
```

```js
import makeWASocket, { useMultiFileAuthState } from '@oxidezap/baileyrs'

const { state } = await useMultiFileAuthState('auth_info')
const phoneNumber = process.env.PHONE_NUMBER
if (!state.creds.registered && !phoneNumber) throw new Error('Set PHONE_NUMBER to pair')
const sock = makeWASocket({ auth: state })
let pairingRequested = false

sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
    if (qr && phoneNumber && !state.creds.registered && !pairingRequested) {
        pairingRequested = true
        sock.requestPairingCode(phoneNumber)
            .then(code => console.log('Pairing code:', code))
            .catch(error => {
                pairingRequested = false
                console.error('Pairing failed:', error)
            })
    }
    if (connection === 'open') console.log('Connected')
    if (connection === 'close') console.error('Socket closed:', lastDisconnect?.error)
})

sock.ev.on('messages.upsert', ({ messages }) => {
    for (const message of messages) console.log('Received:', message.key.id)
})
```

Native auth persists automatically. Keep `auth_info` private and reuse it on
restart. The example stops on terminal closure; [Example/example.ts](Example/example.ts)
includes QR authentication, sending messages and a reconnect policy.

When QR refs expire while a pair code is still outstanding, the socket stays
open if the engine keeps that pairing flow alive. No `connection.update` is
emitted for that QR expiry. QR-only exhaustion still closes with a 408 timeout;
bridges that omit the disconnection flag retain that behavior.

### Host-neutral entrypoint

For Workers, Deno and browser-like hosts, initialize WASM before creating a socket:

```ts
import makeWASocket, { createAuthenticationState, useMemoryStore } from '@oxidezap/baileyrs/host'
import wasm from '@oxidezap/baileyrs/wasm'
import { initSync } from '@oxidezap/whatsapp-rust-bridge/host'

initSync({ module: wasm })
const store = useMemoryStore()
const auth = await createAuthenticationState(store)
const sock = makeWASocket({ auth })
```

Memory storage is temporary. For persistent sessions, supply a byte-preserving
`JsStoreCallbacks` store and reuse it on restart. Do not reset or truncate an
existing device record, including its registration ID, after a failed read.
This entrypoint uses no filesystem auth or Node streams.

Standalone AES-backed media retry helpers require `initWasmEngine()` before use
if no socket has initialized the engine, after `initSync()` on hosts. With a
custom runtime, pass `makeMediaCryptoRuntime(runtime)` as the final argument to
`getMediaKeys`, `encryptMediaRetryRequest` and `decryptMediaRetryData`.

### Optional dependencies

Runtime dependencies are the bridge, `long`, `events` and `fs-native-extensions`.
All peer dependencies are optional:

- `@hapi/boom` and `pino` replace the built-in compatible error and JSON logger implementations. Install them for shared error identity or Pino transports.
- `sharp`, `jimp`, `audio-decode`, `link-preview-js` and `music-metadata` support media processing. Without `music-metadata`, audio sends without computed duration.

### Preview builds

[Available previews](https://pkg.pr.new/~/oxidezap/baileyrs) include installation
URLs for PRs and commits. They are unreleased code with version
`0.0.0-preview-<sha>`; pin them explicitly for testing and use npm releases in production.

## Migrating from upstream Baileys

Custom upstream `{ creds, keys }` auth states require `keys.bridgeTransaction`
with backend-wide isolation and durable atomic commits. Adapter-local upstream
transactions do not meet this contract. Compatible states are wrapped automatically;
keep persisting `creds.update` with your loader's `saveCreds`.

For an existing upstream JSON directory, use `useLegacyMultiFileAuthState`.
`useMultiFileAuthState` uses native binary storage and does not import upstream JSON.

Stop every old auth writer and back up the entire directory, including hidden
files and archives, before the first migration:

```ts
import makeWASocket, { useLegacyMultiFileAuthState } from '@oxidezap/baileyrs'

const { state, saveCreds } = await useLegacyMultiFileAuthState('auth_info', { migrate: true })
const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)
```

The transactional snapshot becomes authoritative; retained per-key files are
backups. Existing native stores also require `{ migrate: true }` for their first
transactional-storage upgrade. Subsequent opens can omit it.

Before reverting storage formats, stop all writers, back up the directory and
successfully run `prepareLegacyAuthRollback(folder, { offline: true })` for JSON
or `prepareNativeAuthRollback(folder, { offline: true })` for native storage.
Do not reopen stale files after a rejected export. Sessions imported with pending
out-of-order gaps can become native-only and need a new Signal handshake after
rollback. Engines older than 0.2.8 cannot read newer seed-only skipped-key records;
do not delete native-only session rows to force a downgrade.

### Connection lifecycle

Transient drops are retried by Rust and report `connecting`. A terminal `close`
is emitted once after resource cleanup; create a replacement socket only then
and register its handlers again.

| Terminal status | Action |
| --- | --- |
| `DisconnectReason.loggedOut` / 401 | Stop and pair again. |
| 405 | Stop and update the rejected build. |
| `DisconnectReason.forbidden` / 403 | Respect `lastDisconnect.error.data.expire`, in Unix seconds. |
| 500 during startup | Inspect `lastDisconnect.error.cause` for storage or setup errors before retrying. |
| Other | Reconnect after a delay. |

`connecting` can last tens of minutes during rate-limit backoff. Do not use it to
start another socket or restart the process. Alert rather than kill on a liveness
timeout. Calls made during reconnect wait for the connection; racing a call
against a deadline does not cancel it. Retrying sends can duplicate messages
unless you retain the same `messageId`. Application traffic pacing is your responsibility.

### Compatibility notes

- History contacts arrive through `messaging-history.set`, not `contacts.upsert`.
- `shouldSyncHistoryMessage` receives pre-download metadata only: `syncType`, `chunkOrder`, `progress`, `fileLength` as `Long`, and `peerDataRequestSessionId`. Returning `false` permanently acknowledges the chunk. It does not gate the initial-sync state machine.
- Engine-owned options such as `getMessage` and `cachedGroupMetadata` are accepted but do not override engine behavior. Socket construction warns about ignored options; see the [option catalog](src/Socket/unsupported-config.ts).
- Undecryptable-message stubs may carry `stanzaType` independently of `messageStubParameters`.
- Duplicate delivery suppression is temporary and in memory. For durable side effects, deduplicate with the full key: `remoteJid`, `id`, `fromMe` and `participant`.
- The `proto` facade uses Baileys field names and translates bridge aliases in both directions without mutating inputs. See [compatibility rules](src/Compatibility/README.md).
- Group and community listings fetch full metadata per entry and reject on failed fetches before emitting `groups.update`.
- `reachoutTimeLock` reports server state without imposing send policy. Unknown enforcement names are preserved; an absent `isActive` is unknown.
- Newsletter `mute_state` controls channel-update notifications, independently of follower-activity notifications. History may omit `messageId`; `serverId` and large counters are strings. Packed live events do not carry the newsletter server ID.
- Community creation can succeed before configuration fails. Preserve `createdJid`, `step`, `kind` and `cause` from the error and resume configuration on that JID.
- Status privacy emits `settings.update`; unarchive settings emit `creds.update`. Historical calls, favorite chats and sticker-list updates have no matching event in the targeted Baileys API.

### Bridge state in your key store

Wrapped upstream stores also contain `bridge-` engine records, including records
created before pairing. Determine pairing from `creds.registered` and `creds.me?.id`,
not the number of stored keys.

Use `isBridgeInternalKeyType` or `BRIDGE_INTERNAL_KEY_TYPES` for upstream-shaped
views. Full backups and moves between baileyrs stores must retain every `bridge-`
row, including native-only sessions and records without a Baileys projection.
This filtering concern does not apply to `useMultiFileAuthState`, whose `keys`
is already a projection over native storage.

## Development

See [AGENTS.md](AGENTS.md) for build, test, E2E and contribution instructions, and
the [fuzzing guide](src/__fuzz__/README.md) for differential testing. The strict
declaration audit has known gaps and is not currently a green gate.

Micro-benchmarks for hot paths (JID helpers, proto codec, message content helpers,
bridge event adaptation, BufferJSON) live in [bench](bench) and run with
`npm run bench`. CI tracks them with [CodSpeed](https://app.codspeed.io/oxidezap/baileyrs).

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected to
WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owners.
baileyrs is an unofficial, community-driven library provided for educational and
interoperability purposes.

Use at your own risk. The authors are not responsible for any misuse, account bans, or
violations of WhatsApp's Terms of Service that may result from the use of this software.

## License

MIT — see [LICENSE](LICENSE).

## Performance benchmarks

CodSpeed tracks CPU simulation and memory using Vitest, with local codec/store
benchmarks and real socket workloads against the private Bartender mock. See the
[benchmark guide](benchmarks/README.md) for scenarios, warmup, commands and memory
interpretation.
