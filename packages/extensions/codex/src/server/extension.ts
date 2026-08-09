import { PLATFORM_API_VERSION, type DashboardExtension, type ExtensionHostServices } from '@vertexade/platform-contracts'
import { agentEnvironment, registerAgentEnvironmentSettings } from '@vertexade/platform-server/agents'
import { createCodexAgent } from './agent.ts'
import { codexSettings } from '../shared/settings.ts'

type CodexContext = {
  run: (command: string, args: string[]) => Promise<unknown>
  host: ExtensionHostServices
}

export function createExtension({ run, host }: CodexContext): DashboardExtension {
  const agent = createCodexAgent({ run, environment: () => agentEnvironment(host) })
  return {
    manifest: {
      id: 'codex',
      name: 'Codex',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'ai',
      description: 'Run durable Codex threads in isolated Git worktrees.',
      catalog: {
        tagline: 'Durable coding threads with isolated worktree execution',
        category: 'automation',
        publisher: { name: 'OpenAI', url: 'https://openai.com/codex' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'emerald',
        tags: ['Agent', 'Coding', 'Worktrees'],
        featured: true,
        highlights: ['Persistent resumable threads', 'Multimodal prompt support', 'Encrypted extension-owned environment'],
        links: { homepage: 'https://openai.com/codex' },
      },
      portable: { surfaces: [], settings: codexSettings },
      permissions: ['settings.read', 'settings.write', 'events.emit', 'process.execute'],
      setupChecks: [
        {
          id: 'codex',
          name: 'Codex',
          command: 'codex',
          args: ['--version'],
          install: 'Install and authenticate Codex',
        },
      ],
      agents: [{ id: agent.id, name: agent.name, accent: 'emerald' }],
    },
    register(registration) {
      registration.agents.register(agent)
      registerAgentEnvironmentSettings(registration, host, agent)
    },
  }
}
