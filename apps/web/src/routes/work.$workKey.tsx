import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { ModuleCatalog, WorkItemWorkspaceMode, WorkResourcePresentation } from '@vertexade/platform-contracts'
import {
  Archive,
  ArrowLeft,
  ArrowRightLeft,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Container,
  Copy,
  ExternalLink,
  FileSearch,
  GitBranch,
  GitPullRequest,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import {
  AgentResourcePicker,
  emptyAgentResourceSelection,
  useAgentResourceSelection,
  type AgentResourceSelection,
} from '@vertexade/ui/components/agent-resource-picker'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { EntityTabBar } from '@vertexade/ui/components/entity-workspace'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { RepositoryMultiSelect } from '@vertexade/ui/components/repository-multi-select'
import { SequentialWorkOption } from '@vertexade/ui/components/sequential-work-option'
import { resourceReference, WorkReferencePicker } from '@vertexade/ui/components/work-reference-picker'
import { WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@vertexade/ui/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import { activityPreview } from '@vertexade/ui/lib/activity-preview'
import { agentIsWorking, agentThreadLabel, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { age, api, isWorkBoardEvent, subscribeToDashboardEvents } from '@vertexade/ui/lib/dashboard-api'
import type {
  Repository,
  WorkDeletionPreview,
  WorkDeletionResult,
  WorkItem,
  WorkLaunchResult,
  WorkMemory,
  WorkReferenceSelection,
  WorkState,
} from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import {
  dialogNavigationOptions,
  pullRequestDialogItem,
  selectedPullRequest,
  workDetailSearch,
  type WorkDetailSection,
} from '@vertexade/ui/lib/work-dialogs'
import { WorkDetailHeader, WorkLifecycle } from '../components/work/work-detail-header'
import { EditWorkDialog } from '../components/work/work-edit-dialog'
import {
  WorkActionBar,
  WorkDetails,
  WorkFocusPanel,
  WorkLinks,
  WorkMobileOverview,
  WorkThreads,
} from '../components/work/work-detail-overview'
import { WorkActivityTimeline } from '../components/work/work-activity-timeline'
import { DeleteWorkDialog, StartThreadDialog, UpfrontReviewDialog, WorkMemoryCard } from '../components/work/work-detail-panels'
import { LazyPrDetailsDialog, LazyThreadDialog } from '../lib/lazy-dialogs'
import { preventBlockedWorkCompletion } from '../lib/work-completion'

export const Route = createFileRoute('/work/$workKey')({
  ssr: false,
  validateSearch: workDetailSearch,
  component: WorkDetail,
})

function WorkDetail() {
  const { workKey } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const isMobile = useIsMobile()
  const [item, setItem] = useState<WorkItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [startOpen, setStartOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [resourcePresentations, setResourcePresentations] = useState<Record<string, WorkResourcePresentation>>({})

  const load = useCallback(async () => {
    try {
      const [workItem, catalog] = await Promise.all([
        api<WorkItem>(`/api/work-items/${encodeURIComponent(workKey)}`),
        api<ModuleCatalog>('/api/modules'),
      ])
      setItem(workItem)
      setResourcePresentations(
        Object.fromEntries(
          catalog.modules
            .filter((module) => module.enabled)
            .flatMap((module) => module.ui?.workResources || [])
            .map((presentation) => [presentation.kind, presentation]),
        ),
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workKey])
  useEffect(() => {
    void load()
    return subscribeToDashboardEvents(() => {
      void load()
      setRevision((value) => value + 1)
    }, isWorkBoardEvent)
  }, [load])

  async function move(state: WorkState) {
    if (!item || preventBlockedWorkCompletion(item, state, toast.info)) return
    setSaving(true)
    try {
      setItem(
        await api<WorkItem>(`/api/work-items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ state, reason: 'Moved from the Work detail screen' }),
        }),
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (!item) return
    try {
      await api(`/api/work-items/${item.id}/archive`, { method: 'POST' })
      toast.success(`${item.key} archived`)
      void navigate({ to: '/' })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  if (loading)
    return (
      <WorkspacePage className="grid min-h-[70svh] place-items-center text-sm text-muted-foreground">
        <span>
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          Loading work…
        </span>
      </WorkspacePage>
    )
  if (!item)
    return (
      <WorkspacePage className="grid min-h-[70svh] place-items-center">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Work item not found</h1>
          <Button asChild variant="outline" className="mt-3">
            <Link to="/">Back to Work</Link>
          </Button>
        </div>
      </WorkspacePage>
    )

  const pr = item.resources
    .filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
    .sort((left, right) => right.is_primary - left.is_primary)[0]
  const dialogPr = selectedPullRequest(item.resources, item.threads, search)
  const activeSection = search.section || 'overview'
  const changeSection = (section: WorkDetailSection) =>
    void navigate({
      search: (current) => ({ ...current, section }),
      replace: true,
      resetScroll: false,
    })
  const closeDialog = () =>
    void navigate({
      search: { section: search.section },
      replace: true,
      ...dialogNavigationOptions,
    })
  const openRun = (jobId: number) => {
    if (isMobile) {
      void navigate({ to: '/threads/$threadId', params: { threadId: String(jobId) } })
      return
    }
    void navigate({ search: (current) => ({ ...current, thread: jobId }), ...dialogNavigationOptions })
  }
  const openPullRequest = (resource: WorkItem['resources'][number]) => {
    const target = pullRequestDialogItem(resource, item.threads)
    if (!target) return
    if (isMobile) {
      void navigate({
        to: '/pull-requests/$repoId/$prNumber',
        params: { repoId: String(target.repo_id), prNumber: String(target.number) },
      })
      return
    }
    void navigate({
      search: (current) => ({ ...current, repo: target.repo_id, pr: target.number }),
      ...dialogNavigationOptions,
    })
  }
  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href)
    toast.success('Work link copied')
  }
  return (
    <WorkspacePage className="pb-24 pt-2 sm:pb-6 sm:pt-4">
      <WorkDetailHeader item={item} onEdit={() => setEditOpen(true)} />
      <section className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border/70 bg-card/55 [&>div:first-child]:contents sm:mb-4 sm:block sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-card/[.08] sm:[&>div:first-child]:grid">
        <div className="md:grid-cols-[minmax(0,1fr)_auto]">
          <WorkFocusPanel item={item} pullRequest={pr} />
          <WorkActionBar
            item={item}
            pullRequest={pr}
            onOpenRun={openRun}
            onOpenPullRequest={openPullRequest}
            onStartWork={() => setStartOpen(true)}
            onStartReview={() => setReviewOpen(true)}
            onCopy={copyLink}
            onArchive={() => void archive()}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
        <WorkLifecycle
          item={item}
          saving={saving}
          onMove={(state) => void move(state)}
          onResumeAutomatic={() => {
            void api<WorkItem>(`/api/work-items/${item.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ clear_state_override: true }),
            })
              .then(setItem)
              .catch((error) => toast.error((error as Error).message))
          }}
        />
      </section>

      <Tabs value={activeSection} onValueChange={(value) => changeSection(value as WorkDetailSection)} className="gap-2 sm:gap-4">
        <EntityTabBar>
          <TabsList variant="line" className="flex h-9 w-max min-w-full gap-1 p-0 sm:h-8 sm:w-fit sm:min-w-0">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Timeline</TabsTrigger>
            <TabsTrigger value="threads">
              Threads <span className="hidden text-muted-foreground sm:inline">({item.threads.length})</span>
            </TabsTrigger>
            <TabsTrigger value="links">
              Links <span className="hidden text-muted-foreground sm:inline">({item.resources.length})</span>
            </TabsTrigger>
            <TabsTrigger value="memory">Details</TabsTrigger>
          </TabsList>
        </EntityTabBar>
        <TabsContent value="overview" className="mt-0">
          <WorkMobileOverview item={item} onOpenRun={openRun} onSectionChange={changeSection} />
        </TabsContent>
        <TabsContent value="activity" className="mt-0">
          <WorkActivityTimeline item={item} onOpenRun={openRun} onOpenPullRequest={openPullRequest} />
        </TabsContent>
        <TabsContent value="threads" className="mt-0">
          <WorkThreads item={item} onOpenRun={openRun} onStartWork={() => setStartOpen(true)} onStartReview={() => setReviewOpen(true)} />
        </TabsContent>
        <TabsContent value="links" className="mt-0">
          <WorkLinks item={item} pullRequest={pr} onOpenPullRequest={openPullRequest} />
        </TabsContent>
        <TabsContent value="memory" className="mt-0">
          <WorkDetails
            item={item}
            presentations={resourcePresentations}
            onOpenPullRequest={openPullRequest}
            onDelete={() => setDeleteOpen(true)}
          >
            <WorkMemoryCard item={item} revision={revision} />
          </WorkDetails>
        </TabsContent>
      </Tabs>
      <EditWorkDialog item={item} open={editOpen} onOpenChange={setEditOpen} onSaved={setItem} />
      <StartThreadDialog item={item} open={startOpen} onOpenChange={setStartOpen} onStarted={load} />
      <UpfrontReviewDialog
        item={item}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onStarted={(jobId) => {
          void load()
          if (jobId) openRun(jobId)
        }}
      />
      <DeleteWorkDialog
        item={item}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => void navigate({ to: '/' })}
        onRetry={load}
      />
      {dialogPr && (
        <LazyBoundary label="pull request details" resetKey={`${dialogPr.repo_id}:${dialogPr.number}`}>
          <LazyPrDetailsDialog
            pr={dialogPr}
            onOpenChange={(open) => {
              if (!open) closeDialog()
            }}
            onOpenRun={openRun}
            actions={{
              onStartWork: () => {
                closeDialog()
                setStartOpen(true)
              },
              onStartReview: () => {
                closeDialog()
                setReviewOpen(true)
              },
            }}
          />
        </LazyBoundary>
      )}
      {search.thread && (
        <LazyBoundary label="agent thread" resetKey={search.thread}>
          <LazyThreadDialog
            jobId={search.thread}
            onOpenChange={(open) => {
              if (!open) closeDialog()
            }}
            onForked={(job) => {
              void load()
              openRun(job.id)
            }}
            onReviewStarted={(job) => {
              void load()
              openRun(job.id)
            }}
          />
        </LazyBoundary>
      )}
    </WorkspacePage>
  )
}
