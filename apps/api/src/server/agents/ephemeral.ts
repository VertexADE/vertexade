import type { Agent } from '@vertexade/platform-contracts'

export function resolveEphemeralLaunch(agent: Pick<Agent, 'name' | 'supportsEphemeral'>, requested: unknown, defaultEnabled = false) {
  if (requested !== undefined && requested !== null && typeof requested !== 'boolean') {
    throw new Error('ephemeral must be a boolean')
  }
  if (requested === true && !agent.supportsEphemeral) {
    throw new Error(`${agent.name} does not support ephemeral runs`)
  }
  return Boolean(agent.supportsEphemeral && (requested ?? defaultEnabled))
}
