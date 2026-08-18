import { describe, expect, it } from 'vite-plus/test'
import { pullRequestThreadTitle } from './pull-request-thread-title.ts'

describe('pullRequestThreadTitle', () => {
  it('gives review and work automation threads a useful persisted title', () => {
    expect(pullRequestThreadTitle('review', { number: 42, title: 'Repair the queue' })).toBe('Review PR #42: Repair the queue')
    expect(pullRequestThreadTitle('task', { number: 42, title: 'Repair the queue' })).toBe('Work on PR #42: Repair the queue')
  })

  it.each([null, undefined, '', '   ', 'null', 'undefined'])('never exposes an unusable provider title: %s', (title) => {
    expect(pullRequestThreadTitle('task', { number: 42, title })).toBe('Work on PR #42')
  })

  it('normalizes whitespace and respects the stored title limit', () => {
    const title = pullRequestThreadTitle('task', { number: 42, title: `  ${'word '.repeat(100)}` })
    expect(title).toHaveLength(200)
    expect(title).not.toContain('  ')
  })
})
