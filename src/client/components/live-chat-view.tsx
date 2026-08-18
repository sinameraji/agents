import { useMemo } from 'react'
import { useSession } from '@/hooks/use-session'
import type { Session } from '~shared/protocol'
import { ChatView } from './coding-agent/chat-view'

/** Bridges the live SessionAgent (useSession) to the ported ChatView, which expects a Session. */
export function LiveChatView({ sessionId }: { sessionId: string }) {
  const s = useSession(sessionId)

  const session = useMemo<Session>(() => {
    const m = s.meta
    return {
      id: sessionId,
      name: m?.name ?? 'Session',
      repo: m?.repo ?? '',
      branch: m?.branch ?? '',
      status: (m?.status as Session['status']) ?? 'idle',
      region: (m?.region as Session['region']) ?? 'iad1',
      model: m?.model ?? '',
      createdAt: m?.createdAt ?? new Date().toISOString(),
      lastActivity: m?.lastActivity ?? 'now',
      tokensIn: s.usage.tokensIn,
      tokensOut: s.usage.tokensOut,
      costUsd: s.usage.costUsd,
      messages: s.messages,
      subAgents: [],
    }
  }, [sessionId, s.meta, s.usage, s.messages])

  return (
    <ChatView
      session={session}
      provider={(s.meta?.provider as import('~shared/protocol').Provider) ?? 'openrouter'}
      onSend={(text) => void s.send(text)}
      onChangeModel={(id) => void s.setModel(id)}
    />
  )
}
