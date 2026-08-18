import { describe, expect, it } from 'vite-plus/test'
import type { PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { unifiedPullRequests } from './unified-pull-requests'

function pullRequest(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: 1,
    repo_id: 1,
    full_name: 'dovo/vertexade',
    number: 42,
    title: 'Unify servers',
    author: 'dominic',
    author_avatar_url: null,
    url: 'https://github.com/dovo/vertexade/pull/42',
    base_ref: 'main',
    head_ref: 'unified',
    head_sha: 'abc',
    draft: 0,
    created_at: null,
    updated_at: '2026-08-18T06:00:00Z',
    labels: null,
    reviewers: null,
    merge_state_status: null,
    checks_pending: 0,
    checks_failed: 0,
    auto_merge_enabled: 0,
    review_decision: null,
    manual_not_ready_at: null,
    updated_after_not_ready_at: null,
    auto_review_watch: 0,
    auto_reviewed_head_sha: null,
    latest_agent_review_id: null,
    latest_agent_review_head_sha: null,
    latest_agent_review_created_at: null,
    latest_agent_review_finished_at: null,
    latest_agent_review_agent_id: null,
    latest_agent_review_automatic: null,
    ...overrides,
  }
}

describe('unified pull requests', () => {
  it('shows one pull request with the latest review while keeping mutable state on its execution owner', () => {
    const local = pullRequest({ backend_id: 'local', repo_id: 1 })
    const remote = pullRequest({
      id: 1_000_001,
      repo_id: 1_000_002,
      backend_id: 'remote',
      full_name: 'Dovo/VertexADE',
      auto_review_watch: 1,
      latest_agent_review_id: 1_000_003,
      latest_agent_review_created_at: '2026-08-18T07:00:00Z',
      latest_agent_review_agent_id: 'codex',
    })
    for (const input of [
      [local, remote],
      [remote, local],
    ])
      expect(unifiedPullRequests(input, 'local')).toEqual([
        expect.objectContaining({
          backend_id: 'local',
          backend_aliases: ['local', 'remote'],
          repo_id: 1,
          auto_review_watch: 0,
          latest_agent_review_id: 1_000_003,
        }),
      ])
  })
})
