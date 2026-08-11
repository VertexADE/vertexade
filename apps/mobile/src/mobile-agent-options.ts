export type MobileAgentOptions = {
  agentId: string
  model: string
  reasoningEffort: string
  serviceTier?: string
  allowSubagents?: boolean
}

export function defaultMobileAgentOptions(agentId = ''): MobileAgentOptions {
  return {
    agentId,
    model: '',
    reasoningEffort: '',
    serviceTier: '',
    allowSubagents: false,
  }
}

export function mobileAgentHeaders(options: MobileAgentOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'x-agent-subagents': String(Boolean(options.allowSubagents)),
  }
  if (options.agentId) headers['x-agent-provider'] = options.agentId
  if (options.model) headers['x-agent-model'] = options.model
  if (options.reasoningEffort) headers['x-agent-reasoning-effort'] = options.reasoningEffort
  if (options.serviceTier) headers['x-agent-service-tier'] = options.serviceTier
  return headers
}
