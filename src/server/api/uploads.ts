import type { Context } from 'hono'
import type { Identity } from '../auth/access'

/**
 * POST /api/uploads — store user attachments in R2 under uploads/<userId>/<uuid>/<name>.
 * Accepts either multipart/form-data (one or more files) or a raw body with the file name
 * in an `x-file-name` header (URI-encoded so non-ASCII names survive the header).
 */
const MAX_BYTES = 25 * 1024 * 1024 // 25MB per file

type UploadContext = Context<{ Bindings: Env; Variables: { identity: Identity } }>

interface UploadedFile {
  key: string
  name: string
  size: number
}

/** Keep only a safe basename: no path segments, no hidden/".." names, no exotic characters. */
function sanitizeName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? 'file'
  const clean = base
    .replace(/[^\w.-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 128)
  return clean || 'file'
}

async function store(
  c: UploadContext,
  userId: string,
  rawName: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<UploadedFile> {
  const name = sanitizeName(rawName)
  const key = `uploads/${userId}/${crypto.randomUUID()}/${name}`
  await c.env.STORE.put(key, body, {
    httpMetadata: { contentType: contentType || 'application/octet-stream' },
  })
  return { key, name, size: body.byteLength }
}

export async function handleUpload(c: UploadContext): Promise<Response> {
  const userId = c.get('identity').id
  const contentType = c.req.header('content-type') ?? ''

  // --- multipart form: one or more files -----------------------------------------------------
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData()
    const files: File[] = []
    for (const value of form.values()) {
      if (value instanceof File) files.push(value)
    }
    if (files.length === 0) return c.json({ error: 'no files in form' }, 400)
    const oversized = files.find((f) => f.size > MAX_BYTES)
    if (oversized) {
      return c.json({ error: `"${oversized.name}" exceeds the 25MB limit` }, 413)
    }
    const stored: UploadedFile[] = []
    for (const file of files) {
      stored.push(await store(c, userId, file.name, await file.arrayBuffer(), file.type))
    }
    return stored.length === 1 ? c.json(stored[0]) : c.json({ files: stored })
  }

  // --- raw body: file name in x-file-name ----------------------------------------------------
  const rawName = c.req.header('x-file-name')
  if (!rawName) return c.json({ error: 'missing x-file-name header' }, 400)
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    name = rawName
  }
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_BYTES) return c.json({ error: 'file exceeds the 25MB limit' }, 413)
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_BYTES) return c.json({ error: 'file exceeds the 25MB limit' }, 413)
  return c.json(await store(c, userId, name, body, contentType))
}
