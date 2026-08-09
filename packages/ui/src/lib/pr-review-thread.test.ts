import { describe, expect, it } from 'vite-plus/test'
import { reviewThreadDiffLines, reviewThreadSide, reviewThreadTarget, type PullRequestReviewThread } from './pr-review-thread'

function thread(value: Partial<PullRequestReviewThread> = {}): PullRequestReviewThread {
  return {
    id: 'thread-1',
    isResolved: false,
    isOutdated: false,
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    path: 'src/example.ts',
    line: 12,
    originalLine: 11,
    diffSide: 'RIGHT',
    comments: {
      nodes: [
        {
          id: 'comment-1',
          body: 'Please rename this.',
          createdAt: '2026-07-23T00:00:00Z',
          diffHunk: '@@ -10,3 +10,4 @@\n unchanged\n-oldName()\n+newName()\n+added()\n next',
        },
      ],
    },
    ...value,
  }
}

describe('pull request review thread context', () => {
  it('maps current and deleted thread locations to GitHub diff targets', () => {
    expect(reviewThreadTarget(thread())).toEqual({
      path: 'src/example.ts',
      line: 12,
      side: 'RIGHT',
    })
    expect(reviewThreadTarget(thread({ line: null, originalLine: 11, diffSide: undefined }))).toEqual({
      path: 'src/example.ts',
      line: 11,
      side: 'LEFT',
    })
    expect(reviewThreadSide(thread({ line: null, diffSide: undefined }))).toBe('LEFT')
  })

  it('tracks both sides of a hunk and highlights the annotated new line', () => {
    const lines = reviewThreadDiffLines(thread())
    expect(lines.map(({ oldLine, newLine }) => [oldLine, newLine])).toEqual([
      [null, null],
      [10, 10],
      [11, null],
      [null, 11],
      [null, 12],
      [12, 13],
    ])
    expect(lines.filter((line) => line.highlighted).map((line) => line.content)).toEqual(['+added()'])
  })

  it('highlights the original line for a deleted-side annotation', () => {
    const lines = reviewThreadDiffLines(thread({ line: null, originalLine: 11, diffSide: 'LEFT' }))
    expect(lines.filter((line) => line.highlighted).map((line) => line.content)).toEqual(['-oldName()'])
  })

  it('returns no context when GitHub omitted the diff hunk', () => {
    expect(reviewThreadDiffLines(thread({ comments: { nodes: [] } }))).toEqual([])
  })
})
