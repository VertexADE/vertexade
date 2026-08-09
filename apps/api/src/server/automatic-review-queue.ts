const DEFAULT_AUTOMATIC_REVIEW_CONCURRENCY = 2
const MAX_AUTOMATIC_REVIEW_CONCURRENCY = 8

export function normalizeAutomaticReviewConcurrency(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_AUTOMATIC_REVIEW_CONCURRENCY
  return Math.min(parsed, MAX_AUTOMATIC_REVIEW_CONCURRENCY)
}

export function automaticReviewCapacity(limit: unknown, active: unknown): number {
  return Math.max(0, normalizeAutomaticReviewConcurrency(limit) - Math.max(0, Number(active) || 0))
}

export type AutomaticReviewTrigger = 'initial' | 'watched_update' | null

export function automaticReviewBaseline({
  currentHeadSha,
  currentHeadReviewed,
  latestReviewHeadSha,
  storedReviewedHeadSha,
}: {
  currentHeadSha?: string | null
  currentHeadReviewed?: boolean
  latestReviewHeadSha?: string | null
  storedReviewedHeadSha?: string | null
}): string | null {
  if (currentHeadReviewed && currentHeadSha) return currentHeadSha
  return latestReviewHeadSha || storedReviewedHeadSha || null
}

export function automaticReviewLaunchAllowed({
  headSha,
  reviewedHeadSha,
  latestAutomaticHeadSha,
  watched,
}: {
  headSha?: string | null
  reviewedHeadSha?: string | null
  latestAutomaticHeadSha?: string | null
  watched?: boolean
}): boolean {
  if (!headSha || headSha === reviewedHeadSha || headSha === latestAutomaticHeadSha) return false
  return watched || (!reviewedHeadSha && !latestAutomaticHeadSha)
}

export function automaticReviewTrigger({
  headSha,
  reviewedHeadSha,
  watched,
  initialMatched,
}: {
  headSha?: string | null
  reviewedHeadSha?: string | null
  watched?: boolean
  initialMatched?: boolean
}): AutomaticReviewTrigger {
  if (!headSha || headSha === reviewedHeadSha) return null
  if (!reviewedHeadSha) return initialMatched ? 'initial' : null
  return watched ? 'watched_update' : null
}

export function automaticReviewSyncTrigger({
  automationEnabled,
  headSha,
  reviewedHeadSha,
  watched,
  initialMatched,
}: {
  automationEnabled?: boolean
  headSha?: string | null
  reviewedHeadSha?: string | null
  watched?: boolean
  initialMatched?: boolean
}): AutomaticReviewTrigger {
  if (!automationEnabled && !watched) return null
  return automaticReviewTrigger({
    headSha,
    reviewedHeadSha,
    watched,
    initialMatched: Boolean(automationEnabled && initialMatched),
  })
}
