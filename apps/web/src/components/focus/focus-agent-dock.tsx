import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { followUpDelivery, type FollowUpDelivery } from '@vertexade/ui/lib/follow-up-delivery'
import { cn } from '@vertexade/ui/lib/utils'
import { deliverFocusAgentMessage } from './focus-agent-actions'
import { FocusAgentCard, FocusAgentEmpty } from './focus-agent-card'
import { agentDockDefaultSection, buildAgentDockSections, type AgentDockSection } from './focus-agent-model'

type SendingState = {
  jobId: number
  delivery: FollowUpDelivery
}

type FocusAgentDockProps = {
  threads: Job[]
  loading: boolean
  onChanged: () => void
  embedded?: boolean
}

export function FocusAgentDock({ threads, loading, onChanged, embedded = false }: FocusAgentDockProps) {
  const sections = useMemo(() => buildAgentDockSections(threads), [threads])
  const [selectedSection, setSelectedSection] = useState<AgentDockSection | null>(null)
  const messaging = useAgentDockMessaging(onChanged)
  const section = selectedSection ?? agentDockDefaultSection(sections)

  return (
    <aside className={cn('min-w-0 overflow-hidden bg-card/10', !embedded && 'rounded-lg border border-border/55')}>
      <header className={cn('border-b px-3 pt-3', embedded && 'px-0')}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Live work</h2>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {sections.active.length} active
          </span>
        </div>
        <AgentDockTabs sections={sections} selected={section} onSelect={setSelectedSection} />
      </header>
      <AgentDockList sections={sections} section={section} loading={loading} messaging={messaging} onChanged={onChanged} />
      <div className={cn('border-t px-3 py-2', embedded && 'px-0')}>
        <Button asChild variant="ghost" size="xs" className="w-full justify-between">
          <Link to="/threads">
            View all agents
            <ExternalLink />
          </Link>
        </Button>
      </div>
    </aside>
  )
}

function useAgentDockMessaging(onChanged: () => void) {
  const [messages, setMessages] = useState<Record<number, string>>({})
  const [sending, setSending] = useState<SendingState | null>(null)

  async function send(job: Job, requested?: 'steer') {
    const prompt = messages[job.id]?.trim()
    if (!prompt) return
    setSending({ jobId: job.id, delivery: followUpDelivery(job, requested) })
    try {
      const { delivery, position } = await deliverFocusAgentMessage(job, prompt, requested)
      setMessages((current) => ({ ...current, [job.id]: '' }))
      onChanged()
      toast.success(agentDeliveryMessage(delivery, position))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(null)
    }
  }

  return {
    messages,
    sending,
    setMessage: (jobId: number, message: string) => setMessages((current) => ({ ...current, [jobId]: message })),
    send,
  }
}

function agentDeliveryMessage(delivery: FollowUpDelivery, position?: number) {
  if (delivery === 'queue') return `Instruction queued${position ? ` · position ${position}` : ''}`
  return delivery === 'steer' ? 'Agent steered immediately' : 'Follow-up started'
}

type AgentDockMessaging = ReturnType<typeof useAgentDockMessaging>
type AgentDockSections = ReturnType<typeof buildAgentDockSections>

function AgentDockTabs({
  sections,
  selected,
  onSelect,
}: {
  sections: AgentDockSections
  selected: AgentDockSection
  onSelect: (section: AgentDockSection) => void
}) {
  return (
    <nav aria-label="Agent session filters" className="mt-3 grid grid-cols-2">
      <DockTab
        label="Needs input"
        count={sections.input.length}
        active={selected === 'input'}
        onClick={() => onSelect('input')}
        tone="text-amber-300"
      />
      <DockTab label="Active" count={sections.active.length} active={selected === 'active'} onClick={() => onSelect('active')} />
    </nav>
  )
}

function AgentDockList({
  sections,
  section,
  loading,
  messaging,
  onChanged,
}: {
  sections: AgentDockSections
  section: AgentDockSection
  loading: boolean
  messaging: AgentDockMessaging
  onChanged: () => void
}) {
  if (loading) {
    return (
      <div className="grid min-h-40 place-items-center text-xs text-muted-foreground">
        <span>
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          Loading agents…
        </span>
      </div>
    )
  }
  return (
    <div className="space-y-2 p-2.5">
      {sections[section].length ? (
        sections[section]
          .slice(0, 6)
          .map((job) => (
            <FocusAgentCard
              key={job.id}
              job={job}
              message={messaging.messages[job.id] || ''}
              sending={messaging.sending?.jobId === job.id ? messaging.sending.delivery : null}
              onMessage={(message) => messaging.setMessage(job.id, message)}
              onSend={(requested) => void messaging.send(job, requested)}
              onChanged={onChanged}
            />
          ))
      ) : (
        <FocusAgentEmpty section={section} />
      )}
    </div>
  )
}

function DockTab({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  tone?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'relative flex items-center justify-center gap-1.5 border-b-2 border-transparent px-1 pb-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground',
        active && 'border-primary text-foreground',
        tone,
      )}
      onClick={onClick}
    >
      {label}
      {count > 0 && (
        <span className="grid min-w-4 place-items-center rounded-full bg-muted px-1 py-0.5 font-mono text-[11px]">{count}</span>
      )}
    </button>
  )
}
