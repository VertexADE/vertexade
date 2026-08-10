import { AlertTriangle, Bot, CheckCircle2, GitPullRequest, Play, Sparkles } from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadState, compareAgentThreadActivity } from '@vertexade/ui/lib/agent-thread-state'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { workAttentionPresentation } from './work-attention-presentation'

type WorkJob = WorkItem['threads'][number]
type WorkResource = WorkItem['resources'][number]
type WorkFocus = { title: string; detail: string; tone: string; icon: typeof Bot; technicalDetails?: string | null }

export function activeWorkJob(item: WorkItem) {
  return item.threads.find((job) => ['starting', 'running'].includes(job.status))
}

export function latestWorkJob(item: WorkItem) {
  return [...item.threads].sort(compareAgentThreadActivity)[0]
}

function attentionFocus(item: WorkItem): WorkFocus | null {
  const attention = workAttentionPresentation(item)
  if (!attention) return null
  return {
    title: attention.title,
    detail: attention.summary,
    tone: 'border-amber-500/30 bg-amber-500/[.05]',
    icon: AlertTriangle,
    technicalDetails: attention.technicalDetails,
  }
}

function waitingFocus(active: WorkJob): WorkFocus {
  return {
    title: `Input required in ${active.full_name}`,
    detail: activityPreview(active.latest_activity || 'Open the thread and answer the agent’s question.'),
    tone: 'border-amber-500/30 bg-amber-500/[.05]',
    icon: AlertTriangle,
  }
}

function workingFocus(active: WorkJob): WorkFocus {
  return {
    title: `Agent working in ${active.full_name}`,
    detail: activityPreview(active.latest_activity || `${active.agent_id} is working`),
    tone: 'border-blue-500/30 bg-blue-500/[.04]',
    icon: Bot,
  }
}

function activeFocus(active: WorkJob | undefined): WorkFocus | null {
  if (!active) return null
  return agentThreadState(active) === 'waiting' ? waitingFocus(active) : workingFocus(active)
}

function pullRequestFocus(item: WorkItem, pullRequest: WorkResource | undefined): WorkFocus | null {
  if (item.state !== 'review') return null
  if (!pullRequest) return null
  return {
    title: 'Ready for pull request review',
    detail: pullRequest.label,
    tone: 'border-violet-500/30 bg-violet-500/[.04]',
    icon: GitPullRequest,
  }
}

function unstartedFocus(item: WorkItem): WorkFocus | null {
  if (item.threads.length) return null
  return {
    title: 'Ready to start implementation',
    detail: 'Launch the first agent thread in the reusable Work-item repository worktree.',
    tone: 'border-emerald-500/30 bg-emerald-500/[.04]',
    icon: Play,
  }
}

function finishedFocus(item: WorkItem): WorkFocus | null {
  const latest = latestWorkJob(item)
  if (!latest) return null
  const state = agentThreadState(latest)
  if (state === 'failed')
    return {
      title: 'Agent thread needs attention',
      detail: activityPreview(latest.latest_activity || `Open ${latest.full_name} to inspect the failure.`),
      tone: 'border-red-500/30 bg-red-500/[.04]',
      icon: AlertTriangle,
    }
  if (state !== 'completed') return null
  if (item.state === 'done')
    return {
      title: 'Outcome completed',
      detail: activityPreview(latest.latest_activity || 'The latest agent result is ready to revisit.'),
      tone: 'border-emerald-500/30 bg-emerald-500/[.04]',
      icon: CheckCircle2,
    }
  return {
    title: 'Agent result ready to inspect',
    detail: activityPreview(latest.latest_activity || `Open the completed thread for ${latest.full_name}.`),
    tone: 'border-emerald-500/30 bg-emerald-500/[.04]',
    icon: CheckCircle2,
  }
}

function defaultFocus(item: WorkItem): WorkFocus {
  const detail = activityPreview(latestWorkJob(item)?.latest_activity || 'Open the latest thread or start the next focused step.')
  return {
    title: 'Continue moving the outcome forward',
    detail,
    tone: 'border-blue-500/25 bg-blue-500/[.025]',
    icon: Sparkles,
  }
}

function workFocus(item: WorkItem, active: WorkJob | undefined, pullRequest: WorkResource | undefined) {
  const focus = [
    attentionFocus(item),
    activeFocus(active),
    pullRequestFocus(item, pullRequest),
    unstartedFocus(item),
    finishedFocus(item),
  ].find(Boolean)
  return focus ? focus : defaultFocus(item)
}

export function WorkFocusPanel({ item, pullRequest }: { item: WorkItem; pullRequest?: WorkResource }) {
  const active = activeWorkJob(item)
  const latest = latestWorkJob(item)
  const focus = workFocus(item, active, pullRequest)
  const FocusIcon = focus.icon
  const target = active || latest
  return (
    <section data-slot="work-next-action" className={cn('col-span-2 min-w-0 px-3 py-3 sm:px-4 sm:py-4', focus.tone)}>
      <div className="flex min-w-0 items-start gap-3">
        {target ? (
          <span className="relative">
            <AgentAvatar id={target.agent_id} name={agentDisplayName(target.agent_id)} size="sm" />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background',
                agentIsWorking(agentThreadState(target)) ? 'bg-blue-400' : target.status === 'failed' ? 'bg-red-400' : 'bg-emerald-400',
              )}
            />
          </span>
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background/80">
            <FocusIcon className="size-4 text-blue-400" />
          </span>
        )}
        <div className="min-w-0">
          <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">Next action</span>
          <h2 className="text-sm font-semibold sm:mt-0.5 sm:text-base">{focus.title}</h2>
          <p className="mt-0.5 line-clamp-1 max-w-3xl text-xs leading-relaxed text-muted-foreground sm:mt-1 sm:line-clamp-none sm:text-[13px]">
            {focus.detail}
          </p>
          {focus.technicalDetails && (
            <details className="mt-2 max-w-3xl text-[11px] text-muted-foreground">
              <summary className="w-fit cursor-pointer font-medium text-foreground/70 hover:text-foreground">Technical details</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border bg-background/70 p-2 font-mono text-[10px] leading-relaxed">
                {focus.technicalDetails}
              </pre>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}
