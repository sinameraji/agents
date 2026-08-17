/**
 * Symmetric encryption for user secrets at rest (provider keys, GitHub PAT).
 * AES-GCM with a 256-bit key from the ENCRYPTION_KEY secret (base64). Ciphertext is stored as
 * base64(iv ‖ ciphertext). The plaintext key never leaves the Worker.
 */

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(keyB64)
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
  return bytesToB64(out)
}

export async function decryptSecret(payload: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64)
  const bytes = b64ToBytes(payload)
  const iv = bytes.slice(0, 12)
  const ct = bytes.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

/** Mask a secret for display: keep a hint of head + tail, hide the middle. */
export function maskSecret(plaintext: string | undefined): string | null {
  if (!plaintext) return null
  if (plaintext.length <= 8) return '••••'
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`
}
