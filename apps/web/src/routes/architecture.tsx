import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Boxes, FileText, Network, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ArchitectureIndex } from '@vertexade/platform-contracts'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

export const Route = createFileRoute('/architecture')({
  ssr: false,
  component: ArchitecturePage,
})

type ArchitectureNode = ArchitectureIndex['result']['nodes'][number]

function architectureNodeSource(node: ArchitectureNode): string {
  return node.citations[0]?.path ?? node.path ?? 'Repository root'
}

function architectureNodeDigest(node: ArchitectureNode): string {
  const digest = node.citations[0]?.digest
  return digest ? ` · ${digest.slice(0, 8)}` : ''
}

function RepositoryArchitectureView({ index }: { index: ArchitectureIndex }) {
  const columns = useMemo<DataTableColumn<ArchitectureNode>[]>(
    () => [
      {
        id: 'boundary',
        header: 'Boundary',
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: ({ row }) => <Badge variant="outline">{row.original.kind}</Badge>,
      },
      {
        id: 'summary',
        header: 'Summary',
        cell: ({ row }) => row.original.summary || 'Observed repository boundary',
      },
      {
        id: 'source',
        header: 'Source',
        cell: ({ row }) => (
          <span className="block max-w-80 truncate font-mono text-xs text-muted-foreground">
            {architectureNodeSource(row.original)}
            {architectureNodeDigest(row.original)}
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {index.result.repositoryName}
            <Badge variant="outline">{index.freshness}</Badge>
            {!!index.warningCount && <Badge variant="destructive">{index.warningCount} warnings</Badge>}
          </CardTitle>
          <CardDescription>
            Revision {index.result.revision.slice(0, 8)} · deterministic index {index.resultVersion}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(index.result.summary).map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 p-3">
              <strong className="block font-mono text-lg">{value}</strong>
              <span className="text-xs text-muted-foreground">{label.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      {!!index.result.warnings.length && (
        <Card size="sm" variant="subtle">
          <CardHeader>
            <CardTitle>Stale, conflicting, or incomplete sources</CardTitle>
            <CardDescription>Warnings remain visible and are never silently resolved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {index.result.warnings.map((warning, position) => (
              <p key={`${warning.code}:${warning.path || position}`} className="text-sm">
                {warning.message} {warning.path && <span className="font-mono text-xs text-muted-foreground">{warning.path}</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      <Card size="sm" layout="divided">
        <CardHeader>
          <CardTitle>System boundaries and contracts</CardTitle>
          <CardDescription>Every displayed fact retains a path and captured-revision digest.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} data={index.result.nodes} getRowId={(node) => node.key} />
        </CardContent>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card size="sm" layout="divided">
          <CardHeader>
            <CardTitle>Architecture decisions</CardTitle>
            <CardDescription>ADR status and supersession remain source-backed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {index.result.decisions.map((decision) => (
              <div key={decision.id} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">{decision.title}</strong>
                  <Badge variant="outline">{decision.status}</Badge>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">{decision.citation.path}</p>
              </div>
            ))}
            {!index.result.decisions.length && <p className="text-xs text-muted-foreground">No ADR-style decisions were discovered.</p>}
          </CardContent>
        </Card>
        <Card size="sm" layout="divided">
          <CardHeader>
            <CardTitle>Dependency direction</CardTitle>
            <CardDescription>Observed relations with confidence and exact evidence paths.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {index.result.relations.slice(0, 100).map((relation, position) => (
              <div key={`${relation.from}:${relation.to}:${relation.relation}:${position}`} className="rounded-md border p-2 text-sm">
                <span className="font-medium">{relation.from}</span> {relation.relation.replaceAll('_', ' ')}{' '}
                <span className="font-medium">{relation.to}</span>
                <p className="truncate font-mono text-xs text-muted-foreground">{relation.citation.path}</p>
              </div>
            ))}
            {!index.result.relations.length && (
              <p className="text-xs text-muted-foreground">No cross-boundary relations were discovered.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ArchitecturePage() {
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const [repositoryId, setRepositoryId] = useState<number | null>(null)
  const [index, setIndex] = useState<ArchitectureIndex | null>(null)
  const [loading, setLoading] = useState(false)
  const selected = useMemo(() => repositories.find((repository) => repository.id === repositoryId) || null, [repositories, repositoryId])

  useEffect(() => {
    if (!repositoryId && repositories[0]) setRepositoryId(repositories[0].id)
  }, [repositories, repositoryId])

  const load = useCallback(async () => {
    if (!repositoryId) return
    setLoading(true)
    try {
      const result = await api<{ index: ArchitectureIndex | null }>(`/api/repositories/${repositoryId}/architecture-index`)
      setIndex(result.index)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [repositoryId])

  useEffect(() => {
    setIndex(null)
    void load()
  }, [load])

  const rebuild = useCallback(async () => {
    if (!repositoryId) return
    setLoading(true)
    try {
      setIndex(
        await api<ArchitectureIndex>(`/api/repositories/${repositoryId}/architecture-index`, {
          method: 'POST',
          body: JSON.stringify({ revision: 'HEAD' }),
        }),
      )
      toast.success('Architecture index rebuilt')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [repositoryId])

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={
          <>
            <Network className="size-3" /> Source-backed system context
          </>
        }
        title="Architecture"
        description="Browse deterministic repository boundaries, contracts, decisions, dependency direction, and documentation conflicts."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              value={repositoryId ? String(repositoryId) : ''}
              onValueChange={(value) => setRepositoryId(value ? Number(value) : null)}
            >
              <SelectTrigger className="w-64 max-w-full">
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
            <Button variant="outline" disabled={loading || !selected} onClick={() => void rebuild()}>
              <RefreshCw data-icon="inline-start" /> {loading ? 'Indexing…' : index ? 'Rebuild' : 'Build index'}
            </Button>
          </div>
        }
      />
      {index ? (
        <RepositoryArchitectureView index={index} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Boxes />
            </EmptyMedia>
            <EmptyTitle>{loading ? 'Loading architecture…' : 'No architecture index yet'}</EmptyTitle>
            <EmptyDescription>
              Build an immutable index from manifests, contracts, deployments, extensions, documentation, and ADRs on the repository owner.
            </EmptyDescription>
          </EmptyHeader>
          {!loading && selected && (
            <EmptyContent>
              <Button onClick={() => void rebuild()}>
                <FileText data-icon="inline-start" /> Build {selected.full_name}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
    </WorkspacePage>
  )
}
