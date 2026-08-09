export type ReviewLaunchError = {
  repository: string
  error: string
}

type ReviewLaunchFeedback = {
  kind: 'success' | 'warning' | 'error'
  title: string
  description?: string
}

export function reviewLaunchFeedback(reviewCount: number, errors: ReviewLaunchError[]): ReviewLaunchFeedback {
  if (!errors.length) {
    return {
      kind: 'success',
      title: `${reviewCount} worktree ${reviewCount === 1 ? 'review' : 'reviews'} started`,
    }
  }

  const description = errors.map((entry) => `${entry.repository}: ${entry.error}`).join(' • ')

  if (!reviewCount) {
    return {
      kind: 'error',
      title: 'No review thread was created',
      description,
    }
  }

  return {
    kind: 'warning',
    title: `${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'} started; ${errors.length} ${errors.length === 1 ? 'worktree' : 'worktrees'} failed`,
    description,
  }
}
