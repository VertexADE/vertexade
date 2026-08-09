import type { AgentAction, AgentTimelineEvent } from '@vertexade/platform-contracts'

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

const actionTitles: Record<string, (item: JsonRecord) => string> = {
  commandExecution: (item) => text(item.command) || 'Run command',
  mcpToolCall: (item) => [text(item.server), text(item.tool)].filter(Boolean).join(' · ') || 'Use MCP tool',
  fileChange: () => 'Update files',
  webSearch: (item) => (text(item.query) ? `Search: ${text(item.query)}` : 'Search the web'),
  imageView: () => 'Inspect image',
  collabAgentToolCall: (item) => text(item.tool) || 'Coordinate agent',
}

function actionTitle(item: JsonRecord) {
  const kind = text(item.type)
  return actionTitles[kind]?.(item) || kind || 'Agent action'
}

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function actionStatus(item: JsonRecord, phase: 'started' | 'completed') {
  if (['failed', 'declined', 'cancelled'].includes(text(item.status))) return 'failed'
  return phase === 'completed' ? 'completed' : 'running'
}

function addActionDetails(action: AgentAction, item: JsonRecord) {
  const detail = actionDetail(item)
  const input = firstValue(item.command, item.arguments, item.query)
  const output = firstValue(item.aggregatedOutput, item.output, item.result)
  if (detail) action.detail = detail
  if (input !== undefined) action.input = input
  if (output !== undefined) action.output = output
}

function actionDetail(item: JsonRecord) {
  const changes = Array.isArray(item.changes) ? item.changes.length : 0
  if (changes) return `${changes} file ${changes === 1 ? 'change' : 'changes'}`
  return text(item.cwd) || text(item.path) || text(item.query) || text(item.status)
}

export function codexActionEvent(itemValue: unknown, phase: 'started' | 'completed', threadId?: string | null): AgentTimelineEvent | null {
  const item = record(itemValue)
  const kind = text(item.type)
  if (!kind || ['agentMessage', 'reasoning', 'plan'].includes(kind)) return null
  const action: AgentAction = {
    id: text(item.id) || `${kind}-${text(item.command) || text(item.query) || 'action'}`,
    title: actionTitle(item),
    kind,
    status: actionStatus(item, phase),
  }
  addActionDetails(action, item)
  return {
    event: phase === 'completed' ? 'action_completed' : 'action_started',
    ...(threadId ? { thread_id: threadId } : {}),
    action,
  }
}
