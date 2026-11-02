# baileyrs

[![npm version](https://img.shields.io/npm/v/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![npm downloads](https://img.shields.io/npm/dm/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/oxidezap/baileyrs)
[![pkg.pr.new](https://pkg.pr.new/badge/oxidezap/baileyrs)](https://pkg.pr.new/~/oxidezap/baileyrs)

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

## Calls

Node sockets load their own VoIP engine and secure relay transport. Applications
use the call API without creating a relay provider or running a relay server:

```ts
const call = await sock.voip.call(peerJid)
const playback = call.audio.receive().pipeTo(speaker)
await call.ready
try {
  await call.audio.play(microphone, { signal: captureSignal })
} catch (error) {
  if (!captureSignal.aborted) throw error
}
// EOF or cancellation stops this source; the call can play another source.
await call.audio.play(recording)
await call.end()
await playback
```

Inputs are `ReadableStream<Int16Array>` of mono samples at 16 kHz. Chunk sizes
may vary up to 65,536 samples; framing into 960-sample packets and pacing happen
inside the library. The final partial frame is padded with silence. Samples must
remain stable after enqueueing. An optional `{ sampleRate: 16000, channels: 1 }`
format is checked explicitly; other formats require conversion by the caller.
There is no implicit resampling. Aligned chunks use views where possible; the
WASM boundary still copies samples.

Calling `audio.play()` directly replaces the previous input and rejects on a source error or cancellation
without ending the call. `audio.stop()` cancels the current source. `ready` waits
for peer acceptance and relay allocation, so a file is not consumed while ringing.
Each `audio.receive()` has an independent queue limited to 960 samples and at most
eight receivers can attach. A slow receiver drops new frames; its `onDrop` callback
reports the cumulative count. Cancellation detaches only that receiver. Closing a
call lets queued output drain; await the `pipeTo` promise to finish playback or
recording. Producers must also respect their own stream backpressure.

The existing `media: () => ({ audio: { input: microphone, output: speaker } })`
option remains useful for call-owned device lifecycles. Supply a factory that
creates fresh streams for each call. It runs after native call
admission, which can precede the peer answering. Its abort signal also covers
socket shutdown and media errors; these factory-owned stream errors end the call.
`dispose` can release resources outside the
streams; cleanup has a one-second grace period and reports stalled disposers.

Accept a ringing offer with `sock.voip.accept(offer, options)`. Repeated acceptance
returns the same managed session. `sock.voip.active` lists active sessions;
`closed` reports local/remote termination, cancellation, socket closure or a media
error. An incomplete `end()` can be retried to finish notifying the peer.

The `media` factory may return a `video(call, signal)` factory providing H.264 Annex-B input and
`CallVideoFrame` output streams. It runs for initial video or after an explicit
`call.video.start()` / `accept()` / `resume()`, and is disposed on stop. Return a
`requestKeyframe` callback to produce an IDR when the backend asks for one.
`call.video.requestKeyframe()` asks the remote encoder instead. The ffmpeg
adapter restarts its encoder to produce fresh SPS/PPS and an IDR, coalescing
restart requests within 500 ms.

The existing `dialCallPcm`, `acceptCallPcm`, encoded audio, synchronous writers,
mute, statistics and video methods remain available for applications that own
their media lifecycle. Use `sock.rejectCall(id, from)` for a ringing call.
`call` events preserve routing context, platform, video and group attributes;
`call.media` carries media lifecycle, keyframe feedback and diagnostics.

For microphone/file input and playback, install ffmpeg and ffplay. The example
commands below require Node 24+ for direct TypeScript execution; the installed
library still supports Node 22.3+. Then run:

```sh
npm run build
node Example/call.ts dial <peer-jid> --mic
node Example/call.ts listen --accept --mic
node Example/call.ts dial <peer-jid> --audio-file audio.wav
# Optional video source: camera, testsrc, file, or URL
node Example/call.ts dial <peer-jid> --mic --video testsrc
```

The CLI handles call orchestration; `Example/call-media.ts` handles ffmpeg processes,
PCM framing and H.264 access units. Finite PCM recordings pad the final
sample-aligned frame with silence; an incomplete sample is rejected. H.264
framing requires AUD delimiters, inserted by the ffmpeg adapter. NAL start codes
alone do not identify complete pictures and are not treated as frame boundaries.
PCM decoding, codecs, encryption, timing and
relay negotiation stay in the engine. In this CLI, a remote video offer never enables the
local camera without an explicit video option or keyboard action. In the public API,
`voip.accept(offer)` inherits `offer.isVideo` and may invoke the supplied video
factory; pass `video: false` to answer without initial video.

The relay is WhatsApp media infrastructure. The Node provider opens an outbound
ICE/DTLS/SCTP DataChannel to that endpoint using the bridge's DTLS fingerprint;
it does not host another server. The secure provider is loaded on the first media
connection. `sock.setRelayTransportProvider(provider)` remains available for custom
hosts and tests. Browser hosts use the bridge's RTCPeerConnection provider; custom
hosts can supply `createCallRelayProvider` and an isolated `loadVoip` engine.

For the local Bartender mock only, add
`--socket wss://127.0.0.1:8080/ws/chat --mock-udp --danger-skip-cert-verify`.
The CLI permits a TLS verification bypass only with a loopback mock socket.
Cleartext UDP requires an explicit `--mock-udp` and a loopback socket URL. Changing
the signaling URL or TLS verification never changes the production media transport.

### Calling through upstream Baileys

The optional `@oxidezap/baileyrs/voip` entrypoint attaches the same managed
session API to an already connected upstream socket. It uses that socket's
connection, Signal repository and authoritative storage. It does not create a
second WhatsApp client or copy its sessions.
The adapter is checked against upstream Baileys `7.0.0-rc14` and uses its
public repository APIs, including `getSessionInfo` to skip unavailable device
sessions without hiding storage failures. All supported devices remain in the
ring list.

```ts
import { encodeSignedDeviceIdentity } from 'baileys'
import { createBaileysVoip } from '@oxidezap/baileyrs/voip'

const voip = await createBaileysVoip(sock, {
  encodeDeviceIdentity: encodeSignedDeviceIdentity,
  reportError: (error, operation) => logger.error({ error }, operation)
})
const call = await voip.call(peerJid)
const playback = call.audio.receive().pipeTo(speaker)
await call.ready
await call.audio.play(firstPcmSource)
await call.audio.play(secondPcmSource)
await call.end()
await playback
await voip.disconnect() // Leaves the upstream socket open.
```

Incoming offers still arrive through upstream's `sock.ev.on('call', ...)`.
Pass an offer to `voip.accept(offer)`. The adapter waits for its raw signaling
processing before accepting it. It does not emit duplicate events into the
upstream socket. Recreate the integration after reconnecting that socket;
connection closure disposes this integration and its pending operations.

The initial upstream integration supports 1:1 PCM audio. Video and group control
reject explicitly. Automatic first-contact PN/LID learning or session migration
also rejects when it would require overwriting upstream state; already trusted
mappings are reused. The current upstream mutation API does not provide the
conflict and ratchet protections needed to implement that migration here.
Existing privacy tokens are read from upstream storage and checked for expiry
by the shared Rust control. Automatic token issuance is unavailable through this
adapter: upstream exposes the IQ sender but keeps issuance deduplication,
routing and persistence private. The adapter does not maintain a second token
lifecycle or call that low-level sender without those protections.

Generic stanza ACKs remain owned by upstream. The shared Rust control sends the
existing native offer receipt. This preserves the native calling baseline;
complete fidelity to WhatsApp Web's receipt-bearing accept/reject/rekey paths
and advanced typed ACKs still needs separate qualification and an upstream
dispatch capability. Synthetic tests do not establish live interoperability.

The default loader uses the packaged engine and outbound relay transport.
Hosts that load their own WASM supply `runtime` and `createRelayProvider` through
the same initializer. Device capture, playback and resampling remain application
code, using the same Web Streams and lifecycle rules described above.

The bridge currently reports peer video rejection (`WasmCallHandle.rejectVideo`)
as unsupported until the core exposes a token-safe operation; it does not stop
local video as a substitute. This does not expand the upstream adapter beyond
its documented 1:1 PCM scope.

This branch pins consolidated bridge #115 preview `c55a546`, built from integrated
core #1830 at `3357b5f3` with native media and shared host control. Registry `0.26.4` does
not contain these VoIP capabilities. Replace the preview with a verified registry
release containing them before releasing this package.
The pinned backend supports PCM and encoded audio plus H.264 video. Integration
checks use synthetic media and a local mock. No authenticated calls, hardware
capture or production NAT traversal were validated for this change.

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

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected to
WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owners.
baileyrs is an unofficial, community-driven library provided for educational and
interoperability purposes.

Use at your own risk. The authors are not responsible for any misuse, account bans, or
violations of WhatsApp's Terms of Service that may result from the use of this software.

## License

MIT — see [LICENSE](LICENSE).
