import { describe, expect, it } from 'vite-plus/test'
import {
  automaticReviewBaseline,
  automaticReviewCapacity,
  automaticReviewLaunchAllowed,
  automaticReviewSyncTrigger,
  automaticReviewTrigger,
  normalizeAutomaticReviewConcurrency,
} from './automatic-review-queue.ts'

describe('automatic review queue', () => {
  it('normalizes the configurable concurrency limit', () => {
    expect(normalizeAutomaticReviewConcurrency(undefined)).toBe(2)
    expect(normalizeAutomaticReviewConcurrency(4)).toBe(4)
    expect(normalizeAutomaticReviewConcurrency(999)).toBe(8)
    expect(normalizeAutomaticReviewConcurrency(0)).toBe(2)
    expect(normalizeAutomaticReviewConcurrency(1.5)).toBe(2)
  })

  it('only opens slots below the configured limit', () => {
    expect(automaticReviewCapacity(3, 0)).toBe(3)
    expect(automaticReviewCapacity(3, 2)).toBe(1)
    expect(automaticReviewCapacity(3, 3)).toBe(0)
    expect(automaticReviewCapacity(3, 10)).toBe(0)
  })

  it('runs the first eligible review without requiring a watch', () => {
    expect(
      automaticReviewTrigger({
        headSha: 'head-1',
        reviewedHeadSha: null,
        watched: false,
        initialMatched: true,
      }),
    ).toBe('initial')
    expect(
      automaticReviewTrigger({
        headSha: 'head-1',
        reviewedHeadSha: null,
        watched: false,
        initialMatched: false,
      }),
    ).toBeNull()
  })

  it('only reviews later commits while the pull request is watched', () => {
    expect(
      automaticReviewTrigger({
        headSha: 'head-2',
        reviewedHeadSha: 'head-1',
        watched: false,
        initialMatched: true,
      }),
    ).toBeNull()
    expect(
      automaticReviewTrigger({
        headSha: 'head-2',
        reviewedHeadSha: 'head-1',
        watched: true,
        initialMatched: false,
      }),
    ).toBe('watched_update')
    expect(
      automaticReviewTrigger({
        headSha: 'head-1',
        reviewedHeadSha: 'head-1',
        watched: true,
        initialMatched: true,
      }),
    ).toBeNull()
  })

  it('keeps a completed current-head review as the watch baseline', () => {
    expect(
      automaticReviewBaseline({
        currentHeadSha: 'head-2',
        currentHeadReviewed: true,
        latestReviewHeadSha: 'invalid-main-checkout',
        storedReviewedHeadSha: null,
      }),
    ).toBe('head-2')
    expect(
      automaticReviewBaseline({
        currentHeadSha: 'head-2',
        currentHeadReviewed: false,
        latestReviewHeadSha: 'head-1',
        storedReviewedHeadSha: null,
      }),
    ).toBe('head-1')
  })

  it('keeps explicit update watches active after rule-based automation is disabled', () => {
    expect(
      automaticReviewSyncTrigger({
        automationEnabled: false,
        headSha: 'head-2',
        reviewedHeadSha: 'head-1',
        watched: true,
        initialMatched: false,
      }),
    ).toBe('watched_update')
    expect(
      automaticReviewSyncTrigger({
        automationEnabled: false,
        headSha: 'head-1',
        reviewedHeadSha: null,
        watched: false,
        initialMatched: true,
      }),
    ).toBeNull()
    expect(
      automaticReviewSyncTrigger({
        automationEnabled: true,
        headSha: 'head-1',
        reviewedHeadSha: null,
        watched: false,
        initialMatched: true,
      }),
    ).toBe('initial')
  })

  it('blocks unwatched reruns when durable job history outlives the pull request marker', () => {
    expect(
      automaticReviewLaunchAllowed({
        headSha: 'head-2',
        reviewedHeadSha: null,
        latestAutomaticHeadSha: 'head-1',
        watched: false,
      }),
    ).toBe(false)
    expect(
      automaticReviewLaunchAllowed({
        headSha: 'head-2',
        reviewedHeadSha: null,
        latestAutomaticHeadSha: 'head-1',
        watched: true,
      }),
    ).toBe(true)
  })

  it('allows only a first unseen automatic review by default', () => {
    expect(
      automaticReviewLaunchAllowed({
        headSha: 'head-1',
        reviewedHeadSha: null,
        latestAutomaticHeadSha: null,
        watched: false,
      }),
    ).toBe(true)
    expect(
      automaticReviewLaunchAllowed({
        headSha: 'head-1',
        reviewedHeadSha: 'head-1',
        latestAutomaticHeadSha: null,
        watched: true,
      }),
    ).toBe(false)
  })
})
