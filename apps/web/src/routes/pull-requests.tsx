import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import type { PrDetailsTab } from '@vertexade/ui/components/pr-details-dialog'
import { api, federationFailureMessage, type FederatedResult } from '@vertexade/ui/lib/dashboard-api'
import { pullRequestReviewActivity } from '@vertexade/ui/lib/activity-status'
import { agentIsWorking, agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import type { DashboardData, GithubReviewer, JobLog, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestFlowDecision, PullRequestIdentity } from '@vertexade/ui/lib/pull-request-flow'
import { backendApiPath, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { dialogNavigationOptions } from '@vertexade/ui/lib/work-dialogs'
import { ForkPrDialog, LabelDialog, LaunchDialog, ReviewerDialog } from '../components/pull-requests/pull-request-dialogs'
import { PullRequestBatchDialog } from '../components/pull-requests/pull-request-batch-dialog'
import { pullRequestBatchKey } from '../components/pull-requests/pull-request-batch-model'
import { buildDependencyGroups } from '../components/pull-requests/pull-request-list'
import { MobilePullRequestFilters, type PullRequestFiltersValue as Filters } from '../components/pull-requests/pull-request-filters'
import { ReviewThreadDialogs } from '../components/pull-requests/review-thread-dialogs'
import { useDashboardCache } from '../lib/dashboard-cache'
import { usePullRequestRefresh } from '../lib/use-pull-request-refresh'
import { optionalEnum, optionalString, positiveInteger } from '../lib/route-search'
import {
  defaultPullRequestFilters,
  filterPullRequests,
  canonicalPullRequestView,
  parseStoredPullRequestFilters,
  pullRequestFilterCounts,
  pullRequestFilterOptions,
  pullRequestFilterSearch,
  pullRequestFilterSearchMatches,
  pullRequestFiltersFromSearch,
  pullRequestFilterStorageKey,
  pullRequestsForView,
  type PullRequestView,
  type PullRequestDashboardSearch as DashboardSearch,
} from '../components/pull-requests/pull-request-queue-model'
import { PullRequestDetailsWorkspace, PullRequestQueueWorkspace } from '../components/pull-requests/pull-request-workspaces'
import { pullRequestThreads } from '../components/pull-requests/pull-request-thread-association'

export const Route = createFileRoute('/pull-requests')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    repo: optionalString(search.repo),
    backend: optionalString(search.backend),
    pr: positiveInteger(search.pr),
    thread: positiveInteger(search.thread),
    tab: optionalEnum(search.tab, ['conversation', 'changes', 'impact', 'evidence', 'checks', 'commits']),
    view: optionalEnum(search.view, ['for-you', 'action', 'ready', 'all', 'stacks', 'attention', 'mine']),
    q: optionalString(search.q, 100),
    repos: optionalString(search.repos, 500),
    status: optionalEnum(search.status, ['ready', 'draft']),
    author: optionalString(search.author, 100),
    reviewer: optionalString(search.reviewer, 100),
    checks: optionalEnum(search.checks, ['clear', 'pending', 'failed']),
    age: optionalEnum(search.age, ['day', 'week', 'month']),
    label: optionalString(search.label, 100),
    branch: optionalEnum(search.branch, ['current', 'behind']),
    type: optionalString(search.type, 80),
    service: optionalString(search.service, 100),
  }),
  component: Dashboard,
})

function storedFilters(): Filters {
  try {
    return parseStoredPullRequestFilters(localStorage.getItem(pullRequestFilterStorageKey))
  } catch {
    return defaultPullRequestFilters()
  }
}

function Dashboard() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const dashboard = useDashboardCache()
  const dialogs = usePullRequestDialogs()
  const scmIdentity = useCurrentScmIdentity()
  const filters = usePullRequestFilterState(search, navigate, dashboard.data.repositories, scmIdentity.identity.status)
  const selection = usePullRequestSelection(search, navigate, dashboard.data, useIsMobile())
  const batch = usePullRequestBatchSelection(dashboard.data.prs)
  const projection = usePullRequestProjection(
    dashboard.data,
    filters.filters,
    filters.view,
    filters.limit,
    scmIdentity.user,
    scmIdentity.identity,
    scmIdentity.identitiesByBackend,
  )
  const refresh = usePullRequestWorkspaceRefresh(dashboard.refresh)
  const review = usePullRequestReview(dialogs.setReviewPr)
  const details = usePullRequestRefresh(dashboard.refresh)
  return (
    <PullRequestDashboardView
      dashboard={dashboard}
      dialogs={dialogs}
      filters={filters}
      selection={selection}
      batch={batch}
      currentUser={scmIdentity.user}
      projection={projection}
      refresh={refresh}
      review={review}
      details={details}
    />
  )
}

function usePullRequestBatchSelection(pullRequests: PullRequest[]) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const available = new Set(pullRequests.map(pullRequestBatchKey))
    setSelectedKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)))
      return next.size === current.size ? current : next
    })
  }, [pullRequests])
  const selectedPrs = pullRequests.filter((pr) => selectedKeys.has(pullRequestBatchKey(pr)))
  return {
    selectedKeys,
    selectedPrs,
    open,
    setOpen,
    toggleSelected(pr: PullRequest, selected: boolean) {
      setSelectedKeys((current) => {
        const next = new Set(current)
        if (selected) next.add(pullRequestBatchKey(pr))
        else next.delete(pullRequestBatchKey(pr))
        return next
      })
    },
    selectVisible(visible: PullRequest[]) {
      setSelectedKeys((current) => new Set([...current, ...visible.map(pullRequestBatchKey)]))
    },
    clearSelection() {
      setSelectedKeys(new Set())
    },
  }
}

function usePullRequestDialogs() {
  const [launchRequest, setLaunchRequest] = useState<{ pr: PullRequest; decision?: PullRequestFlowDecision } | null>(null)
  const [forkPr, setForkPr] = useState<PullRequest | null>(null)
  const [labelPr, setLabelPr] = useState<PullRequest | null>(null)
  const [reviewerPr, setReviewerPr] = useState<PullRequest | null>(null)
  const [reviewPr, setReviewPr] = useState<PullRequest | null>(null)
  const [handoffJob, setHandoffJob] = useState<JobLog | null>(null)
  const setLaunchPr = (pr: PullRequest | null) => setLaunchRequest(pr ? { pr } : null)
  const openLaunch = (pr: PullRequest, decision: PullRequestFlowDecision) => setLaunchRequest({ pr, decision })
  return {
    launchPr: launchRequest?.pr || null,
    launchDecision: launchRequest?.decision,
    setLaunchPr,
    openLaunch,
    forkPr,
    setForkPr,
    labelPr,
    setLabelPr,
    reviewerPr,
    setReviewerPr,
    reviewPr,
    setReviewPr,
    handoffJob,
    setHandoffJob,
  }
}

type Navigate = ReturnType<typeof Route.useNavigate>

function usePullRequestFilterState(
  search: DashboardSearch,
  navigate: Navigate,
  repositories: DashboardData['repositories'],
  identityStatus: PullRequestIdentity['status'],
) {
  const [filters, setFilters] = useState<Filters>(() => pullRequestFiltersFromSearch(search, storedFilters()))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(12)
  const view = canonicalPullRequestView(search.view, identityStatus)

  useEffect(() => applyRepositorySearch(search, repositories, setFilters), [repositories, search.pr, search.repo])
  useEffect(() => {
    storeFilters(filters)
  }, [filters])
  useEffect(() => {
    if (pullRequestFilterSearchMatches(search, filters)) return
    void navigate({ search: (current) => ({ ...current, ...pullRequestFilterSearch(filters) }), replace: true, resetScroll: false })
  }, [filters, navigate, search])
  useEffect(() => setLimit(12), [filters, view])

  const changeView = (next: typeof view) =>
    void navigate({ search: (current) => ({ ...current, view: next }), replace: true, resetScroll: false })
  return {
    filters,
    setFilters,
    mobileFiltersOpen,
    setMobileFiltersOpen,
    view,
    limit,
    setLimit,
    changeView,
    resetFilters: () => setFilters(defaultPullRequestFilters()),
  }
}

function applyRepositorySearch(
  search: DashboardSearch,
  repositories: DashboardData['repositories'],
  setFilters: Dispatch<SetStateAction<Filters>>,
) {
  const repository = repositoryFromSearch(search, repositories)
  if (!repository) return
  setFilters((current) =>
    current.repositories.length === 1 && current.repositories[0] === repository.full_name
      ? current
      : { ...current, repositories: [repository.full_name] },
  )
}

function repositoryFromSearch(search: DashboardSearch, repositories: DashboardData['repositories']) {
  const requested = repositorySearchRequest(search, repositories.length)
  if (!requested) return null
  return repositories.find((item) => repositoryMatches(item, requested)) ?? null
}

function repositorySearchRequest(search: DashboardSearch, repositoryCount: number) {
  const requested = search.repo
  if (!requested) return null
  if (search.pr) return null
  if (!repositoryCount) return null
  return requested
}

function repositoryMatches(repository: DashboardData['repositories'][number], requested: string) {
  return String(repository.id) === requested || repository.full_name === requested
}

function storeFilters(filters: Filters) {
  try {
    localStorage.setItem(pullRequestFilterStorageKey, JSON.stringify(filters))
  } catch {}
}

function usePullRequestSelection(search: DashboardSearch, navigate: Navigate, data: DashboardData, isMobile: boolean) {
  const [detailsPr, setDetailsPr] = useState<PullRequest | null>(null)
  const [threadId, setThreadId] = useState<number | null>(null)
  const returnPoint = useRef<{ scrollY: number; cardId: string } | null>(null)
  useEffect(() => setDetailsPr(selectedPullRequest(search, data.prs)), [data.prs, search.backend, search.pr, search.repo])
  useEffect(() => setThreadId(search.thread || null), [search.thread])

  const open = (pr: PullRequest) => {
    returnPoint.current = { scrollY: window.scrollY, cardId: `pr-card-${pr.repo_id}-${pr.number}` }
    openPullRequest(navigate, pr, isMobile)
  }
  const openReviewDecision = (pr: PullRequest) => openPullRequest(navigate, pr, isMobile, 'changes')
  const openRun = (id: number) => navigateDialog(navigate, { repo: undefined, backend: undefined, pr: undefined, thread: id })
  const changeTab = (tab: PrDetailsTab) => void navigate({ search: (current) => ({ ...current, tab }), replace: true, resetScroll: false })
  const close = () => {
    const restore = returnPoint.current
    void navigate({
      search: (current) => ({ ...current, repo: undefined, backend: undefined, pr: undefined, thread: undefined, tab: undefined }),
      replace: true,
      ...dialogNavigationOptions,
    }).then(() => {
      if (!restore) return
      requestAnimationFrame(() => {
        window.scrollTo({ top: restore.scrollY })
        document.getElementById(restore.cardId)?.focus({ preventScroll: true })
      })
    })
  }
  return { detailsPr, setDetailsPr, threadId, tab: search.tab, open, openRun, openReviewDecision, changeTab, close }
}

function selectedPullRequest(search: DashboardSearch, pullRequests: PullRequest[]) {
  if (!search.repo || !search.pr) return null
  return (
    pullRequests.find(
      (pr) => pr.full_name === search.repo && pr.number === search.pr && (!search.backend || pr.backend_id === search.backend),
    ) || null
  )
}

function openPullRequest(navigate: Navigate, pr: PullRequest, isMobile: boolean, tab?: PrDetailsTab) {
  if (isMobile) {
    void navigate({
      to: '/pull-requests/$repoId/$prNumber',
      params: { repoId: String(pr.repo_id), prNumber: String(pr.number) },
      search: tab ? { tab } : {},
    })
    return
  }
  navigateDialog(navigate, { repo: pr.full_name, backend: pr.backend_id, pr: pr.number, thread: undefined, tab })
}

function navigateDialog(navigate: Navigate, values: Pick<DashboardSearch, 'repo' | 'backend' | 'pr' | 'thread'> & { tab?: PrDetailsTab }) {
  void navigate({ search: (current) => ({ ...current, ...values }), replace: true, ...dialogNavigationOptions })
}

type ScmIdentityState = {
  user: GithubReviewer | null
  identity: PullRequestIdentity
  identitiesByBackend: ReadonlyMap<string, PullRequestIdentity>
}

const unavailableScmIdentity = (): ScmIdentityState => ({
  user: null,
  identity: { status: 'unavailable' },
  identitiesByBackend: new Map(),
})

async function loadBackendScmIdentity(backend: BackendDescriptor) {
  try {
    return [backend, await api<GithubReviewer>(backendApiPath('/api/scm/me', backend.id))] as const
  } catch {
    return [backend, null] as const
  }
}

async function loadScmIdentityState(): Promise<ScmIdentityState> {
  const { backends } = await api<{ backends: BackendDescriptor[] }>('/api/backends')
  const entries = await Promise.all(backends.map(loadBackendScmIdentity))
  const identitiesByBackend = new Map<string, PullRequestIdentity>(
    entries.map(([backend, user]) => [backend.id, user ? { status: 'ready', login: user.login } : { status: 'unavailable' }]),
  )
  const primary = entries.find(([backend]) => backend.isDefault)?.[1] || null
  return {
    user: primary,
    identity: primary ? { status: 'ready', login: primary.login } : { status: 'unavailable' },
    identitiesByBackend,
  }
}

function useCurrentScmIdentity() {
  const [state, setState] = useState<ScmIdentityState>({
    user: null,
    identity: { status: 'loading' },
    identitiesByBackend: new Map(),
  })
  useEffect(() => {
    void loadScmIdentityState().then(setState, () => setState(unavailableScmIdentity()))
  }, [])
  return state
}

function usePullRequestProjection(
  data: DashboardData,
  filters: Filters,
  view: PullRequestView,
  limit: number,
  currentUser: GithubReviewer | null,
  identity: PullRequestIdentity,
  identitiesByBackend: ReadonlyMap<string, PullRequestIdentity>,
) {
  const [renderedAt] = useState(Date.now)
  const filtered = useMemo(
    () => filterPullRequests(data.prs, filters, currentUser, renderedAt),
    [currentUser, data.prs, filters, renderedAt],
  )
  const filterOptions = useMemo(() => pullRequestFilterOptions(data.prs), [data.prs])
  const forYouPrs = useMemo(
    () => pullRequestsForView('for-you', filtered, identity, data.agentThreads, identitiesByBackend),
    [data.agentThreads, filtered, identitiesByBackend, identity],
  )
  const actionPrs = useMemo(
    () => pullRequestsForView('action', filtered, identity, data.agentThreads, identitiesByBackend),
    [data.agentThreads, filtered, identitiesByBackend, identity],
  )
  const readyPrs = useMemo(
    () => pullRequestsForView('ready', filtered, identity, data.agentThreads, identitiesByBackend),
    [data.agentThreads, filtered, identitiesByBackend, identity],
  )
  const visiblePrs = useMemo(() => {
    if (view === 'for-you') return forYouPrs
    if (view === 'action') return actionPrs
    if (view === 'ready') return readyPrs
    return pullRequestsForView(view, filtered, identity, data.agentThreads, identitiesByBackend)
  }, [actionPrs, data.agentThreads, filtered, forYouPrs, identitiesByBackend, identity, readyPrs, view])
  const serviceColors = useMemo(
    () => new Map(data.service_colors.map((item) => [item.service.toLocaleLowerCase(), item.color])),
    [data.service_colors],
  )
  const dependencyGroups = useMemo(() => buildDependencyGroups(data.prs), [data.prs])
  const reviewActivity = useMemo(() => reviewActivityCounts(data.prs, data.agentThreads), [data.agentThreads, data.prs])
  const runsFor = (pr: PullRequest) => pullRequestThreads(pr, data.agentThreads)
  return {
    filtered,
    filterOptions,
    queueCounts: { forYou: forYouPrs.length, action: actionPrs.length, ready: readyPrs.length },
    visiblePrs,
    displayedPrs: visiblePrs.slice(0, limit),
    serviceColors,
    dependencyGroups,
    reviewActivity,
    runsFor,
    activeRuns: data.agentThreads.filter((job) => agentIsWorking(agentThreadState(job))).length,
    actionPrs: actionPrs.length,
    ...pullRequestFilterCounts(filters),
  }
}

function reviewActivityCounts(pullRequests: PullRequest[], agentThreads: DashboardData['agentThreads']) {
  const statuses = pullRequests.map((pr) => pullRequestReviewActivity(pr, agentThreads))
  return {
    running: statuses.filter((status) => status.label === 'Review running').length,
    ready: statuses.filter((status) => status.label === 'Review ready').length,
    waiting: statuses.filter((status) => status.label === 'Ready for review').length,
  }
}

function usePullRequestWorkspaceRefresh(load: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await api<{ repositories: number; open_prs: number; errors: { repository: string }[] } & FederatedResult>(
        '/api/repositories/sync-all',
        {
          method: 'POST',
          body: '{}',
        },
      )
      await load()
      notifyRefreshResult(result)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRefreshing(false)
    }
  }
  return { refreshing, refresh }
}

function notifyRefreshResult(result: { repositories: number; open_prs: number; errors: unknown[] } & FederatedResult) {
  const federationWarning = federationFailureMessage(result, 'Repository refresh')
  if (federationWarning) toast.warning(federationWarning)
  else if (result.errors.length) toast.warning(`Refreshed ${result.repositories} repositories; ${result.errors.length} failed`)
  else toast.success(`Refreshed ${result.repositories} repositories · ${result.open_prs} open PRs`)
}

function usePullRequestReview(setReviewPr: (pr: PullRequest | null) => void) {
  const openReview = (pr: PullRequest) => setReviewPr(pr)
  return { openReview }
}

type DashboardViewProps = {
  dashboard: ReturnType<typeof useDashboardCache>
  dialogs: ReturnType<typeof usePullRequestDialogs>
  filters: ReturnType<typeof usePullRequestFilterState>
  selection: ReturnType<typeof usePullRequestSelection>
  batch: ReturnType<typeof usePullRequestBatchSelection>
  currentUser: GithubReviewer | null
  projection: ReturnType<typeof usePullRequestProjection>
  refresh: ReturnType<typeof usePullRequestWorkspaceRefresh>
  review: ReturnType<typeof usePullRequestReview>
  details: ReturnType<typeof usePullRequestRefresh>
}

function PullRequestDashboardView(props: DashboardViewProps) {
  if (props.selection.detailsPr) return <DetailsView {...props} detailsPr={props.selection.detailsPr} />
  return <QueueView {...props} />
}

function DetailsView(props: DashboardViewProps & { detailsPr: PullRequest }) {
  const { detailsPr, dashboard, selection, dialogs, details, currentUser, review } = props
  const startReview = () => {
    selection.setDetailsPr(null)
    selection.close()
    review.openReview(detailsPr)
  }
  return (
    <>
      <PullRequestDetailsWorkspace
        data={dashboard.data}
        detailsPr={detailsPr}
        currentUser={currentUser}
        detailsRevision={details.detailsRevision}
        close={selection.close}
        openRun={selection.openRun}
        refresh={details.refreshPullRequest}
        tab={selection.tab}
        onTabChange={selection.changeTab}
        startWork={() => {
          selection.close()
          dialogs.setLaunchPr(detailsPr)
        }}
        startReview={startReview}
      />
      <SharedLaunchDialog {...props} />
      <SharedReviewDialogs {...props} />
    </>
  )
}

function QueueView(props: DashboardViewProps) {
  const { dashboard, filters, projection, refresh, selection, batch, dialogs, currentUser, review } = props
  return (
    <>
      <PullRequestQueueWorkspace
        data={dashboard.data}
        ready={dashboard.ready}
        view={filters.view}
        actionPrs={projection.actionPrs}
        activeRuns={projection.activeRuns}
        reviewActivity={projection.reviewActivity}
        refreshing={refresh.refreshing}
        queueCounts={projection.queueCounts}
        visiblePrs={projection.visiblePrs}
        displayedPrs={projection.displayedPrs}
        dependencyGroups={projection.dependencyGroups}
        filters={filters.filters}
        setFilters={filters.setFilters}
        filterOptions={projection.filterOptions}
        activeFilterCount={projection.active}
        advancedFilterCount={projection.advanced}
        currentUser={currentUser}
        serviceColors={projection.serviceColors}
        runsFor={projection.runsFor}
        changeView={filters.changeView}
        refresh={() => void refresh.refresh()}
        reconcile={dashboard.refresh}
        resetFilters={filters.resetFilters}
        openMobileFilters={() => filters.setMobileFiltersOpen(true)}
        showMore={() => filters.setLimit((current) => current + 12)}
        open={selection.open}
        launch={dialogs.openLaunch}
        fork={dialogs.setForkPr}
        editLabels={dialogs.setLabelPr}
        editReviewers={dialogs.setReviewerPr}
        review={review.openReview}
        openRun={selection.openRun}
        selectedKeys={batch.selectedKeys}
        selectVisible={batch.selectVisible}
        clearSelection={batch.clearSelection}
        toggleSelected={batch.toggleSelected}
        openBatch={() => batch.setOpen(true)}
      />
      <QueueDialogs {...props} />
    </>
  )
}

function QueueDialogs(props: DashboardViewProps) {
  const { dashboard, dialogs, filters, projection, selection, batch, currentUser } = props
  return (
    <>
      <MobilePullRequestFilters
        open={filters.mobileFiltersOpen}
        onOpenChange={filters.setMobileFiltersOpen}
        filters={filters.filters}
        setFilters={filters.setFilters}
        repositories={dashboard.data.repositories}
        options={projection.filterOptions}
        activeCount={projection.active}
        resultCount={projection.filtered.length}
        onReset={filters.resetFilters}
      />
      <SharedLaunchDialog {...props} />
      <ForkPrDialog
        pr={dialogs.forkPr}
        presentation={dashboard.data.presentation}
        onOpenChange={(open) => !open && dialogs.setForkPr(null)}
        onStarted={(id) => {
          dialogs.setForkPr(null)
          selection.openRun(id)
        }}
      />
      <LabelDialog pr={dialogs.labelPr} onOpenChange={(open) => !open && dialogs.setLabelPr(null)} onChanged={dashboard.refresh} />
      <ReviewerDialog pr={dialogs.reviewerPr} onOpenChange={(open) => !open && dialogs.setReviewerPr(null)} onChanged={dashboard.refresh} />
      <PullRequestBatchDialog
        open={batch.open}
        pullRequests={batch.selectedPrs}
        currentUser={currentUser}
        onOpenChange={batch.setOpen}
        onReconcile={dashboard.refresh}
      />
      <SharedReviewDialogs {...props} />
    </>
  )
}

function SharedLaunchDialog({ dashboard, dialogs, selection }: DashboardViewProps) {
  return (
    <LaunchDialog
      pr={dialogs.launchPr}
      data={dashboard.data}
      decision={dialogs.launchDecision}
      onOpenChange={(open) => !open && dialogs.setLaunchPr(null)}
      onStarted={(id) => {
        dialogs.setLaunchPr(null)
        selection.openRun(id)
      }}
    />
  )
}

function SharedReviewDialogs({ dashboard, dialogs, selection }: DashboardViewProps) {
  return (
    <ReviewThreadDialogs
      reviewPr={dialogs.reviewPr}
      threadId={selection.threadId}
      handoffJob={dialogs.handoffJob}
      presentation={dashboard.data.presentation}
      data={dashboard.data}
      setReviewPr={dialogs.setReviewPr}
      setHandoffJob={dialogs.setHandoffJob}
      onSubmitReview={(job) => {
        const pr = dashboard.data.prs.find((item) => item.repo_id === job.repo_id && item.number === job.pr_number)
        if (!pr) return toast.error('The reviewed pull request is no longer available in this workspace')
        selection.openReviewDecision(pr)
      }}
      closeLink={selection.close}
      openRun={selection.openRun}
    />
  )
}
