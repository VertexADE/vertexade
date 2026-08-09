export type AgentThreadContext = {
  model: string | null
  reasoningEffort: string | null
}

type StoredThreadContext = { agent_model?: string | null; agent_reasoning_effort?: string | null }

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function agentThreadContext(event: Record<string, unknown>): AgentThreadContext | null {
  const model = text(event.model)
  const reasoningEffort = text(event.reasoning_effort) || text(event.reasoningEffort) || text(event.effort)
  return model || reasoningEffort ? { model, reasoningEffort } : null
}

function first(values: Array<string | null | undefined>) {
  return values.find(Boolean) as string | undefined
}

export function mergeAgentThreadContext(current: StoredThreadContext, detected: AgentThreadContext): AgentThreadContext {
  return {
    model: first([detected.model, current.agent_model]) || null,
    reasoningEffort: first([detected.reasoningEffort, current.agent_reasoning_effort]) || null,
  }
}
