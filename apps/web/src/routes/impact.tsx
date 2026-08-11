import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { GitCompareArrows, Play } from 'lucide-react'
import { toast } from 'sonner'
import type { ImpactAnalysis } from '@vertexade/platform-contracts'
import { ImpactAnalysisView } from '@vertexade/ui/components/impact-analysis-panel'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { DevelopmentIntelligencePanel } from '../components/development/development-intelligence-panel'
import { DevelopmentRepositorySelect } from '../components/development/development-repository-select'
import { useDevelopmentRepositorySelection } from '../lib/development-intelligence'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

export const Route = createFileRoute('/impact')({
  ssr: false,
  component: ImpactExplorerPage,
})

function useImpactComparison(repositoryId: number | null, baseRevision: string, headRevision: string) {
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => setAnalysis(null), [repositoryId])

  const analyze = useCallback(async () => {
    if (!repositoryId) return
    setRunning(true)
    try {
      setAnalysis(
        await api<ImpactAnalysis>(`/api/repositories/${repositoryId}/impact-analyses`, {
          method: 'POST',
          body: JSON.stringify({ baseRevision, headRevision }),
        }),
      )
      toast.success('Repository comparison analyzed')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRunning(false)
    }
  }, [baseRevision, headRevision, repositoryId])

  return { analysis, running, analyze }
}

function ImpactComparisonCard({
  repositories,
  repositoryId,
  selected,
  baseRevision,
  headRevision,
  running,
  onRepositoryChange,
  onBaseRevisionChange,
  onHeadRevisionChange,
  onAnalyze,
}: {
  repositories: Repository[]
  repositoryId: number | null
  selected: Repository | null
  baseRevision: string
  headRevision: string
  running: boolean
  onRepositoryChange(value: number | null): void
  onBaseRevisionChange(value: string): void
  onHeadRevisionChange(value: string): void
  onAnalyze(): void
}) {
  const requiredValues = [selected, baseRevision.trim(), headRevision.trim()]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparison</CardTitle>
        <CardDescription>Refs are resolved to commits and the merge base is captured before analysis.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup className="md:grid-cols-[minmax(14rem,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end">
          <Field>
            <FieldLabel>Repository</FieldLabel>
            <DevelopmentRepositorySelect repositories={repositories} value={repositoryId} onValueChange={onRepositoryChange} />
          </Field>
          <Field>
            <FieldLabel htmlFor="impact-base-revision">Base revision</FieldLabel>
            <Input id="impact-base-revision" value={baseRevision} onChange={(event) => onBaseRevisionChange(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="impact-head-revision">Head revision</FieldLabel>
            <Input id="impact-head-revision" value={headRevision} onChange={(event) => onHeadRevisionChange(event.target.value)} />
          </Field>
          <Button disabled={running || !requiredValues.every(Boolean)} onClick={onAnalyze}>
            <Play data-icon="inline-start" /> {running ? 'Analyzing…' : 'Analyze'}
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function ImpactAnalysisContent({
  analysis,
  selected,
  running,
  onRefresh,
}: {
  analysis: ImpactAnalysis | null
  selected: Repository | null
  running: boolean
  onRefresh(): void
}) {
  if (analysis) {
    return (
      <div className="flex flex-col gap-3">
        <ImpactAnalysisView analysis={analysis} running={running} onRefresh={onRefresh} />
        <DevelopmentIntelligencePanel
          kind="impact_analysis"
          repositoryId={analysis.subject.repositoryId}
          artifactId={analysis.id}
          sourceGraph={analysis.result.sourceGraph}
        />
      </div>
    )
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitCompareArrows />
        </EmptyMedia>
        <EmptyTitle>{selected ? 'Choose revisions to compare' : 'No repository selected'}</EmptyTitle>
        <EmptyDescription>
          Analysis runs on the owning server and records source-backed reason edges, incomplete-analysis warnings, and revision identity.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ImpactExplorerPage() {
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const { repositoryId, setRepositoryId, selected } = useDevelopmentRepositorySelection(repositories)
  const [baseRevision, setBaseRevision] = useState('HEAD~1')
  const [headRevision, setHeadRevision] = useState('HEAD')
  const { analysis, running, analyze } = useImpactComparison(repositoryId, baseRevision, headRevision)

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={
          <>
            <GitCompareArrows className="size-3" /> Explainable repository comparison
          </>
        }
        title="Impact explorer"
        description="Compare two immutable Git revisions and trace affected projects, contracts, validation targets, and delivery paths on the repository owner."
      />
      <ImpactComparisonCard
        repositories={repositories}
        repositoryId={repositoryId}
        selected={selected}
        baseRevision={baseRevision}
        headRevision={headRevision}
        running={running}
        onRepositoryChange={setRepositoryId}
        onBaseRevisionChange={setBaseRevision}
        onHeadRevisionChange={setHeadRevision}
        onAnalyze={() => void analyze()}
      />
      <ImpactAnalysisContent analysis={analysis} selected={selected} running={running} onRefresh={() => void analyze()} />
    </WorkspacePage>
  )
}
