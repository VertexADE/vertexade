import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { GitCompareArrows, Play } from 'lucide-react'
import { toast } from 'sonner'
import type { ImpactAnalysis } from '@vertexade/platform-contracts'
import { ImpactAnalysisView } from '@vertexade/ui/components/impact-analysis-panel'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

export const Route = createFileRoute('/impact')({
  ssr: false,
  component: ImpactExplorerPage,
})

function ImpactExplorerPage() {
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
  const [baseRevision, setBaseRevision] = useState('HEAD~1')
  const [headRevision, setHeadRevision] = useState('HEAD')
  const [analysis, setAnalysis] = useState<ImpactAnalysis | null>(null)
  const [running, setRunning] = useState(false)
  const selected = useMemo(() => repositories.find((repository) => repository.id === repositoryId) || null, [repositories, repositoryId])

  useEffect(() => {
    if (!repositoryId && repositories[0]) setRepositoryId(repositories[0].id)
  }, [repositories, repositoryId])

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
      <Card>
        <CardHeader>
          <CardTitle>Comparison</CardTitle>
          <CardDescription>Refs are resolved to commits and the merge base is captured before analysis.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(14rem,1.5fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end">
          <Label className="grid gap-1.5">
            Repository
            <Select value={repositoryId ? String(repositoryId) : ''} onValueChange={(value) => setRepositoryId(Number(value))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select repository" />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((repository) => (
                  <SelectItem key={repository.id} value={String(repository.id)}>
                    {repository.full_name} · {repository.backend_name || 'Local'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1.5">
            Base revision
            <Input value={baseRevision} onChange={(event) => setBaseRevision(event.target.value)} />
          </Label>
          <Label className="grid gap-1.5">
            Head revision
            <Input value={headRevision} onChange={(event) => setHeadRevision(event.target.value)} />
          </Label>
          <Button disabled={running || !selected || !baseRevision.trim() || !headRevision.trim()} onClick={() => void analyze()}>
            <Play data-icon="inline-start" /> {running ? 'Analyzing…' : 'Analyze'}
          </Button>
        </CardContent>
      </Card>
      {analysis ? (
        <ImpactAnalysisView analysis={analysis} running={running} onRefresh={() => void analyze()} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitCompareArrows />
            </EmptyMedia>
            <EmptyTitle>{selected ? 'Choose revisions to compare' : 'No repository selected'}</EmptyTitle>
            <EmptyDescription>
              Analysis runs on the owning server and records source-backed reason edges, incomplete-analysis warnings, and revision
              identity.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </WorkspacePage>
  )
}
