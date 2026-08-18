import { useSession } from '@/hooks/use-session'
import { ChatView } from './coding-agent/chat-view'

/** Connects a session id to the live SessionAgent and renders the chat. */
export function LiveChatView({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId)
  return <ChatView session={session} />
}
