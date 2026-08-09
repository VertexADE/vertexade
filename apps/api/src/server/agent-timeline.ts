import type { Agent } from '@vertexade/platform-contracts'
import { summarizeDiff } from './diff-preview.ts'

type JsonRecord = Record<string, any>

type AgentLogEvent = {
  kind: string
  title: string
  text: string
  time: string | null
  status?: string
  action_id?: string
  action_kind?: string
  data?: JsonRecord
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function display(value: unknown) {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function firstText(...values: unknown[]) {
  return values.map(display).find(Boolean) || ''
}

function actionDetails(action: JsonRecord) {
  const input = record(action.input)
  return firstText(action.detail, action.command, input.command, input.path, input.query, action.output, action.input)
}

function actionStatus(action: JsonRecord, lifecycle: string) {
  if (['failed', 'error'].includes(String(action.status))) return 'failed'
  if (['action_completed', 'tool_finished'].includes(lifecycle)) return 'completed'
  return String(action.status || 'running')
}

function actionKind(action: JsonRecord) {
  return firstText(action.kind, action.name, action.type, 'tool')
}

function actionId(action: JsonRecord, lifecycle: string, index: number) {
  return firstText(action.id, action.callID, action.toolCallId, `${lifecycle}-${index}`)
}

function actionEvent(entry: JsonRecord, index: number): AgentLogEvent {
  const action = { ...record(entry.tool), ...record(entry.action) }
  const lifecycle = String(entry.event || '')
  const kind = actionKind(action)
  const title = firstText(action.title, action.name, kind === 'tool' ? 'Agent action' : kind)
  return {
    kind: 'action',
    title,
    text: actionDetails(action),
    time: entry.time || entry.timestamp || null,
    status: actionStatus(action, lifecycle),
    action_id: actionId(action, lifecycle, index),
    action_kind: kind,
    data: entry,
  }
}

function planText(entry: JsonRecord) {
  const plan = record(entry.plan)
  const entries = Array.isArray(plan.entries) ? plan.entries : Array.isArray(plan.steps) ? plan.steps : []
  return (
    entries
      .map((value) => {
        const step = record(value)
        const label = firstText(step.content, step.title, step.description)
        return label ? `${step.status ? `[${step.status}] ` : ''}${label}` : ''
      })
      .filter(Boolean)
      .join('\n') || firstText(plan.description, entry.detail)
  )
}

function formatDiffSummary(diff: unknown) {
  const summary = summarizeDiff(String(diff || ''))
  if (!summary.files.length) return 'No file changes recorded'
  return `${summary.files.length} file${summary.files.length === 1 ? '' : 's'} · +${summary.additions} −${summary.deletions}`
}

function threadContextText(entry: JsonRecord) {
  const model = firstText(entry.model, 'Provider default')
  const reasoningEffort = firstText(entry.reasoning_effort, entry.reasoningEffort, entry.effort)
  return reasoningEffort ? `${model} · ${reasoningEffort} reasoning` : model
}

type EventContext = {
  entry: JsonRecord
  runtimeAgent: Agent
  index: number
  followUpActive: boolean
}
type NormalizedEvent = { event: AgentLogEvent; followUpActive: boolean }
type EventHandler = (context: EventContext) => NormalizedEvent

function logEvent(entry: JsonRecord, kind: string, title: string, text = '', status?: string): AgentLogEvent {
  return {
    kind,
    title,
    text,
    time: entry.time || entry.timestamp || null,
    ...(status ? { status } : {}),
    data: entry,
  }
}

function unchanged(context: EventContext, event: AgentLogEvent): NormalizedEvent {
  return { event, followUpActive: context.followUpActive }
}

const actionHandler: EventHandler = (context) => unchanged(context, actionEvent(context.entry, context.index))

function completedTurn(context: EventContext): NormalizedEvent {
  const { entry, followUpActive } = context
  const succeeded = ['completed', 'details_completed'].includes(String(entry.status))
  const title = followUpActive ? (succeeded ? 'Follow-up completed' : 'Follow-up failed') : succeeded ? 'Output ready' : 'Run failed'
  const text = followUpActive
    ? succeeded
      ? 'The requested update was completed.'
      : 'The completed output is preserved; this follow-up needs attention.'
    : `Turn status: ${entry.status || 'unknown'}`
  return {
    event: logEvent(entry, succeeded ? 'completed' : 'error', title, text, succeeded ? 'completed' : 'failed'),
    followUpActive: false,
  }
}

function userMessage(context: EventContext, title: string, text = context.entry.text) {
  return unchanged(context, logEvent(context.entry, 'user_message', title, firstText(text), 'completed'))
}

const eventHandlers: Record<string, EventHandler> = {
  action_started: actionHandler,
  action_updated: actionHandler,
  action_completed: actionHandler,
  tool_started: actionHandler,
  tool_finished: actionHandler,
  thread_started: (context) =>
    unchanged(context, logEvent(context.entry, 'started', `${context.runtimeAgent.name} thread started`, context.entry.cwd || '')),
  thread_forked: (context) =>
    unchanged(
      context,
      logEvent(
        context.entry,
        'started',
        `${context.runtimeAgent.name} thread forked`,
        `Inherited context from ${context.entry.source_thread_id}`,
      ),
    ),
  thread_roots_updated: (context) => unchanged(context, logEvent(context.entry, 'started', 'Workspace linked', context.entry.cwd || '')),
  thread_context_updated: (context) =>
    unchanged(context, logEvent(context.entry, 'progress', 'Thread settings detected', threadContextText(context.entry), 'completed')),
  turn_started: (context) =>
    unchanged(
      context,
      logEvent(
        context.entry,
        'progress',
        context.entry.title || 'Agent is working',
        firstText(context.entry.detail, context.entry.reason),
        'running',
      ),
    ),
  step_started: (context) =>
    unchanged(
      context,
      logEvent(
        context.entry,
        'progress',
        context.entry.title || 'Agent is working',
        firstText(context.entry.detail, context.entry.reason),
        'running',
      ),
    ),
  step_completed: (context) =>
    unchanged(
      context,
      logEvent(
        context.entry,
        'progress',
        context.entry.title || 'Step completed',
        firstText(context.entry.detail, context.entry.reason),
        context.entry.status || 'completed',
      ),
    ),
  plan_updated: (context) => unchanged(context, logEvent(context.entry, 'plan', 'Plan updated', planText(context.entry), 'running')),
  plan: (context) => unchanged(context, logEvent(context.entry, 'plan', 'Plan updated', planText(context.entry), 'running')),
  user_message: (context) => userMessage(context, context.entry.source === 'steer' ? 'You steered the thread' : 'Your request'),
  follow_up_started: (context) => ({
    event: logEvent(
      context.entry,
      'user_message',
      'You continued the thread',
      firstText(context.entry.display_prompt, 'Earlier follow-up message'),
      'completed',
    ),
    followUpActive: true,
  }),
  input_required: (context) =>
    unchanged(
      context,
      logEvent(
        context.entry,
        'input',
        'Your input is required',
        (context.entry.questions || []).map((question: JsonRecord) => question.question).join('\n'),
        'waiting',
      ),
    ),
  input_answered: (context) =>
    unchanged(
      context,
      logEvent(context.entry, 'input', 'Answer sent', `Your response was submitted to ${context.runtimeAgent.name}.`, 'completed'),
    ),
  agent_message: (context) => unchanged(context, logEvent(context.entry, 'message', context.runtimeAgent.name, context.entry.text || '')),
  error: (context) =>
    unchanged(
      context,
      logEvent(context.entry, 'error', `${context.runtimeAgent.name} error`, context.entry.message || 'The agent process failed', 'failed'),
    ),
  diff_updated: (context) =>
    unchanged(context, {
      ...logEvent(context.entry, 'changes', 'Files changed', formatDiffSummary(context.entry.diff), 'completed'),
      data: { ...context.entry, diff_summary: summarizeDiff(String(context.entry.diff || '')) },
    }),
  turn_completed: completedTurn,
}

function normalizedEvent(context: EventContext): NormalizedEvent {
  const handler = eventHandlers[String(context.entry.event)]
  return handler
    ? handler(context)
    : unchanged(context, logEvent(context.entry, 'technical', context.entry.event || 'Event', display(context.entry)))
}

export function parseAgentLogEvents(content: unknown, runtimeAgent: Agent) {
  let followUpActive = false
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const rawEntry = JSON.parse(line) as JsonRecord
        const entry = runtimeAgent.normalizeEvent?.(rawEntry) || rawEntry
        const normalized = normalizedEvent({ entry, runtimeAgent, index, followUpActive })
        followUpActive = normalized.followUpActive
        return normalized.event
      } catch {
        const match = line.match(/^(\d{4}-\d\d-\d\dT\S+)\s+(ERROR|WARN)\s+[^:]+:\s*(.*)$/)
        if (match)
          return {
            kind: match[2] === 'ERROR' ? 'error' : 'warning',
            title: match[2] === 'ERROR' ? 'Error' : 'Warning',
            text: match[3] || '',
            time: match[1] || null,
          }
        return { kind: 'technical', title: 'Process output', text: line, time: null }
      }
    })
}
