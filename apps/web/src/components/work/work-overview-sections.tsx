import type { ReactNode } from 'react'
import type { WorkResourcePresentation } from '@vertexade/platform-contracts'
import { CheckCircle2, ExternalLink, FileCode2, GitBranch, GitPullRequest, TriangleAlert, Trash2 } from 'lucide-react'
import { AgentAvatar, agentDisplayName } from '@vertexade/ui/components/agent-identity'
import { EntityInspectorSection, EntityWorkspace } from '@vertexade/ui/components/entity-workspace'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { ContextTransfers, Relations, Resources, ThreadList, WorkItemPreviewCard } from './work-detail-panels'
import { latestWorkJob } from './work-focus-panel'
import { DeliveryMatrix } from './work-delivery-matrix'

type WorkResource = WorkItem['resources'][number]

function WorkOverview({ item }: { item: WorkItem }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Outcome</CardTitle>
        </CardHeader>
        <CardContent>
          {item.description ? (
            <MarkdownContent content={item.description} />
          ) : (
            <p className="text-sm text-muted-foreground">No description or acceptance criteria yet.</p>
          )}
        </CardContent>
      </Card>
      <aside className="min-w-0">
        <WorkItemPreviewCard item={item} />
      </aside>
    </div>
  )
}

export function WorkDetails({
  item,
  presentations,
  onOpenPullRequest,
  onDelete,
  children,
}: {
  item: WorkItem
  presentations: Record<string, WorkResourcePresentation>
  onOpenPullRequest(resource: WorkResource): void
  onDelete(): void
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-4">
      <WorkOverview item={item} />
      {children}
      <Resources item={item} presentations={presentations} onOpenPullRequest={onOpenPullRequest} />
      <Relations item={item} />
      <DangerZone onDelete={onDelete} />
    </div>
  )
}

function diffFileCount(job: WorkItem['threads'][number]) {
  try {
    const files = JSON.parse(job.diff_files || '[]')
    return Array.isArray(files) ? files.length : 0
  } catch {
    return 0
  }
}

function resultExcerpt(value: string | null) {
  if (!value) return 'The thread completed without a written result.'
  const lines = value.trim().split('\n')
  const excerpt = lines.slice(0, 8).join('\n').trim()
  return excerpt.length > 900 ? `${excerpt.slice(0, 897)}…` : excerpt
}

function LatestResultCard({ item, onOpen }: { item: WorkItem; onOpen(jobId: number): void }) {
  const job = latestWorkJob(item)
  if (!job) return null
  const state = agentThreadState(job)
  if (!['completed', 'failed'].includes(state)) return null
  const failed = state === 'failed'
  const agentName = agentDisplayName(job.agent_id)
  const files = diffFileCount(job)
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border',
        failed ? 'border-red-500/25 bg-red-500/[.025]' : 'border-emerald-500/25 bg-emerald-500/[.025]',
      )}
    >
      <header className="flex items-start gap-2.5 border-b px-3 py-3">
        <span className="relative">
          <AgentAvatar id={job.agent_id} name={agentName} size="sm" />
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background',
              failed ? 'bg-red-400' : 'bg-emerald-400',
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest result</span>
          <h2 className="mt-0.5 text-sm font-semibold">{failed ? `${agentName} needs attention` : `${agentName} completed the thread`}</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {job.full_name} · {age(job.activity_at || job.finished_at || job.created_at)}
          </p>
        </div>
        {failed ? <TriangleAlert className="size-4 text-red-400" /> : <CheckCircle2 className="size-4 text-emerald-400" />}
      </header>
      <div className="px-3 py-3">
        <div className="max-w-5xl line-clamp-4 text-xs leading-relaxed text-foreground/90">
          <MarkdownContent content={resultExcerpt(job.latest_activity)} />
        </div>
      </div>
      <footer className="flex min-w-0 items-center gap-2 border-t px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{files} files</span>
          <span className="text-emerald-400">+{job.diff_additions || 0}</span>
          <span className="text-red-400">−{job.diff_deletions || 0}</span>
          <span className="flex min-w-0 items-center gap-1">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{job.branch_name || 'No branch recorded'}</span>
          </span>
        </span>
        <Button size="sm" variant={failed ? 'destructive' : 'outline'} onClick={() => onOpen(job.id)}>
          <FileCode2 />
          Open
        </Button>
      </footer>
    </section>
  )
}

export function WorkMobileOverview({
  item,
  onOpenRun,
  onSectionChange,
}: {
  item: WorkItem
  onOpenRun(jobId: number): void
  onSectionChange(section: 'links'): void
}) {
  const latest = latestWorkJob(item)
  const latestState = latest ? agentThreadState(latest) : null
  const hasResult = latestState === 'completed' || latestState === 'failed'
  const outcome = item.description ? (
    <MarkdownContent content={item.description} />
  ) : (
    <p>No description yet. The title is the current outcome.</p>
  )
  return (
    <EntityWorkspace
      className="gap-2 xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-4"
      inspectorClassName="hidden xl:block"
      inspector={
        <>
          {hasResult && (
            <EntityInspectorSection
              title="Outcome"
              actions={
                <button type="button" onClick={() => onSectionChange('links')} className="text-xs font-medium text-blue-400">
                  Delivery
                </button>
              }
            >
              <div className="p-3 text-xs leading-relaxed text-muted-foreground">{outcome}</div>
            </EntityInspectorSection>
          )}
          <EntityInspectorSection eyebrow="At a glance" title="Work context">
            <dl className="grid grid-cols-2 border-t-0 text-xs">
              {[
                ['Stage', item.state],
                ['Priority', item.priority],
                ['Threads', item.threads.length],
                ['Links', item.resources.length],
                ['Repositories', item.repository_names.length],
                ['Owner', item.owner || 'Unassigned'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 border-b border-r border-border/55 p-3 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0"
                >
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="mt-1 truncate font-medium capitalize" title={String(value)}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </EntityInspectorSection>
        </>
      }
    >
      {hasResult ? (
        <LatestResultCard item={item} onOpen={onOpenRun} />
      ) : (
        <section className="min-w-0 border-y border-border/55 py-4 sm:border sm:p-4">
          <p className="text-[10px] font-medium uppercase tracking-[.12em] text-muted-foreground">Intended outcome</p>
          <div className="mt-3 text-sm leading-relaxed text-foreground/90">{outcome}</div>
        </section>
      )}
    </EntityWorkspace>
  )
}

export function WorkThreads({
  item,
  onOpenRun,
  onStartWork,
  onStartReview,
}: {
  item: WorkItem
  onOpenRun(jobId: number): void
  onStartWork(): void
  onStartReview(): void
}) {
  return (
    <div className="min-w-0 space-y-4">
      <ThreadList item={item} onOpen={onOpenRun} onStartWork={onStartWork} onStartReview={onStartReview} />
      {item.context_transfers.length > 0 && <ContextTransfers item={item} onOpen={onOpenRun} />}
    </div>
  )
}

function PullRequestStatus({ resource, onOpen }: { resource: WorkResource; onOpen(resource: WorkResource): void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="size-4 text-violet-400" />
          Pull request status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="break-words text-sm font-medium">{resource.label}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="capitalize">
            {resource.state || 'unknown'}
          </Badge>
          <Badge variant="secondary">{resource.role.replace('_', ' ')}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="h-11 sm:h-7" size="sm" onClick={() => onOpen(resource)}>
            <GitPullRequest />
            View PR
          </Button>
          {resource.url && (
            <Button className="h-11 sm:h-7" asChild variant="outline" size="sm">
              <a href={resource.url} target="_blank" rel="noreferrer">
                GitHub
                <ExternalLink />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DangerZone({ onDelete }: { onDelete(): void }) {
  return (
    <Card className="border-red-500/25">
      <CardHeader>
        <CardTitle className="text-red-400">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Permanently remove this Work item and its disposable local execution state. Use Archive when you want to keep its history.
        </p>
        <Button data-audit-action="work.delete" className="h-11 w-full sm:h-7 sm:w-auto" variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 />
          Delete Work permanently
        </Button>
      </CardContent>
    </Card>
  )
}

export function WorkLinks({
  item,
  pullRequest,
  onOpenPullRequest,
}: {
  item: WorkItem
  pullRequest?: WorkResource
  onOpenPullRequest(resource: WorkResource): void
}) {
  const pullRequests = item.resources.filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
  return (
    <div className="min-w-0 space-y-4">
      <DeliveryMatrix item={item} />
      {pullRequests.length > 0 || pullRequest ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {pullRequests.map((resource) => (
            <PullRequestStatus key={`${resource.id}:${resource.role}`} resource={resource} onOpen={onOpenPullRequest} />
          ))}
          {!pullRequests.length && pullRequest && <PullRequestStatus resource={pullRequest} onOpen={onOpenPullRequest} />}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <GitPullRequest className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-xs font-medium">No pull request yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">The delivery path will update when an agent opens or links one.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
