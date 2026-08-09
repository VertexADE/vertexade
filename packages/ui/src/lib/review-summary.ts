export type StoredReviewResult = {
  reviewPhase?: string | null
  reviewDetails?: string | null
  reviewSummary?: string | null
  resultText?: string | null
}

export function storedReviewResult(review: StoredReviewResult) {
  if (!review.reviewPhase) return null
  return {
    summary: review.reviewSummary || '',
    details: review.reviewDetails || (review.reviewPhase === 'details' ? review.resultText || '' : ''),
  }
}
