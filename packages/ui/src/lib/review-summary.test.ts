import { describe, expect, it } from 'vite-plus/test'
import { storedReviewResult } from './review-summary'

describe('storedReviewResult', () => {
  it('does not infer a phased review from an unmigrated result', () => {
    expect(storedReviewResult({ resultText: 'Combined review output' })).toBeNull()
  })

  it('keeps phased review details and summary in their dedicated surfaces', () => {
    expect(
      storedReviewResult({
        reviewPhase: 'complete',
        reviewDetails: '## Findings\n\nDetailed evidence.',
        reviewSummary: '## Review summary\n\nConcise result.',
        resultText: 'legacy combined value',
      }),
    ).toEqual({
      details: '## Findings\n\nDetailed evidence.',
      summary: '## Review summary\n\nConcise result.',
    })
  })

  it('shows details while the same-thread summary is still running', () => {
    expect(storedReviewResult({ reviewPhase: 'summary', reviewDetails: '## Findings\n\nReady.' })).toEqual({
      details: '## Findings\n\nReady.',
      summary: '',
    })
  })
})
