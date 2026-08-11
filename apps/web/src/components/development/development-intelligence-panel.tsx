import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Archive, BookCheck, Bot, ExternalLink, GitCommitHorizontal, History, Network, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type {
  DevelopmentArtifactKind,
  DevelopmentIntelligenceOverview,
  DevelopmentInvestigation,
  DevelopmentKnowledgeEntry,
  DevelopmentSourceGraphSummary,
} from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
import { DataTable, type DataTableColumn } from '@vertexade/ui/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { useDevelopmentIntelligenceOverview } from '../../lib/development-intelligence'
import { InvestigationDialog, KnowledgePromotionDialog, type KnowledgeDraft } from './development-intelligence-dialogs'

const emptyDraft: KnowledgeDraft = {
  sourceJobId: null,
  supersedesEntryId: null,
  title: '',
  summary: '',
}

function timestamp(value: string | null): string {
  if (!value) return 'In progress'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function shortDigest(value: string): string {
  return value ? value.slice(0, 10) : 'unavailable'
}

export function InvestigationTable({
  investigations,
  onOpen,
  onPromote,
}: {
  investigations: DevelopmentInvestigation[]
  onOpen(investigation: DevelopmentInvestigation): void
  onPromote(investigation: DevelopmentInvestigation): void
}) {
  const columns = useMemo<DataTableColumn<DevelopmentInvestigation>[]>(
    () => [
      {
        id: 'work',
        header: 'Work',
        cell: ({ row }) => (
          <div className="max-w-72">
            <div className="flex items-center gap-2">
              <strong>{row.original.workItemKey}</strong>
              <Badge variant={['failed', 'cancelled'].includes(row.original.status) ? 'destructive' : 'outline'}>
                {row.original.status}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{row.original.title}</p>
          </div>
        ),
      },
      {
        id: 'agent',
        header: 'Agent runtime',
        cell: ({ row }) => (
          <div className="text-xs">
            <p className="font-medium">{row.original.agentId}</p>
            <p className="text-muted-foreground">
              {[row.original.model, row.original.reasoningEffort].filter(Boolean).join(' · ') || 'Configured default'}
            </p>
          </div>
        ),
      },
      {
        id: 'finding',
        header: 'Latest finding',
        cell: ({ row }) => (
          <p className="max-w-[34rem] text-xs leading-relaxed text-muted-foreground">
            {row.original.resultSummary || row.original.latestActivity || 'The investigation has not produced a summary yet.'}
          </p>
        ),
      },
      {
        id: 'evidence',
        header: 'Evidence',
        cell: ({ row }) => (
          <div className="font-mono text-[11px] text-muted-foreground">
            <p>{shortDigest(row.original.revision)}</p>
            <p>{shortDigest(row.original.digest)}</p>
            <p className="font-sans">{timestamp(row.original.finishedAt || row.original.createdAt)}</p>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => onOpen(row.original)}>
              <ExternalLink data-icon="inline-start" /> Open
            </Button>
            <Button size="sm" variant="outline" disabled={!row.original.resultSummary} onClick={() => onPromote(row.original)}>
              <BookCheck data-icon="inline-start" /> Promote
            </Button>
          </div>
        ),
      },
    ],
    [onOpen, onPromote],
  )

  return (
    <DataTable
      columns={columns}
      data={investigations}
      getRowId={(investigation) => String(investigation.jobId)}
      caption="Persistent read-only investigations linked to this exact artifact."
      cellClassName={(column) => (column === 'actions' ? 'text-right' : undefined)}
    />
  )
}

export function KnowledgeTable({
  knowledge,
  archivingId,
  onSupersede,
  onArchive,
}: {
  knowledge: DevelopmentKnowledgeEntry[]
  archivingId: number | null
  onSupersede(entry: DevelopmentKnowledgeEntry): void
  onArchive(entry: DevelopmentKnowledgeEntry): void
}) {
  const columns = useMemo<DataTableColumn<DevelopmentKnowledgeEntry>[]>(
    () => [
      {
        id: 'knowledge',
        header: 'Accepted knowledge',
        cell: ({ row }) => (
          <div className="max-w-[38rem]">
            <div className="flex flex-wrap items-center gap-1.5">
              <strong className="text-sm">{row.original.title}</strong>
              <Badge variant="outline">{row.original.kind}</Badge>
              <Badge variant={row.original.freshness === 'current' ? 'secondary' : 'destructive'}>{row.original.freshness}</Badge>
              {row.original.status !== 'accepted' && <Badge variant="outline">{row.original.status}</Badge>}
            </div>
            <MarkdownContent content={row.original.summary} className="mt-1 text-xs text-muted-foreground" />
          </div>
        ),
      },
      {
        id: 'scope',
        header: 'Scope',
        cell: ({ row }) => (
          <div className="max-w-64 text-xs">
            <p className="font-medium">{row.original.scope}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {row.original.path || row.original.boundaryKey || 'Entire repository'}
            </p>
          </div>
        ),
      },
      {
        id: 'provenance',
        header: 'Provenance',
        cell: ({ row }) => (
          <div className="max-w-64 text-[11px] text-muted-foreground">
            <p>
              {row.original.source.label}
              {row.original.source.jobId ? ` · thread #${row.original.source.jobId}` : ''}
            </p>
            <p className="font-mono">
              {shortDigest(row.original.source.revision)} · {shortDigest(row.original.source.digest)}
            </p>
            <p>
              {row.original.actor} · {row.original.confidence} confidence
            </p>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.status === 'accepted' && (
              <Button size="sm" variant="ghost" onClick={() => onSupersede(row.original)}>
                <RefreshCw data-icon="inline-start" /> Supersede
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={archivingId === row.original.id} onClick={() => onArchive(row.original)}>
              {archivingId === row.original.id ? <Spinner data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
              Archive
            </Button>
          </div>
        ),
      },
    ],
    [archivingId, onArchive, onSupersede],
  )

  return (
    <DataTable
      columns={columns}
      data={knowledge}
      getRowId={(entry) => String(entry.id)}
      caption="Human-reviewed knowledge with immutable source provenance and visible freshness."
      cellClassName={(column) => (column === 'actions' ? 'text-right' : undefined)}
    />
  )
}

function IntelligenceEmpty({ icon, title, description }: { icon: 'investigation' | 'knowledge'; title: string; description: string }) {
  return (
    <Empty className="min-h-56">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon === 'investigation' ? <Bot /> : <BookCheck />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function InvestigationContent({
  investigations,
  onOpen,
  onPromote,
}: {
  investigations: DevelopmentInvestigation[]
  onOpen(investigation: DevelopmentInvestigation): void
  onPromote(investigation: DevelopmentInvestigation): void
}) {
  if (!investigations.length) {
    return (
      <IntelligenceEmpty
        icon="investigation"
        title="No investigation history"
        description="Start a read-only agent thread to examine this exact artifact and retain it as Work."
      />
    )
  }
  return <InvestigationTable investigations={investigations} onOpen={onOpen} onPromote={onPromote} />
}

function KnowledgeContent({
  knowledge,
  archivingId,
  onSupersede,
  onArchive,
}: {
  knowledge: DevelopmentKnowledgeEntry[]
  archivingId: number | null
  onSupersede(entry: DevelopmentKnowledgeEntry): void
  onArchive(entry: DevelopmentKnowledgeEntry): void
}) {
  if (!knowledge.length) {
    return (
      <IntelligenceEmpty
        icon="knowledge"
        title="No accepted repository knowledge"
        description="Promote a reviewed finding or add a source-backed fact, decision, constraint, risk, pattern, or owner."
      />
    )
  }
  return <KnowledgeTable knowledge={knowledge} archivingId={archivingId} onSupersede={onSupersede} onArchive={onArchive} />
}

function ContextSnapshot({
  overview,
  sourceGraph,
}: {
  overview: DevelopmentIntelligenceOverview
  sourceGraph?: DevelopmentSourceGraphSummary
}) {
  return (
    <div className="p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-muted/15 p-3">
          <p className="text-xs font-medium">Artifact revision</p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{overview.artifact.revision}</p>
        </div>
        <div className="rounded-lg border bg-muted/15 p-3">
          <p className="text-xs font-medium">Artifact digest</p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{overview.artifact.digest}</p>
        </div>
        <div className="rounded-lg border bg-muted/15 p-3">
          <p className="text-xs font-medium">Accepted knowledge snapshot</p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{overview.acceptedKnowledgeDigest}</p>
        </div>
        <div className="rounded-lg border bg-muted/15 p-3">
          <p className="text-xs font-medium">Source graph</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {sourceGraph
              ? `${sourceGraph.sourceFileCount} files · ${sourceGraph.edgeCount} edges · ${shortDigest(sourceGraph.digest)}`
              : 'Older artifact without graph metadata'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-xs font-medium">Related revision-matched artifacts</p>
        {overview.relatedArtifacts.map((artifact) => (
          <div key={`${artifact.kind}:${artifact.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
            <Badge variant="outline">{artifact.kind.replaceAll('_', ' ')}</Badge>
            <span className="font-medium">#{artifact.id}</span>
            <span className="min-w-0 flex-1 text-muted-foreground">{artifact.summary}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{shortDigest(artifact.digest)}</span>
          </div>
        ))}
        {!overview.relatedArtifacts.length && (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No matching Impact or Architecture artifact exists at this revision yet. Investigations still receive accepted repository
            knowledge.
          </p>
        )}
      </div>
    </div>
  )
}

function IntelligenceTabs({
  overview,
  sourceGraph,
  defaultTab,
  archivingId,
  onOpenInvestigation,
  onPromoteInvestigation,
  onSupersedeKnowledge,
  onArchiveKnowledge,
}: {
  overview: DevelopmentIntelligenceOverview
  sourceGraph?: DevelopmentSourceGraphSummary
  defaultTab: 'investigations' | 'knowledge' | 'context'
  archivingId: number | null
  onOpenInvestigation(investigation: DevelopmentInvestigation): void
  onPromoteInvestigation(investigation: DevelopmentInvestigation): void
  onSupersedeKnowledge(entry: DevelopmentKnowledgeEntry): void
  onArchiveKnowledge(entry: DevelopmentKnowledgeEntry): void
}) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-0">
      <TabsList className="mx-3 mt-2 max-w-[calc(100%-1.5rem)] overflow-x-auto" variant="line">
        <TabsTrigger value="investigations">
          <History data-icon="inline-start" /> Investigations
        </TabsTrigger>
        <TabsTrigger value="knowledge">
          <BookCheck data-icon="inline-start" /> Knowledge
        </TabsTrigger>
        <TabsTrigger value="context">
          <GitCommitHorizontal data-icon="inline-start" /> Context snapshot
        </TabsTrigger>
      </TabsList>
      <TabsContent value="investigations">
        <InvestigationContent investigations={overview.investigations} onOpen={onOpenInvestigation} onPromote={onPromoteInvestigation} />
      </TabsContent>
      <TabsContent value="knowledge">
        <KnowledgeContent
          knowledge={overview.knowledge}
          archivingId={archivingId}
          onSupersede={onSupersedeKnowledge}
          onArchive={onArchiveKnowledge}
        />
      </TabsContent>
      <TabsContent value="context">
        <ContextSnapshot overview={overview} sourceGraph={sourceGraph} />
      </TabsContent>
    </Tabs>
  )
}

function IntelligenceContent({
  overview,
  sourceGraph,
  defaultTab,
  loading,
  error,
  archivingId,
  onRetry,
  onOpenInvestigation,
  onPromoteInvestigation,
  onSupersedeKnowledge,
  onArchiveKnowledge,
}: {
  overview: DevelopmentIntelligenceOverview | undefined
  sourceGraph?: DevelopmentSourceGraphSummary
  defaultTab: 'investigations' | 'knowledge' | 'context'
  loading: boolean
  error: Error | null
  archivingId: number | null
  onRetry(): void
  onOpenInvestigation(investigation: DevelopmentInvestigation): void
  onPromoteInvestigation(investigation: DevelopmentInvestigation): void
  onSupersedeKnowledge(entry: DevelopmentKnowledgeEntry): void
  onArchiveKnowledge(entry: DevelopmentKnowledgeEntry): void
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
        <Spinner /> Loading intelligence…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-medium">Development intelligence could not be loaded</p>
        <p className="max-w-xl text-xs text-muted-foreground">{error.message}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" /> Retry
        </Button>
      </div>
    )
  }
  if (!overview) return null
  return (
    <IntelligenceTabs
      overview={overview}
      sourceGraph={sourceGraph}
      defaultTab={defaultTab}
      archivingId={archivingId}
      onOpenInvestigation={onOpenInvestigation}
      onPromoteInvestigation={onPromoteInvestigation}
      onSupersedeKnowledge={onSupersedeKnowledge}
      onArchiveKnowledge={onArchiveKnowledge}
    />
  )
}

export function DevelopmentIntelligencePanel({
  kind,
  repositoryId,
  artifactId,
  sourceGraph,
  defaultTab = 'investigations',
  title = 'Development intelligence',
  description = 'Investigate immutable evidence in persistent read-only Work, then explicitly promote reviewed findings into reusable repository knowledge.',
}: {
  kind: DevelopmentArtifactKind
  repositoryId: number
  artifactId: number
  sourceGraph?: DevelopmentSourceGraphSummary
  defaultTab?: 'investigations' | 'knowledge' | 'context'
  title?: string
  description?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { artifactPath, queryKey, query } = useDevelopmentIntelligenceOverview(kind, repositoryId, artifactId)
  const [investigationOpen, setInvestigationOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft>(emptyDraft)
  const archiveMutation = useMutation({
    mutationFn: (entryId: number) =>
      api(`${`/api/repositories/${repositoryId}/development-knowledge/${entryId}/archive`}`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
      toast.success('Repository knowledge archived')
    },
    onError: (error) => toast.error(error.message),
  })

  const openNewKnowledge = () => {
    setKnowledgeDraft(emptyDraft)
    setKnowledgeOpen(true)
  }
  const promoteInvestigation = (investigation: DevelopmentInvestigation) => {
    setKnowledgeDraft({
      sourceJobId: investigation.jobId,
      supersedesEntryId: null,
      title: '',
      summary: investigation.resultSummary || '',
    })
    setKnowledgeOpen(true)
  }
  const supersedeKnowledge = (entry: DevelopmentKnowledgeEntry) => {
    setKnowledgeDraft({
      sourceJobId: entry.source.jobId,
      supersedesEntryId: entry.id,
      title: entry.title,
      summary: entry.summary,
    })
    setKnowledgeOpen(true)
  }

  const overview = query.data
  return (
    <Card layout="divided">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Network className="size-4" /> {title}
          {overview && (
            <Badge variant="secondary">{overview.knowledge.filter((entry) => entry.status === 'accepted').length} accepted</Badge>
          )}
          {overview && <Badge variant="outline">{overview.investigations.length} investigations</Badge>}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setInvestigationOpen(true)}>
            <Bot data-icon="inline-start" /> Investigate
          </Button>
          <Button size="sm" onClick={openNewKnowledge}>
            <Plus data-icon="inline-start" /> Add knowledge
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <IntelligenceContent
          overview={overview}
          sourceGraph={sourceGraph}
          defaultTab={defaultTab}
          loading={query.isLoading}
          error={query.error}
          archivingId={archiveMutation.isPending ? archiveMutation.variables : null}
          onRetry={() => void query.refetch()}
          onOpenInvestigation={(investigation) =>
            void navigate({
              to: '/threads/$threadId',
              params: { threadId: String(investigation.jobId) },
            })
          }
          onPromoteInvestigation={promoteInvestigation}
          onSupersedeKnowledge={supersedeKnowledge}
          onArchiveKnowledge={(entry) => archiveMutation.mutate(entry.id)}
        />
      </CardContent>
      <InvestigationDialog open={investigationOpen} onOpenChange={setInvestigationOpen} artifactPath={artifactPath} queryKey={queryKey} />
      <KnowledgePromotionDialog
        open={knowledgeOpen}
        onOpenChange={setKnowledgeOpen}
        artifactPath={artifactPath}
        queryKey={queryKey}
        draft={knowledgeDraft}
        knowledge={overview?.knowledge || []}
      />
    </Card>
  )
}
