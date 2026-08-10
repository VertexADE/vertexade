import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, CircleX, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { PullRequestEvidenceDecision, PullRequestEvidenceEntry, PullRequestEvidenceSnapshot } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { externalHttpUrl } from '@vertexade/ui/lib/external-http-url'

type PullRequestEvidencePanelProps = {
  repositoryId: number
  pullRequestNumber: number
  onOpenImpact?(): void
  onOpenDiscussion?(): void
  className?: string
}

const decisionLabels: Record<PullRequestEvidenceDecision, string> = {
  scope_understood: 'Scope understood',
  behavior_validated: 'Behavior validated',
  review_resolved: 'Review resolved',
  release_safe: 'Release safe',
}

const readinessVariant = {
  ready: 'outline',
  blocked: 'destructive',
  unknown: 'secondary',
  stale: 'destructive',
} as const

const statusVariant = {
  passed: 'outline',
  failed: 'destructive',
  blocked: 'destructive',
  not_applicable: 'secondary',
  unknown: 'secondary',
  stale: 'destructive',
} as const

function EvidenceStatusIcon({ entry }: { entry: PullRequestEvidenceEntry }) {
  if (entry.waiver) return <ShieldCheck />
  if (entry.status === 'passed' || entry.status === 'not_applicable') return <CheckCircle2 />
  if (entry.status === 'failed' || entry.status === 'blocked') return <CircleX />
  if (entry.status === 'stale') return <AlertTriangle />
  return <CircleHelp />
}

function EvidenceEntry({
  entry,
  waiving,
  onWaive,
  onAction,
}: {
  entry: PullRequestEvidenceEntry
  waiving: boolean
  onWaive(entry: PullRequestEvidenceEntry): void
  onAction(entry: PullRequestEvidenceEntry): void
}) {
  const sourceUrl = externalHttpUrl(entry.sourceUrl)
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-start">
      <EvidenceStatusIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{entry.label}</strong>
          <Badge variant={statusVariant[entry.status]}>{entry.status.replaceAll('_', ' ')}</Badge>
          {entry.required && <Badge variant="outline">required</Badge>}
          {entry.waiver && <Badge variant="secondary">waived by {entry.waiver.actor}</Badge>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{entry.proof}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {entry.provider} · {entry.observedHeadRevision?.slice(0, 8) || 'no revision'}
        </p>
        {entry.waiver && <p className="mt-1 text-xs text-muted-foreground">Waiver: {entry.waiver.reason}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {sourceUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              Source <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
        {entry.action && entry.status !== 'passed' && entry.status !== 'not_applicable' && (
          <Button variant="outline" size="sm" onClick={() => onAction(entry)}>
            Resolve
          </Button>
        )}
        {entry.required && !entry.waiver && !['passed', 'not_applicable'].includes(entry.status) && (
          <Button variant="ghost" size="sm" disabled={waiving} onClick={() => onWaive(entry)}>
            Waive
          </Button>
        )}
      </div>
    </div>
  )
}

export function PullRequestEvidenceView({
  snapshot,
  collecting,
  waivingKey,
  onCollect,
  onWaive,
  onAction,
}: {
  snapshot: PullRequestEvidenceSnapshot
  collecting: boolean
  waivingKey: string | null
  onCollect(): void
  onWaive(entry: PullRequestEvidenceEntry): void
  onAction(entry: PullRequestEvidenceEntry): void
}) {
  const decisions = Object.keys(decisionLabels) as PullRequestEvidenceDecision[]
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Pull-request evidence
            <Badge variant={readinessVariant[snapshot.readiness]}>{snapshot.readiness}</Badge>
            <Badge variant={snapshot.freshness === 'stale' ? 'destructive' : 'outline'}>{snapshot.freshness}</Badge>
          </CardTitle>
          <CardDescription>
            Head {snapshot.headRevision.slice(0, 8)} · policy v{snapshot.policyVersion} · {snapshot.counts.passed} passed ·{' '}
            {snapshot.counts.failed + snapshot.counts.blocked} blocked · {snapshot.counts.unknown} unknown
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" disabled={collecting} onClick={onCollect}>
              <RefreshCw data-icon="inline-start" /> {collecting ? 'Collecting…' : 'Refresh evidence'}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
      {snapshot.freshness === 'stale' && (
        <Card size="sm" variant="subtle">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle /> Evidence belongs to an older head
            </CardTitle>
            <CardDescription>Refresh all revision-bound collectors before using this ledger to decide readiness.</CardDescription>
          </CardHeader>
        </Card>
      )}
      {decisions.map((decision) => {
        const entries = snapshot.entries.filter((entry) => entry.decision === decision)
        if (!entries.length) return null
        return (
          <Card key={decision} size="sm" layout="divided">
            <CardHeader>
              <CardTitle>{decisionLabels[decision]}</CardTitle>
              <CardDescription>Required proof and explicit unknowns for this decision.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {entries.map((entry) => (
                <EvidenceEntry key={entry.key} entry={entry} waiving={waivingKey === entry.key} onWaive={onWaive} onAction={onAction} />
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function PullRequestEvidencePanel({
  repositoryId,
  pullRequestNumber,
  onOpenImpact,
  onOpenDiscussion,
  className,
}: PullRequestEvidencePanelProps) {
  const [snapshot, setSnapshot] = useState<PullRequestEvidenceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [collecting, setCollecting] = useState(false)
  const [waiverEntry, setWaiverEntry] = useState<PullRequestEvidenceEntry | null>(null)
  const [waiverActor, setWaiverActor] = useState('local-user')
  const [waiverReason, setWaiverReason] = useState('')
  const endpoint = useMemo(() => `/api/pulls/${repositoryId}/${pullRequestNumber}/evidence`, [pullRequestNumber, repositoryId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ snapshot: PullRequestEvidenceSnapshot | null }>(endpoint)
      setSnapshot(result.snapshot)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setSnapshot(null)
    setWaiverEntry(null)
    void load()
  }, [load])

  const collect = useCallback(async () => {
    setCollecting(true)
    try {
      setSnapshot(await api<PullRequestEvidenceSnapshot>(endpoint, { method: 'POST' }))
      toast.success('Evidence refreshed for the current head')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCollecting(false)
    }
  }, [endpoint])

  const waive = useCallback(async () => {
    if (!waiverEntry) return
    setCollecting(true)
    try {
      setSnapshot(
        await api<PullRequestEvidenceSnapshot>(`${endpoint}/waivers`, {
          method: 'POST',
          body: JSON.stringify({ entryKey: waiverEntry.key, actor: waiverActor, reason: waiverReason }),
        }),
      )
      setWaiverEntry(null)
      setWaiverReason('')
      toast.success('Revision-scoped waiver recorded')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCollecting(false)
    }
  }, [endpoint, waiverActor, waiverEntry, waiverReason])

  const action = useCallback(
    (entry: PullRequestEvidenceEntry) => {
      if (['refresh_impact', 'build_architecture', 'run_validation'].includes(String(entry.action))) onOpenImpact?.()
      else if (entry.action === 'request_review') onOpenDiscussion?.()
      else {
        const sourceUrl = externalHttpUrl(entry.sourceUrl)
        if (sourceUrl) window.open(sourceUrl, '_blank', 'noopener,noreferrer')
        else void collect()
      }
    },
    [collect, onOpenDiscussion, onOpenImpact],
  )

  if (loading && !snapshot) {
    return (
      <Card className={className} aria-label="Loading pull-request evidence">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    )
  }
  if (!snapshot) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>No evidence snapshot for this pull request</EmptyTitle>
          <EmptyDescription>Collect current-head impact, architecture, validation, review, and release proof.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={collecting} onClick={() => void collect()}>
            <RefreshCw data-icon="inline-start" /> {collecting ? 'Collecting…' : 'Collect evidence'}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <div className={className}>
      {waiverEntry && (
        <Card className="mb-3" size="sm" variant="subtle">
          <CardHeader>
            <CardTitle>Waive {waiverEntry.label}</CardTitle>
            <CardDescription>
              The waiver applies only to head {snapshot.headRevision.slice(0, 8)} and remains in the audit history.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Label className="grid gap-1.5">
              Actor
              <Input value={waiverActor} maxLength={200} onChange={(event) => setWaiverActor(event.target.value)} />
            </Label>
            <Label className="grid gap-1.5">
              Reason
              <Textarea required value={waiverReason} maxLength={2_000} onChange={(event) => setWaiverReason(event.target.value)} />
            </Label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setWaiverEntry(null)}>
                Cancel
              </Button>
              <Button disabled={collecting || !waiverActor.trim() || !waiverReason.trim()} onClick={() => void waive()}>
                Record waiver
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <PullRequestEvidenceView
        snapshot={snapshot}
        collecting={collecting}
        waivingKey={waiverEntry?.key || null}
        onCollect={() => void collect()}
        onWaive={setWaiverEntry}
        onAction={action}
      />
    </div>
  )
}
