import type { Agent } from '@vertexade/platform-contracts'

export function resolveSubagentLaunch(agent: Pick<Agent, 'name' | 'subagentOrchestration'>, requested: unknown) {
  if (requested !== undefined && requested !== null && typeof requested !== 'boolean') {
    throw new Error('allowSubagents must be a boolean')
  }
  if (requested === true && !agent.subagentOrchestration) {
    throw new Error(`${agent.name} does not support sub-agent orchestration`)
  }
  return requested === true
}
