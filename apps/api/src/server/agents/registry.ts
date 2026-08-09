import type { Agent, ScopedAgentRegistry } from '@vertexade/platform-contracts'

type InstalledAgent = { agent: Readonly<Agent>; moduleId: string }

export class AgentRegistry {
  #agents = new Map<string, InstalledAgent>()
  readonly #isModuleEnabled: (moduleId: string) => boolean

  constructor(isModuleEnabled: (moduleId: string) => boolean = () => true) {
    this.#isModuleEnabled = isModuleEnabled
  }

  register(moduleId: string, agent: Agent) {
    if (!agent?.id || !agent?.name || !agent.workspaceRoot || typeof agent.launch !== 'function')
      throw new Error('Agents require an id, name, workspace root, and launch method')
    if (this.#agents.has(agent.id)) throw new Error(`Agent already registered: ${agent.id}`)
    this.#agents.set(agent.id, { agent: Object.freeze({ ...agent }), moduleId })
    return this
  }

  forModule(moduleId: string): ScopedAgentRegistry {
    return {
      register: (agent) => {
        this.register(moduleId, agent)
      },
      unregister: (id) => {
        if (this.#agents.get(id)?.moduleId === moduleId) this.#agents.delete(id)
      },
    }
  }

  get(id: string) {
    return this.#agents.get(id)?.agent || null
  }

  moduleId(id: string) {
    return this.#agents.get(id)?.moduleId || null
  }

  require(id: string) {
    const installed = this.#agents.get(id)
    if (!installed) throw new Error(`Unknown agent: ${id}`)
    if (!installed.agent.enabled || !this.#isModuleEnabled(installed.moduleId)) throw new Error(`${installed.agent.name} agent is disabled`)
    return installed.agent
  }

  declarations(moduleId: string) {
    return [...this.#agents.values()]
      .filter((installed) => installed.moduleId === moduleId)
      .map(({ agent }) => agent.id)
      .sort()
  }

  removeModule(moduleId: string) {
    for (const [id, installed] of this.#agents) if (installed.moduleId === moduleId) this.#agents.delete(id)
  }

  unregister(id: string) {
    this.#agents.delete(id)
  }

  capabilities() {
    return [...this.#agents.values()].map(({ agent, moduleId }) => ({
      id: agent.id,
      name: agent.name,
      enabled: agent.enabled && this.#isModuleEnabled(moduleId),
      supportsLiveSteering: agent.supportsLiveSteering || false,
      supportsCustomEnvironment: agent.supportsCustomEnvironment || false,
      supportsReadOnlyMode: agent.supportsReadOnlyMode || false,
      supportsEphemeral: agent.supportsEphemeral || false,
      supportsSubagents: Boolean(agent.subagentOrchestration),
      subagentOrchestration: agent.subagentOrchestration || 'none',
      supportsPlatformSubagents: Boolean(agent.subagentOrchestration),
      platformSubagentOrchestration: agent.subagentOrchestration ? 'vertexade-hybrid' : 'none',
      ...(agent.preset ? { preset: agent.preset } : {}),
      selectable: agent.selectable !== false,
      moduleId,
    }))
  }
}
