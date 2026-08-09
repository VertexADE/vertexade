import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  CircleAlert,
  Eye,
  FileSearch,
  GitFork,
  GitPullRequest,
  Plus,
  RefreshCw,
  Rocket,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { WorkspaceHeader } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Job, PullRequest, Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { groupPullRequestsForQueue, type PullRequestQueueGroupId } from '../../lib/pull-request-action-policy'

const queueGroupPresentation: Record<PullRequestQueueGroupId, { label: string; description: string; icon: LucideIcon; className: string }> =
  {
    action: {
      label: 'Unblock first',
      description: 'Checks, feedback, or branch updates are holding these back.',
      icon: CircleAlert,
      className: 'text-red-400',
    },
    review: {
      label: 'Review next',
      description: 'Ready for a human or agent decision.',
      icon: Eye,
      className: 'text-amber-400',
    },
    ship: {
      label: 'Ready to ship',
      description: 'Approved and ready for merge automation.',
      icon: Rocket,
      className: 'text-emerald-400',
    },
    waiting: {
      label: 'In motion',
      description: 'Waiting on checks or automation.',
      icon: Timer,
      className: 'text-blue-400',
    },
  }

export function GroupedPullRequestRows({
  pullRequests,
  currentUser,
  agentThreads,
  renderRow,
}: {
  pullRequests: PullRequest[]
  currentUser: { login: string } | null
  agentThreads: Job[]
  renderRow(pullRequest: PullRequest): ReactNode
}) {
  const groups = groupPullRequestsForQueue(pullRequests, {
    identity: currentUser ? { status: 'ready', login: currentUser.login } : { status: 'unavailable' },
    threads: agentThreads,
  })
  return (
    <>
      <div className="hidden grid-cols-[minmax(0,3fr)_minmax(18rem,1.35fr)_11rem] gap-4 border-b border-border/55 bg-muted/15 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[.1em] text-muted-foreground lg:grid">
        <span>Pull request</span>
        <span>Status</span>
        <span className="text-right">Action</span>
      </div>
      {groups.map((group) => {
        const presentation = queueGroupPresentation[group.id]
        const Icon = presentation.icon
        return (
          <section key={group.id} data-pr-queue-group={group.id} aria-labelledby={`pr-queue-${group.id}`}>
            <header className="flex min-w-0 items-center gap-2 border-y border-border/55 bg-muted/28 px-3 py-1.5 first:border-t-0">
              <Icon className={cn('size-3.5 shrink-0', presentation.className)} />
              <span className="min-w-0 flex-1">
                <strong id={`pr-queue-${group.id}`} className="block text-xs font-semibold">
                  {presentation.label}
                </strong>
                <span className="sr-only">{presentation.description}</span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{group.pullRequests.length}</span>
            </header>
            <div className="space-y-1.5 bg-background/30 p-2 lg:space-y-0 lg:bg-card/25 lg:p-0">{group.pullRequests.map(renderRow)}</div>
          </section>
        )
      })}
    </>
  )
}

export function PullRequestQueueHeader({
  title,
  action,
  open,
  activeRuns,
  reviewActivity,
  refreshing,
  onRefresh,
}: {
  title: string
  action: number
  open: number
  activeRuns: number
  reviewActivity: { running: number; ready: number; waiting: number }
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <>
      <WorkspaceHeader
        className="mb-2 items-center pb-0 [&_[data-slot=page-actions]]:w-auto [&_[data-slot=page-header-content]]:xl:flex [&_[data-slot=page-header-content]]:xl:items-baseline [&_[data-slot=page-header-content]]:xl:gap-3 [&_[data-slot=page-title]]:text-lg [&_[data-slot=page-description]]:xl:mt-0"
        title={title}
        description={`${action} need action · ${reviewActivity.ready} agent reviews ready · ${open} open${activeRuns ? ` · ${activeRuns} agents running` : ''}`}
        actions={
          <div className="flex gap-1.5">
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/work" search={{ create: 1 }}>
                <Plus />
                New work
              </Link>
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh pull requests" disabled={refreshing} onClick={onRefresh}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </div>
        }
      />
      <p className="-mt-2 mb-2.5 text-xs text-muted-foreground sm:hidden">
        <strong className="font-medium text-foreground">{action}</strong> need action
        <span aria-hidden="true"> · </span>
        <strong className="font-medium text-foreground">{reviewActivity.ready}</strong> reviews ready
      </p>
    </>
  )
}

export function PrViewButton({
  label,
  mobileLabel,
  active,
  count,
  icon: Icon = GitPullRequest,
  mobileIconOnly = false,
  onClick,
}: {
  label: string
  mobileLabel?: string
  active: boolean
  count?: number
  icon?: LucideIcon
  mobileIconOnly?: boolean
  onClick(): void
}) {
  return (
    <button type="button" onClick={onClick} className={viewButtonClass(active)}>
      <Icon className={viewIconClass(mobileIconOnly)} />
      <MobileViewLabel hidden={mobileIconOnly} label={mobileLabel || label} />
      <span className="hidden sm:inline">{label}</span>
      <ViewCount count={count} desktopOnly={mobileIconOnly} />
    </button>
  )
}

function viewButtonClass(active: boolean) {
  return cn(
    'flex h-10 min-w-0 items-center justify-center gap-1 border-b-2 border-transparent px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:shrink-0 sm:justify-start sm:gap-1.5 sm:rounded-md sm:border-b-0 sm:px-2.5 sm:text-xs sm:hover:bg-accent',
    active && 'border-primary text-primary sm:bg-primary/10 sm:text-primary',
  )
}

function viewIconClass(mobileIconOnly: boolean) {
  return cn('size-3.5 sm:block', mobileIconOnly ? 'block' : 'hidden')
}

function MobileViewLabel({ hidden, label }: { hidden: boolean; label: string }) {
  if (hidden) return null
  return <span className="truncate sm:hidden">{label}</span>
}

function ViewCount({ count, desktopOnly }: { count?: number; desktopOnly: boolean }) {
  if (count === undefined) return null
  return <span className={cn('text-[11px] tabular-nums text-muted-foreground', desktopOnly && 'hidden sm:inline')}>{count}</span>
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading pull requests">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
export function buildDependencyGroups(prs: PullRequest[]) {
  const groups: PullRequest[][] = []
  const visited = new Set<string>()
  const key = (pr: PullRequest) => `${pr.repo_id}:${pr.number}`
  for (const pr of prs) {
    if (visited.has(key(pr))) continue
    const component: PullRequest[] = []
    const queue = [pr]
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(key(current))) continue
      visited.add(key(current))
      component.push(current)
      queue.push(
        ...prs.filter(
          (candidate) =>
            candidate.repo_id === current.repo_id && (candidate.base_ref === current.head_ref || current.base_ref === candidate.head_ref),
        ),
      )
    }
    if (component.length < 2) continue
    const byHead = new Map(component.map((item) => [item.head_ref, item]))
    component.sort((a, b) => dependencyDepth(a, byHead) - dependencyDepth(b, byHead) || a.number - b.number)
    groups.push(component)
  }
  return groups.sort((a, b) => a[0].full_name.localeCompare(b[0].full_name) || a[0].number - b[0].number)
}

function dependencyDepth(pr: PullRequest, byHead: Map<string, PullRequest>) {
  let depth = 0
  let current: PullRequest | undefined = pr
  const seen = new Set<number>()
  while (current && !seen.has(current.number)) {
    seen.add(current.number)
    current = byHead.get(current.base_ref)
    if (current) depth += 1
  }
  return depth
}

export function DependencyOverview({
  groups,
  repositories,
  agentName,
  onOpen,
  onRun,
}: {
  groups: PullRequest[][]
  repositories: Repository[]
  agentName: string
  onOpen: (pr: PullRequest) => void
  onRun: (id: number) => void
}) {
  const [analyzing, setAnalyzing] = useState<number | null>(null)
  async function analyze(repo: Repository) {
    setAnalyzing(repo.id)
    try {
      const job = await api<Job>(`/api/repositories/${repo.id}/stack-analysis`, {
        method: 'POST',
        body: '{}',
      })
      toast.success(`${agentName} is analyzing PR relationships in ${repo.full_name}`)
      onRun(job.id)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAnalyzing(null)
    }
  }
  return (
    <Card className="mb-3 gap-0 overflow-hidden py-0">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitFork className="size-4 text-blue-400" />
            PR dependency overview
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {groups.length} detected stack{groups.length === 1 ? '' : 's'} · ask {agentName} to find dependencies that branch metadata
            cannot show
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {repositories.map((repo) => (
            <Button key={repo.id} variant="outline" size="xs" disabled={analyzing !== null} onClick={() => analyze(repo)}>
              <FileSearch className={cn(analyzing === repo.id && 'animate-pulse')} />
              Analyze {repo.full_name}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {groups.map((group) => (
          <div key={`${group[0].repo_id}:${group[0].number}`} className="border-b p-3 last:border-0">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{group[0].full_name}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {group.map((pr, index) => (
                <span key={pr.number} className="contents">
                  {index > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                  <button
                    type="button"
                    onClick={() => onOpen(pr)}
                    className="flex max-w-72 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-left text-xs hover:bg-accent"
                  >
                    <strong className="text-blue-400">#{pr.number}</strong>
                    <span className="truncate">{pr.title}</span>
                    {pr.checks_pending > 0 && (
                      <Badge variant="outline" className="border-amber-500/40 text-xs text-amber-400">
                        {pr.checks_pending} pending
                      </Badge>
                    )}
                    {pr.merge_state_status === 'BEHIND' && (
                      <Badge variant="outline" className="border-orange-500/40 text-xs text-orange-400">
                        outdated
                      </Badge>
                    )}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No stacks detected from branch targets. {agentName} can inspect the actual changes and recommend relationships.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
