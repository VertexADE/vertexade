import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { BookOpen, Boxes, FileText, Map, Network, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ArchitectureIndex } from '@vertexade/platform-contracts'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { DevelopmentIntelligencePanel } from '../components/development/development-intelligence-panel'
import { DevelopmentRepositorySelect } from '../components/development/development-repository-select'
import { ThreadMarkdownContent } from '@vertexade/ui/components/thread-markdown-content'
import { useDevelopmentRepositorySelection } from '../lib/development-intelligence'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

export const Route = createFileRoute('/architecture')({
  ssr: false,
  component: ArchitecturePage,
})

type ArchitectureNode = ArchitectureIndex['result']['nodes'][number]
type ArchitectureRelation = ArchitectureIndex['result']['relations'][number]
type ArchitectureDecision = ArchitectureIndex['result']['decisions'][number]

function architectureNodeSource(node: ArchitectureNode): string {
  return node.citations[0]?.path ?? node.path ?? 'Repository root'
}

function architectureNodeDigest(node: ArchitectureNode): string {
  const digest = node.citations[0]?.digest
  return digest ? ` · ${digest.slice(0, 8)}` : ''
}

function RepositoryArchitectureView({ index }: { index: ArchitectureIndex }) {
  const nodeColumns = useMemo<DataTableColumn<ArchitectureNode>[]>(
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
  const relationColumns = useMemo<DataTableColumn<ArchitectureRelation>[]>(
    () => [
      {
        id: 'from',
        header: 'Consumer / owner',
        cell: ({ row }) => <span className="block max-w-80 truncate font-mono text-xs">{row.original.from}</span>,
      },
      {
        id: 'relation',
        header: 'Relation',
        cell: ({ row }) => <Badge variant="outline">{row.original.relation.replaceAll('_', ' ')}</Badge>,
      },
      {
        id: 'to',
        header: 'Provider / boundary',
        cell: ({ row }) => <span className="block max-w-80 truncate font-mono text-xs">{row.original.to}</span>,
      },
      {
        id: 'evidence',
        header: 'Observed evidence',
        cell: ({ row }) => (
          <div className="max-w-[38rem] text-xs">
            <p>{row.original.summary}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.citation.path}
              {row.original.citation.startLine ? `:${row.original.citation.startLine}` : ''} · {row.original.confidence}
            </p>
          </div>
        ),
      },
    ],
    [],
  )
  const decisionColumns = useMemo<DataTableColumn<ArchitectureDecision>[]>(
    () => [
      {
        id: 'decision',
        header: 'Decision',
        cell: ({ row }) => (
          <div className="max-w-[34rem]">
            <strong className="text-sm">{row.original.title}</strong>
            <p className="font-mono text-[11px] text-muted-foreground">{row.original.id}</p>
          </div>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge> },
      {
        id: 'scope',
        header: 'Scope and lineage',
        cell: ({ row }) => (
          <div className="max-w-72 text-xs text-muted-foreground">
            <p>{row.original.scope || 'Repository-wide or unspecified'}</p>
            {row.original.supersedes && <p>Supersedes {row.original.supersedes}</p>}
          </div>
        ),
      },
      {
        id: 'citation',
        header: 'Source',
        cell: ({ row }) => <span className="font-mono text-[11px] text-muted-foreground">{row.original.citation.path}</span>,
      },
    ],
    [],
  )
  return (
    <div className="flex flex-col gap-3">
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
          <CardContent className="flex flex-col gap-2">
            {index.result.warnings.map((warning, position) => (
              <p key={`${warning.code}:${warning.path || position}`} className="text-sm">
                {warning.message} {warning.path && <span className="font-mono text-xs text-muted-foreground">{warning.path}</span>}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
      {index.result.diagram ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Architecture diagram</CardTitle>
            <CardDescription>Generated from the same source-backed boundaries, relations, and ADRs shown below.</CardDescription>
          </CardHeader>
          <CardContent>
            <ThreadMarkdownContent content={`\`\`\`mermaid\n${index.result.diagram}\n\`\`\``} />
          </CardContent>
        </Card>
      ) : null}
      <Card size="sm" layout="divided">
        <CardHeader>
          <CardTitle>System boundaries and contracts</CardTitle>
          <CardDescription>Every displayed fact retains a path and captured-revision digest.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={nodeColumns} data={index.result.nodes} getRowId={(node) => node.key} />
        </CardContent>
      </Card>
      <Card size="sm" layout="divided">
        <CardHeader>
          <CardTitle>Architecture decisions</CardTitle>
          <CardDescription>Complete ADR status, scope, supersession lineage, and source citations.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {index.result.decisions.length ? (
            <DataTable columns={decisionColumns} data={index.result.decisions} getRowId={(decision) => decision.id} />
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No ADR-style decisions were discovered.</p>
          )}
        </CardContent>
      </Card>
      <Card size="sm" layout="divided">
        <CardHeader>
          <CardTitle>Dependency direction</CardTitle>
          <CardDescription>
            Every observed manifest and source-level relation, including confidence, exact path, line, and direction. Results are not
            silently capped.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {index.result.relations.length ? (
            <DataTable
              columns={relationColumns}
              data={index.result.relations}
              getRowId={(relation, position) => `${relation.from}:${relation.to}:${relation.relation}:${position}`}
            />
          ) : (
            <p className="p-4 text-xs text-muted-foreground">No cross-boundary relations were discovered.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function useRepositoryArchitecture(repositoryId: number | null) {
  const [index, setIndex] = useState<ArchitectureIndex | null>(null)
  const [loading, setLoading] = useState(false)

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

  return { index, loading, rebuild }
}

function ArchitectureActions({
  repositories,
  repositoryId,
  selected,
  index,
  loading,
  onRepositoryChange,
  onRebuild,
}: {
  repositories: Repository[]
  repositoryId: number | null
  selected: Repository | null
  index: ArchitectureIndex | null
  loading: boolean
  onRepositoryChange(value: number | null): void
  onRebuild(): void
}) {
  const actionLabel = loading ? 'Indexing…' : index ? 'Rebuild' : 'Build index'
  return (
    <div className="flex flex-wrap gap-2">
      <DevelopmentRepositorySelect
        repositories={repositories}
        value={repositoryId}
        onValueChange={onRepositoryChange}
        className="w-64 max-w-full"
      />
      <Button variant="outline" disabled={loading || !selected} onClick={onRebuild}>
        <RefreshCw data-icon="inline-start" /> {actionLabel}
      </Button>
    </div>
  )
}

function ArchitectureContent({
  index,
  selected,
  loading,
  onRebuild,
}: {
  index: ArchitectureIndex | null
  selected: Repository | null
  loading: boolean
  onRebuild(): void
}) {
  if (index) {
    return (
      <Tabs defaultValue="system-map" className="gap-3">
        <TabsList variant="line" className="w-fit max-w-full overflow-x-auto">
          <TabsTrigger value="system-map">
            <Map data-icon="inline-start" /> System map
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <BookOpen data-icon="inline-start" /> Knowledge base
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system-map" className="mt-0">
          <RepositoryArchitectureView index={index} />
        </TabsContent>
        <TabsContent value="knowledge" className="mt-0">
          <DevelopmentIntelligencePanel
            kind="architecture_index"
            repositoryId={index.subject.repositoryId}
            artifactId={index.id}
            sourceGraph={index.result.sourceGraph}
            defaultTab="knowledge"
            title="Repository knowledge base"
            description="Shared, repository-scoped facts, decisions, constraints, risks, patterns, and ownership notes. Every entry remains linked to immutable source evidence and can be superseded without losing history."
          />
        </TabsContent>
      </Tabs>
    )
  }
  return <ArchitectureEmpty selected={selected} loading={loading} onRebuild={onRebuild} />
}

function ArchitectureEmpty({ selected, loading, onRebuild }: { selected: Repository | null; loading: boolean; onRebuild(): void }) {
  return (
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
          <Button onClick={onRebuild}>
            <FileText data-icon="inline-start" /> Build {selected.full_name}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function ArchitecturePage() {
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const { repositoryId, setRepositoryId, selected } = useDevelopmentRepositorySelection(repositories)
  const { index, loading, rebuild } = useRepositoryArchitecture(repositoryId)

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={
          <>
            <Network className="size-3" /> Source-backed system context
          </>
        }
        title="Architecture"
        description="Understand the current system map and maintain shared, source-backed knowledge for the selected repository."
        actions={
          <ArchitectureActions
            repositories={repositories}
            repositoryId={repositoryId}
            selected={selected}
            index={index}
            loading={loading}
            onRepositoryChange={setRepositoryId}
            onRebuild={() => void rebuild()}
          />
        }
      />
      <ArchitectureContent index={index} selected={selected} loading={loading} onRebuild={() => void rebuild()} />
    </WorkspacePage>
  )
}
