import { useState } from 'react'
import { api, dateValue, parseJson } from '@vertexade/ui/lib/dashboard-api'
import { parseConventionalTitle } from '@vertexade/ui/lib/conventional-title'
import type { GithubLabel, GithubReviewer, Job, PullRequest, WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { pullRequestSummaryFlow } from '@vertexade/ui/lib/pull-request-flow'
import type { PullRequestFlowDecision } from '@vertexade/ui/lib/pull-request-flow'
import { recommendedPullRequestAction } from '../../lib/pull-request-action-policy'
import { usePullRequestMutation } from '../../lib/use-pull-request-mutation'

import { type PrActionHandlers } from './pull-request-row-actions'
export function usePrRow({
  pr,
  currentUser,
  agentThreads,
  onDetails,
  onLaunch,
  onReview,
  onReconcile,
}: {
  pr: PullRequest
  currentUser: GithubReviewer | null
  agentThreads: Job[]
  onDetails(): void
  onLaunch(flow: PullRequestFlowDecision): void
  onReview(): void
  onReconcile(): Promise<void>
}) {
  const [renderedAt] = useState(Date.now)
  const labels = parseJson<GithubLabel[]>(pr.labels, [])
  const reviewers = parseJson<GithubReviewer[]>(pr.reviewers, [])
  const conventional = parseConventionalTitle(pr.title)
  const createdAt = dateValue(pr.created_at)
  const openLongerThanDay = !pr.draft && createdAt && renderedAt - createdAt.getTime() > 86_400_000
  const assignedToMe = Boolean(currentUser && reviewers.some((reviewer) => reviewer.login === currentUser.login))
  const authoredByMe = Boolean(currentUser && String(pr.author || '').toLowerCase() === currentUser.login.toLowerCase())
  const identity = currentUser ? ({ status: 'ready', login: currentUser.login } as const) : ({ status: 'loading' } as const)
  const flow = pullRequestSummaryFlow(pr, identity, agentThreads)
  const checksSignal =
    pr.checks_failed > 0
      ? {
          label: `${pr.checks_failed} failed`,
          className: 'text-red-400',
          dotClassName: 'bg-red-400',
        }
      : pr.checks_pending > 0
        ? {
            label: `${pr.checks_pending} pending`,
            className: 'text-amber-400',
            dotClassName: 'bg-amber-400',
          }
        : { label: 'All clear', className: 'text-emerald-400', dotClassName: 'bg-emerald-400' }
  const mergeSignal =
    pr.merge_state_status === 'BEHIND'
      ? { label: 'Update needed', className: 'text-orange-400', dotClassName: 'bg-orange-400' }
      : pr.merge_state_status === 'BLOCKED'
        ? { label: 'Blocked', className: 'text-red-400', dotClassName: 'bg-red-400' }
        : pr.merge_state_status === 'CLEAN'
          ? { label: 'Ready', className: 'text-emerald-400', dotClassName: 'bg-emerald-400' }
          : {
              label: pr.merge_state_status?.replaceAll('_', ' ').toLowerCase() || 'Unknown',
              className: 'text-muted-foreground',
              dotClassName: 'bg-muted-foreground',
            }
  const mutation = usePullRequestMutation(onReconcile)
  const updating = mutation.busy('update')
  const markingReady = mutation.busy('ready')
  const readinessBusy = mutation.busy('readiness')
  const enablingAutoMerge = mutation.busy('auto-merge')
  const addingToWork = mutation.busy('work')
  async function addToWork() {
    await mutation.run(
      'work',
      () => api<WorkItem>(`/api/pulls/${pr.repo_id}/${pr.number}/work`, { method: 'POST', body: '{}' }),
      (item) => `${item.key} added as a contributor review task`,
    )
  }
  async function assignMe() {
    await mutation.run(
      'assign-me',
      () => api(`/api/pulls/${pr.repo_id}/${pr.number}/reviewers`, { method: 'POST', body: JSON.stringify({ me: true }) }),
      () => `Assigned ${currentUser?.login || 'you'} to review #${pr.number}`,
    )
  }
  async function updateBranch() {
    await mutation.run(
      'update',
      () => api<{ message: string }>(`/api/pulls/${pr.repo_id}/${pr.number}/update-branch`, { method: 'POST', body: '{}' }),
      (result) => result.message,
    )
  }
  async function markReadyForReview() {
    await mutation.run(
      'ready',
      () => api<{ message: string }>(`/api/pulls/${pr.repo_id}/${pr.number}/ready-for-review`, { method: 'POST', body: '{}' }),
      (result) => result.message,
    )
  }
  async function changeReadiness(action: 'mark' | 'clear' | 'dismiss-update') {
    await mutation.run(
      'readiness',
      () => api(`/api/pulls/${pr.repo_id}/${pr.number}/readiness`, { method: 'POST', body: JSON.stringify({ action }) }),
      () =>
        action === 'mark'
          ? `Marked #${pr.number} not ready`
          : action === 'clear'
            ? `Cleared not-ready mark on #${pr.number}`
            : 'Update indicator dismissed',
    )
  }
  async function enableAutoMerge() {
    await mutation.run(
      'auto-merge',
      () => api<{ message: string }>(`/api/pulls/${pr.repo_id}/${pr.number}/auto-merge`, { method: 'POST', body: '{}' }),
      (result) => result.message,
    )
  }
  const handlers: PrActionHandlers = {
    work: () => onLaunch(flow),
    review: onReview,
    details: onDetails,
    ready: () => void markReadyForReview(),
    update: () => void updateBranch(),
    autoMerge: () => void enableAutoMerge(),
  }
  const recommendation = recommendedPullRequestAction(
    pr,
    {
      markingReady,
      updating,
      enablingAutoMerge,
    },
    {
      identity,
      threads: agentThreads,
    },
  )
  return {
    labels,
    reviewers,
    conventional,
    openLongerThanDay,
    assignedToMe,
    authoredByMe,
    flow,
    checksSignal,
    mergeSignal,
    readinessBusy,
    addingToWork,
    assigningMe: mutation.busy('assign-me'),
    mutationFailure: mutation.failure,
    retryMutation: mutation.retry,
    handlers,
    recommendation,
    addToWork,
    assignMe,
    changeReadiness,
  }
}
