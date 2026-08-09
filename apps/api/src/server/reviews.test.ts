import { describe, expect, it } from 'vite-plus/test'
import {
  isReviewSnapshotCurrent,
  reviewConversationPrompt,
  reviewRerunSelection,
  reviewSummaryPrompt,
  shouldStartReviewSummary,
} from './reviews.ts'

describe('review follow-up lifecycle', () => {
  it('summarizes single and aggregate reviews but not internal member reports', () => {
    expect(shouldStartReviewSummary({ kind: 'review', reviewRole: 'single', reviewPhase: 'details' })).toBe(true)
    expect(shouldStartReviewSummary({ kind: 'review', reviewRole: 'aggregate', reviewPhase: 'details' })).toBe(true)
    expect(shouldStartReviewSummary({ kind: 'review', reviewRole: 'member', reviewPhase: 'details' })).toBe(false)
    expect(shouldStartReviewSummary({ kind: 'review', reviewRole: 'single', reviewPhase: 'summary' })).toBe(false)
    expect(
      shouldStartReviewSummary({
        kind: 'work_review',
        reviewRole: 'single',
        reviewPhase: 'details',
      }),
    ).toBe(true)
    expect(shouldStartReviewSummary({ kind: 'task', reviewRole: 'single', reviewPhase: 'details' })).toBe(false)
  })

  it('requires the same-thread summary to preserve the detailed ratings', () => {
    const prompt = reviewSummaryPrompt()
    expect(prompt).toContain('same thread')
    expect(prompt).toContain('Intended outcome')
    expect(prompt).toContain('100 words total')
    expect(prompt).toContain('## Rating snapshot')
    expect(prompt).toContain('preserve its ratings and 1–10 scores exactly')
    expect(prompt).toContain('Do not add new findings')
  })

  it('can summarize a stored review without relying on provider history', () => {
    const prompt = reviewSummaryPrompt('## Recommendation\nP1 · Request changes')
    expect(prompt).toContain('<stored_review>')
    expect(prompt).toContain('untrusted reference content')
    expect(prompt).toContain('P1 · Request changes')
    expect(prompt).not.toContain('same thread')
  })

  it('continues an ephemeral review in a persistent conversation without losing its snapshot', () => {
    const prompt = reviewConversationPrompt(
      { reviewSummary: 'P1 · Request changes', reviewDetails: 'Finding: guard the null path.' },
      'Can you explain the risk?',
    )
    expect(prompt).toContain('new persistent agent thread')
    expect(prompt).toContain('P1 · Request changes')
    expect(prompt).toContain('Finding: guard the null path.')
    expect(prompt).toContain('Can you explain the risk?')
    expect(prompt).toContain('do not redo or change its findings unless the user explicitly asks')
  })

  it('does not mistake the previous detailed turn for a completed summary after restart', () => {
    const job = {
      kind: 'review',
      reviewPhase: 'summary',
      reviewPhaseStartedAt: '2026-07-19 10:00:00',
    }
    expect(isReviewSnapshotCurrent(job, Date.parse('2026-07-19T09:59:59Z') / 1_000)).toBe(false)
    expect(isReviewSnapshotCurrent(job, Date.parse('2026-07-19T10:00:01Z') / 1_000)).toBe(true)
    expect(isReviewSnapshotCurrent(job, null)).toBe(false)
    expect(isReviewSnapshotCurrent({ ...job, kind: 'work_review' }, Date.parse('2026-07-19T09:59:59Z') / 1_000)).toBe(false)
  })

  it('re-runs a single review with the same agent, model, and reasoning level', () => {
    expect(
      reviewRerunSelection({
        agentId: 'opencode',
        reviewRole: 'single',
        model: 'openai/gpt-5',
        reasoningEffort: 'high',
      }),
    ).toEqual({
      agentIds: ['opencode'],
      aggregatorAgentId: null,
      model: 'openai/gpt-5',
      reasoningEffort: 'high',
    })
  })

  it('re-runs an aggregate review with its original member and aggregation agents', () => {
    expect(reviewRerunSelection({ agentId: 'codex', reviewRole: 'aggregate' }, ['codex', 'opencode', 'codex'], 'opencode')).toEqual({
      agentIds: ['codex', 'opencode'],
      aggregatorAgentId: 'opencode',
      model: null,
      reasoningEffort: null,
    })
  })
})
