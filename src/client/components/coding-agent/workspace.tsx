'use client'

import { useMemo, useState } from 'react'

import { MODELS, SESSIONS } from '@/lib/mock-data'
import { estimateCost } from '~shared/format'
import type { Message, PastedBlock, Session } from '~shared/protocol'
import { SessionSidebar } from './session-sidebar'
import { ChatView } from './chat-view'
import { SettingsDialog } from './settings-dialog'

const REGIONS: Session['region'][] = ['iad1', 'sfo1', 'fra1', 'hnd1']
let sessionSeq = 0

export function Workspace() {
  const [sessions, setSessions] = useState<Session[]>(SESSIONS)
  const [activeId, setActiveId] = useState<string>(SESSIONS[0].id)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  )

  const handleSelect = (id: string) => {
    setActiveId(id)
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread: false } : s)))
  }

  const handleNew = () => {
    sessionSeq += 1
    const id = `new-${Date.now()}-${sessionSeq}`
    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)]
    const newSession: Session = {
      id,
      name: 'Untitled session',
      repo: 'acme/scratch',
      branch: `agent/session-${sessionSeq}`,
      status: 'idle',
      region,
      model: 'claude-sonnet-4.5',
      createdAt: new Date().toISOString(),
      lastActivity: 'now',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      subAgents: [],
      messages: [
        {
          id: 'init',
          role: 'agent',
          createdAt: new Date().toISOString(),
          text: `Fresh sandbox provisioned in ${region}. Tell me what to build, paste code or logs, and I'll get to work.`,
          steps: [
            { id: 'i1', label: `Allocated isolated sandbox (${region})`, status: 'done' },
            { id: 'i2', label: 'Waiting for your first instruction', status: 'pending' },
          ],
        },
      ],
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveId(id)
  }

  const handleSend = (text: string, pasted: PastedBlock[]) => {
    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      createdAt: new Date().toISOString(),
      text: text || undefined,
      pasted: pasted.length ? pasted : undefined,
    }

    // Rough token accounting so the meter and cost update live.
    const pastedChars = pasted.reduce((sum, b) => sum + b.chars, 0)
    const addedIn = Math.round((text.length + pastedChars) / 4) + 40

    const agentMessage: Message = {
      id: `a-${Date.now()}`,
      role: 'agent',
      createdAt: new Date().toISOString(),
      text: 'On it — reading the relevant files in the sandbox and planning the change.',
      steps: [
        { id: `st-${Date.now()}-1`, label: 'Scanned repository for context', status: 'done' },
        { id: `st-${Date.now()}-2`, label: 'Planning edits', status: 'running' },
        { id: `st-${Date.now()}-3`, label: 'Apply + run checks', status: 'pending' },
      ],
    }
    const addedOut = 180

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s
        const model = MODELS.find((m) => m.id === s.model)
        const tokensIn = s.tokensIn + addedIn
        const tokensOut = s.tokensOut + addedOut
        return {
          ...s,
          status: 'running',
          lastActivity: 'now',
          name: s.name === 'Untitled session' && text ? text.slice(0, 40) : s.name,
          messages: [...s.messages, userMessage, agentMessage],
          tokensIn,
          tokensOut,
          costUsd: estimateCost(tokensIn, tokensOut, model),
        }
      }),
    )
  }

  const handleChangeModel = (modelId: string) => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s
        const model = MODELS.find((m) => m.id === modelId)
        return { ...s, model: modelId, costUsd: estimateCost(s.tokensIn, s.tokensOut, model) }
      }),
    )
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="hidden w-72 shrink-0 border-r border-border md:block">
        <SessionSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <ChatView
        key={activeSession.id}
        session={activeSession}
        onSend={handleSend}
        onChangeModel={handleChangeModel}
      />

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
