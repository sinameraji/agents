/** Result of a stored upload, mirrors what the server returns from POST /api/uploads. */
export interface UploadedAttachment {
  key: string
  name: string
  size: number
}

/**
 * Upload files one request each (raw body + x-file-name header) and collect the stored results.
 * The name is URI-encoded so non-ASCII filenames survive the header.
 */
export async function uploadFiles(files: File[]): Promise<UploadedAttachment[]> {
  return Promise.all(
    files.map(async (file) => {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      return (await res.json()) as UploadedAttachment
    }),
  )
}
