import type { Job } from './dashboard-types'

export type AgentThreadState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'resumable'
  | 'interrupted'
  | 'cancelled'
  | 'unknown'

type AgentThread = Pick<Job, 'status' | 'input_questions'>
type AgentThreadActivity = Pick<Job, 'activity_at' | 'finished_at' | 'created_at'>

const activeStates = new Set<AgentThreadState>(['starting', 'running'])

export function agentNeedsInput(thread: AgentThread) {
  if (!activeStates.has(thread.status as AgentThreadState) || !thread.input_questions?.trim()) return false
  try {
    const questions = JSON.parse(thread.input_questions) as unknown
    return !Array.isArray(questions) || questions.length > 0
  } catch {
    return true
  }
}

export function agentThreadState(thread: AgentThread): AgentThreadState {
  if (agentNeedsInput(thread)) return 'waiting'
  return ['starting', 'running', 'completed', 'failed', 'resumable', 'interrupted', 'cancelled'].includes(thread.status)
    ? (thread.status as AgentThreadState)
    : 'unknown'
}

export function agentIsWorking(state: AgentThreadState) {
  return activeStates.has(state)
}

export function compareAgentThreadActivity(left: AgentThreadActivity, right: AgentThreadActivity) {
  return (
    Date.parse(right.activity_at || right.finished_at || right.created_at) -
    Date.parse(left.activity_at || left.finished_at || left.created_at)
  )
}

export function agentThreadLabel(state: AgentThreadState) {
  const labels: Record<AgentThreadState, string> = {
    starting: 'Starting',
    running: 'Working',
    waiting: 'Waiting for you',
    completed: 'Completed',
    failed: 'Failed',
    resumable: 'Ready to continue',
    interrupted: 'Interrupted',
    cancelled: 'Stopped',
    unknown: 'Status unavailable',
  }
  return labels[state]
}
