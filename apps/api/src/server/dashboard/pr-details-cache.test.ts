import { describe, expect, it } from 'vite-plus/test'
import { createPullRequestDetailsCache, PR_DETAILS_CACHE_MAX_BYTES, PR_DETAILS_CACHE_MAX_ENTRIES } from './pr-details-cache.ts'

describe('pull request details cache', () => {
  it('keeps unique details inside its entry and byte budgets', () => {
    const cache = createPullRequestDetailsCache()
    for (let index = 0; index < 200; index += 1) {
      cache.set(`1:${index}`, { number: index, diff: 'x'.repeat(1024 * 1024) })
    }

    expect(cache.size).toBeLessThanOrEqual(PR_DETAILS_CACHE_MAX_ENTRIES)
    expect(cache.retainedBytes).toBeLessThanOrEqual(PR_DETAILS_CACHE_MAX_BYTES)
  })

  it('returns but does not retain a response larger than the whole budget', () => {
    const cache = createPullRequestDetailsCache()
    const details = { diff: 'x'.repeat(PR_DETAILS_CACHE_MAX_BYTES + 1) }

    expect(cache.set('1:1', details)).toBe(false)
    expect(cache.get('1:1')).toBeUndefined()
  })
})
