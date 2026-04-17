import readline from 'node:readline'
import makeWASocket, { Boom, DEFAULT_CONNECTION_CONFIG, DisconnectReason, fetchLatestWaWebVersion, proto, useMultiFileAuthState, useLegacyMultiFileAuthState, wrapLegacyStore } from '../lib/index.js'
import { getWasmMemoryBytes } from 'whatsapp-rust-bridge'
import P from 'pino'
import process from "node:process";

const logger = P({
  level: "trace",
  transport: {
    targets: [
      {
        target: "pino-pretty", // pretty-print for console
        options: { colorize: true },
        level: "trace",
      },
      {
        target: "pino/file", // raw file output
        options: { destination: './wa-logs.txt' },
        level: "trace",
      },
    ],
  },
})
logger.level = 'trace'

const usePairingCode = process.argv.includes('--use-pairing-code')
const useLegacyStore = process.argv.includes('--use-legacy-store')

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// start a connection
const startSock = async() => {
	// Two auth modes:
	// 1. Default: bridge-native binary store (useMultiFileAuthState)
	// 2. Legacy: load an existing upstream Baileys session via wrapLegacyStore
	//    Usage: npx ts-node example.ts --use-legacy-store /path/to/baileys_auth_info
	let state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state']
	if (useLegacyStore) {
		const legacyPath = process.argv[process.argv.indexOf('--use-legacy-store') + 1] || 'baileys_auth_info'
		logger.info({ path: legacyPath }, 'loading upstream Baileys session via wrapLegacyStore')
		const legacy = await useLegacyMultiFileAuthState(legacyPath)
		const store = await wrapLegacyStore(legacy.state, legacy.saveCreds)
		state = { store }
	} else {
		({ state } = await useMultiFileAuthState('baileys_auth_info'))
	}

	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestWaWebVersion()
	logger.debug({version: version.join('.'), isLatest}, `using latest WA version`)

	const sock = makeWASocket({
		version,
		logger,
		waWebSocketUrl: process.env.SOCKET_URL ?? DEFAULT_CONNECTION_CONFIG.waWebSocketUrl,
		auth: state,
	})

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect, qr } = update
				if(connection === 'close') {
					const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
					if(statusCode === DisconnectReason.loggedOut) {
						logger.fatal('Connection closed. You are logged out.')
					}
					// Other disconnects are handled automatically by the Rust engine
					// (auto-reconnect with fibonacci backoff). No need to call startSock().
				}

				if (qr) {
					// Pairing code for Web clients
					if (usePairingCode && !sock.isLoggedIn) {
						const phoneNumber = await question('Please enter your phone number:\n')
						const code = await sock.requestPairingCode(phoneNumber)
						console.log(`Pairing code: ${code}`)
					}
				}

				logger.debug(update, 'connection update')
			}

			if(events['labels.association']) {
				logger.debug(events['labels.association'], 'labels.association event fired')
			}


			if(events['labels.edit']) {
				logger.debug(events['labels.edit'], 'labels.edit event fired')
			}

			if(events['call']) {
				logger.debug(events['call'], 'call event fired')
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					logger.debug(messages, 'received on-demand history sync')
				}
				logger.debug({contacts: contacts.length, chats: chats.length, messages: messages.length, isLatest, progress, syncType: syncType?.toString() }, 'messaging-history.set event fired')
			}

			// received a new message
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert']
        logger.debug(upsert, 'messages.upsert fired')

        if (upsert.requestId) {
          logger.debug(upsert, 'placeholder request message received')
        }



        if (upsert.type === 'notify') {
          for (const msg of upsert.messages) {
            if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
              // on-demand history sync: send "onDemandHistSync" to trigger
              if (text == "onDemandHistSync") {
                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
                logger.debug({ id: messageId }, 'requested on-demand history resync')
              }

              if (text === "ping") {
                await sock.sendMessage(msg.key.remoteJid!, { text: 'pong '+msg.key.id })
              }

              // Example: send a PIX payment button via relayMessage
              // Demonstrates interactive native flow messages with auto-inferred <biz> node.
              if (text === "pix") {
                const msgId = await sock.relayMessage(msg.key.remoteJid!, {
                  interactiveMessage: {
                    body: { text: 'Send a PIX payment using the button below.' },
                    interactiveMessage: {
                      nativeFlowMessage: {
                        buttons: [{
                          name: 'payment_info',
                          buttonParamsJson: JSON.stringify({
                            currency: 'BRL',
                            total_amount: { value: 0, offset: 100 },
                            reference_id: Math.random().toString(36).substring(2, 13).toUpperCase(),
                            type: 'physical-goods',
                            order: {
                              status: 'pending',
                              subtotal: { value: 0, offset: 100 },
                              order_type: 'ORDER',
                              items: [{ name: '', amount: { value: 0, offset: 100 }, quantity: 0, sale_amount: { value: 0, offset: 100 } }]
                            },
                            payment_settings: [{
                              type: 'pix_static_code',
                              pix_static_code: {
                                merchant_name: 'Example Bot',
                                key: '00000000-0000-0000-0000-000000000000',
                                key_type: 'EVP'
                              }
                            }],
                            share_payment_status: false,
                            referral: 'chat_attachment'
                          })
                        }],
                        messageVersion: 1
                      }
                    }
                  }
                })
                logger.info({ msgId }, 'PIX payment button sent via relayMessage')
              }

              if (text === "memory") {
                const v8 = await import('v8')
                const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MB'
                const n = (v: number) => new Intl.NumberFormat('en').format(v)

                const mem = process.memoryUsage()
                const heap = v8.getHeapStatistics()
                const spaces = v8.getHeapSpaceStatistics()
                  .filter(s => s.space_used_size > 0)
                  .sort((a, b) => b.space_used_size - a.space_used_size)
                const wasm = getWasmMemoryBytes()
                const diag = await sock.waClient!.getMemoryDiagnostics()
                const wasmEntries = Object.entries(diag)
                  .filter(([, v]) => v > 0)
                  .sort(([, a], [, b]) => b - a)

                const report = [
                  '📊 Memory Report',
                  '',
                  `── Process (RSS: ${mb(mem.rss)}) ──`,
                  `  Heap Used:     ${mb(mem.heapUsed)} / ${mb(mem.heapTotal)}`,
                  `  External:      ${mb(mem.external)}`,
                  `  Array Buffers: ${mb(mem.arrayBuffers)}`,
                  '',
                  `── V8 Heap Spaces ──`,
                  ...spaces.map(s =>
                    `  ${s.space_name.replace('_space', '').padEnd(20)} ${mb(s.space_used_size).padStart(10)}`
                  ),
                  '',
                  `── V8 Stats ──`,
                  `  Native contexts:   ${heap.number_of_native_contexts}`,
                  `  Global handles:    ${n(heap.used_global_handles_size)} / ${n(heap.total_global_handles_size)}`,
                  `  Malloced:          ${mb(heap.malloced_memory)}`,
                  `  Peak malloced:     ${mb(heap.peak_malloced_memory)}`,
                  '',
                  `── WASM (${mb(wasm)}) ──`,
                  ...wasmEntries.length
                    ? wasmEntries.map(([k, v]) => `  ${k.padEnd(26)} ${n(v).padStart(8)}`)
                    : ['  (all caches empty)'],
                  '',
                  `── Total: ${mb(mem.rss + wasm)} ──`,
                ].join('\n')

                console.log(report)
                await sock.sendMessage(msg.key.remoteJid!, { text: report })
              }
            }
          }
        }
      }

			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				logger.debug(events['messages.update'], 'messages.update fired')

				for(const { update } of events['messages.update']) {
					if(update.pollUpdates) {
						logger.debug({ pollUpdates: update.pollUpdates }, 'got poll update')
					}
				}
			}

			if(events['message-receipt.update']) {
				logger.debug(events['message-receipt.update'])
			}

			if (events['contacts.upsert']) {
				logger.debug(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				logger.debug(events['messages.reaction'])
			}

			if(events['presence.update']) {
				logger.debug(events['presence.update'])
			}

			if(events['chats.update']) {
				logger.debug(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						logger.debug({id: contact.id, newUrl}, `contact has a new profile pic` )
					}
				}
			}

			if(events['chats.delete']) {
				logger.debug({ chats: events['chats.delete'] }, 'chats deleted')
			}

			if(events['group.member-tag.update']) {
				logger.debug({ update: events['group.member-tag.update'] }, 'group member tag update')
			}
		}
	)

	return sock

}

startSock()
