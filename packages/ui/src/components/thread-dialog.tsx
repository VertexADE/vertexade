import { ThreadPanel, type ThreadViewCallbacks } from '@vertexade/ui/components/thread-panel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@vertexade/ui/components/ui/dialog'

export function ThreadDialog({
  jobId,
  onOpenChange,
  onHandoff,
  onSubmitReview,
  onForked,
  onReviewStarted,
}: ThreadViewCallbacks & {
  jobId: number | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(jobId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-dvh max-h-dvh max-w-full flex-col overflow-hidden rounded-none border-x-0 bg-background p-0 sm:h-[calc(100dvh-3rem)] sm:max-h-[calc(100dvh-3rem)] sm:max-w-7xl sm:rounded-2xl sm:border">
        <DialogTitle className="sr-only">Agent run</DialogTitle>
        <DialogDescription className="sr-only">Conversation, output, changes, and controls for the selected agent run.</DialogDescription>
        <ThreadPanel
          jobId={jobId}
          className="[&>header]:pr-12"
          onClose={() => onOpenChange(false)}
          onHandoff={onHandoff}
          onSubmitReview={onSubmitReview}
          onForked={onForked}
          onReviewStarted={onReviewStarted}
        />
      </DialogContent>
    </Dialog>
  )
}
