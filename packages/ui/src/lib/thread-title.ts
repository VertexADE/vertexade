import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendId } from '@vertexade/ui/lib/backend-registry'

export function usableThreadTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title || ['null', 'undefined'].includes(title.toLowerCase())) return null
  return title
}

export function threadTitle(job: Job): string {
  const stored = usableThreadTitle(job.task_title)
  if (stored) return stored
  const id = displayBackendId(job, job.id)
  const fallback = usableThreadTitle(job.kind_title_fallback)
  if (job.kind === 'subagent') return `Child agent #${id}`
  if (job.kind === 'pre_pr') return `Task #${id}`
  if (job.kind === 'work_review') return 'Worktree code review'
  if (job.kind === 'stack_analysis') return 'Pull request stack analysis'
  if (job.kind === 'review') return job.pr_number ? `Review PR #${job.pr_number}` : 'Code review'
  if (job.kind === 'planning') return `Planning · ${job.full_name}`
  if (job.pr_number) return `${job.full_name} · PR #${job.pr_number}`
  return fallback || `Run #${id}`
}
