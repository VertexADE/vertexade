import type { WorkItem } from './dashboard-types'
import { activityPreview } from './activity-preview'
import { isReviewJob, jobActivityStatus } from './activity-status'

const activeStatuses = new Set(['starting', 'running', 'resumable'])
const terminalPullRequestStates = new Set(['approved', 'merged', 'closed'])

export function workCardDetails(item: WorkItem) {
  const pullRequests = item.resources
    .filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
    .sort((left, right) => right.is_primary - left.is_primary)
  const deployments = item.resources.filter((resource) => resource.kind === 'deployment')
  const activeJobs = item.threads.filter((job) => activeStatuses.has(job.status))
  const failedJobs = item.threads.filter((job) => job.status === 'failed')
  const currentJob = activeJobs[0] || item.threads[0]
  const outputJob = item.threads.find((job) => job.status === 'completed' && job.latest_activity)
  const pullRequest = pullRequests[0]
  const prInReview = item.state === 'review' && pullRequests.some((resource) => !terminalPullRequestStates.has(resource.state || ''))
  const outputLabel =
    outputJob?.kind === 'review' ? 'Review output ready' : outputJob?.kind === 'work_review' ? 'Worktree review ready' : 'Task output ready'

  const signal = item.attention
    ? { kind: 'attention' as const, label: item.attention, detail: 'Action required' }
    : failedJobs.length
      ? {
          kind: 'failed' as const,
          label: `${failedJobs.length} failed thread${failedJobs.length === 1 ? '' : 's'}`,
          detail: 'Open the Work item to recover',
        }
      : currentJob && activeJobs.length
        ? isReviewJob(currentJob)
          ? {
              kind: 'review' as const,
              label: jobActivityStatus(currentJob).label,
              detail: activityPreview(currentJob.latest_activity || `${currentJob.agent_id} · ${currentJob.status}`),
            }
          : {
              kind: 'active' as const,
              label: activityPreview(currentJob.latest_activity || `${currentJob.agent_id} · ${currentJob.status}`),
              detail: `${activeJobs.length} active thread${activeJobs.length === 1 ? '' : 's'}`,
            }
        : prInReview && pullRequest
          ? {
              kind: 'review' as const,
              label: pullRequests.length === 1 ? 'Pull request needs review' : `${pullRequests.length} pull requests need review`,
              detail: pullRequests.length === 1 ? pullRequest.label : 'Progress follows the least advanced linked PR',
            }
          : item.state === 'done'
            ? { kind: 'done' as const, label: 'Delivered', detail: 'Outcome completed' }
            : outputJob
              ? { kind: 'output' as const, label: outputLabel, detail: 'Result ready to inspect' }
              : item.state === 'deploy'
                ? {
                    kind: 'deploy' as const,
                    label: 'Moving through deployment',
                    detail: 'Delivery is in progress',
                  }
                : { kind: 'idle' as const, label: 'Ready to start', detail: 'No active thread' }

  return {
    pullRequest,
    pullRequests,
    deployments,
    activeJobs,
    failedJobs,
    currentJob,
    outputJob,
    prInReview,
    outputLabel,
    signal,
  }
}
