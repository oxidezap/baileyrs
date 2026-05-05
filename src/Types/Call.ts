export type WACallUpdateType = 'offer' | 'ringing' | 'timeout' | 'reject' | 'accept' | 'terminate'

export type WACallEvent = {
	chatId: string
	from: string
	callerPn?: string
	isGroup?: boolean
	groupJid?: string
	id: string
	date: Date
	isVideo?: boolean
	status: WACallUpdateType
	offline: boolean
	latencyMs?: number
	// ── baileyrs additions: bridge surfaces these fields, upstream Baileys
	// today only carries the subset above. Kept optional + named after the
	// bridge fields so consumers using upstream's type don't break.

	/** ISO country code on `offer` (e.g. `"BR"`, `"US"`). */
	callerCountryCode?: string
	/** Device class string from the offer (e.g. `"web"`, `"mobile"`). */
	deviceClass?: string
	/** `true` for group-call invites the recipient can join late. */
	joinable?: boolean
	/** Codec names advertised on the offer (e.g. `["opus", "g722"]`). */
	audio?: string[]
	/** Total call duration in **seconds** — only on `terminate`. */
	duration?: number
	/** Active audio-stream duration in **seconds** — only on `terminate`. */
	audioDuration?: number
	/** Stanza-level `id` (distinct from `id`/`callId`). */
	stanzaId?: string
	/** Pushname on the call offer. */
	notify?: string
	/** Platform string from the offer (e.g. `"web"`, `"smbi"`). */
	platform?: string
	/** WhatsApp client version on the caller side. */
	version?: string
}
