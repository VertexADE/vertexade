import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileSearch,
  GitBranch,
  GitPullRequest,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Rocket,
} from 'lucide-react'
import { EntityHeader } from '@vertexade/ui/components/entity-workspace'
import { BackendBadge } from '@vertexade/ui/components/backend-badge'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { cn } from '@vertexade/ui/lib/utils'

const lifecycle: { id: WorkState; label: string; icon: typeof Clock3 }[] = [
  { id: 'backlog', label: 'Backlog', icon: Clock3 },
  { id: 'active', label: 'Active', icon: CircleDot },
  { id: 'review', label: 'Review', icon: FileSearch },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
]

const stateIndex = Object.fromEntries(lifecycle.map((state, index) => [state.id, index])) as Record<WorkState, number>

function ConnectedRepositoryChips({ repositories, owner, updatedAt }: { repositories: string[]; owner: string | null; updatedAt: string }) {
  return (
    <>
      <span
        className="flex min-w-0 items-center gap-1.5"
        aria-label={repositories.length ? `Connected repositories: ${repositories.join(', ')}` : 'No connected repositories'}
      >
        <GitBranch className="size-3 shrink-0" />
        <span className="truncate">{repositories.length ? repositories.join(', ') : 'No repository connected'}</span>
      </span>
      {owner && (
        <span className="hidden items-center gap-1.5 sm:flex">
          <span className="grid size-4 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">
            {owner[0]}
          </span>
          {owner}
        </span>
      )}
      <span className="hidden sm:inline">Updated {age(updatedAt)}</span>
    </>
  )
}

export function WorkDetailHeader({ item, onEdit }: { item: WorkItem; onEdit(): void }) {
  const pullRequest = item.resources.find((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
  const reviewThread = [...item.threads].reverse().find((thread) => thread.kind === 'review' || thread.kind === 'work_review')
  const prNumber = Number(pullRequest?.metadata.number || 0)
  return (
    <EntityHeader
      className="-mx-3 mb-2 rounded-none border-x-0 [&_[data-slot=entity-badges]]:hidden [&_[data-slot=entity-icon]]:hidden [&_[data-slot=entity-metadata]]:border-t-0 [&_[data-slot=entity-metadata]]:bg-transparent [&_[data-slot=entity-metadata]]:py-1.5 [&_[data-slot=page-header]]:py-2 [&_[data-slot=page-title]]:text-lg sm:mx-0 sm:mb-0 sm:rounded-lg sm:border-x sm:[&_[data-slot=entity-badges]]:flex sm:[&_[data-slot=entity-icon]]:grid sm:[&_[data-slot=entity-metadata]]:border-t sm:[&_[data-slot=entity-metadata]]:bg-muted/38 sm:[&_[data-slot=entity-metadata]]:py-2.5 sm:[&_[data-slot=page-header]]:py-4 sm:[&_[data-slot=page-title]]:text-2xl"
      icon={BriefcaseBusiness}
      expandableTitle
      backAction={
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground sm:h-7 sm:px-2">
          <Link to="/work">
            <ArrowLeft />
            <span className="hidden sm:inline">All work</span>
          </Link>
        </Button>
      }
      eyebrow={
        <>
          <span className="font-mono text-blue-400">{displayBackendKey(item, item.key)}</span>
          <span className="text-border">/</span>
          <span className="capitalize">{item.kind.replace('_', ' ')}</span>
        </>
      }
      title={item.title}
      badges={
        <>
          <Badge variant="outline" className="hidden h-6 shrink-0 rounded-full px-2 text-xs capitalize sm:inline-flex">
            <CircleDot className="size-3" />
            {item.state}
          </Badge>
          <span className="hidden sm:inline-flex">
            <BackendBadge source={item} />
          </span>
          {['high', 'urgent'].includes(item.priority) && (
            <Badge variant="secondary" className="hidden capitalize sm:inline-flex">
              {item.priority} priority
            </Badge>
          )}
        </>
      }
      metadata={<ConnectedRepositoryChips repositories={item.repository_names} owner={item.owner} updatedAt={item.updated_at} />}
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="sm:hidden" variant="ghost" size="icon-sm" aria-label="Work item actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-audit-action="work.edit-outcome" onSelect={onEdit}>
                <Pencil />
                Edit Work item
              </DropdownMenuItem>
              {((pullRequest?.repository_id && prNumber) || reviewThread) && <DropdownMenuSeparator />}
              {pullRequest?.repository_id && prNumber ? (
                <DropdownMenuItem asChild>
                  <Link
                    to="/pull-requests/$repoId/$prNumber"
                    params={{ repoId: String(pullRequest.repository_id), prNumber: String(prNumber) }}
                  >
                    <GitPullRequest />
                    Pull request #{prNumber}
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {reviewThread ? (
                <DropdownMenuItem asChild>
                  <Link to="/threads/$threadId" params={{ threadId: String(reviewThread.id) }}>
                    <MessageSquareText />
                    Review thread #{reviewThread.id}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {(pullRequest?.repository_id && prNumber) || reviewThread ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="hidden sm:inline-flex" variant="ghost" size="icon-sm" aria-label="Open related item">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Related items</DropdownMenuLabel>
                {pullRequest?.repository_id && prNumber ? (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/pull-requests/$repoId/$prNumber"
                      params={{ repoId: String(pullRequest.repository_id), prNumber: String(prNumber) }}
                    >
                      <GitPullRequest />
                      Pull request #{prNumber}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                {reviewThread ? (
                  <DropdownMenuItem asChild>
                    <Link to="/threads/$threadId" params={{ threadId: String(reviewThread.id) }}>
                      <MessageSquareText />
                      Review thread #{reviewThread.id}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            data-audit-action="work.edit-outcome"
            variant="ghost"
            size="sm"
            className="-mr-2 hidden text-muted-foreground sm:inline-flex sm:h-7 sm:px-2"
            onClick={onEdit}
          >
            <Pencil />
            Edit outcome
          </Button>
        </>
      }
    />
  )
}

export function WorkLifecycle({
  item,
  saving,
  onMove,
  onResumeAutomatic,
}: {
  item: WorkItem
  saving: boolean
  onMove(state: WorkState): void
  onResumeAutomatic(): void
}) {
  const isMobile = useIsMobile()
  const currentIndex = stateIndex[item.state]
  if (isMobile) {
    return (
      <div className="border-l bg-background/20 px-2 py-2 sm:border-l-0 sm:px-3">
        <div className="flex items-center justify-between gap-3">
          <span className="sr-only">Stage</span>
          <Select value={item.state} disabled={saving} onValueChange={(value) => onMove(value as WorkState)}>
            <SelectTrigger className="h-8 w-28" aria-label="Move Work item">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lifecycle.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  <stage.icon />
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {item.state_override && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">Manual stage · {item.state_override_reason}</span>
            <Button size="sm" variant="ghost" onClick={onResumeAutomatic}>
              Resume automatic
            </Button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="border-t bg-background/20">
      <div className="flex items-center justify-between gap-3 border-b border-border/55 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">Updates automatically from agent threads, pull requests, and deployments.</p>
        <Select value={item.state} disabled={saving} onValueChange={(value) => onMove(value as WorkState)}>
          <SelectTrigger className="h-7 w-28 text-[11px]" aria-label="Adjust Work stage manually">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {lifecycle.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                <stage.icon />
                {stage.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-5 px-2 sm:px-3" aria-label={`Work lifecycle, ${lifecycle[currentIndex].label} is current`}>
        {lifecycle.map((stage, index) => {
          const reached = index <= currentIndex
          const current = index === currentIndex
          return (
            <div
              key={stage.id}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'relative flex min-w-0 flex-col items-center gap-1 py-2.5 text-muted-foreground sm:flex-row sm:justify-center sm:gap-2',
                reached && 'text-foreground',
              )}
            >
              <span
                className={cn(
                  'relative z-10 grid size-3.5 place-items-center rounded-full border bg-background',
                  reached && 'border-blue-400 text-blue-400',
                  current && 'ring-4 ring-blue-500/10',
                )}
              >
                {reached && !current && <Check className="size-2" />}
                {current && <span className="size-1.5 rounded-full bg-blue-400" />}
              </span>
              <span className={cn('truncate text-[11px] font-medium sm:text-[11px]', current && 'text-blue-300')}>{stage.label}</span>
              {index < lifecycle.length - 1 && (
                <span
                  className={cn(
                    'absolute left-[calc(50%+.55rem)] right-[calc(-50%+.55rem)] top-[16px] h-px bg-border sm:top-1/2 sm:-translate-y-1/2',
                    index < currentIndex && 'bg-blue-500/45',
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
      {item.state_override && (
        <div className="flex flex-col items-start gap-2 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Manual stage · {item.state_override_reason}</span>
          <Button size="xs" variant="ghost" onClick={onResumeAutomatic}>
            Resume automatic lifecycle
          </Button>
        </div>
      )}
    </div>
  )
}
