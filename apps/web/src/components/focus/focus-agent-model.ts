import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { dateValue } from '@vertexade/ui/lib/dashboard-api'
import type { Job } from '@vertexade/ui/lib/dashboard-types'

export type AgentDockSection = 'input' | 'active' | 'recent'

function jobActivityTime(job: Job) {
  return dateValue(job.activity_at || job.finished_at || job.created_at)?.getTime() ?? 0
}

function activeJob(job: Job) {
  return ['starting', 'running'].includes(agentThreadState(job))
}

export function buildAgentDockSections(threads: Job[]) {
  const available = threads.filter((thread) => !thread.archived_at && Boolean(thread.thread_id))
  const sort = (values: Job[]) => [...values].sort((left, right) => jobActivityTime(right) - jobActivityTime(left) || right.id - left.id)
  return {
    input: sort(available.filter((job) => agentThreadState(job) === 'waiting')),
    active: sort(available.filter(activeJob)),
    recent: sort(available.filter((job) => !activeJob(job) && agentThreadState(job) !== 'waiting')).slice(0, 8),
  } satisfies Record<AgentDockSection, Job[]>
}

export function agentDockDefaultSection(sections: Record<AgentDockSection, Job[]>): AgentDockSection {
  if (sections.input.length) return 'input'
  if (sections.active.length) return 'active'
  return 'recent'
}

export function jobTitle(job: Job) {
  if (job.task_title) return job.task_title
  if (job.kind === 'review') return `Review PR #${job.pr_number}`
  if (job.kind === 'work_review') return 'Worktree code review'
  if (job.kind === 'stack_analysis') return 'PR stack analysis'
  return job.kind_title_fallback || `Thread #${job.id}`
}

export function firstInputQuestion(job: Job) {
  if (!job.input_questions) return null
  try {
    const questions = JSON.parse(job.input_questions) as Array<{ question?: unknown }>
    const question = questions[0]?.question
    return typeof question === 'string' && question.trim() ? question.trim() : null
  } catch {
    return null
  }
}
