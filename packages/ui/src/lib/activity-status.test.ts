import { describe, expect, it } from 'vite-plus/test'
import type { Job, PullRequest } from './dashboard-types'
import { isReviewJob, jobActivityStatus, pullRequestReviewActivity } from './activity-status'

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 9,
    repo_id: 2,
    full_name: 'example/api',
    pr_number: 42,
    status: 'running',
    thread_id: 'thread-9',
    thread_url: null,
    agent_id: 'codex',
    agent_name: 'Codex',
    can_steer: true,
    worktree_path: '/tmp/worktree',
    head_sha: 'abc',
    latest_activity: 'Inspecting changes',
    activity_at: '2026-07-27T10:00:00Z',
    created_at: '2026-07-27T09:00:00Z',
    finished_at: null,
    diff_files: null,
    diff_additions: 0,
    diff_deletions: 0,
    input_questions: null,
    kind: 'task',
    source_job_id: null,
    task_title: 'Implement endpoint',
    branch_name: 'feature/endpoint',
    linked_pr_number: null,
    linked_pr_url: null,
    archived_at: null,
    pr_merged_at: null,
    pr_closed_at: null,
    review_phase: null,
    review_phase_started_at: null,
    review_details: null,
    review_summary: null,
    agent_model: null,
    agent_reasoning_effort: null,
    work_item_id: null,
    ...overrides,
  }
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 3,
    repo_id: 2,
    full_name: 'example/api',
    number: 42,
    title: 'Add endpoint',
    author: 'maria',
    author_avatar_url: null,
    url: 'https://github.com/example/api/pull/42',
    base_ref: 'main',
    head_ref: 'feature/endpoint',
    head_sha: 'abc',
    draft: 0,
    created_at: '2026-07-27T08:00:00Z',
    updated_at: '2026-07-27T10:00:00Z',
    labels: null,
    reviewers: null,
    merge_state_status: 'CLEAN',
    checks_pending: 0,
    checks_failed: 0,
    auto_merge_enabled: 0,
    review_decision: 'REVIEW_REQUIRED',
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

describe('activity status', () => {
  it('uses concise thread lifecycle labels', () => {
    expect(jobActivityStatus(job())).toEqual({ label: 'Active', tone: 'blue' })
    expect(jobActivityStatus(job({ status: 'completed' }))).toEqual({
      label: 'Finished',
      tone: 'emerald',
    })
    expect(jobActivityStatus(job({ input_questions: '[{\"question\":\"Continue?\"}]' }))).toEqual({
      label: 'Waiting for input',
      tone: 'amber',
    })
  })

  it('distinguishes reviews that are running and ready', () => {
    const review = job({ kind: 'review' })
    expect(isReviewJob(review)).toBe(true)
    expect(jobActivityStatus(review)).toEqual({ label: 'Review running', tone: 'blue' })
    expect(jobActivityStatus({ ...review, status: 'completed' })).toEqual({
      label: 'Review ready',
      tone: 'emerald',
    })
  })

  it('prefers live review work over older completed reviews', () => {
    const completed = job({
      id: 8,
      kind: 'review',
      status: 'completed',
      finished_at: '2026-07-27T09:30:00Z',
    })
    const running = job({
      id: 9,
      kind: 'review',
      status: 'running',
      activity_at: '2026-07-27T10:00:00Z',
    })
    expect(pullRequestReviewActivity(pullRequest(), [completed, running])).toMatchObject({
      label: 'Review running',
      tone: 'blue',
      job: { id: 9 },
    })
  })

  it('shows PRs without an agent run as ready for review', () => {
    expect(pullRequestReviewActivity(pullRequest(), [])).toEqual({
      label: 'Ready for review',
      tone: 'amber',
      job: null,
    })
  })

  it('keeps drafts out of the ready queue', () => {
    expect(pullRequestReviewActivity(pullRequest({ draft: 1 }), [])).toEqual({
      label: 'Draft',
      tone: 'slate',
      job: null,
    })
  })
})
