# baileyrs

[![npm version](https://img.shields.io/npm/v/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![npm downloads](https://img.shields.io/npm/dm/@oxidezap/baileyrs?color=cb3837&logo=npm)](https://www.npmjs.com/package/@oxidezap/baileyrs)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/oxidezap/baileyrs)

A Rust-powered WhatsApp Web library for JavaScript, with a Baileys-compatible API.

## How it works

baileyrs is a thin JavaScript wrapper over [whatsapp-rust](https://github.com/oxidezap/whatsapp-rust)
compiled to WebAssembly. The heavy lifting — Signal protocol, Noise handshake, media
encryption, binary-node (de)serialization, protobuf codec — runs in Rust/WASM via the
[whatsapp-rust-bridge](https://www.npmjs.com/package/whatsapp-rust-bridge) package.

The public surface intentionally mirrors [Baileys](https://github.com/WhiskeySockets/Baileys)
so existing integrations can migrate with minimal changes. See
[ATTRIBUTION.md](ATTRIBUTION.md) for details.

### vs. Baileys

| Area | Original Baileys | baileyrs |
|---|---|---|
| Signal Protocol | JS (libsignal) | Rust/WASM |
| Media encrypt/decrypt | Node.js crypto | Rust AES-256-CBC + HMAC |
| Media upload/download | JS fetch + temp files | Rust with CDN failover, auth refresh, resumable upload |
| Key management | JS auth state | Rust `PersistenceManager` |
| Auto-reconnect | Manual `startSock()` loop | Built-in with fibonacci backoff |

## Installation

### New project

```sh
npm install @oxidezap/baileyrs
```

```ts
import makeWASocket from '@oxidezap/baileyrs'
```

### Drop-in replacement for upstream Baileys

baileyrs is API-compatible with [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).
Existing projects switch over by aliasing the package — **no source changes needed**:

```sh
npm install @whiskeysockets/baileys@npm:@oxidezap/baileyrs
```

That writes the alias to your `package.json`:

```jsonc
{
  "dependencies": {
    "@whiskeysockets/baileys": "npm:@oxidezap/baileyrs@^0.0.8"
  }
}
```

Every `import { makeWASocket } from '@whiskeysockets/baileys'` in your codebase
now resolves to baileyrs. Auth state, event listeners, and message APIs work
unchanged — see [Migrating from Upstream Baileys](#migrating-from-upstream-baileys)
for what happens behind the scenes and the (very small) surface where behavior
differs.

## Quick Start

```ts
import makeWASocket, { Boom, DisconnectReason, useMultiFileAuthState } from '@oxidezap/baileyrs'

const { state } = await useMultiFileAuthState('auth_info')
const sock = makeWASocket({ auth: state })

sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        if (statusCode === DisconnectReason.loggedOut) {
            console.log('Logged out')
        }
        // Auto-reconnect is handled by the Rust engine — no need to call makeWASocket again
    }
    if (connection === 'open') {
        console.log('Connected')
    }
})

sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
        console.log('received message', msg.key.id)
    }
})
```

## Error Handling

baileyrs ships its own `Boom` error class, API-compatible with
[`@hapi/boom`](https://github.com/hapijs/boom) — no extra dependency needed.
Methods that fail (including `sendMessage`, media uploads, and connection errors)
throw a `Boom` with a `statusCode` aligned to WhatsApp disconnect reasons.

```ts
import { Boom } from '@oxidezap/baileyrs'

try {
    await sock.sendMessage(jid, { text: 'hi' })
} catch (err) {
    if (Boom.isBoom(err)) {
        console.log(err.statusCode)          // fast path
        console.log(err.output.statusCode)   // @hapi/boom-compatible
        console.log(err.data)                // optional user payload
    }
}
```

If you have existing code importing `Boom` from `@hapi/boom`, the
`(err as Boom)?.output?.statusCode` pattern continues to work via structural
typing — only the underlying dependency changed.

## Connecting

### QR Code

```ts
const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('My App')
})
```

A QR code will be emitted via `connection.update` events. Scan it with your phone.

### Pairing Code

```ts
const sock = makeWASocket({ auth: state })

if (!sock.isLoggedIn) {
    const code = await sock.requestPairingCode('5511999999999')
    console.log('Pairing code:', code)
}
```

## Auth State

All state — crypto keys, Signal sessions, device identity, and push name — is managed and persisted by the Rust bridge. No `creds.json`, no `saveCreds` callback.

```ts
import { useMultiFileAuthState } from '@oxidezap/baileyrs'

const { state } = await useMultiFileAuthState('auth_folder')
const sock = makeWASocket({ auth: state })
```

Files created in `auth_folder/`:
- `device-*.bin` — Rust device state (noise keys, identity, push name, etc.)
- `session-*.bin` — Signal sessions
- `identity-*.bin` — Signal identity keys
- `pre-key-*.bin` — Signal pre-keys
- `sender-key-*.bin` — Group sender keys

### Custom Store (Native)

For new deployments, implement `JsStoreCallbacks` directly — a flat binary key-value store. The Rust bridge handles all serialization internally.

```ts
import makeWASocket from '@oxidezap/baileyrs'

const store = {
  async get(store: string, key: string): Promise<Uint8Array | null> {
    // read from your DB: SELECT value FROM wa_store WHERE store=? AND key=?
  },
  async set(store: string, key: string, value: Uint8Array): Promise<void> {
    // upsert to your DB: INSERT ... ON DUPLICATE KEY UPDATE
  },
  async delete(store: string, key: string): Promise<void> {
    // delete from your DB: DELETE FROM wa_store WHERE store=? AND key=?
  },
  async flush(): Promise<void> { /* flush pending writes if you batch */ }
}

const sock = makeWASocket({ auth: { store } })
```

No creds management, no type routing — just `(store, key) → bytes`. Works with any backend (MySQL, Redis, S3, etc.).

### Migrating from Upstream Baileys

baileyrs accepts the upstream `auth: { creds, keys }` shape directly — the
internal `wrapLegacyStore` adapter runs automatically when it sees that
shape, so the **`makeWASocket(...)` call site needs zero changes**:

```ts
// makeWASocket() works as-is once the npm alias is in place.
// Auto-wrap kicks in when it sees {creds, keys}.
const sock = makeWASocket({ auth: state })

sock.ev.on('creds.update', saveCreds)  // still fires — adapter re-emits
```

The one switch you do make is **how you load `state`**. baileyrs's
`useMultiFileAuthState` is a *new-state-only* helper: it provisions a
binary `.bin` store for the Rust engine and ignores any pre-existing
upstream JSON. To carry an existing pairing across the migration, swap
the import to `useLegacyMultiFileAuthState` (one line):

```diff
- import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys'
+ import makeWASocket, { useLegacyMultiFileAuthState as useMultiFileAuthState } from '@whiskeysockets/baileys'

  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const sock = makeWASocket({ auth: state })
  sock.ev.on('creds.update', saveCreds)
```

Same approach works for any custom upstream auth (`useMySQLAuthState`,
`useRedisAuthState`, mysql-baileys, etc.) — your loader keeps returning
`{creds, keys, saveCreds}`, baileyrs auto-wraps it on the way in.

#### Existing sessions migrate without re-pairing

`useLegacyMultiFileAuthState` reads the existing `creds.json` +
`pre-key-*.json` / `session-*.json` files from the same folder upstream
Baileys was using and hands them to the Rust engine. Pair-ID, identity,
signed pre-keys, and Signal sessions are all preserved. No QR re-scan,
no logged-out events.

> **Where the new state goes**: baileyrs continues to write the legacy
> JSON files (via `saveCreds`) so the folder stays compatible with both
> sides during a rollback window. The Rust engine treats the JSON as the
> source of truth as long as you keep using `useLegacyMultiFileAuthState`.
> If you later want to drop the JSON layer, switch to
> `useMultiFileAuthState` — but that path requires a fresh QR.

#### Gotchas

A few behaviors that differ from upstream — almost always to your advantage:

- **Auto-reconnect is built in.** Don't call `makeWASocket()` again from
  `connection.update`'s `'close'` branch. The Rust engine retries with
  fibonacci backoff; opening a second socket leaks the first one.
- **No `getMessage` / `cachedGroupMetadata` polyfill required.** The Rust
  side caches group metadata and message keys natively. You can still pass
  them — they're respected as overrides — but they're optional.
- **`Boom` ships in the box.** baileyrs exports its own
  `@hapi/boom`-compatible `Boom` (see [Error Handling](#error-handling))
  so the existing `(err as Boom).output.statusCode` pattern works
  unchanged. If your `package.json` was pulling `@hapi/boom` only for
  baileys, you can drop the dependency.

#### Manual `wrapLegacyStore` (advanced)

If you want explicit control over when the adapter runs (testing, custom
shapes, mixed storage), call it yourself:

```ts
import makeWASocket, { useLegacyMultiFileAuthState, wrapLegacyStore } from '@oxidezap/baileyrs'

const { state, saveCreds } = await useLegacyMultiFileAuthState('/path/to/baileys_auth_info')
const store = await wrapLegacyStore(state, saveCreds)
const sock = makeWASocket({ auth: { store } })
```

## Sending Messages

```ts
// Text
await sock.sendMessage(jid, { text: 'Hello!' })

// Quote
await sock.sendMessage(jid, { text: 'Reply' }, { quoted: msg })

// Mention
await sock.sendMessage(jid, {
    text: '@12345678901',
    mentions: ['12345678901@s.whatsapp.net']
})

// Forward
await sock.sendMessage(jid, { forward: msg })

// Location
await sock.sendMessage(jid, {
    location: { degreesLatitude: 24.12, degreesLongitude: 55.11 }
})

// Contact
await sock.sendMessage(jid, {
    contacts: {
        displayName: 'Jeff',
        contacts: [{ vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Jeff\nEND:VCARD' }]
    }
})

// Reaction
await sock.sendMessage(jid, { react: { text: '💖', key: msg.key } })

// Poll
await sock.sendMessage(jid, {
    poll: { name: 'My Poll', values: ['Yes', 'No'], selectableCount: 1 }
})

// Delete (for everyone)
await sock.sendMessage(jid, { delete: msg.key })

// Edit
await sock.sendMessage(jid, { text: 'updated text', edit: msg.key })

// Disappearing messages
await sock.sendMessage(jid, { disappearingMessagesInChat: 604800 }) // 7 days
```

### Media Messages

Media encryption, upload, and CDN failover are handled entirely by the Rust bridge.

```ts
// Image
await sock.sendMessage(jid, { image: readFileSync('photo.jpg'), caption: 'Hello' })

// Video
await sock.sendMessage(jid, { video: { url: './clip.mp4' }, caption: 'Watch this' })

// Audio
await sock.sendMessage(jid, { audio: { url: './audio.ogg' }, mimetype: 'audio/ogg; codecs=opus' })

// Document
await sock.sendMessage(jid, {
    document: { url: './file.pdf' },
    mimetype: 'application/pdf',
    fileName: 'report.pdf'
})

// View once
await sock.sendMessage(jid, { image: { url: './photo.jpg' }, viewOnce: true })

// GIF (mp4 with gifPlayback)
await sock.sendMessage(jid, { video: readFileSync('anim.mp4'), gifPlayback: true })
```

> Thumbnails are auto-generated for images (requires `jimp` or `sharp`). Video thumbnails need `ffmpeg` on your system, or provide `jpegThumbnail` directly.

#### Streaming Upload (Large Files)

For files that are too large to buffer in memory, pass a `processMedia` hook to `sendMessage`:

```ts
await sock.sendMessage(jid, { video: readFileSync('large-video.mp4') }, {
    processMedia: async (buffer, mediaType, waClient) => {
        const { Writable } = await import('node:stream')
        const fs = await import('node:fs')
        const os = await import('node:os')
        const path = await import('node:path')

        const tmpEnc = path.join(os.tmpdir(), `enc-${Date.now()}`)

        // Streaming encrypt → temp file (constant ~40KB memory)
        const input = new Blob([new Uint8Array(buffer)]).stream()
        const output = Writable.toWeb(fs.createWriteStream(tmpEnc))
        const enc = await waClient.encryptMediaStream(input, output, mediaType)

        // Upload from temp file
        const encData = await fs.promises.readFile(tmpEnc)
        await fs.promises.unlink(tmpEnc)

        const upload = await waClient.uploadEncryptedMediaStream(
            () => new Blob([new Uint8Array(encData)]).stream(),
            enc.mediaKey, enc.fileSha256, enc.fileEncSha256, enc.fileLength, mediaType
        )

        return { upload: { ...upload, ...enc } }
    }
})
```

### Downloading Media

The recommended way to download media is via the socket method — it handles CDN failover, auth refresh, HMAC verification, and media re-upload automatically:

```ts
// Buffer (recommended)
const buffer = await sock.downloadMedia(msg, 'buffer')
await writeFile('photo.jpg', buffer)

// Stream
const stream = await sock.downloadMedia(msg, 'stream')
for await (const chunk of stream) {
    // process chunk — only ~64KB in memory at a time
}
```

<details>
<summary>Advanced: standalone utility (for use without a socket)</summary>

If you need to download media outside of a socket context (e.g., custom logger or reupload logic), use the standalone `downloadMediaMessage` utility:

```ts
import { downloadMediaMessage } from '@oxidezap/baileyrs'

const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
    logger: sock.logger,
    reuploadRequest: m => sock.updateMediaMessage(m),
    waClient: sock.waClient!
})
```

</details>

### Re-upload Expired Media
```ts
await sock.updateMediaMessage(msg)
```

## Read Receipts

```ts
await sock.readMessages([{ remoteJid: msg.key.remoteJid!, id: msg.key.id! }])
```

## Presence

```ts
// Online/offline
await sock.sendPresenceUpdate('available')
await sock.sendPresenceUpdate('unavailable')

// Subscribe to a contact's presence
await sock.presenceSubscribe(jid)

// Typing indicator
await sock.sendChatState(jid, 'composing')
await sock.sendChatState(jid, 'paused')
```

## Chat Actions

```ts
await sock.pinChat(jid, true)
await sock.muteChat(jid, 8 * 60 * 60 * 1000) // mute 8h
await sock.muteChat(jid, null)                 // unmute
await sock.archiveChat(jid, true)
await sock.starMessage(jid, msgId, true)
```

## Reject Calls

```ts
await sock.rejectCall(callId, callFrom)
```

## User Queries

```ts
// Check if on WhatsApp
const [result] = await sock.onWhatsApp('+1234567890')
if (result.exists) console.log('JID:', result.jid)

// Fetch status
const status = await sock.fetchStatus(jid)

// Profile picture
const url = await sock.profilePictureUrl(jid, 'image')

// Business profile
const profile = await sock.getBusinessProfile(jid)

// On-demand history (messages arrive via messaging-history.set event)
await sock.fetchMessageHistory(50, oldestMsg.key, oldestMsg.messageTimestamp)
```

## Profile

```ts
await sock.setPushName('My Name')
await sock.updateProfileStatus('Hello World!')
await sock.updateProfilePicture(jid, imageBytes)
await sock.removeProfilePicture()
```

## Groups

```ts
// Create
const group = await sock.groupCreate('Group Name', ['1234@s.whatsapp.net'])

// Participants
await sock.groupParticipantsUpdate(jid, ['1234@s.whatsapp.net'], 'add')    // or 'remove', 'promote', 'demote'

// Metadata
const metadata = await sock.groupMetadata(jid)
const all = await sock.groupFetchAllParticipating()

// Settings
await sock.groupUpdateSubject(jid, 'New Name')
await sock.groupUpdateDescription(jid, 'New Description')
await sock.groupSettingUpdate(jid, 'announce', true)   // only admins send
await sock.groupSettingUpdate(jid, 'locked', true)      // only admins edit settings
await sock.groupToggleEphemeral(jid, 604800)            // 7 days
await sock.groupMemberAddMode(jid, 'admin_add')         // or 'all_member_add'

// Invite
const code = await sock.groupInviteCode(jid)
const newCode = await sock.groupRevokeInvite(jid)
const response = await sock.groupAcceptInvite(code)
const info = await sock.groupGetInviteInfo(code)

// Join requests
const requests = await sock.groupRequestParticipantsList(jid)
await sock.groupRequestParticipantsUpdate(jid, ['1234@s.whatsapp.net'], 'approve')

// Leave
await sock.groupLeave(jid)
```

## Privacy

```ts
// Block/unblock
await sock.updateBlockStatus(jid, 'block')
await sock.updateBlockStatus(jid, 'unblock')

// Fetch
const settings = await sock.fetchPrivacySettings()
const blocklist = await sock.fetchBlocklist()

// Update privacy settings
await sock.updateLastSeenPrivacy('contacts')        // 'all' | 'contacts' | 'contact_blacklist' | 'none'
await sock.updateOnlinePrivacy('all')                // 'all' | 'match_last_seen'
await sock.updateProfilePicturePrivacy('contacts')
await sock.updateStatusPrivacy('contacts')
await sock.updateReadReceiptsPrivacy('all')          // 'all' | 'none'
await sock.updateGroupsAddPrivacy('contacts')
await sock.updateDefaultDisappearingMode(604800)     // seconds, 0 to disable
```

## Newsletters (Channels)

```ts
const channel = await sock.newsletterCreate('My Channel', 'Description')
const meta = await sock.newsletterMetadata(jid)
await sock.newsletterSubscribe(jid)
await sock.newsletterUnsubscribe(jid)
```

## Memory Monitoring

```ts
import { getWasmMemoryBytes } from 'whatsapp-rust-bridge'

// WASM linear memory (total reserved)
const wasmBytes = getWasmMemoryBytes()
console.log(`WASM memory: ${(wasmBytes / 1024 / 1024).toFixed(1)} MB`)

// Detailed cache/collection diagnostics from the Rust engine
const diag = await sock.waClient!.getMemoryDiagnostics()
console.log(diag) // { signalCacheSessions, groupCache, deviceCache, ... }
```

## Socket Config

```ts
const sock = makeWASocket({
    // Required
    auth: state,

    // Connection
    waWebSocketUrl: 'wss://web.whatsapp.com/ws/chat',
    connectTimeoutMs: 20_000,
    keepAliveIntervalMs: 30_000,

    // Identity
    version: [2, 3000, 1035194821],
    browser: Browsers.macOS('Chrome'),

    // Events
    emitOwnEvents: true,
    shouldIgnoreJid: jid => false,

    // Proxy (for fetch/HTTP requests — uses undici dispatcher)
    options: { dispatcher: undiciAgent },

    // Cache (Rust-side, see CacheConfig type)
    cache: { group: { ttlSecs: 7200 } },

    // Optional override for the display identity sent at pairing.
    // Orthogonal to `browser`. Only takes effect on the initial pairing.
    deviceProps: { os: '...', platformType: 'CHROME' }
})
```

## Relationship to Baileys

baileyrs began as a fork of [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
but the internals have been rewritten from the ground up on top of
[whatsapp-rust](https://github.com/oxidezap/whatsapp-rust). Only the public API shape
is preserved, to make migration from Baileys straightforward.

See [ATTRIBUTION.md](ATTRIBUTION.md) for the full attribution notice.

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected to
WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owners.
baileyrs is an unofficial, community-driven library provided for educational and
interoperability purposes.

Use at your own risk. The authors are not responsible for any misuse, account bans, or
violations of WhatsApp's Terms of Service that may result from the use of this software.

## License

MIT — see [LICENSE](LICENSE).
