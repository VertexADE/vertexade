import type { MobileThreadDetails } from './mobile-detail-service'

export type MobileThreadTab = 'activity' | 'summary' | 'findings' | 'suggestions' | 'changes' | 'context'
export type MobileThreadOutcome = {
  headline: string
  description: string
  tone: 'active' | 'success' | 'warning' | 'danger' | 'neutral'
  outputReady: boolean
}

const kindNames: Record<string, string> = {
  task: 'Task',
  review: 'Code review',
  review_handoff: 'Review follow-up',
  pre_pr: 'Implementation',
  work_review: 'Worktree review',
  stack_analysis: 'Stack analysis',
  planning: 'Planning',
  subagent: 'Child agent',
}

export function mobileThreadTabs(detail: MobileThreadDetails): Array<{ id: MobileThreadTab; label: string }> {
  const tabs: Array<{ id: MobileThreadTab; label: string }> = []
  if (detail.reviewSummary || (detail.resultText && !showsFindings(detail)))
    tabs.push({ id: 'summary', label: detail.reviewSummary ? 'Summary' : 'Result' })
  if (showsFindings(detail)) tabs.push({ id: 'findings', label: detail.kind === 'stack_analysis' ? 'Stack report' : 'Full review' })
  if (detail.kind === 'review') tabs.push({ id: 'suggestions', label: suggestionLabel(detail.suggestions.length) })
  tabs.push({ id: 'activity', label: 'Activity' })
  tabs.push({ id: 'changes', label: detail.files.length ? `Changes (${detail.files.length})` : 'Changes' })
  tabs.push({ id: 'context', label: 'Context' })
  return tabs
}

export function initialMobileThreadTab(detail: MobileThreadDetails): MobileThreadTab {
  if (detail.reviewSummary || (detail.resultText && !showsFindings(detail))) return 'summary'
  if (showsFindings(detail)) return 'findings'
  return 'activity'
}

export function mobileThreadKind(detail: MobileThreadDetails): string {
  return detail.kindLabel || kindNames[detail.kind] || detail.kind.replaceAll('_', ' ')
}

export function mobileThreadOutcome(detail: MobileThreadDetails): MobileThreadOutcome {
  const outputReady = Boolean(detail.resultText || detail.reviewDetails || detail.reviewSummary)
  const followUpStarted = lastEventIndex(detail, 'follow_up_started')
  const completion = lastEventIndex(detail, 'turn_completed')
  if (outputReady && followUpStarted > completion)
    return outcomeForActiveFollowUp(detail.status, outputReady)
  if (outputReady)
    return {
      outputReady,
      headline: followUpStarted >= 0 ? 'Updated output ready' : 'Output ready',
      description: 'The completed result is preserved and ready to review.',
      tone: 'success',
    }
  if (detail.inputQuestions.length)
    return {
      outputReady,
      headline: 'Input required',
      description: 'Answer the agent’s question so it can continue this task.',
      tone: 'warning',
    }
  return statusOutcome(detail.status, outputReady)
}

export function canComposeThreadMessage(detail: MobileThreadDetails): boolean {
  return Boolean(detail.threadId && !detail.inputQuestions.length && !['review', 'work_review'].includes(detail.kind))
}

export function canForkMobileThread(detail: MobileThreadDetails): boolean {
  return Boolean(detail.threadId && !detail.ephemeral && !isActive(detail.status))
}

export function canTransferMobileThread(detail: MobileThreadDetails): boolean {
  return Boolean(detail.workItemId && !isActive(detail.status) && (detail.resultText || detail.reviewDetails || detail.reviewSummary))
}

export function canSaveMobileThreadTasks(detail: MobileThreadDetails): boolean {
  return detail.kind === 'stack_analysis' && detail.status === 'completed' && Boolean(detail.resultText)
}

export function isActive(status: string): boolean {
  return ['starting', 'running'].includes(status)
}

export function isRetryable(status: string): boolean {
  return ['failed', 'resumable', 'cancelled'].includes(status)
}

function showsFindings(detail: MobileThreadDetails): boolean {
  return ['review', 'work_review', 'stack_analysis'].includes(detail.kind)
}

function suggestionLabel(count: number): string {
  return count ? `Suggestions (${count})` : 'Suggestions'
}

function lastEventIndex(detail: MobileThreadDetails, eventName: string): number {
  for (let index = detail.events.length - 1; index >= 0; index -= 1)
    if (detail.events[index]?.event === eventName) return index
  return -1
}

function outcomeForActiveFollowUp(status: string, outputReady: boolean): MobileThreadOutcome {
  if (isActive(status))
    return {
      outputReady,
      headline: 'Updating completed output',
      description: 'The previous result remains available while the agent handles your follow-up.',
      tone: 'active',
    }
  if (status === 'failed')
    return {
      outputReady,
      headline: 'Output ready · follow-up failed',
      description: 'The completed result is preserved. Only the latest follow-up needs attention.',
      tone: 'warning',
    }
  return {
    outputReady,
    headline: 'Output ready · follow-up paused',
    description: 'The previous result remains available. Resume the thread to continue.',
    tone: 'warning',
  }
}

function statusOutcome(status: string, outputReady: boolean): MobileThreadOutcome {
  if (isActive(status))
    return {
      outputReady,
      headline: status === 'starting' ? 'Agent is starting' : 'Agent is running',
      description: 'Live activity and changes will appear as the task progresses.',
      tone: 'active',
    }
  if (status === 'failed')
    return {
      outputReady,
      headline: 'Run failed',
      description: 'Review the latest activity and retry the task when ready.',
      tone: 'danger',
    }
  if (['cancelled', 'resumable', 'interrupted'].includes(status))
    return {
      outputReady,
      headline: status === 'resumable' ? 'Ready to resume' : 'Run stopped',
      description: 'The thread and its existing workspace remain available.',
      tone: 'warning',
    }
  return {
    outputReady,
    headline: 'Run status available',
    description: 'Review the activity timeline for the latest task state.',
    tone: 'neutral',
  }
}
