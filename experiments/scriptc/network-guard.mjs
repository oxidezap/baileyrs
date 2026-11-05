import net from 'node:net'
import dgram from 'node:dgram'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
const forbidden = () => {
	throw new Error('offline smoke attempted network access')
}
globalThis.fetch = forbidden
// The replacement must remain constructible for `new WebSocket` callers.
// oxlint-disable-next-line typescript/no-extraneous-class
globalThis.WebSocket = class {
	constructor() {
		forbidden()
	}
}
net.connect = net.createConnection = tls.connect = forbidden
net.Socket.prototype.connect = forbidden
net.Server.prototype.listen = forbidden
dgram.createSocket = forbidden
dgram.Socket.prototype.bind = dgram.Socket.prototype.connect = dgram.Socket.prototype.send = forbidden
http.request = http.get = https.request = https.get = forbidden
syncBuiltinESMExports()
