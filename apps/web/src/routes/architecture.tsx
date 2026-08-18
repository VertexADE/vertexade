import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { BookOpen, Boxes, Code2, FileText, Map, Network, RefreshCw, RotateCcw, Search, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { ArchitectureIndex } from '@vertexade/platform-contracts'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Input } from '@vertexade/ui/components/ui/input'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { DevelopmentIntelligencePanel } from '../components/development/development-intelligence-panel'
import { DevelopmentRepositorySelect } from '../components/development/development-repository-select'
import { MermaidDiagram } from '@vertexade/ui/components/mermaid-diagram'
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

function containsSearch(query: string, values: Array<string | null | undefined>) {
  const normalized = query.trim().toLowerCase()
  return !normalized || values.some((value) => value?.toLowerCase().includes(normalized))
}

function ArchitectureDiagramWorkspace({ index }: { index: ArchitectureIndex }) {
  const generated = index.result.diagram || ''
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState(generated)
  const [preview, setPreview] = useState(generated)

  useEffect(() => {
    setEditing(false)
    setSource(generated)
    setPreview(generated)
  }, [generated, index.id])

  useEffect(() => {
    const timeout = window.setTimeout(() => setPreview(source), 220)
    return () => window.clearTimeout(timeout)
  }, [source])

  if (!generated) return null
  const modified = source !== generated
  return (
    <Card size="sm" className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Architecture map
          <Badge variant="outline">{modified ? 'Preview modified' : 'Generated from source'}</Badge>
        </CardTitle>
        <CardDescription>
          Connected system boundaries are prioritized for readability. Complete uncapped evidence remains available below.
        </CardDescription>
        <CardAction className="flex gap-1">
          {modified ? (
            <Button variant="ghost" size="sm" onClick={() => setSource(generated)}>
              <RotateCcw data-icon="inline-start" /> Reset
            </Button>
          ) : null}
          <Button variant={editing ? 'secondary' : 'outline'} size="sm" onClick={() => setEditing((value) => !value)}>
            <Code2 data-icon="inline-start" /> {editing ? 'Close source' : 'Edit preview'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <div className={editing ? 'grid min-h-0 lg:grid-cols-[minmax(20rem,0.7fr)_minmax(0,1.3fr)]' : ''}>
          {editing ? (
            <div className="flex min-h-0 flex-col gap-2 border-b bg-muted/10 p-3 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">Mermaid source</span>
                <span className="text-muted-foreground">Preview only · not persisted</span>
              </div>
              <Textarea
                value={source}
                onChange={(event) => setSource(event.target.value)}
                aria-label="Edit Mermaid preview source"
                className="min-h-72 flex-1 resize-none font-mono text-xs leading-relaxed lg:min-h-[32rem]"
                spellCheck={false}
              />
            </div>
          ) : null}
          <MermaidDiagram
            chart={preview}
            title={`${index.result.repositoryName} architecture`}
            downloadName={`${index.result.repositoryName.replaceAll('/', '-')}-architecture.svg`}
            className="m-0 rounded-none border-0"
            viewportClassName="min-h-[28rem] max-h-[70dvh]"
          />
        </div>
      </CardContent>
    </Card>
  )
}

function RepositoryArchitectureView({ index }: { index: ArchitectureIndex }) {
  const [query, setQuery] = useState('')
  const filteredNodes = useMemo(
    () =>
      index.result.nodes.filter((node) =>
        containsSearch(query, [node.label, node.kind, node.summary, node.path, ...node.citations.map((citation) => citation.path)]),
      ),
    [index.result.nodes, query],
  )
  const filteredRelations = useMemo(
    () =>
      index.result.relations.filter((relation) =>
        containsSearch(query, [relation.from, relation.to, relation.relation, relation.summary, relation.citation.path]),
      ),
    [index.result.relations, query],
  )
  const filteredDecisions = useMemo(
    () =>
      index.result.decisions.filter((decision) =>
        containsSearch(query, [decision.id, decision.title, decision.status, decision.scope, decision.citation.path]),
      ),
    [index.result.decisions, query],
  )
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
      <section className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{index.result.repositoryName}</h2>
            <Badge variant="outline">{index.freshness}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Revision <span className="font-mono">{index.result.revision.slice(0, 8)}</span> · index {index.resultVersion}
          </p>
        </div>
        <dl className="grid grid-cols-5 gap-x-4 gap-y-1">
          {Object.entries(index.result.summary).map(([label, value]) => (
            <div key={label} className="min-w-0 text-center">
              <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
              <dt className="truncate text-[10px] capitalize text-muted-foreground">{label.replaceAll('_', ' ')}</dt>
            </div>
          ))}
        </dl>
      </section>
      {!!index.result.warnings.length && (
        <details className="rounded-lg border border-amber-500/25 bg-amber-500/[.04]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-amber-500">
            <TriangleAlert className="size-3.5" /> {index.result.warnings.length} source warning
            {index.result.warnings.length === 1 ? '' : 's'}
            <span className="font-normal text-muted-foreground">Review stale, conflicting, or incomplete evidence</span>
          </summary>
          <div className="flex flex-col gap-2 border-t px-3 py-2">
            {index.result.warnings.map((warning, position) => (
              <p key={`${warning.code}:${warning.path || position}`} className="text-xs">
                {warning.message} {warning.path && <span className="font-mono text-xs text-muted-foreground">{warning.path}</span>}
              </p>
            ))}
          </div>
        </details>
      )}
      <ArchitectureDiagramWorkspace index={index} />
      <Card size="sm" layout="divided" className="overflow-hidden">
        <CardHeader>
          <CardTitle>Architecture evidence</CardTitle>
          <CardDescription>Filter complete source-backed boundaries, decisions, and directed relations.</CardDescription>
          <CardAction>
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter evidence…"
                aria-label="Filter architecture evidence"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue="boundaries" className="gap-0">
            <TabsList variant="line" className="mx-3 mt-1 w-fit">
              <TabsTrigger value="boundaries">Boundaries {filteredNodes.length}</TabsTrigger>
              <TabsTrigger value="relations">Relations {filteredRelations.length}</TabsTrigger>
              <TabsTrigger value="decisions">Decisions {filteredDecisions.length}</TabsTrigger>
            </TabsList>
            <TabsContent value="boundaries" className="mt-0">
              {filteredNodes.length ? (
                <DataTable columns={nodeColumns} data={filteredNodes} getRowId={(node) => node.key} />
              ) : (
                <EvidenceEmpty query={query} label="boundaries" />
              )}
            </TabsContent>
            <TabsContent value="relations" className="mt-0">
              {filteredRelations.length ? (
                <DataTable
                  columns={relationColumns}
                  data={filteredRelations}
                  getRowId={(relation, position) => `${relation.from}:${relation.to}:${relation.relation}:${position}`}
                />
              ) : (
                <EvidenceEmpty query={query} label="relations" />
              )}
            </TabsContent>
            <TabsContent value="decisions" className="mt-0">
              {filteredDecisions.length ? (
                <DataTable columns={decisionColumns} data={filteredDecisions} getRowId={(decision) => decision.id} />
              ) : (
                <EvidenceEmpty query={query} label="decisions" />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

function EvidenceEmpty({ query, label }: { query: string; label: string }) {
  return (
    <p className="border-t p-5 text-center text-xs text-muted-foreground">
      {query.trim() ? `No ${label} match “${query.trim()}”.` : `No ${label} were discovered.`}
    </p>
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
