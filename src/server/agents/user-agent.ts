import { Agent, callable } from 'agents'

/**
 * One instance per user (name = user id). Holds the session index for the sidebar and the
 * user's settings/connections. Fleshed out in P1; for now it proves the DO wiring.
 */
export class UserAgent extends Agent<Env, { createdAt: string | null }> {
  initialState = { createdAt: null }

  onStart() {
    if (!this.state.createdAt) this.setState({ createdAt: new Date().toISOString() })
  }

  @callable()
  ping(): { ok: true; at: string } {
    return { ok: true, at: new Date().toISOString() }
  }
}
