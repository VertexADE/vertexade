type ThreadContext = { model: string | null; reasoning_effort: string | null }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function messageContext(value: unknown): ThreadContext {
  const message = record(value)
  const selectedModel = record(message.model)
  const provider = text(message.providerID) || text(selectedModel.providerID)
  const modelId = text(message.modelID) || text(selectedModel.modelID)
  const model = modelId && (modelId.includes('/') || !provider) ? modelId : provider && modelId ? `${provider}/${modelId}` : null
  return {
    model,
    reasoning_effort: text(message.variant) || text(selectedModel.variant),
  }
}

export function openCodeThreadContext(messages: unknown[], fallback: Partial<ThreadContext> = {}): ThreadContext {
  let model: string | null = null
  let reasoningEffort: string | null = null
  for (const message of messages) {
    const context = messageContext(message)
    model ||= context.model
    reasoningEffort ||= context.reasoning_effort
    if (model && reasoningEffort) break
  }
  return {
    model: model || text(fallback.model),
    reasoning_effort: reasoningEffort || text(fallback.reasoning_effort),
  }
}
