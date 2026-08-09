import { Avatar, AvatarFallback, AvatarImage } from '@vertexade/ui/components/ui/avatar'
import type { GithubReviewer } from '@vertexade/ui/lib/dashboard-types'

const visibleReviewerLimit = 3

export function PrAssignedPeople({ reviewers }: { reviewers: GithubReviewer[] }) {
  if (!reviewers.length) return null

  const visibleReviewers = reviewers.slice(0, visibleReviewerLimit)
  const reviewerNames = reviewers.map((reviewer) => reviewer.login).join(', ')

  return (
    <span
      data-pr-assignees
      className="flex min-w-0 items-center gap-1.5"
      aria-label={`Assigned reviewers: ${reviewerNames}`}
      title={`Assigned reviewers: ${reviewerNames}`}
    >
      <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
        {visibleReviewers.map((reviewer) => (
          <Avatar key={reviewer.login} size="sm" className="size-5 border border-card bg-card ring-1 ring-border/70">
            <AvatarImage src={reviewer.avatar_url} alt="" />
            <AvatarFallback className="text-[8px]">{reviewer.login.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        ))}
      </span>
      {reviewers.length > visibleReviewerLimit && (
        <span className="grid size-5 place-items-center rounded-full border border-card bg-muted text-[8px] font-medium text-muted-foreground ring-1 ring-border/70">
          +{reviewers.length - visibleReviewerLimit}
        </span>
      )}
      <span className="min-w-0 max-w-32 truncate text-[11px] font-medium text-foreground/80">
        {reviewers[0].login}
        {reviewers.length > 1 ? ` +${reviewers.length - 1}` : ''}
      </span>
    </span>
  )
}
