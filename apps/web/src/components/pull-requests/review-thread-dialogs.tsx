import type { DashboardData, JobLog, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { ReviewDialog, ReviewHandoffDialog } from './pull-request-dialogs'
import { LazyThreadDialog } from '../../lib/lazy-dialogs'

export function ReviewThreadDialogs({
  reviewPr,
  threadId,
  handoffJob,
  presentation,
  data,
  setReviewPr,
  setHandoffJob,
  onSubmitReview,
  closeLink,
  openRun,
}: {
  reviewPr: PullRequest | null
  threadId: number | null
  handoffJob: JobLog | null
  presentation: DashboardData['presentation']
  data: DashboardData
  setReviewPr(pr: PullRequest | null): void
  setHandoffJob(job: JobLog | null): void
  onSubmitReview(job: JobLog): void
  closeLink(): void
  openRun(id: number): void
}) {
  return (
    <>
      <ReviewDialog
        pr={reviewPr}
        data={data}
        onOpenChange={(open) => !open && setReviewPr(null)}
        onStarted={(id) => {
          setReviewPr(null)
          openRun(id)
        }}
      />
      {threadId && (
        <LazyBoundary label="agent run" resetKey={threadId}>
          <LazyThreadDialog
            jobId={threadId}
            onOpenChange={(open) => !open && closeLink()}
            onHandoff={(job) => {
              closeLink()
              setHandoffJob(job)
            }}
            onSubmitReview={onSubmitReview}
            onForked={(job) => openRun(job.id)}
            onReviewStarted={(job) => openRun(job.id)}
          />
        </LazyBoundary>
      )}
      <ReviewHandoffDialog
        job={handoffJob}
        presentation={presentation}
        onOpenChange={(open) => !open && setHandoffJob(null)}
        onSent={(id) => {
          setHandoffJob(null)
          openRun(id)
        }}
      />
    </>
  )
}
