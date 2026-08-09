import type { Dispatch, SetStateAction } from 'react'
import { ArrowLeft, GitPullRequest, Layers3, RefreshCw } from 'lucide-react'
import { ContextualActions } from '@vertexade/ui/components/contextual-actions'
import { GlobalHighlights } from '@vertexade/ui/components/global-highlights'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import type { PrDetailsActions, PrDetailsTab } from '@vertexade/ui/components/pr-details-dialog'
import { WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import type { DashboardData, GithubReviewer, Job, PullRequest, Repository } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestFlowDecision } from '@vertexade/ui/lib/pull-request-flow'
import { parseConventionalTitle } from '@vertexade/ui/lib/conventional-title'
import { cn } from '@vertexade/ui/lib/utils'
import { LazyPrDetailsDialog } from '../../lib/lazy-dialogs'
import {
  DashboardSkeleton,
  buildDependencyGroups,
  DependencyOverview,
  GroupedPullRequestRows,
  PullRequestQueueHeader,
  PrRow,
  PrViewButton,
} from './pull-request-list'
import { PullRequestFilters, type PullRequestFiltersValue as Filters } from './pull-request-filters'
import type { PullRequestView } from './pull-request-queue-model'

const capitalize = (value: string) => (value ? `${value[0].toUpperCase()}${value.slice(1)}` : value)

function pullRequestEntity(pr: PullRequest, currentUser: GithubReviewer | null) {
  return {
    kind: 'pull-request',
    key: `${pr.full_name}#${pr.number}`,
    data: {
      ...pr,
      authored_by_me: Boolean(currentUser && String(pr.author || '').toLowerCase() === currentUser.login.toLowerCase()),
    },
  }
}

function pullRequestDetailsActions(
  pr: PullRequest,
  currentUser: GithubReviewer | null,
  modules: DashboardData['modules'],
  reload: () => Promise<void>,
  actions: { work(): void; review(): void },
): PrDetailsActions {
  return {
    onStartWork: actions.work,
    onStartReview: actions.review,
    contextualReviewActions: (
      <ContextualActions
        modules={modules}
        entity={pullRequestEntity(pr, currentUser)}
        placement="pull-request.review"
        mode="sheet"
        onCompleted={reload}
      />
    ),
    contextualMenuActions: (
      <ContextualActions
        modules={modules}
        entity={pullRequestEntity(pr, currentUser)}
        placement="pull-request.secondary"
        mode="menu"
        onCompleted={reload}
      />
    ),
  }
}

export function PullRequestDetailsWorkspace({
  data,
  detailsPr,
  currentUser,
  detailsRevision,
  close,
  openRun,
  refresh,
  tab,
  onTabChange,
  startWork,
  startReview,
}: {
  data: DashboardData
  detailsPr: PullRequest
  currentUser: GithubReviewer | null
  detailsRevision: number
  close(): void
  openRun(id: number): void
  refresh(): Promise<void>
  tab?: PrDetailsTab
  onTabChange(tab: PrDetailsTab): void
  startWork(): void
  startReview(): void
}) {
  return (
    <>
      <GlobalHighlights rules={data.highlights} />
      <WorkspacePage className="pb-40 md:pb-5">
        <Button variant="ghost" size="sm" className="mb-3" onClick={close}>
          <ArrowLeft />
          {capitalize(data.presentation.scm.changeRequestLabelPlural)}
        </Button>
        <LazyBoundary label={`${data.presentation.scm.changeRequestLabel} details`} resetKey={`${detailsPr.repo_id}:${detailsPr.number}`}>
          <LazyPrDetailsDialog
            embedded
            pr={detailsPr}
            refreshKey={detailsRevision}
            tab={tab}
            onTabChange={onTabChange}
            onOpenChange={(open) => !open && close()}
            onOpenRun={openRun}
            actions={pullRequestDetailsActions(detailsPr, currentUser, data.modules, refresh, {
              work: startWork,
              review: startReview,
            })}
          />
        </LazyBoundary>
      </WorkspacePage>
    </>
  )
}

type QueueProps = {
  data: DashboardData
  ready: boolean
  view: PullRequestView
  actionPrs: number
  activeRuns: number
  reviewActivity: { running: number; ready: number; waiting: number }
  refreshing: boolean
  queueCounts: { forYou: number; action: number; ready: number }
  visiblePrs: PullRequest[]
  displayedPrs: PullRequest[]
  dependencyGroups: ReturnType<typeof buildDependencyGroups>
  filters: Filters
  setFilters: Dispatch<SetStateAction<Filters>>
  filterOptions: { authors: string[]; reviewers: string[]; labels: string[]; types: string[]; services: string[] }
  activeFilterCount: number
  advancedFilterCount: number
  currentUser: GithubReviewer | null
  serviceColors: Map<string, string>
  runsFor(pr: PullRequest): Job[]
  changeView(view: QueueProps['view']): void
  refresh(): void
  reconcile(): Promise<void>
  resetFilters(): void
  openMobileFilters(): void
  showMore(): void
  open(pr: PullRequest): void
  launch(pr: PullRequest, flow: PullRequestFlowDecision): void
  fork(pr: PullRequest): void
  editLabels(pr: PullRequest): void
  editReviewers(pr: PullRequest): void
  review(pr: PullRequest): void
  openRun(id: number): void
  selectedKeys: Set<string>
  selectVisible(pullRequests: PullRequest[]): void
  clearSelection(): void
  toggleSelected(pr: PullRequest, selected: boolean): void
  openBatch(): void
}

export function PullRequestQueueWorkspace(props: QueueProps) {
  const { data } = props
  return (
    <>
      <GlobalHighlights rules={data.highlights} />
      <WorkspacePage className="px-2 py-3 xl:px-5 xl:py-3">
        <PullRequestQueueHeader
          title={capitalize(data.presentation.scm.changeRequestLabelPlural)}
          action={props.actionPrs}
          open={data.prs.length}
          activeRuns={props.activeRuns}
          reviewActivity={props.reviewActivity}
          refreshing={props.refreshing}
          onRefresh={props.refresh}
        />
        <QueueNavigation {...props} />
        <PullRequestListView {...props} />
        <StackView {...props} />
      </WorkspacePage>
    </>
  )
}

type QueueNavigationProps = Pick<QueueProps, 'data' | 'view' | 'queueCounts' | 'dependencyGroups' | 'changeView'>

function QueueNavigation(props: QueueNavigationProps) {
  const { data, view } = props
  return (
    <nav
      className="mb-3 grid min-w-0 grid-cols-[repeat(4,minmax(0,1fr))_2.75rem] border-b border-border/55 sm:flex sm:gap-0.5"
      aria-label={`${capitalize(data.presentation.scm.changeRequestLabel)} views`}
    >
      <PrViewButton
        label="For you"
        mobileLabel="You"
        active={view === 'for-you'}
        count={props.queueCounts.forYou}
        onClick={() => props.changeView('for-you')}
      />
      <PrViewButton
        label="Needs action"
        mobileLabel="Action"
        active={view === 'action'}
        count={props.queueCounts.action}
        onClick={() => props.changeView('action')}
      />
      <PrViewButton label="Ready" active={view === 'ready'} count={props.queueCounts.ready} onClick={() => props.changeView('ready')} />
      <PrViewButton label="All" active={view === 'all'} count={data.prs.length} onClick={() => props.changeView('all')} />
      <PrViewButton
        label="Stacks"
        mobileLabel=""
        icon={Layers3}
        mobileIconOnly
        active={view === 'stacks'}
        count={props.dependencyGroups.length}
        onClick={() => props.changeView('stacks')}
      />
    </nav>
  )
}

function PullRequestListView(props: QueueProps) {
  if (!['for-you', 'action', 'ready', 'all'].includes(props.view)) return null
  return (
    <div className="min-w-0">
      <Card className="min-w-0 gap-0 overflow-visible border-border/75 bg-card/68 py-0 backdrop-blur-sm max-lg:rounded-md lg:overflow-hidden">
        <PullRequestFilters
          filters={props.filters}
          setFilters={props.setFilters}
          repositories={props.data.repositories}
          options={props.filterOptions}
          activeCount={props.activeFilterCount}
          advancedCount={props.advancedFilterCount}
          changeRequestLabelPlural={props.data.presentation.scm.changeRequestLabelPlural}
          onOpenMobile={props.openMobileFilters}
          onReset={props.resetFilters}
        />
        <BatchSelectionBar {...props} />
        <QueueCardContent {...props} />
        <QueuePagination {...props} />
      </Card>
    </div>
  )
}

function QueueCardContent(props: QueueProps) {
  return (
    <CardContent className="min-w-0 overflow-hidden p-0">
      <QueueResults {...props} />
    </CardContent>
  )
}

type BatchSelectionBarProps = Pick<QueueProps, 'displayedPrs' | 'selectedKeys' | 'selectVisible' | 'clearSelection' | 'openBatch'>

function BatchSelectionBar(props: BatchSelectionBarProps) {
  const selectedCount = props.selectedKeys.size
  const checkboxState = visibleSelectionState(props.displayedPrs, props.selectedKeys)
  const changeVisibleSelection = (checked: boolean) => {
    if (checked) props.selectVisible(props.displayedPrs)
    else props.clearSelection()
  }
  return (
    <div
      className={cn(
        'min-w-0 items-center gap-2 border-b border-border/65 bg-muted/10 px-2.5 py-1.5 lg:flex',
        selectedCount ? 'flex' : 'hidden',
      )}
    >
      <Checkbox
        checked={checkboxState}
        onCheckedChange={(checked) => changeVisibleSelection(Boolean(checked))}
        aria-label="Select visible pull requests"
      />
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground"
        onClick={() => props.selectVisible(props.displayedPrs)}
      >
        Select visible
      </button>
      <SelectedPullRequestActions count={selectedCount} onClear={props.clearSelection} onOpen={props.openBatch} />
    </div>
  )
}

function visibleSelectionState(pullRequests: PullRequest[], selected: Set<string>): true | 'indeterminate' | false {
  const selectedCount = pullRequests.filter((pr) => selected.has(`${pr.repo_id}:${pr.number}`)).length
  if (!selectedCount) return false
  return selectedCount === pullRequests.length ? true : 'indeterminate'
}

function SelectedPullRequestActions({ count, onClear, onOpen }: { count: number; onClear(): void; onOpen(): void }) {
  if (!count)
    return <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Choose several PRs for safe batch actions</span>
  return (
    <>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count} selected</span>
      <Button variant="ghost" size="xs" onClick={onClear}>
        Clear
      </Button>
      <Button size="xs" onClick={onOpen}>
        Batch actions
      </Button>
    </>
  )
}

function QueueResults(props: QueueProps) {
  if (!props.ready) return <DashboardSkeleton />
  if (!props.visiblePrs.length) return <EmptyQueue {...props} />
  return (
    <GroupedPullRequestRows
      pullRequests={props.displayedPrs}
      currentUser={props.currentUser}
      agentThreads={props.data.agentThreads}
      renderRow={(pr) => <PullRequestQueueRow key={`${pr.repo_id}-${pr.number}`} pr={pr} props={props} />}
    />
  )
}

function PullRequestQueueRow({ pr, props }: { pr: PullRequest; props: QueueProps }) {
  const scope = parseConventionalTitle(pr.title)?.scope
  return (
    <PrRow
      pr={pr}
      agentThreads={props.runsFor(pr)}
      currentUser={props.currentUser}
      scm={props.data.presentation.scm}
      serviceColor={scope ? props.serviceColors.get(scope.toLocaleLowerCase()) : undefined}
      onDetails={() => props.open(pr)}
      onLaunch={(flow) => props.launch(pr, flow)}
      onFork={() => props.fork(pr)}
      onLabels={() => props.editLabels(pr)}
      onReviewers={() => props.editReviewers(pr)}
      onReview={() => props.review(pr)}
      onRun={props.openRun}
      onReconcile={props.reconcile}
      selected={props.selectedKeys.has(`${pr.repo_id}:${pr.number}`)}
      onSelectedChange={(selected) => props.toggleSelected(pr, selected)}
    />
  )
}

function EmptyQueue(props: QueueProps) {
  const hasPullRequests = props.data.prs.length > 0
  return (
    <Empty className="min-h-72 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitPullRequest />
        </EmptyMedia>
        <EmptyTitle>
          {hasPullRequests
            ? `No ${props.data.presentation.scm.changeRequestLabelPlural} match`
            : `Your ${props.data.presentation.scm.changeRequestLabel} inbox is clear`}
        </EmptyTitle>
        <EmptyDescription>
          {hasPullRequests
            ? 'Adjust the view or filters to bring work back into focus.'
            : 'Refresh the workspace when you are ready to look for new work.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <EmptyQueueAction {...props} />
      </EmptyContent>
    </Empty>
  )
}

type EmptyQueueActionProps = Pick<QueueProps, 'activeFilterCount' | 'resetFilters' | 'refreshing' | 'refresh'>

function EmptyQueueAction(props: EmptyQueueActionProps) {
  if (props.activeFilterCount)
    return (
      <Button variant="outline" onClick={props.resetFilters}>
        Clear all filters
      </Button>
    )
  return (
    <Button variant="outline" disabled={props.refreshing} onClick={props.refresh}>
      <RefreshCw className={cn(props.refreshing && 'animate-spin')} />
      Refresh workspace
    </Button>
  )
}

type QueuePaginationProps = Pick<QueueProps, 'displayedPrs' | 'visiblePrs' | 'showMore'>

function QueuePagination(props: QueuePaginationProps) {
  if (props.displayedPrs.length >= props.visiblePrs.length) return null
  return (
    <div className="flex items-center justify-between border-t px-3 py-2">
      <span className="text-xs text-muted-foreground">
        Showing {props.displayedPrs.length} of {props.visiblePrs.length}
      </span>
      <Button variant="outline" size="sm" onClick={props.showMore}>
        Show more
      </Button>
    </div>
  )
}

type StackViewProps = Pick<QueueProps, 'view' | 'dependencyGroups' | 'data' | 'open' | 'openRun'>

function StackView(props: StackViewProps) {
  if (props.view !== 'stacks') return null
  return (
    <DependencyOverview
      groups={props.dependencyGroups}
      repositories={props.data.repositories as Repository[]}
      agentName={props.data.presentation.defaultAgent.name}
      onOpen={props.open}
      onRun={props.openRun}
    />
  )
}
