import { agentIsWorking, agentThreadState } from './agent-thread-state'
import type { Job, PullRequest } from './dashboard-types'

export type ActivityTone = 'blue' | 'amber' | 'emerald' | 'rose' | 'slate'

export type ActivityStatus = {
  label: string
  tone: ActivityTone
}

export function isReviewJob(job: Pick<Job, 'kind'>) {
  return job.kind === 'review' || job.kind === 'work_review'
}

export function jobActivityStatus(job: Pick<Job, 'kind' | 'status' | 'input_questions'>): ActivityStatus {
  const state = agentThreadState(job)
  const review = isReviewJob(job)
  if (state === 'waiting') return { label: review ? 'Review waiting' : 'Waiting for input', tone: 'amber' }
  if (agentIsWorking(state)) return { label: review ? 'Review running' : 'Active', tone: 'blue' }
  if (state === 'completed') return { label: review ? 'Review ready' : 'Finished', tone: 'emerald' }
  if (state === 'failed') return { label: review ? 'Review failed' : 'Failed', tone: 'rose' }
  if (state === 'resumable') return { label: 'Ready to continue', tone: 'amber' }
  return { label: 'Stopped', tone: 'slate' }
}

function recentJob(left: Job, right: Job) {
  const leftTime = Date.parse(left.activity_at || left.finished_at || left.created_at)
  const rightTime = Date.parse(right.activity_at || right.finished_at || right.created_at)
  return rightTime - leftTime
}

export function pullRequestReviewActivity(pr: PullRequest, threads: Job[]): ActivityStatus & { job: Job | null } {
  const reviewJobs = threads
    .filter((job) => isReviewJob(job) && job.repo_id === pr.repo_id && (job.pr_number === pr.number || job.linked_pr_number === pr.number))
    .sort(recentJob)
  const current =
    reviewJobs.find((job) => agentIsWorking(agentThreadState(job)) || agentThreadState(job) === 'waiting') ||
    reviewJobs.find((job) => job.status === 'completed' && (!job.head_sha || job.head_sha === pr.head_sha)) ||
    reviewJobs[0] ||
    null
  if (current) return { ...jobActivityStatus(current), job: current }
  if (pr.draft) return { label: 'Draft', tone: 'slate', job: null }
  if (pr.latest_agent_review_id && pr.latest_agent_review_head_sha === pr.head_sha)
    return { label: 'Review ready', tone: 'emerald', job: null }
  if (pr.review_decision === 'APPROVED') return { label: 'Approved', tone: 'emerald', job: null }
  if (pr.review_decision === 'CHANGES_REQUESTED') return { label: 'Changes requested', tone: 'rose', job: null }
  return { label: 'Ready for review', tone: 'amber', job: null }
}
