import { lazy, useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, MessageSquareText, Plus, SlidersHorizontal } from 'lucide-react'
import { GlobalHighlights } from '@vertexade/ui/components/global-highlights'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { FilterBar, FilterBarControls, FilterBarToggle } from '@vertexade/ui/components/ui/toolbar'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import {
  shouldCollapseThreadHistory,
  sortThreads,
  threadPriority,
  threadPriorityStats,
  type ThreadSort,
} from '@vertexade/ui/lib/thread-priority'
import { dialogNavigationOptions } from '@vertexade/ui/lib/work-dialogs'
import { matchesStatus, ThreadFilters, type StatusFilter } from '../components/threads/thread-components'
import { hideThreadId, reconcileHiddenThreadIds, restoreThreadId } from '../components/threads/thread-deletion-state'
import { ThreadPrioritySummary, ThreadQueueList, type ThreadListActions } from '../components/threads/thread-workspace'
import { LazyThreadDialog } from '../lib/lazy-dialogs'
import { useDashboardMeta } from '../lib/dashboard-cache'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'
import { optionalEnum, optionalString, positiveInteger } from '../lib/route-search'

type ThreadSearch = {
  thread?: number
  view?: 'details'
  repo?: string
  archive?: 'open' | 'archived' | 'all'
  status?: StatusFilter
  agent?: string
  sort?: ThreadSort
  q?: string
}

const threadStatuses: StatusFilter[] = ['all', 'attention', 'active', 'input', 'action', 'queued', 'completed', 'failed', 'resumable']

export const Route = createFileRoute('/threads')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ThreadSearch => ({
    thread: positiveInteger(search.thread),
    view: optionalEnum(search.view, ['details']),
    repo: optionalString(search.repo),
    archive: optionalEnum(search.archive, ['open', 'archived', 'all']),
    status: optionalEnum(search.status, threadStatuses),
    agent: optionalString(search.agent),
    sort: optionalEnum(search.sort, ['priority', 'recent', 'oldest']),
    q: optionalString(search.q),
  }),
  component: ThreadsPage,
})

const LazyForkThreadDialog = lazy(() =>
  import('@vertexade/ui/components/fork-thread-dialog').then(({ ForkThreadDialog }) => ({
    default: ForkThreadDialog,
  })),
)
const LazyThreadPanel = lazy(() =>
  import('@vertexade/ui/components/thread-panel').then(({ ThreadPanel }) => ({
    default: ThreadPanel,
  })),
)

// fallow-ignore-next-line complexity -- Existing route orchestration; this change only promotes the thread workspace presentation.
function ThreadsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const threadCache = useRxDashboardCollection<Job>('agentThreads')
  const highlights = useDashboardMeta().value.highlights
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileLimit, setMobileLimit] = useState(12)
  const [forkSource, setForkSource] = useState<Job | null>(null)
  const [focusedThreadId, setFocusedThreadId] = useState<number | null>(search.thread ?? null)
  const [hiddenThreadIds, setHiddenThreadIds] = useState<Set<number>>(() => new Set())
  const isMobile = useIsMobile()
  const repository = search.repo || 'all'
  const archiveView = search.archive || 'open'
  const statusFilter = search.status || 'all'
  const agent = search.agent || 'all'
  const sort = search.sort || 'priority'
  const query = search.q || ''
  const updateSearch = (patch: Partial<ThreadSearch>) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace: true,
      resetScroll: false,
    })
  const setRepository = (value: string) => updateSearch({ repo: value === 'all' ? undefined : value, thread: undefined, view: undefined })
  const setArchiveView = (value: 'open' | 'archived' | 'all') =>
    updateSearch({
      archive: value === 'open' ? undefined : value,
      repo: undefined,
      thread: undefined,
      view: undefined,
    })
  const setStatusFilter = (value: StatusFilter) =>
    updateSearch({ status: value === 'all' ? undefined : value, thread: undefined, view: undefined })
  const setAgent = (value: string) => updateSearch({ agent: value === 'all' ? undefined : value, thread: undefined, view: undefined })
  const setSort = (value: ThreadSort) => updateSearch({ sort: value === 'priority' ? undefined : value })
  const setQuery = (value: string) => updateSearch({ q: value || undefined, thread: undefined, view: undefined })
  const threads = useMemo(
    () =>
      threadCache.values.filter(
        (thread) =>
          !hiddenThreadIds.has(thread.id) &&
          (archiveView === 'all' || (archiveView === 'archived' ? Boolean(thread.archived_at) : !thread.archived_at)),
      ),
    [archiveView, hiddenThreadIds, threadCache.values],
  )
  const refresh = () => void threadCache.refresh()

  const repositories = useMemo(() => Array.from(new Set(threads.map((thread) => thread.full_name))).sort(), [threads])
  const agents = useMemo(
    () =>
      Array.from(new Map(threads.map((thread) => [thread.agent_id, thread.agent_name])).entries()).sort((a, b) => a[1].localeCompare(b[1])),
    [threads],
  )
  const visible = useMemo(
    () =>
      sortThreads(
        threads.filter((thread) => {
          const target =
            `${thread.full_name} ${thread.task_title || ''} ${thread.branch_name || ''} ${thread.agent_name} ${thread.latest_activity || ''} ${thread.pr_number ? `#${thread.pr_number}` : ''} ${thread.thread_id}`.toLowerCase()
          return (
            (repository === 'all' || thread.full_name === repository) &&
            (agent === 'all' || thread.agent_id === agent) &&
            matchesStatus(thread, statusFilter) &&
            (!query || target.includes(query.toLowerCase()))
          )
        }),
        sort,
      ),
    [agent, query, repository, sort, statusFilter, threads],
  )
  const stats = useMemo(() => threadPriorityStats(threads), [threads])
  const selectedJob =
    visible.find((thread) => thread.id === search.thread) ||
    visible.find((thread) => thread.id === focusedThreadId) ||
    (statusFilter === 'completed' || sort !== 'priority' || Boolean(query)
      ? visible[0]
      : visible.find((thread) => threadPriority(thread) !== 'history')) ||
    visible[0] ||
    null
  const activeFilters =
    Number(repository !== 'all') + Number(archiveView !== 'open') + Number(statusFilter !== 'all') + Number(agent !== 'all')
  const mobileThreads = visible.slice(0, mobileLimit)
  const collapseHistory = shouldCollapseThreadHistory(visible, statusFilter === 'completed')
  const openThread = (jobId: number, view?: 'details') => {
    if (isMobile) {
      void navigate({
        to: '/threads/$threadId',
        params: { threadId: String(jobId) },
        search: view ? { view } : {},
      })
      return
    }
    setFocusedThreadId(jobId)
    void navigate({
      search: (current) => ({ ...current, thread: jobId, view }),
      replace: true,
      ...dialogNavigationOptions,
    })
  }
  const threadListActions: ThreadListActions = {
    onOpen: (thread) => openThread(thread.id),
    onDetails: (thread) => openThread(thread.id, 'details'),
    onFork: setForkSource,
    onDeleting: (thread) => setHiddenThreadIds((current) => hideThreadId(current, thread.id)),
    onDeleteFailed: (thread) => setHiddenThreadIds((current) => restoreThreadId(current, thread.id)),
    onChanged: refresh,
  }

  useEffect(() => {
    setHiddenThreadIds((current) => reconcileHiddenThreadIds(current, threadCache.values))
  }, [threadCache.values])

  useEffect(() => {
    setMobileLimit(12)
  }, [agent, archiveView, query, repository, sort, statusFilter])

  useEffect(() => {
    if (search.thread) setFocusedThreadId(search.thread)
  }, [search.thread])

  return (
    <>
      <GlobalHighlights rules={highlights} />
      <WorkspacePage className="max-w-none px-2 py-3 xl:px-3 xl:py-3">
        <WorkspaceHeader
          className="mb-3 flex-row items-start justify-between [&_[data-slot=page-actions]]:w-auto xl:mb-2 xl:items-center xl:[&_[data-slot=page-description]]:mt-0 xl:[&_[data-slot=page-eyebrow]]:hidden xl:[&_[data-slot=page-header-content]]:flex xl:[&_[data-slot=page-header-content]]:items-baseline xl:[&_[data-slot=page-header-content]]:gap-3 xl:[&_[data-slot=page-title]]:text-lg"
          eyebrow="Priority queue"
          title="Agents"
          description={
            <>
              <span className="sm:hidden">Live runs, decisions, and history.</span>
              <span className="hidden sm:inline">Track live execution and history. Decisions stay in Focus.</span>
            </>
          }
          actions={
            <Button asChild size="sm">
              <Link to="/work" search={{ create: 1, start: 1 }}>
                <Plus />
                Start agent task
              </Link>
            </Button>
          }
        />
        <ThreadPrioritySummary stats={stats} activeFilter={statusFilter} onFilter={setStatusFilter} />

        <div className="xl:hidden" data-audit-agents-layout="list">
          <FilterBar className="mb-3 bg-muted/20 shadow-none ring-0">
            <SearchInput
              containerClassName="flex-1 sm:min-w-64"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              placeholder="Search agent sessions or activity"
            />
            <FilterBarToggle
              label={`Agent filters${activeFilters ? `, ${activeFilters} active` : ''}`}
              count={activeFilters}
              active={activeFilters > 0}
              aria-expanded={mobileFiltersOpen}
              aria-controls="mobile-thread-filters"
              onClick={() => setMobileFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal />
            </FilterBarToggle>
            <FilterBarControls id="mobile-thread-filters" open={mobileFiltersOpen}>
              <ThreadFilters
                repositories={repositories}
                repository={repository}
                archiveView={archiveView}
                statusFilter={statusFilter}
                agents={agents}
                agent={agent}
                sort={sort}
                mobile
                onRepository={setRepository}
                onArchiveView={setArchiveView}
                onStatus={setStatusFilter}
                onAgent={setAgent}
                onSort={setSort}
              />
            </FilterBarControls>
          </FilterBar>
          <div>
            <ThreadQueueList
              threads={mobileThreads}
              sort={sort}
              variant="cards"
              collapseHistory={collapseHistory}
              historyCount={visible.filter((thread) => threadPriority(thread) === 'history').length}
              actions={threadListActions}
            />
            {!visible.length && <div className="py-16 text-center text-sm text-muted-foreground">No matching agent sessions.</div>}
            {mobileThreads.length < visible.length && (
              <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Showing {mobileThreads.length} of {visible.length}
                </span>
                <Button type="button" variant="outline" size="xs" onClick={() => setMobileLimit((limit) => limit + 12)}>
                  Show more
                </Button>
              </div>
            )}
          </div>
        </div>

        <section
          className="hidden h-[calc(100dvh-9.5rem)] min-h-[34rem] min-w-0 overflow-hidden xl:grid xl:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]"
          data-audit-agents-layout="master-detail"
        >
          <aside className="flex min-h-0 min-w-0 flex-col border-r border-border/55 bg-muted/[.10]">
            <div className="space-y-1.5 border-b border-border/55 p-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <strong className="block truncate text-xs">{repository === 'all' ? 'Priority queue' : repository.split('/').at(-1)}</strong>
                <span className="text-[11px] tabular-nums text-muted-foreground">{visible.length}</span>
              </div>
              <SearchInput
                density="compact"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                placeholder="Search agent sessions"
              />
              <ThreadFilters
                repositories={repositories}
                repository={repository}
                archiveView={archiveView}
                statusFilter={statusFilter}
                agents={agents}
                agent={agent}
                sort={sort}
                compact
                onRepository={setRepository}
                onArchiveView={setArchiveView}
                onStatus={setStatusFilter}
                onAgent={setAgent}
                onSort={setSort}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ThreadQueueList
                threads={visible}
                sort={sort}
                variant="rail"
                selectedId={selectedJob?.id}
                collapseHistory={collapseHistory}
                actions={threadListActions}
              />
              {!visible.length && (
                <div className="grid min-h-52 place-items-center px-6 text-center">
                  <div>
                    <Bot className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-2 text-xs font-medium">No matching sessions</p>
                    <p className="mt-1 text-xs text-muted-foreground">Change the filters or select another project.</p>
                  </div>
                </div>
              )}
            </div>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-col">
            {selectedJob ? (
              <LazyBoundary label="agent thread" resetKey={selectedJob.id}>
                <LazyThreadPanel
                  jobId={selectedJob.id}
                  activityOnly
                  showCompactHeader
                  onForked={(job) => {
                    refresh()
                    updateSearch({ thread: job.id, view: undefined })
                  }}
                  onReviewStarted={(job) => {
                    refresh()
                    updateSearch({ thread: job.id, view: undefined })
                  }}
                />
              </LazyBoundary>
            ) : (
              <div className="grid h-full place-items-center p-8 text-center">
                <div>
                  <MessageSquareText className="mx-auto size-8 text-muted-foreground" />
                  <h2 className="mt-3 text-base font-semibold">Your agent queue is clear</h2>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Adjust the filters or start a new task to open another session.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </WorkspacePage>
      {search.thread && (isMobile || search.view === 'details') && (
        <LazyBoundary label="agent thread" resetKey={search.thread}>
          <LazyThreadDialog
            jobId={search.thread}
            onOpenChange={(open) => !open && updateSearch(isMobile ? { thread: undefined, view: undefined } : { view: undefined })}
            onForked={(job) => {
              refresh()
              updateSearch({ thread: job.id, view: undefined })
            }}
            onReviewStarted={(job) => {
              refresh()
              updateSearch({ thread: job.id, view: 'details' })
            }}
          />
        </LazyBoundary>
      )}
      {forkSource && (
        <LazyBoundary label="thread fork" resetKey={forkSource.id}>
          <LazyForkThreadDialog
            source={forkSource}
            onOpenChange={(open) => !open && setForkSource(null)}
            onForked={(job) => {
              setForkSource(null)
              refresh()
              updateSearch({ thread: job.id, view: undefined })
            }}
          />
        </LazyBoundary>
      )}
    </>
  )
}
