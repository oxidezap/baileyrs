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
| Auto-reconnect | Manual `startSock()` loop | Transient drops retried in Rust (fibonacci backoff); terminal ones still yours |

## Documentation

The full API reference and guides live in the
**[baileyrs wiki](https://deepwiki.com/oxidezap/baileyrs)** — sending messages and
media, groups, privacy, newsletters, custom stores, socket configuration,
error handling, memory monitoring, and more.

## Installation

Requires Node.js 22 or newer.

### New project

```sh
npm install @oxidezap/baileyrs
```

```ts
import makeWASocket from '@oxidezap/baileyrs'
```

### Drop-in replacement for upstream Baileys

baileyrs is API-compatible with [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).
Existing projects switch over by aliasing the package — **the API and imports
need no source changes**. Two things do:

- Carrying an existing pairing across takes a one-line import swap, see
  [Migrating from Upstream Baileys](#migrating-from-upstream-baileys).
- If your `connection.update` handler was written for a version of baileyrs
  before 0.1, see [Gotchas](#gotchas): a `close` now always means the socket
  is finished, and you have to recreate it. Code written against upstream
  Baileys already does the right thing.


```sh
npm install @whiskeysockets/baileys@npm:@oxidezap/baileyrs
```

That writes the alias to your `package.json` (with the latest version at install time):

```jsonc
{
  "dependencies": {
    "@whiskeysockets/baileys": "npm:@oxidezap/baileyrs@^x.x.x"
  }
}
```

Every `import { makeWASocket } from '@whiskeysockets/baileys'` in your codebase
now resolves to baileyrs.

## Quick Start

```ts
import makeWASocket, { Boom, DisconnectReason, useMultiFileAuthState } from '@oxidezap/baileyrs'

const { state } = await useMultiFileAuthState('auth_info')

async function connectToWhatsApp() {
    const sock = makeWASocket({ auth: state })

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            // `close` means this socket is finished — same as upstream Baileys.
            // Transient drops never get here; the Rust engine retries those and
            // reports `connecting`.
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
            // See the reconnect table under Gotchas: a few terminal closes
            // reject the replacement just as fast, so they are not worth
            // retrying — or not yet. `Example/example.ts` has the full policy.
            if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
                console.log('Closed for good', statusCode)
            } else if (statusCode === DisconnectReason.forbidden) {
                // Temporary ban: `expire` is unix seconds. `Example/example.ts`
                // chunks the wait, since setTimeout caps at ~24.8 days.
                const expire = (lastDisconnect?.error as Boom)?.data?.expire
                const waitMs = expire ? Math.max(0, expire * 1000 - Date.now()) : 0
                console.log('Temporarily banned until', expire)
                if (expire) setTimeout(connectToWhatsApp, Math.min(waitMs, 2_147_483_647))
            } else {
                setTimeout(connectToWhatsApp, 5_000)
            }
        }
        if (connection === 'open') {
            console.log('Connected')
        }
    })

    // Register every handler in here. A replacement socket is a new emitter,
    // so anything attached outside stops firing after the first reconnect.
    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const msg of messages) {
            console.log('received message', msg.key.id)
        }
    })

    return sock
}

const sock = await connectToWhatsApp()
await sock.sendMessage('1234567890@s.whatsapp.net', { text: 'Hello!' })
```

## Migrating from Upstream Baileys

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

Existing sessions migrate without re-pairing: `useLegacyMultiFileAuthState`
reads the existing `creds.json` + `pre-key-*.json` / `session-*.json` files
from the same folder upstream Baileys was using and hands them to the Rust
engine. Pair-ID, identity, signed pre-keys, and Signal sessions are all
preserved. No QR re-scan, no logged-out events.

> **Where the new state goes**: baileyrs continues to write the legacy
> JSON files (via `saveCreds`) so the folder stays compatible with both
> sides during a rollback window. The Rust engine treats the JSON as the
> source of truth as long as you keep using `useLegacyMultiFileAuthState`.
> One edge case: a Signal session imported while it still had pending
> out-of-order message gaps becomes native-only on its first write-back —
> after a rollback, that one session re-establishes itself through a fresh
> Signal handshake (automatic; no re-pairing, other sessions unaffected).
> If you later want to drop the JSON layer, switch to
> `useMultiFileAuthState` — but that path requires a fresh QR.

### Gotchas

A few behaviors that differ from upstream — almost always to your advantage:

- **Auto-reconnect is built in, but `close` still means `close`.** The Rust
  engine retries transient drops on a fibonacci backoff and reports them as
  `connection: 'connecting'`, so the canonical upstream handler never fires
  for those and you never end up with two sockets on one account. A
  `connection: 'close'` is only emitted once the engine has given up — a
  replaced session, an outdated build, a temporary ban, an unrecoverable
  `<failure>` — and by then the socket has already released its resources.
  Ignoring it leaves the bot permanently offline, so handle it the upstream
  way and build a replacement — with three exceptions, because some of those
  failures reject the replacement just as fast:

  | `statusCode` | what to do |
  | --- | --- |
  | `DisconnectReason.loggedOut` (401) | stop; needs a fresh pairing |
  | `405` | stop; the server rejected this build, and the next one too |
  | `DisconnectReason.forbidden` (403) | wait until `lastDisconnect.error.data.expire` (unix seconds) — it is a temporary ban |
  | anything else | reconnect, after a short delay |

  `Example/example.ts` implements exactly this.
- **No `getMessage` / `cachedGroupMetadata` polyfill required.** The Rust
  side caches group metadata and message keys natively. You can still pass
  them — they're respected as overrides — but they're optional.
- **`Boom` ships in the box.** baileyrs exports its own
  `@hapi/boom`-compatible `Boom`, so the existing
  `(err as Boom).output.statusCode` pattern works unchanged. If your
  `package.json` was pulling `@hapi/boom` only for baileys, you can drop
  the dependency.

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected to
WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owners.
baileyrs is an unofficial, community-driven library provided for educational and
interoperability purposes.

Use at your own risk. The authors are not responsible for any misuse, account bans, or
violations of WhatsApp's Terms of Service that may result from the use of this software.

## License

MIT — see [LICENSE](LICENSE).
