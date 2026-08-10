import { useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  ExternalLink,
  GitCommitHorizontal,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardTitle } from '@vertexade/ui/components/ui/card'
import { List, ListItem, ListItemAction, ListItemContent, ListItemMeta, ListItemTitle } from '@vertexade/ui/components/ui/list'
import { Status } from '@vertexade/ui/components/ui/status'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { age } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import type { DeploymentService, DeploymentStage } from '@vertexade/ui/lib/dashboard-types'

const stateTone = {
  deployed: 'success',
  deploying: 'info',
  waiting: 'warning',
  failed: 'danger',
  pending: 'warning',
  outdated: 'warning',
  unknown: 'neutral',
} as const

export function ServiceCard({ service, rerunning, onRerun }: { service: DeploymentService; rerunning: boolean; onRerun: () => void }) {
  const canRerun = service.latest?.status === 'completed'
  const startsOpen = service.state === 'failed' || service.state === 'deploying'
  const [open, setOpen] = useState(startsOpen)
  return (
    <Card className="gap-0 overflow-hidden border-border/75 bg-card/72 py-0 backdrop-blur-sm">
      <details className="group/service" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3 transition-colors hover:bg-accent/16">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <CardTitle className="truncate font-mono text-sm">{service.name}</CardTitle>
              <Badge variant="outline" className="shrink-0">
                {service.target.label}
              </Badge>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {service.latest ? (
                <>
                  <code>{service.latest.sha.slice(0, 7)}</code> · {service.latest.title}
                </>
              ) : (
                'No deployment attempt found'
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {service.pending_commits.length > 0 && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">{service.pending_commits.length} pending</span>
            )}
            <Status tone={stateTone[service.state]}>{service.state.replace('_', ' ')}</Status>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/service:rotate-180" />
          </div>
        </summary>
        <CardContent className="min-w-0 border-t p-0">
          {canRerun && service.state !== 'deployed' && (
            <div className="flex justify-end border-b border-border/45 px-3 py-2">
              <Button size="sm" variant={service.state === 'failed' ? 'destructive' : 'outline'} disabled={rerunning} onClick={onRerun}>
                {rerunning ? <Spinner data-icon="inline-start" /> : <Rocket data-icon="inline-start" />}
                {rerunning ? 'Requesting…' : service.state === 'failed' ? 'Retry failed' : 'Trigger rerun'}
              </Button>
            </div>
          )}
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.85fr)]">
            <div className="grid min-w-0 border-b sm:[grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))] lg:border-b-0 lg:border-r">
              {service.target.environments.map((environment) => (
                <Environment
                  key={environment}
                  name={environment}
                  stage={service.environments[environment]}
                  outdated={environment === service.target.production_environment && service.production_outdated}
                  outdatedLabel={`Behind ${service.target.comparison_environment}`}
                />
              ))}
            </div>
            <div className="min-w-0 p-3">
              <DeploymentDetails service={service} />
            </div>
          </div>
        </CardContent>
      </details>
    </Card>
  )
}

function DeploymentDetails({ service }: { service: DeploymentService }) {
  return (
    <>
      <p className="mb-2 truncate text-[11px] text-muted-foreground">
        {service.target.repository} · {service.target.workflow} · {service.target.branch} · {service.target.event}
      </p>
      <DeployDifference service={service} />
      <div className="mb-2 mt-3 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
          Service commits awaiting {service.target.production_environment}
        </span>
        <Badge variant="secondary" className="shrink-0 font-mono">
          {service.pending_commits.length}
        </Badge>
      </div>
      {service.pending_commits.length ? (
        <List className="max-h-40 min-w-0 overflow-y-auto rounded-lg border border-border/70 bg-background/35">
          {service.pending_commits.map((commit) => (
            <ListItem key={commit.run_id} asChild interactive className="min-w-0 py-2">
              <a href={commit.url} target="_blank" rel="noreferrer">
                <ListItemContent>
                  <ListItemTitle className="flex-nowrap text-xs">
                    <code className="shrink-0 text-amber-300">{commit.sha.slice(0, 7)}</code>
                    <span className="truncate">{commit.title}</span>
                  </ListItemTitle>
                  <ListItemMeta>{age(commit.created_at)}</ListItemMeta>
                </ListItemContent>
                <ListItemAction>
                  <ExternalLink className="size-3 text-muted-foreground" />
                </ListItemAction>
              </a>
            </ListItem>
          ))}
        </List>
      ) : (
        <p className="text-[11px] text-muted-foreground">No affected commits are waiting for production.</p>
      )}
    </>
  )
}

function DeployDifference({ service }: { service: DeploymentService }) {
  const delta = service.deployment_delta
  if (!delta) {
    const comparison = service.environments[service.target.comparison_environment]
    const production = service.environments[service.target.production_environment]
    const matched = comparison?.deployed_sha && comparison.deployed_sha === production?.deployed_sha
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs',
          matched ? 'border-emerald-500/25 bg-emerald-500/[.045] text-emerald-300' : 'text-muted-foreground',
        )}
      >
        <GitCompareArrows className="size-3.5 shrink-0" />
        <span>
          {matched
            ? `${service.target.comparison_environment} and ${service.target.production_environment} are on the same commit`
            : `No ${service.target.comparison_environment}-to-${service.target.production_environment} comparison available`}
        </span>
      </div>
    )
  }
  return (
    <a
      href={delta.compare_url}
      target="_blank"
      rel="noreferrer"
      className="group block min-w-0 rounded-md border border-orange-500/30 bg-orange-500/[.06] px-2.5 py-2 hover:bg-orange-500/10"
    >
      <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-orange-300">
          <GitCompareArrows className="size-3.5 shrink-0" />
          <span className="truncate">
            {service.target.production_environment} is behind {service.target.comparison_environment}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:text-orange-200">
          Compare changes
          <ExternalLink className="size-2.5" />
        </span>
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs">
        <code className="text-muted-foreground">{delta.from_sha.slice(0, 7)}</code>
        <ArrowRight className="size-3 text-orange-400" />
        <code className="text-orange-300">{delta.to_sha.slice(0, 7)}</code>
        <Badge variant="outline" className="border-orange-500/30 text-xs text-orange-300 sm:ml-auto">
          {delta.commit_count} service commit{delta.commit_count === 1 ? '' : 's'}
        </Badge>
      </div>
    </a>
  )
}

function Environment({
  name,
  stage,
  outdated = false,
  outdatedLabel,
}: {
  name: string
  stage: DeploymentStage | null
  outdated?: boolean
  outdatedLabel: string
}) {
  const Icon = !stage ? Clock3 : stage.conclusion === 'success' ? Check : stage.conclusion === 'failure' ? AlertTriangle : Loader2
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 border-b border-r border-border/45 p-3 sm:block',
        outdated && 'bg-orange-500/[.045]',
      )}
    >
      <div className="flex items-center gap-1.5 sm:mb-1.5">
        <Icon
          className={cn(
            'size-3.5',
            outdated
              ? 'text-orange-400'
              : stage?.conclusion === 'success'
                ? 'text-emerald-400'
                : stage?.conclusion === 'failure'
                  ? 'text-red-400'
                  : 'text-muted-foreground',
            stage?.status === 'in_progress' && 'animate-spin',
          )}
        />
        <span className="font-mono text-xs font-semibold uppercase">{name}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {stage?.deployed_sha ? (
            <a href={stage.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs hover:text-blue-300">
              {stage.deployed_sha.slice(0, 7)}
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">Not deployed</span>
          )}
          {outdated && (
            <Badge variant="outline" className="border-orange-500/40 px-1 text-xs text-orange-300">
              Outdated
            </Badge>
          )}
        </div>
        <p className={cn('mt-0.5 truncate text-xs capitalize', outdated ? 'text-orange-300' : 'text-muted-foreground')}>
          {outdated
            ? outdatedLabel
            : stage
              ? `${stage.conclusion || stage.status} · ${age(stage.completed_at || stage.started_at)}`
              : 'No attempt found'}
        </p>
        {stage?.attempt_sha && stage.attempt_sha !== stage.deployed_sha && (
          <p className="mt-1 truncate font-mono text-xs text-amber-300">Attempt {stage.attempt_sha.slice(0, 7)}</p>
        )}
      </div>
    </div>
  )
}
