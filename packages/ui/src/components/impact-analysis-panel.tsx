import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, GitCompareArrows, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ImpactAnalysis, ImpactAnalysisFeedback, ImpactNode } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'

type ImpactAnalysisPanelProps = {
  repositoryId: number
  pullRequestNumber: number
  className?: string
}

type WorkImpactAnalysisPanelProps = {
  workItemId: number
  className?: string
}

const riskVariant = {
  low: 'outline',
  medium: 'secondary',
  high: 'destructive',
} as const

function shortRevision(value: string): string {
  return value.slice(0, 8)
}

function projectNodes(analysis: ImpactAnalysis): ImpactNode[] {
  return analysis.result.nodes.filter((node) => node.kind === 'project' || node.kind === 'package')
}

function ImpactLoading({ className }: { className?: string }) {
  return (
    <div className={className} aria-label="Loading impact analysis">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    </div>
  )
}

function ImpactEmpty({ running, onAnalyze, className }: { running: boolean; onAnalyze(): void; className?: string }) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitCompareArrows />
        </EmptyMedia>
        <EmptyTitle>No impact analysis for this revision</EmptyTitle>
        <EmptyDescription>
          Analyze the pull request to find affected projects, downstream consumers, required validations, contracts, and delivery changes.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button disabled={running} onClick={onAnalyze}>
          <RefreshCw data-icon="inline-start" />
          {running ? 'Analyzing…' : 'Analyze impact'}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function ImpactSummary({ analysis }: { analysis: ImpactAnalysis }) {
  const summary = analysis.result.summary
  const values = [
    { label: 'Changed files', value: analysis.result.changedFiles.length },
    { label: 'Direct projects', value: summary.directProjects },
    { label: 'Consumers', value: summary.transitiveProjects },
    { label: 'Required checks', value: summary.requiredValidations },
    { label: 'Delivery effects', value: summary.deliveryEffects },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {values.map((item) => (
        <div key={item.label} className="rounded-md border bg-muted/20 p-3">
          <strong className="block font-mono text-lg tabular-nums">{item.value}</strong>
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function AffectedProjects({ analysis }: { analysis: ImpactAnalysis }) {
  const projects = projectNodes(analysis)
  return (
    <Card size="sm" layout="divided">
      <CardHeader>
        <CardTitle>Affected projects</CardTitle>
        <CardDescription>Direct owners and transitive workspace consumers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {projects.map((project) => (
          <div key={project.key} className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{project.label}</strong>
              <span className="block truncate font-mono text-xs text-muted-foreground">{project.path}</span>
            </div>
            <Badge variant={project.direct ? 'default' : 'secondary'}>{project.direct ? 'Direct' : 'Consumer'}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function RequiredValidations({ analysis }: { analysis: ImpactAnalysis }) {
  return (
    <Card size="sm" layout="divided">
      <CardHeader>
        <CardTitle>Required validation</CardTitle>
        <CardDescription>Source-backed scripts selected for the affected projects.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {analysis.result.validationTargets.map((target) => (
          <div key={target.id} className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{target.projectLabel}</strong>
              <span className="block truncate text-xs text-muted-foreground">{target.reason}</span>
            </div>
            <Badge variant="outline">{target.script}</Badge>
          </div>
        ))}
        {!analysis.result.validationTargets.length && (
          <p className="text-xs text-muted-foreground">No validation scripts were discovered for the affected projects.</p>
        )}
      </CardContent>
    </Card>
  )
}

type ImpactEdge = ImpactAnalysis['result']['edges'][number]

function ImpactReasons({ analysis }: { analysis: ImpactAnalysis }) {
  const labels = useMemo(() => new Map(analysis.result.nodes.map((node) => [node.key, node.label])), [analysis.result.nodes])
  const columns = useMemo<DataTableColumn<ImpactEdge>[]>(
    () => [
      {
        id: 'from',
        header: 'From',
        cell: ({ row }) => <span className="block max-w-64 truncate">{labels.get(row.original.from) || row.original.from}</span>,
      },
      {
        id: 'relationship',
        header: 'Relationship',
        cell: ({ row }) => <Badge variant="outline">{row.original.relation.replaceAll('_', ' ')}</Badge>,
      },
      {
        id: 'to',
        header: 'To',
        cell: ({ row }) => <span className="block max-w-64 truncate">{labels.get(row.original.to) || row.original.to}</span>,
      },
      {
        id: 'evidence',
        header: 'Evidence',
        cell: ({ row }) => (
          <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground">
            {row.original.sourcePath || row.original.summary}
          </span>
        ),
      },
    ],
    [labels],
  )
  const rows = analysis.result.edges.slice(0, 100)
  return (
    <Card size="sm" layout="divided">
      <CardHeader>
        <CardTitle>Reason chain</CardTitle>
        <CardDescription>Why each project, validation, or delivery surface is included.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(edge) => `${edge.from}:${edge.to}:${edge.relation}:${edge.sourcePath || edge.summary}`}
        />
        {analysis.result.edges.length > 100 && (
          <p className="p-3 text-xs text-muted-foreground">Showing the first 100 of {analysis.result.edges.length} reason edges.</p>
        )}
      </CardContent>
    </Card>
  )
}

function ImpactWarnings({ analysis }: { analysis: ImpactAnalysis }) {
  if (!analysis.result.warnings.length) return null
  return (
    <Card size="sm" variant="subtle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle /> Analysis limitations
        </CardTitle>
        <CardDescription>These gaps lower confidence; they are not treated as successful checks.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {analysis.result.warnings.map((warning, index) => (
          <div key={`${warning.code}:${warning.path || index}`}>
            <strong className="text-sm">{warning.message}</strong>
            {warning.path && <p className="font-mono text-xs text-muted-foreground">{warning.path}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ImpactFeedbackPanel({ analysis }: { analysis: ImpactAnalysis }) {
  const [feedback, setFeedback] = useState<ImpactAnalysisFeedback[]>([])
  const [kind, setKind] = useState<ImpactAnalysisFeedback['kind']>('false_positive')
  const [nodeKey, setNodeKey] = useState('')
  const [comment, setComment] = useState('')
  const [actor, setActor] = useState('local-user')
  const [submitting, setSubmitting] = useState(false)
  const endpoint = `/api/repositories/${analysis.subject.repositoryId}/impact-analyses/${analysis.id}/feedback`

  useEffect(() => {
    api<{ feedback: ImpactAnalysisFeedback[] }>(endpoint)
      .then((result) => setFeedback(result.feedback))
      .catch(() => undefined)
  }, [endpoint])

  const submit = useCallback(async () => {
    setSubmitting(true)
    try {
      const created = await api<ImpactAnalysisFeedback>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ kind, nodeKey: kind === 'false_positive' ? nodeKey : null, comment, actor }),
      })
      setFeedback((current) => [created, ...current])
      setComment('')
      toast.success('Impact feedback recorded separately from analyzer truth')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [actor, comment, endpoint, kind, nodeKey])

  return (
    <Card size="sm" layout="divided">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Analyzer feedback
          {!!feedback.length && <Badge variant="outline">{feedback.length}</Badge>}
        </CardTitle>
        <CardDescription>Record false positives or missing relationships without rewriting the deterministic result.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Label className="grid gap-1.5">
          Feedback kind
          <Select value={kind} onValueChange={(value) => setKind(value as ImpactAnalysisFeedback['kind'])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false_positive">False-positive node</SelectItem>
              <SelectItem value="missing_relationship">Missing relationship</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        {kind === 'false_positive' ? (
          <Label className="grid gap-1.5">
            Affected node
            <Select value={nodeKey} onValueChange={(value) => setNodeKey(value || '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a node" />
              </SelectTrigger>
              <SelectContent>
                {analysis.result.nodes.map((node) => (
                  <SelectItem key={node.key} value={node.key}>
                    {node.label} · {node.kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        ) : (
          <div />
        )}
        <Label className="grid gap-1.5">
          Actor
          <Input value={actor} maxLength={200} onChange={(event) => setActor(event.target.value)} />
        </Label>
        <Label className="grid gap-1.5 sm:col-span-2">
          Evidence and expected relationship
          <Textarea value={comment} maxLength={2_000} onChange={(event) => setComment(event.target.value)} />
        </Label>
        <div className="flex justify-end sm:col-span-2">
          <Button
            disabled={submitting || !actor.trim() || !comment.trim() || (kind === 'false_positive' && !nodeKey)}
            onClick={() => void submit()}
          >
            {submitting ? 'Recording…' : 'Record feedback'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ImpactAnalysisView({ analysis, running, onRefresh }: { analysis: ImpactAnalysis; running: boolean; onRefresh(): void }) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Change impact
            <Badge variant={riskVariant[analysis.result.summary.risk]}>{analysis.result.summary.risk} risk</Badge>
            <Badge variant={analysis.freshness === 'stale' ? 'destructive' : 'outline'}>{analysis.freshness}</Badge>
          </CardTitle>
          <CardDescription>
            {shortRevision(analysis.subject.baseRevision)} → {shortRevision(analysis.subject.headRevision)} · analyzer{' '}
            {analysis.resultVersion}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" disabled={running} onClick={onRefresh}>
              <RefreshCw data-icon="inline-start" />
              {running ? 'Refreshing…' : 'Refresh'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ImpactSummary analysis={analysis} />
        </CardContent>
      </Card>
      {analysis.freshness === 'stale' && (
        <Card size="sm" variant="subtle">
          <CardHeader>
            <CardTitle>Analysis is stale</CardTitle>
            <CardDescription>
              The pull-request head changed after this result was captured. Refresh before using it as evidence.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <AffectedProjects analysis={analysis} />
        <RequiredValidations analysis={analysis} />
      </div>
      <ImpactWarnings analysis={analysis} />
      <ImpactFeedbackPanel analysis={analysis} />
      <ImpactReasons analysis={analysis} />
    </div>
  )
}

export function ImpactAnalysisPanel({ repositoryId, pullRequestNumber, className }: ImpactAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const endpoint = useMemo(() => `/api/pulls/${repositoryId}/${pullRequestNumber}/impact-analysis`, [pullRequestNumber, repositoryId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ analysis: ImpactAnalysis | null }>(endpoint)
      setAnalysis(result.analysis)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setAnalysis(null)
    void load()
  }, [load])

  const analyze = useCallback(async () => {
    setRunning(true)
    try {
      const value = await api<ImpactAnalysis>(endpoint, { method: 'POST' })
      setAnalysis(value)
      toast.success('Impact analysis completed')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRunning(false)
    }
  }, [endpoint])

  if (loading && !analysis) return <ImpactLoading className={className} />
  if (!analysis) return <ImpactEmpty className={className} running={running} onAnalyze={() => void analyze()} />
  return (
    <div className={className}>
      <ImpactAnalysisView analysis={analysis} running={running} onRefresh={() => void analyze()} />
    </div>
  )
}

export function WorkImpactAnalysisPanel({ workItemId, className }: WorkImpactAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const endpoint = useMemo(() => `/api/work-items/${workItemId}/impact-analysis`, [workItemId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ analysis: ImpactAnalysis | null }>(endpoint)
      setAnalysis(result.analysis)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setAnalysis(null)
    void load()
  }, [load])

  const analyze = useCallback(async () => {
    setRunning(true)
    try {
      setAnalysis(await api<ImpactAnalysis>(endpoint, { method: 'POST' }))
      toast.success('Work impact analysis completed')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRunning(false)
    }
  }, [endpoint])

  if (loading && !analysis) return <ImpactLoading className={className} />
  if (!analysis) return <ImpactEmpty className={className} running={running} onAnalyze={() => void analyze()} />
  return (
    <div className={className}>
      <ImpactAnalysisView analysis={analysis} running={running} onRefresh={() => void analyze()} />
    </div>
  )
}
