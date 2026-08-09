import { describe, expect, it } from 'vite-plus/test'
import { reviewLaunchFeedback } from './review-launch-feedback'

describe('reviewLaunchFeedback', () => {
  it('explains that a failed launch did not create a thread', () => {
    expect(
      reviewLaunchFeedback(0, [
        {
          repository: 'example/repository · thread #42',
          error: 'Fallow skill is unavailable',
        },
      ]),
    ).toEqual({
      kind: 'error',
      title: 'No review thread was created',
      description: 'example/repository · thread #42: Fallow skill is unavailable',
    })
  })

  it('keeps partial launches distinct from complete success', () => {
    expect(
      reviewLaunchFeedback(1, [
        {
          repository: 'example/other',
          error: 'Worktree is unavailable',
        },
      ]),
    ).toEqual({
      kind: 'warning',
      title: '1 review started; 1 worktree failed',
      description: 'example/other: Worktree is unavailable',
    })
    expect(reviewLaunchFeedback(2, [])).toEqual({
      kind: 'success',
      title: '2 worktree reviews started',
    })
  })
})
