/**
 * Dreamweav bridge — runs inside the Sandbox container, wraps the chosen coding harness and
 * exposes a WebSocket on :7700 for the SessionAgent supervisor. Stub for now (P1 fills it in).
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.BRIDGE_PORT ?? 7700)

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, version: '0.0.1' }))
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ type: 'log', message: `bridge listening on :${PORT}` }))
})
