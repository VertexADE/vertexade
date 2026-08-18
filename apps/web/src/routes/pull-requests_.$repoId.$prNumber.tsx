import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, GitPullRequest } from 'lucide-react'
import { ContextualActions } from '@vertexade/ui/components/contextual-actions'
import { GlobalHighlights } from '@vertexade/ui/components/global-highlights'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { PrDetailsDialog, type PrDetailsActions, type PrDetailsTab } from '@vertexade/ui/components/pr-details-dialog'
import { WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { GithubReviewer } from '@vertexade/ui/lib/dashboard-types'
import { LaunchDialog, ReviewDialog } from '../components/pull-requests/pull-request-dialogs'
import { LazyThreadDialog } from '../lib/lazy-dialogs'
import { useDashboardCache } from '../lib/dashboard-cache'
import { usePullRequestRefresh } from '../lib/use-pull-request-refresh'

type PullRequestDetailSearch = { tab?: PrDetailsTab; thread?: number }

export const Route = createFileRoute('/pull-requests_/$repoId/$prNumber')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): PullRequestDetailSearch => ({
    tab: ['conversation', 'changes', 'impact', 'evidence', 'checks', 'commits'].includes(String(search.tab))
      ? (search.tab as PrDetailsTab)
      : undefined,
    thread: Number.isInteger(Number(search.thread)) && Number(search.thread) > 0 ? Number(search.thread) : undefined,
  }),
  component: PullRequestDetailPage,
})

function PullRequestDetailPage() {
  const { repoId: repoIdParam, prNumber: prNumberParam } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const repoId = Number(repoIdParam)
  const prNumber = Number(prNumberParam)
  const dashboard = useDashboardCache()
  const data = dashboard.data
  const [currentUser, setCurrentUser] = useState<GithubReviewer | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const load = dashboard.refresh
  const { detailsRevision, refreshPullRequest } = usePullRequestRefresh(load)
  const pr = useMemo(
    () => data.prs.find((item) => item.repo_id === repoId && item.number === prNumber) || null,
    [data.prs, prNumber, repoId],
  )

  useEffect(() => {
    let current = true
    setCurrentUser(null)
    if (pr)
      void backendApi<GithubReviewer>(pr.backend_id, '/api/scm/me')
        .then((user) => {
          if (current) setCurrentUser(user)
        })
        .catch(() => {})
    return () => {
      current = false
    }
  }, [pr])

  const startReview = useCallback(() => setReviewOpen(true), [])

  const actions = useMemo<PrDetailsActions | undefined>(() => {
    if (!pr) return undefined
    const entity = {
      kind: 'pull-request',
      key: `${pr.full_name}#${pr.number}`,
      data: {
        ...pr,
        authored_by_me: Boolean(currentUser && String(pr.author || '').toLowerCase() === currentUser.login.toLowerCase()),
      },
    }
    const result: PrDetailsActions = {
      onStartWork: () => setLaunchOpen(true),
      onStartReview: () => void startReview(),
      contextualReviewActions: (
        <ContextualActions
          modules={data.modules}
          entity={entity}
          placement="pull-request.review"
          mode="sheet"
          onCompleted={refreshPullRequest}
        />
      ),
      contextualMenuActions: (
        <ContextualActions
          modules={data.modules}
          entity={entity}
          placement="pull-request.secondary"
          mode="menu"
          onCompleted={refreshPullRequest}
        />
      ),
    }
    return result
  }, [currentUser, data.modules, pr, refreshPullRequest, startReview])

  const openRun = (id: number) => void navigate({ search: (current) => ({ ...current, thread: id }) })
  const closeRun = () => void navigate({ search: (current) => ({ tab: current.tab }), replace: true })
  const changeTab = (tab: PrDetailsTab) => void navigate({ search: (current) => ({ ...current, tab }), replace: true, resetScroll: false })

  return (
    <>
      <GlobalHighlights rules={data.highlights} />
      <WorkspacePage className="pb-40 pt-3 md:pb-6 md:pt-4">
        {!dashboard.ready && (
          <div className="grid min-h-[32rem] place-items-center text-sm text-muted-foreground">Loading pull request…</div>
        )}
        {dashboard.ready && !pr && (
          <Empty className="min-h-[32rem]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest />
              </EmptyMedia>
              <EmptyTitle>Pull request unavailable</EmptyTitle>
              <EmptyDescription>It may have been merged, closed, or removed from the current workspace.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {pr && (
          <LazyBoundary label="pull request details" resetKey={`${pr.repo_id}:${pr.number}`}>
            <PrDetailsDialog
              embedded
              stickyTabs
              pr={pr}
              backAction={
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground"
                  onClick={() => {
                    if (window.history.length > 1) window.history.back()
                    else void navigate({ to: '/pull-requests' })
                  }}
                >
                  <ArrowLeft />
                  Pull requests
                </Button>
              }
              tab={search.tab}
              onTabChange={changeTab}
              onOpenChange={() => {}}
              onOpenRun={openRun}
              actions={actions}
              refreshKey={detailsRevision}
            />
          </LazyBoundary>
        )}
      </WorkspacePage>
      {pr && (
        <LaunchDialog
          pr={launchOpen ? pr : null}
          data={data}
          onOpenChange={(open) => !open && setLaunchOpen(false)}
          onStarted={(id) => {
            setLaunchOpen(false)
            openRun(id)
          }}
        />
      )}
      {pr && (
        <ReviewDialog
          pr={reviewOpen ? pr : null}
          data={data}
          onOpenChange={(open) => !open && setReviewOpen(false)}
          onStarted={(id) => {
            setReviewOpen(false)
            openRun(id)
          }}
        />
      )}
      {search.thread && (
        <LazyBoundary label="agent thread" resetKey={search.thread}>
          <LazyThreadDialog
            jobId={search.thread}
            onOpenChange={(open) => !open && closeRun()}
            onForked={(job) => openRun(job.id)}
            onReviewStarted={(job) => openRun(job.id)}
            onSubmitReview={() =>
              void navigate({
                search: () => ({ tab: 'changes' }),
                replace: true,
                resetScroll: false,
              })
            }
          />
        </LazyBoundary>
      )}
    </>
  )
}
