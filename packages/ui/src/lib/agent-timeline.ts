import { dateValue } from './dashboard-api'
import type { LogEvent } from './dashboard-types'
import { agentIsWorking, type AgentThreadState } from './agent-thread-state'

export type TimelineEvent = LogEvent & {
  key: string
  completed_at?: string | null
  duration_ms?: number
}

function elapsed(startValue: string | null, endValue: string | null) {
  const start = dateValue(startValue)
  const end = dateValue(endValue)
  return start && end ? Math.max(0, end.getTime() - start.getTime()) : undefined
}

function mergeAction(start: TimelineEvent, finish: LogEvent): TimelineEvent {
  return {
    ...start,
    text: finish.text || start.text,
    status: finish.status || start.status,
    completed_at: finish.time,
    duration_ms: elapsed(start.time, finish.time),
    data: start.data && finish.data ? { started: start.data, completed: finish.data } : finish.data || start.data,
  }
}

function streamingMessage(previous: TimelineEvent | undefined, current: LogEvent) {
  return (
    current.data?.streaming === true &&
    previous?.data?.streaming === true &&
    previous.kind === 'message' &&
    previous.title === current.title &&
    Boolean(previous.text) &&
    current.text.startsWith(previous.text)
  )
}

type TimelineState = { timeline: TimelineEvent[]; actions: Map<string, number> }

function replaceLatest(state: TimelineState, event: LogEvent, previous: TimelineEvent) {
  state.timeline[state.timeline.length - 1] = { ...previous, ...event, key: previous.key }
}

const previousEventHandlers: Record<string, (state: TimelineState, event: LogEvent, previous: TimelineEvent) => boolean> = {
  message(state, event, previous) {
    if (!streamingMessage(previous, event)) return false
    replaceLatest(state, event, previous)
    return true
  },
  plan(state, event, previous) {
    if (previous.kind !== 'plan' || previous.status !== 'running') return false
    replaceLatest(state, event, previous)
    return true
  },
}

function mergePreviousEvent(state: TimelineState, event: LogEvent, previous?: TimelineEvent) {
  if (!previous) return false
  return previousEventHandlers[event.kind]?.(state, event, previous) || false
}

function mergeKnownAction(state: TimelineState, event: LogEvent) {
  if (event.kind !== 'action' || !event.action_id) return false
  const actionIndex = state.actions.get(event.action_id)
  if (actionIndex === undefined) {
    state.actions.set(event.action_id, state.timeline.length)
    return false
  }
  state.timeline[actionIndex] = mergeAction(state.timeline[actionIndex]!, event)
  return true
}

function appendEvent(state: TimelineState, event: LogEvent, index: number) {
  const previous = state.timeline.at(-1)
  if (mergePreviousEvent(state, event, previous)) return
  if (mergeKnownAction(state, event)) return
  state.timeline.push({
    ...event,
    key: `${event.action_id || event.kind}-${event.time || index}-${index}`,
  })
}

function settledStatus(state: AgentThreadState) {
  const statuses: Partial<Record<AgentThreadState, string>> = {
    waiting: 'waiting',
    completed: 'completed',
    failed: 'interrupted',
    resumable: 'paused',
    interrupted: 'interrupted',
    cancelled: 'interrupted',
  }
  return statuses[state]
}

function reconcileEvent(event: TimelineEvent, state: AgentThreadState) {
  if (!['running', 'pending'].includes(event.status || '')) return event
  const status = settledStatus(state)
  return status ? { ...event, status } : event
}

export function buildAgentTimeline(events: LogEvent[], state: AgentThreadState = 'running') {
  const timelineState: TimelineState = { timeline: [], actions: new Map() }
  events
    .filter((event) => event.kind !== 'message' || event.text.trim())
    .forEach((event, index) => appendEvent(timelineState, event, index))
  const timeline = timelineState.timeline.map((event) => reconcileEvent(event, state))
  if (state !== 'completed') return timeline
  const finalCompletion = timeline.findLastIndex((event) => event.kind === 'completed')
  return timeline.filter((event, index) => event.kind !== 'completed' || index === finalCompletion)
}

export function timelineSummary(events: TimelineEvent[], state: AgentThreadState = 'running') {
  const visible = events.filter((event) => event.kind !== 'technical')
  const actions = visible.filter((event) => event.kind === 'action')
  const active = agentIsWorking(state)
    ? [...visible].reverse().find((event) => event.status === 'running' || event.status === 'pending')
    : undefined
  return { actions: actions.length, visible: visible.length, active }
}
