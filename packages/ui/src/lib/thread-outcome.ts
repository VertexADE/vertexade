import type { JobLog, LogEvent } from './dashboard-types'
import { agentThreadState } from './agent-thread-state'

export type FollowUpOutcome = 'none' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed'

export type ThreadOutcome = {
  outputReady: boolean
  outputCompletedAt: string | null
  followUp: FollowUpOutcome
  followUpStartedAt: string | null
  headline: string
  description: string
  tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger'
}

function eventName(event: LogEvent) {
  return String(event.data?.event || '')
}

function completionSucceeded(event: LogEvent) {
  return eventName(event) === 'turn_completed' && event.data?.status === 'completed'
}

function completionFailed(event: LogEvent) {
  return eventName(event) === 'turn_completed' && event.data?.status !== 'completed'
}

function lastIndex(events: LogEvent[], predicate: (event: LogEvent) => boolean) {
  for (let index = events.length - 1; index >= 0; index -= 1) if (predicate(events[index])) return index
  return -1
}

function followUpOutcome(job: JobLog, followUpIndex: number): FollowUpOutcome {
  if (followUpIndex < 0) return 'none'
  const later = job.events.slice(followUpIndex + 1)
  if (later.some(completionSucceeded)) return 'completed'
  if (later.some(completionFailed)) return 'failed'
  const state = agentThreadState(job)
  if (state === 'waiting') return 'waiting'
  if (['starting', 'running'].includes(state)) return 'running'
  if (state === 'failed') return 'failed'
  if (state === 'completed') return 'completed'
  return 'paused'
}

const presentations: Record<string, Pick<ThreadOutcome, 'headline' | 'description' | 'tone'>> = {
  'output:running': {
    headline: 'Updating completed output',
    description: 'The previous result remains available while the agent handles your follow-up.',
    tone: 'active',
  },
  'output:waiting': {
    headline: 'Input required',
    description: 'The previous result remains available while the agent waits for your response.',
    tone: 'warning',
  },
  'output:paused': {
    headline: 'Output ready · follow-up paused',
    description: 'The previous result remains available. Resume the thread to continue the latest follow-up.',
    tone: 'warning',
  },
  'output:failed': {
    headline: 'Output ready · follow-up failed',
    description: 'The completed result is preserved. Only the latest follow-up needs attention.',
    tone: 'warning',
  },
  'output:completed': {
    headline: 'Updated output ready',
    description: 'The agent completed the original task and the latest follow-up.',
    tone: 'success',
  },
  'output:none': {
    headline: 'Output ready',
    description: 'The agent completed this task and its result is ready to review.',
    tone: 'success',
  },
  'status:starting': {
    headline: 'Agent is starting',
    description: 'Live activity and changes will appear as the task progresses.',
    tone: 'active',
  },
  'status:running': {
    headline: 'Agent is running',
    description: 'Live activity and changes will appear as the task progresses.',
    tone: 'active',
  },
  'status:waiting': {
    headline: 'Input required',
    description: 'Answer the agent’s question so it can continue this task.',
    tone: 'warning',
  },
  'status:resumable': {
    headline: 'Ready to resume',
    description: 'The saved task can continue in the same workspace and thread.',
    tone: 'warning',
  },
  'status:failed': {
    headline: 'Run failed',
    description: 'No completed output was produced. Review the failure and retry the task.',
    tone: 'danger',
  },
  'status:cancelled': {
    headline: 'Run stopped',
    description: 'The run was stopped by request. Its existing worktree and output remain available.',
    tone: 'warning',
  },
  fallback: {
    headline: 'Run status unavailable',
    description: 'Review the activity timeline for the latest task state.',
    tone: 'neutral',
  },
}

function presentation(job: JobLog, outputReady: boolean, followUp: FollowUpOutcome) {
  return presentations[outputReady ? `output:${followUp}` : `status:${agentThreadState(job)}`] || presentations.fallback
}

export function threadOutcome(job: JobLog): ThreadOutcome {
  const followUpIndex = lastIndex(job.events, (event) => eventName(event) === 'follow_up_started')
  const completedIndex = lastIndex(job.events, completionSucceeded)
  const hasOutput = Boolean(job.result_text?.trim() || job.review_details?.trim() || job.review_summary?.trim())
  const outputReady = hasOutput && (completedIndex >= 0 || agentThreadState(job) === 'completed')
  const followUp = followUpOutcome(job, followUpIndex)
  return {
    outputReady,
    outputCompletedAt: completedIndex >= 0 ? job.events[completedIndex].time : outputReady ? job.finished_at : null,
    followUp,
    followUpStartedAt: followUpIndex >= 0 ? job.events[followUpIndex].time : null,
    ...presentation(job, outputReady, followUp),
  }
}
