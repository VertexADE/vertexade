import type { Agent, CustomAgentProfile } from '@vertexade/platform-contracts'
import type { AgentRegistry } from './registry.ts'
import type { AgentResourceService } from './resources.ts'
import { customAgentId } from './resources.ts'

export function customAgent(base: Readonly<Agent>, profile: CustomAgentProfile): Agent {
  const preset = { model: profile.model, reasoningEffort: profile.reasoningEffort }
  return {
    ...base,
    id: customAgentId(profile.id),
    name: profile.name,
    preset,
    selectable: !profile.archived,
    parseLaunchOptions: () => preset,
    launch: (options) => base.launch({ ...options, ...preset }),
  }
}

export class CustomAgentSynchronizer {
  readonly #registered = new Set<string>()

  constructor(
    private readonly agents: AgentRegistry,
    private readonly resources: AgentResourceService,
  ) {}

  sync() {
    for (const id of this.#registered) this.agents.unregister(id)
    this.#registered.clear()
    for (const profile of this.resources.profiles()) {
      const base = this.agents.get(profile.agentId)
      const moduleId = this.agents.moduleId(profile.agentId)
      if (!base || !moduleId) continue
      const agent = customAgent(base, profile)
      this.agents.register(moduleId, agent)
      this.#registered.add(agent.id)
    }
  }
}
