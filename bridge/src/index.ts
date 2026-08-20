/**
 * Dreamweav bridge — runs inside the Sandbox container, hosts the chosen coding harness (pi /
 * KimiFlare / built-in AI SDK) and exposes a poll-able request/response HTTP API on :7700. The
 * SessionAgent DO drives it via sandbox.containerFetch (SSE does not stream over that transport, so
 * state is polled). OpenCode is handled directly by the DO via @cloudflare/sandbox/opencode.
 */
import { createServer } from 'node:http'
import { BridgeSession, type Harness } from './session'
import type { StartConfig } from './adapters/types'

const PORT = Number(process.env.BRIDGE_PORT ?? 7700)
let session: BridgeSession | null = null

function body(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => resolve(b))
  })
}

const server = createServer(async (req, res) => {
  const send = (code: number, obj: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  try {
    const url = req.url ?? '/'
    if (req.method === 'GET' && url === '/health') return send(200, { ok: true, rev: process.env.BRIDGE_REV ?? 'dev' })
    if (req.method === 'GET' && url === '/state') return send(200, session ? session.state() : { status: 'idle', turns: [], todos: [], permissions: [] })

    if (req.method === 'POST' && url === '/start') {
      const { harness, config } = JSON.parse(await body(req)) as { harness: Harness; config: StartConfig }
      session = new BridgeSession()
      await session.start(harness, config)
      return send(200, { ok: true })
    }
    if (req.method === 'POST' && url === '/prompt') {
      const { text } = JSON.parse(await body(req)) as { text: string }
      if (!session) return send(400, { error: 'not started' })
      session.prompt(text)
      return send(200, { ok: true })
    }
    if (req.method === 'POST' && url === '/steer') {
      const { text } = JSON.parse(await body(req)) as { text: string }
      if (!session) return send(400, { error: 'not started' })
      // {ok:false, reason:'unsupported'|'idle'|…} tells the caller to fall back to abort+prompt.
      return send(200, await session.steer(text))
    }
    if (req.method === 'POST' && url === '/command') {
      const { name, args } = JSON.parse(await body(req)) as { name: string; args?: Record<string, unknown> }
      if (!session) return send(400, { error: 'not started' })
      return send(200, await session.command(name, args))
    }
    if (req.method === 'POST' && url === '/abort') {
      await session?.abort()
      return send(200, { ok: true })
    }
    if (req.method === 'POST' && url === '/permission') {
      const { id, reply, note } = JSON.parse(await body(req)) as { id: string; reply: 'once' | 'always' | 'reject'; note?: string }
      await session?.resolvePermission(id, reply, note)
      return send(200, { ok: true })
    }
    send(404, { error: 'not found' })
  } catch (e) {
    send(500, { error: (e as Error).message })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ type: 'log', message: `bridge listening on :${PORT}` }))
})
