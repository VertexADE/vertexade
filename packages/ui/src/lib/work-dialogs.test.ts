import { describe, expect, it } from 'vite-plus/test'
import type { WorkResource } from './dashboard-types'
import { dialogNavigationOptions, pullRequestDialogItem, selectedPullRequest, workDetailSearch } from './work-dialogs'

const resource: WorkResource = {
  id: 7,
  provider: 'github',
  kind: 'pull_request',
  external_id: 'example/api#42',
  repository_id: 3,
  label: 'PR #42 · feat: inline dialogs',
  url: 'https://github.com/example/api/pull/42',
  state: 'open',
  metadata: { number: 42, headSha: 'abc' },
  role: 'delivery',
  is_primary: 1,
}
const review = {
  id: 19,
  status: 'completed',
  kind: 'review' as const,
  pr_number: 42,
  linked_pr_number: null,
  full_name: 'example/api',
  head_sha: 'abc',
}

describe('Work dialog links', () => {
  it('preserves the page position when dialog search parameters change', () => {
    expect(dialogNavigationOptions).toEqual({ resetScroll: false })
  })

  it('normalizes only valid thread and pull-request deep-link values', () => {
    expect(workDetailSearch({ section: 'threads', thread: '12', repo: 3, pr: '42' })).toEqual({
      section: 'threads',
      thread: 12,
      repo: 3,
      pr: 42,
    })
    expect(workDetailSearch({ section: 'unknown', thread: 'nope', repo: 0, pr: -1 })).toEqual({
      section: undefined,
      thread: undefined,
      repo: undefined,
      pr: undefined,
    })
  })

  it('builds a PR dialog target from the Work resource identity', () => {
    expect(pullRequestDialogItem(resource, [review])).toEqual({
      repo_id: 3,
      full_name: 'example/api',
      number: 42,
      title: 'feat: inline dialogs',
      url: 'https://github.com/example/api/pull/42',
      head_sha: 'abc',
      latest_agent_review_id: 19,
      latest_agent_review_head_sha: 'abc',
    })
    expect(selectedPullRequest([resource], [review], { repo: 3, pr: 42 })?.number).toBe(42)
    expect(selectedPullRequest([resource], [review], { repo: 3, pr: 41 })).toBeNull()
  })
})
