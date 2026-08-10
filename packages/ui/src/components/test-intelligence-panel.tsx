import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, CircleX, FlaskConical, Play, RefreshCw, Repeat2, ScrollText, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { PullRequestTestIntelligence, TestTarget, ValidationRun } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import { api } from '@vertexade/ui/lib/dashboard-api'

type TestIntelligencePanelProps = {
  repositoryId: number
  pullRequestNumber: number
  className?: string
}

const statusVariant = {
  running: 'secondary',
  passed: 'outline',
  failed: 'destructive',
  cancelled: 'secondary',
  'timed-out': 'destructive',
} as const

function duration(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_000) return `${value} ms`
  return `${(value / 1_000).toFixed(1)} s`
}

function targetReason(target: TestTarget, intelligence: PullRequestTestIntelligence): string {
  const source = intelligence.analysis?.result.validationTargets.find((candidate) => candidate.id === target.id)
  if (source) return source.reason
  return `Covers affected project ${target.projectLabel}`
}

function RunResult({
  run,
  log,
  loadingLog,
  repairing,
  verifying,
  autoRepairing,
  onLoadLog,
  onRepair,
  onVerifyRepair,
  onAutoRepair,
  onCancelRepairLoop,
}: {
  run: ValidationRun
  log: string | undefined
  loadingLog: boolean
  repairing: boolean
  verifying: boolean
  autoRepairing: boolean
  onLoadLog(): void
  onRepair(): void
  onVerifyRepair(): void
  onAutoRepair(): void
  onCancelRepairLoop(): void
}) {
  const canRepair = run.status === 'failed' || run.status === 'timed-out'
  return (
    <Card size="sm" variant={run.status === 'failed' || run.status === 'timed-out' ? 'subtle' : 'default'}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {run.status === 'passed' ? <CheckCircle2 /> : canRepair ? <CircleX /> : <FlaskConical />}
          {run.target.label}
          <Badge variant={statusVariant[run.status]}>{run.status}</Badge>
          {run.freshness === 'stale' && <Badge variant="destructive">stale</Badge>}
          {run.repairLoop && (
            <Badge
              variant={run.repairLoop.state === 'active' ? 'outline' : run.repairLoop.state === 'completed' ? 'secondary' : 'destructive'}
            >
              auto repair {run.repairLoop.state} · {run.repairLoop.attemptCount}/{run.repairLoop.maxAttempts}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {duration(run.durationMs)} · base {run.baseComparison.replaceAll('_', ' ')} · {run.failures.length} normalized failure
          {run.failures.length === 1 ? '' : 's'}
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button variant="outline" size="sm" disabled={loadingLog} onClick={onLoadLog}>
            <ScrollText data-icon="inline-start" />
            {log === undefined ? (loadingLog ? 'Loading…' : 'View log') : 'Refresh log'}
          </Button>
          {canRepair &&
            (run.repairLoop?.state === 'active' ? (
              <Button variant="outline" size="sm" onClick={onCancelRepairLoop}>
                <Square data-icon="inline-start" /> Stop auto repair
              </Button>
            ) : run.repairJobId ? (
              <Button size="sm" disabled={verifying} onClick={onVerifyRepair}>
                <RefreshCw data-icon="inline-start" />
                {verifying ? 'Verifying…' : 'Verify repair'}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" disabled={autoRepairing || repairing} onClick={onAutoRepair}>
                  <Repeat2 data-icon="inline-start" />
                  {autoRepairing ? 'Starting loop…' : 'Auto-repair · max 3'}
                </Button>
                <Button size="sm" disabled={repairing || autoRepairing} onClick={onRepair}>
                  <Bot data-icon="inline-start" />
                  {repairing ? 'Starting…' : 'Repair with agent'}
                </Button>
              </>
            ))}
        </CardAction>
      </CardHeader>
      {!!run.failures.length && (
        <CardContent className="flex flex-col gap-2">
          {run.failures.slice(0, 20).map((failure) => (
            <div key={failure.fingerprint} className="rounded-md border bg-background p-2">
              <strong className="block text-sm">{failure.test || failure.suite || failure.message}</strong>
              {(failure.path || failure.line) && (
                <span className="font-mono text-xs text-muted-foreground">
                  {failure.path || 'unknown'}
                  {failure.line ? `:${failure.line}${failure.column ? `:${failure.column}` : ''}` : ''}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      )}
      {log !== undefined && (
        <CardContent>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">{log || 'No output'}</pre>
          {run.outputTruncated && (
            <p className="mt-2 text-xs text-muted-foreground">The stored output was truncated at the server limit.</p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function TestIntelligenceView({
  intelligence,
  running,
  logs = {},
  loadingLogId = null,
  repairingRunId = null,
  verifyingRunId = null,
  autoRepairingRunId = null,
  onRun,
  onRefresh,
  onLoadLog,
  onRepair,
  onVerifyRepair,
  onAutoRepair,
  onCancelRepairLoop,
}: {
  intelligence: PullRequestTestIntelligence
  running: boolean
  logs?: Record<number, string>
  loadingLogId?: number | null
  repairingRunId?: number | null
  verifyingRunId?: number | null
  autoRepairingRunId?: number | null
  onRun(targetIds: string[]): void
  onRefresh(): void
  onLoadLog(runId: number): void
  onRepair(runId: number): void
  onVerifyRepair(runId: number): void
  onAutoRepair(runId: number): void
  onCancelRepairLoop(runId: number): void
}) {
  const analysis = intelligence.analysis
  const selection = intelligence.selection
  if (!analysis || !intelligence.catalog || !selection) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConical />
          </EmptyMedia>
          <EmptyTitle>Impact analysis is required</EmptyTitle>
          <EmptyDescription>Analyze the current pull-request revision before selecting validation targets.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Test intelligence
            <Badge variant="outline">{selection.selected.length} selected</Badge>
            {!!selection.coverageGaps.length && <Badge variant="destructive">{selection.coverageGaps.length} gaps</Badge>}
          </CardTitle>
          <CardDescription>
            Revision {selection.revision.slice(0, 8)} · {intelligence.catalog.packageManager} catalog · every omission remains explicit
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="sm" disabled={running} onClick={onRefresh}>
              <RefreshCw data-icon="inline-start" /> Refresh
            </Button>
            <Button
              size="sm"
              disabled={running || !selection.selected.length || analysis.freshness === 'stale'}
              onClick={() => onRun(selection.selected.map((target) => target.id))}
            >
              <Play data-icon="inline-start" /> {running ? 'Running…' : 'Run selected'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-2 lg:grid-cols-2">
          {selection.selected.map((target) => (
            <div key={target.id} className="flex min-w-0 items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <strong className="block truncate text-sm">{target.label}</strong>
                <span className="block text-xs text-muted-foreground">{targetReason(target, intelligence)}</span>
                <code className="mt-1 block truncate text-xs text-muted-foreground">
                  {target.executable} {target.args.join(' ')}
                </code>
              </div>
              <Button variant="outline" size="sm" disabled={running || analysis.freshness === 'stale'} onClick={() => onRun([target.id])}>
                <Play data-icon="inline-start" /> Run
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      {!!selection.coverageGaps.length && (
        <Card size="sm" variant="subtle">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle /> Coverage gaps
            </CardTitle>
            <CardDescription>These gaps prevent the recommendation from claiming complete validation coverage.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {selection.coverageGaps.map((gap, index) => (
              <p key={`${gap.code}:${gap.path || index}`} className="text-sm">
                {gap.message}
                {gap.path ? <span className="ml-2 font-mono text-xs text-muted-foreground">{gap.path}</span> : null}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {intelligence.runs.map((run) => (
        <RunResult
          key={run.id}
          run={run}
          log={logs[run.id]}
          loadingLog={loadingLogId === run.id}
          repairing={repairingRunId === run.id}
          verifying={verifyingRunId === run.id}
          autoRepairing={autoRepairingRunId === run.id}
          onLoadLog={() => onLoadLog(run.id)}
          onRepair={() => onRepair(run.id)}
          onVerifyRepair={() => onVerifyRepair(run.id)}
          onAutoRepair={() => onAutoRepair(run.id)}
          onCancelRepairLoop={() => onCancelRepairLoop(run.id)}
        />
      ))}
    </div>
  )
}

export function TestIntelligencePanel({ repositoryId, pullRequestNumber, className }: TestIntelligencePanelProps) {
  const [intelligence, setIntelligence] = useState<PullRequestTestIntelligence | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<Record<number, string>>({})
  const [loadingLogId, setLoadingLogId] = useState<number | null>(null)
  const [repairingRunId, setRepairingRunId] = useState<number | null>(null)
  const [verifyingRunId, setVerifyingRunId] = useState<number | null>(null)
  const [autoRepairingRunId, setAutoRepairingRunId] = useState<number | null>(null)
  const endpoint = useMemo(() => `/api/pulls/${repositoryId}/${pullRequestNumber}`, [pullRequestNumber, repositoryId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setIntelligence(await api<PullRequestTestIntelligence>(`${endpoint}/test-intelligence`))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setIntelligence(null)
    setLogs({})
    void load()
  }, [load])

  useEffect(() => {
    if (!intelligence?.runs.some((run) => run.repairLoop?.state === 'active')) return
    const interval = window.setInterval(() => void load(), 5_000)
    return () => window.clearInterval(interval)
  }, [intelligence, load])

  const run = useCallback(
    async (targetIds: string[]) => {
      setRunning(true)
      try {
        const result = await api<{ runs: ValidationRun[]; errors: Array<{ targetId: string; message: string }> }>(
          `${endpoint}/validation-runs`,
          {
            method: 'POST',
            body: JSON.stringify({ targetIds, requestId: crypto.randomUUID() }),
          },
        )
        if (result.errors.length)
          toast.error(`${result.errors.length} validation target${result.errors.length === 1 ? '' : 's'} could not run`)
        else toast.success(`${result.runs.length} validation target${result.runs.length === 1 ? '' : 's'} completed`)
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setRunning(false)
      }
    },
    [endpoint, load],
  )

  const loadLog = useCallback(
    async (runId: number) => {
      setLoadingLogId(runId)
      try {
        const result = await api<{ output: string }>(`/api/repositories/${repositoryId}/validation-runs/${runId}/log`)
        setLogs((current) => ({ ...current, [runId]: result.output }))
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setLoadingLogId(null)
      }
    },
    [repositoryId],
  )

  const repair = useCallback(
    async (runId: number) => {
      setRepairingRunId(runId)
      try {
        await api(`/api/repositories/${repositoryId}/validation-runs/${runId}/repair`, { method: 'POST' })
        toast.success('Repair Work started')
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setRepairingRunId(null)
      }
    },
    [load, repositoryId],
  )

  const verifyRepair = useCallback(
    async (runId: number) => {
      setVerifyingRunId(runId)
      try {
        const result = await api<{
          runs: ValidationRun[]
          stoppedReason: 'failed_target' | 'repeated_fingerprint' | 'broader_impact' | null
        }>(`/api/repositories/${repositoryId}/validation-runs/${runId}/repair/verify`, {
          method: 'POST',
          body: JSON.stringify({ requestId: crypto.randomUUID() }),
        })
        if (result.stoppedReason === 'broader_impact') toast.warning('Repair changed the impact set; review and run the broader selection')
        else if (result.stoppedReason === 'repeated_fingerprint')
          toast.error('Repair stopped because the same failure fingerprint repeated')
        else if (result.stoppedReason) toast.error('Repair verification still has a failing target')
        else toast.success(`${result.runs.length} repair validation target${result.runs.length === 1 ? '' : 's'} passed`)
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setVerifyingRunId(null)
      }
    },
    [load, repositoryId],
  )

  const autoRepair = useCallback(
    async (runId: number) => {
      setAutoRepairingRunId(runId)
      try {
        await api(`/api/repositories/${repositoryId}/validation-runs/${runId}/repair-loop`, {
          method: 'POST',
          body: JSON.stringify({ maxAttempts: 3, maxElapsedMinutes: 120 }),
        })
        toast.success('Bounded auto-repair started with a maximum of 3 attempts and 2 hours')
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setAutoRepairingRunId(null)
      }
    },
    [load, repositoryId],
  )

  const cancelRepairLoop = useCallback(
    async (runId: number) => {
      try {
        await api(`/api/repositories/${repositoryId}/validation-runs/${runId}/repair-loop/cancel`, { method: 'POST' })
        toast.success('Automatic repair scheduling stopped; existing Work and logs were retained')
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
    [load, repositoryId],
  )

  if (loading && !intelligence) {
    return (
      <Card className={className} aria-label="Loading test intelligence">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    )
  }
  if (!intelligence) return null
  return (
    <div className={className}>
      <TestIntelligenceView
        intelligence={intelligence}
        running={running}
        logs={logs}
        loadingLogId={loadingLogId}
        repairingRunId={repairingRunId}
        verifyingRunId={verifyingRunId}
        autoRepairingRunId={autoRepairingRunId}
        onRun={(targetIds) => void run(targetIds)}
        onRefresh={() => void load()}
        onLoadLog={(runId) => void loadLog(runId)}
        onRepair={(runId) => void repair(runId)}
        onVerifyRepair={(runId) => void verifyRepair(runId)}
        onAutoRepair={(runId) => void autoRepair(runId)}
        onCancelRepairLoop={(runId) => void cancelRepairLoop(runId)}
      />
    </div>
  )
}
