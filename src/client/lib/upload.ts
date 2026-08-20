import { imageMimeOf } from '~shared/vision'

/** Result of a stored upload, mirrors what the server returns from POST /api/uploads. */
export interface UploadedAttachment {
  key: string
  name: string
  size: number
  /** Content type as stored in R2 (drives the image lane + composer thumbnails). */
  mime?: string
  /** Client-only object URL for the composer's thumbnail chip; never sent to the server. */
  previewUrl?: string
}

/**
 * Upload files one request each (raw body + x-file-name header) and collect the stored results.
 * The name is URI-encoded so non-ASCII filenames survive the header. Image files additionally
 * get a local object URL so the composer can show a thumbnail while the chip is pending.
 */
export async function uploadFiles(files: File[]): Promise<UploadedAttachment[]> {
  return Promise.all(
    files.map(async (file) => {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      const stored = (await res.json()) as UploadedAttachment
      if (imageMimeOf({ name: stored.name, mime: stored.mime ?? file.type })) {
        stored.previewUrl = URL.createObjectURL(file)
      }
      return stored
    }),
  )
}
