import { PLATFORM_API_VERSION, type DashboardExtension, type ExtensionHostServices } from '@vertexade/platform-contracts'
import { agentEnvironment, registerAgentEnvironmentSettings, type AgentEnvironment } from '@vertexade/platform-server/agents'
import { createOpenCodeAgent } from './agent.ts'
import { openCodeSettings } from '../shared/settings.ts'

type OpenCodeContext = {
  run: (command: string, args: string[], options?: { env?: AgentEnvironment }) => Promise<unknown>
  host: ExtensionHostServices
}

export function createExtension({ run, host }: OpenCodeContext): DashboardExtension {
  const agent = createOpenCodeAgent({ run, environment: () => agentEnvironment(host) })
  return {
    manifest: {
      id: 'opencode',
      name: 'OpenCode',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'ai',
      description: 'Run OpenCode sessions with full tooling, LSP, and bundled skills.',
      catalog: {
        tagline: 'Open coding-agent sessions with full repository tooling',
        category: 'automation',
        publisher: { name: 'OpenCode', url: 'https://opencode.ai' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'cyan',
        tags: ['Agent', 'Coding', 'LSP'],
        highlights: ['Resumable OpenCode sessions', 'Full LSP support', 'Bundled Fallow quality skill'],
        links: { homepage: 'https://opencode.ai' },
      },
      portable: { surfaces: [], settings: openCodeSettings },
      permissions: ['settings.read', 'settings.write', 'events.emit', 'process.execute'],
      setupChecks: [
        {
          id: 'opencode',
          name: 'OpenCode',
          command: 'opencode',
          args: ['--version'],
          install: 'Install OpenCode and make it available on PATH',
        },
      ],
      agents: [{ id: agent.id, name: agent.name, accent: 'cyan' }],
    },
    register(registration) {
      registration.agents.register(agent)
      registerAgentEnvironmentSettings(registration, host, agent)
    },
  }
}
