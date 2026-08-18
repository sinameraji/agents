import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * A child process driven by LF-delimited JSONL on stdin/stdout. CRITICAL: split on '\n' only —
 * Node's readline also splits on U+2028/U+2029 which are legal inside JSON strings (pi's docs warn
 * about exactly this).
 */
export class JsonlProcess {
  private proc: ChildProcessWithoutNullStreams
  private buf = ''
  constructor(command: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }, onEvent: (ev: Record<string, unknown>) => void) {
    this.proc = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } })
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString('utf8')
      let idx: number
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).replace(/\r$/, '')
        this.buf = this.buf.slice(idx + 1)
        if (!line.trim()) continue
        try {
          onEvent(JSON.parse(line))
        } catch {
          /* non-JSON log line */
        }
      }
    })
    this.proc.stderr.on('data', () => {})
  }
  send(obj: unknown) {
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }
  kill() {
    try {
      this.proc.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
}
