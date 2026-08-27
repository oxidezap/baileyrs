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

Compatibility is checked rather than assumed: a declaration audit against
upstream's `.d.ts`, a wire-fidelity audit of the send path, ~50 behavioural
compatibility suites, and a
[differential fuzz suite](src/__fuzz__/README.md) that generates its own inputs
from the proto schema and compares the two libraries directly. Differences the
fuzzers find are recorded with a reason and a review date, and known open ones
are listed in `src/__fuzz__/harness/divergence.ts`.

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

// setTimeout caps at ~2^31-1 ms (~24.8 days) and fires immediately past that,
// so a long ban has to be waited out in chunks.
async function waitUntil(deadlineMs: number) {
    for (let left = deadlineMs - Date.now(); left > 0; left = deadlineMs - Date.now()) {
        await new Promise(resolve => setTimeout(resolve, Math.min(left, 2_147_483_647)))
    }
}

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
                // Temporary ban: `expire` is unix seconds. A missing or past
                // expiry means the ban is over — reconnect like any other
                // terminal close rather than staying offline forever.
                const expire = (lastDisconnect?.error as Boom)?.data?.expire
                console.log('Temporarily banned until', expire)
                waitUntil(typeof expire === 'number' ? expire * 1000 : 0).then(connectToWhatsApp)
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
- **`connecting` is not a short state here.** The engine's backoff grows with
  each consecutive failure, so a single `connecting` can stand for minutes of
  downtime with nothing else emitted in between. See
  [When `connecting` lasts minutes](#when-connecting-lasts-minutes): a
  readiness timeout written for upstream's `connecting` misreads this one.
- **No `getMessage` / `cachedGroupMetadata` polyfill required.** The Rust
  side caches group metadata and message keys natively, and nothing here calls
  either hook: a `cachedGroupMetadata` carried over from upstream never runs,
  and neither does a `getMessage`. Passing them is harmless — the whole
  `SocketConfig` shape is accepted so a migration needs no edits — but they are
  not overrides, so delete them rather than maintain them. Every socket warns once
  at construction naming any option in that group it received; that list is the
  authority — the type system requires each `SocketConfig` member to be
  classified, so it cannot fall behind — and it also covers `keepAliveIntervalMs`,
  `markOnlineOnConnect`, `maxMsgRetryCount`, `msgRetryCounterCache`,
  `retryRequestDelayMs`, `fireInitQueries`, `syncFullHistory`,
  `shouldSyncHistoryMessage`, `generateHighQualityLinkPreview`,
  `linkPreviewImageThumbnailWidth`, `enableAutoSessionRecreation`,
  `enableRecentMessageCache`, `appStateMacVerification`,
  `patchMessageBeforeSending`, `customUploadHosts`, `countryCode`,
  `connectTimeoutMs`, `qrTimeout`, `printQRInTerminal`, `ignoreOfflineMessages`,
  `downloadHistory`, `agent`, `fetchAgent`, `mobile`, `mediaCache`,
  `userDevicesCache`, `callOfferCache` and `placeholderResendCache`.
- **A sender's resend reaches you once, not once per delivery.** When a
  sender's network is bad, their client re-runs its own outbox and sends the
  same message again — same `key.id`, re-encrypted. Upstream Baileys emits a
  `messages.upsert` for each of those deliveries, so an auto-reply bot answers
  the same message two or three times; the engine now recognises the repeat and
  emits one. It is a short-lived, in-memory window (five minutes), so the one
  case still open is a sender whose retry spans a restart of your process. If
  your handler has side effects, keying them on the whole `key` — `remoteJid`,
  `id`, `fromMe` and `participant` — remains the thing that makes it safe. Not
  on `id` alone: the id is the sending client's to choose, so two participants
  of one group can pick the same one, and a handler that keys on it would drop
  the second person's message rather than a duplicate. That is why the engine's
  own check carries the sender too.
- **`Boom` ships in the box.** baileyrs exports its own
  `@hapi/boom`-compatible `Boom`, so the existing
  `(err as Boom).output.statusCode` pattern works unchanged. If your
  `package.json` was pulling `@hapi/boom` only for baileys, you can drop
  the dependency.
- **Your key store also holds bridge state, so "empty" is not "unpaired".**
  See [Bridge state in your key store](#bridge-state-in-your-key-store) — this
  one can break a boot path, so it has its own section.

### When `connecting` lasts minutes

Upstream Baileys emits `connecting` once per socket, and it resolves to `open`
or `close` within seconds, because upstream never retries on its own. On
baileyrs the same value also covers every drop the engine is retrying, and the
backoff between those retries climbs with each consecutive failure.

Here is what that costs on a rate-limited account. Four consecutive
`429 rate-overlimit`, measured against the production reconnect path:

| failure | next attempt in | offline so far |
| --- | --- | --- |
| `429` #1 | 8.4s | 8.4s |
| `429` #2 | 146.2s | 154.6s |
| `429` #3 | 813.9s | 968.5s |
| `429` #4 | 903.5s | 1872.0s |

About 16 minutes offline once the third retry delay has run, and about 31 once
the fourth has. For all of it the consumer sees exactly **one**
`connection: 'connecting'`: no `lastDisconnect`, no status code, no repeat.
`isConnected` and `isLoggedIn` are both `false` throughout, exactly as they are
during a first connection, so neither tells you a retry is scheduled.

**Do not arm a readiness timeout on `connecting`, and above all do not restart
the process when one expires.** The backoff counter lives in the Rust client
that your socket owns, so it dies with the process. The next boot starts a new
attempt immediately, replays the whole startup burst against a server that just
asked for less traffic, and earns the next `429` sooner. Restarting is the
single worst answer to a rate limit, and an upstream-shaped readiness timeout
leads straight to it.

What to do instead:

- Treat `open` and `close` as the only decision points. `connecting` carries no
  failure to react to, and it is never a reason to build a second socket. Only
  `close` is.
- Read `connecting` in context: after an `open` it means the engine is retrying
  a drop it owns and will keep retrying; with no `open` before it, it is a first
  connection still being established. Neither one is stuck.
- If you need a liveness watchdog anyway, budget it well past the ladder above,
  tens of minutes rather than seconds, and have it alert a human instead of
  killing the process. A shorter one fires on a backoff that was about to
  succeed.
- Know what your own calls do meanwhile. A call issued while the engine is
  reconnecting no longer fails fast: it parks and goes out when the connection
  lands, which on the ladder above can be tens of minutes. That is the point,
  since the alternative was an error indistinguishable from a finished session,
  but it means a call you issue during `connecting` is a call you are committing
  to. Racing it against your own deadline bounds your waiting and not the work:
  the call still goes out when the reconnect lands, so a retry after the
  deadline sends it twice unless you pinned `messageId`.
- Fix the cause on your side: send less. The engine restores the connection,
  but it does not pace your traffic, and the traffic is what earned the `429`.
  Queueing, throttling and deferral are yours to decide, the same as upstream.

### Bridge state in your key store

Upstream Baileys keeps engine state in `creds` (persisted by `saveCreds`) and
puts only Signal key material in `keys`. baileyrs uses that same `keys` store
as the persistence channel for the Rust core's own state as well: its device
record, and the byte-level records the Signal namespaces are projected from.
Those live under namespaces reserved with the **`bridge-` prefix**:

| namespace | what it holds |
| --- | --- |
| `bridge-native-*` | the core's own encoding of a namespace that also has a Baileys projection (`bridge-native-session`, `bridge-native-prekey`, `bridge-native-device`, …) |
| `bridge-*` | core records with no Baileys equivalent (`bridge-signed-prekey`, `bridge-sent-message`, `bridge-msg-secret`, `bridge-meta`, …) |

No upstream Baileys namespace starts with `bridge-`, and none of your data is
stored under one. Which of them you actually see depends on what the engine
touches; `bridge-native-device` shows up first, because the core reads its
device record while the socket is still `connecting` — **before any QR, before
any pairing**.

That last point is the one that bites. A store that counted rows to decide
whether this was a first run reports a session that does not exist:

```js
// WRONG on baileyrs: bridge-native-device is already in the table before pairing,
// so this never reports empty again — the bot skips its pairing flow and hangs.
const isEmpty = () => !creds.registered && !creds.me?.id && countKeys() === 0

// Right, on baileyrs and upstream alike: creds are the pairing record.
const isEmpty = () => !creds.registered && !creds.me?.id
```

**A non-empty key store is not evidence of a session.** `creds.registered` and
`creds.me?.id` are, and they are the only thing to check.

When you need to present a store the way upstream would — counting rows,
listing the Signal namespaces, exporting an upstream-shaped dump — filter the
bridge rows out with the exported classifier rather than matching the prefix
yourself. It is derived from the internal routing catalog, so a namespace added
in a later release is covered without you changing anything:

```ts
// Aliased install? Import from '@whiskeysockets/baileys' instead; it resolves here.
import { BRIDGE_INTERNAL_KEY_TYPES, isBridgeInternalKeyType } from '@oxidezap/baileyrs'

isBridgeInternalKeyType('bridge-native-device') // true
isBridgeInternalKeyType('pre-key')              // false

// Every bridge-internal namespace, e.g. for a SQL `NOT IN (...)` clause. The
// store also holds the Baileys namespaces the engine projects into it.
BRIDGE_INTERNAL_KEY_TYPES
```

> **Do not drop these rows from a backup or a store-to-store move.** They are
> effective state, not metadata. `bridge-signed-prekey`, `bridge-sender-key-devices`,
> `bridge-base-key`, `bridge-sent-message`, `bridge-msg-secret`,
> `bridge-mutation-mac` and `bridge-meta` have no Baileys projection at all, and
> a Signal session that turned native-only lives under `bridge-native-session`
> alone. Restoring only the non-bridge rows rolls those sessions back or loses
> the state outright. Filter the bridge rows only where the destination is an
> upstream-shaped view that cannot represent them; a full backup, or a move
> between two baileyrs stores, carries every `bridge-` row across.

This applies to stores you own — the upstream `{ creds, keys }` shape that
baileyrs auto-wraps, including `useLegacyMultiFileAuthState`. It does not apply
to `useMultiFileAuthState`, whose `keys` is a projection over the engine's own
store; the `bridge-` namespaces never surface through it.

The move back down is not symmetric either. From 0.2.8 on, the core buffers a
skipped-message key as its seed alone, where an earlier release wrote the
derived cipher/mac/iv triple beside it. Forward is fine — a record written
before this carries both, and the newer engine reads it unchanged. Backward is
not: an older engine cannot parse a record whose skipped keys carry no triple,
and it fails on **the whole record**, not on the one key.

Where that bites depends on which bytes the engine is handed, and a wrapped
store is not automatically on the safe side of it. It holds the Baileys
projection, which has only ever held seeds — but it also mirrors the core's
exact bytes under `bridge-native-session`, and a read prefers that mirror for as
long as its fingerprint still matches the projection. A downgrade can therefore
be handed the newer record with a perfectly readable projection sitting right
beside it.

Dropping a mirror row makes the next read rebuild it from the projection, which
is the format both versions agree on — but only for a session that has one. A
session that turned native-only lives in that row alone, so dropping *that* one
loses the session outright, which is the case the warning above is about. A
session with no skipped keys buffered at the time is unaffected either way: the
difference only exists while a chain is holding keys for messages that arrived
out of order.

## Disclaimer

This project is not affiliated with, endorsed by, or in any way officially connected to
WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its respective owners.
baileyrs is an unofficial, community-driven library provided for educational and
interoperability purposes.

Use at your own risk. The authors are not responsible for any misuse, account bans, or
violations of WhatsApp's Terms of Service that may result from the use of this software.

## License

MIT — see [LICENSE](LICENSE).
