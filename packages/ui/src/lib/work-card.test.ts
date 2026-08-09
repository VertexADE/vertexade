import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from './dashboard-types'
import { workCardDetails } from './work-card'

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 1,
    key: 'W-0001',
    title: 'Review the change',
    description: '',
    kind: 'pr_review',
    state: 'review',
    state_override: null,
    state_override_reason: null,
    priority: 'normal',
    owner: null,
    primary_repository_id: 2,
    primary_repository_name: 'example/api',
    repository_names: ['example/api'],
    attention: null,
    sequential_execution: false,
    archived_at: null,
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
    events: [],
    relations: [],
    resources: [
      {
        id: 3,
        provider: 'github',
        kind: 'pull_request',
        external_id: 'example/api#42',
        repository_id: 2,
        label: 'PR #42 · Review the change',
        url: 'https://github.com/example/api/pull/42',
        state: 'open',
        metadata: { number: 42 },
        role: 'review_subject',
        is_primary: 1,
      },
    ],
    threads: [
      {
        id: 9,
        status: 'completed',
        kind: 'review',
        thread_id: 'thread-9',
        agent_id: 'codex',
        task_title: null,
        pr_number: 42,
        branch_name: null,
        head_sha: 'abc',
        latest_activity: '## Review summary',
        activity_at: '2026-07-20T00:00:00Z',
        created_at: '2026-07-20T00:00:00Z',
        finished_at: '2026-07-20T00:01:00Z',
        input_questions: null,
        linked_pr_number: null,
        full_name: 'example/api',
      },
    ],
    ...overrides,
    context_transfers: overrides.context_transfers || [],
  }
}

describe('Work card details', () => {
  it('distinguishes reviewable agent output from a PR that is in review', () => {
    const details = workCardDetails(item())

    expect(details.outputJob?.id).toBe(9)
    expect(details.outputLabel).toBe('Review output ready')
    expect(details.prInReview).toBe(true)
  })

  it('does not present approved or merged pull requests as in review', () => {
    for (const state of ['approved', 'merged', 'closed']) {
      const value = item({ resources: [{ ...item().resources[0], state }] })
      expect(workCardDetails(value).prInReview).toBe(false)
    }
  })

  it('summarizes multiple direct pull requests from the least advanced state', () => {
    const primary = { ...item().resources[0], state: 'approved', is_primary: 1 }
    const open = {
      ...primary,
      id: 4,
      external_id: 'example/api#43',
      label: 'PR #43',
      state: 'open',
      is_primary: 0,
    }
    const context = {
      ...primary,
      id: 5,
      external_id: 'example/api#44',
      label: 'PR #44',
      role: 'context',
      state: 'open',
      is_primary: 0,
    }
    const details = workCardDetails(item({ resources: [primary, open, context] }))

    expect(details.pullRequests).toHaveLength(2)
    expect(details.prInReview).toBe(true)
    expect(details.signal).toEqual({
      kind: 'review',
      label: '2 pull requests need review',
      detail: 'Progress follows the least advanced linked PR',
    })
  })

  it('prefers active work for status while retaining completed output', () => {
    const completed = item().threads[0]
    const running = {
      ...completed,
      id: 10,
      status: 'running',
      latest_activity: 'Implementing feedback',
    }
    const details = workCardDetails(item({ kind: 'implementation', threads: [running, completed] }))

    expect(details.currentJob?.id).toBe(10)
    expect(details.activeJobs).toHaveLength(1)
    expect(details.outputJob?.id).toBe(9)
  })

  it('labels completed worktree reviews separately from implementation output', () => {
    const review = { ...item().threads[0], kind: 'work_review' as const, pr_number: 0 }
    expect(workCardDetails(item({ kind: 'implementation', resources: [], threads: [review] })).outputLabel).toBe('Worktree review ready')
  })

  it('shows an active review as review work instead of generic activity', () => {
    const running = {
      ...item().threads[0],
      status: 'running',
      latest_activity: 'Checking responsive behavior',
    }
    const details = workCardDetails(item({ kind: 'implementation', state: 'review', resources: [], threads: [running] }))

    expect(details.signal).toEqual({
      kind: 'review',
      label: 'Review running',
      detail: 'Checking responsive behavior',
    })
  })

  it('shows one decision-oriented signal with attention taking precedence', () => {
    const details = workCardDetails(item({ attention: 'New commits need re-review' }))

    expect(details.signal).toEqual({
      kind: 'attention',
      label: 'New commits need re-review',
      detail: 'Action required',
    })
  })

  it('summarizes active work without exposing the full card detail stack', () => {
    const running = {
      ...item().threads[0],
      kind: 'task' as const,
      status: 'running',
      latest_activity: '## Progress\n\nImplementing the API contract',
    }
    const details = workCardDetails(item({ kind: 'implementation', state: 'active', resources: [], threads: [running] }))

    expect(details.signal).toEqual({
      kind: 'active',
      label: 'Progress Implementing the API contract',
      detail: '1 active thread',
    })
  })

  it('presents completed work as delivered instead of stale output', () => {
    expect(workCardDetails(item({ state: 'done' })).signal.kind).toBe('done')
  })
})
