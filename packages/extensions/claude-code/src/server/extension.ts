import { PLATFORM_API_VERSION, type DashboardExtension, type ExtensionHostServices } from '@vertexade/platform-contracts'
import { agentEnvironment, registerAgentEnvironmentSettings, type AgentEnvironment } from '@vertexade/platform-server/agents'
import { createClaudeCodeAgent } from './agent.ts'
import { claudeCodeSettings } from '../shared/settings.ts'

type ClaudeCodeContext = {
  run: (command: string, args: string[], options?: { env?: AgentEnvironment }) => Promise<unknown>
  host: ExtensionHostServices
}

export function createExtension({ run, host }: ClaudeCodeContext): DashboardExtension {
  const agent = createClaudeCodeAgent({ run, environment: () => agentEnvironment(host) })
  return {
    manifest: {
      id: 'claude-code',
      name: 'Claude Code',
      version: '0.0.1',
      platformApi: PLATFORM_API_VERSION,
      kind: 'ai',
      description: 'Run Claude Code sessions with model discovery and bundled Fallow tooling.',
      catalog: {
        tagline: 'Claude-powered coding sessions with custom model endpoints',
        category: 'automation',
        publisher: { name: 'Anthropic', url: 'https://www.anthropic.com/claude-code' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'orange',
        tags: ['Agent', 'Coding', 'Models'],
        highlights: [
          'Resumable and forkable sessions',
          'Custom Anthropic-compatible model discovery',
          'Automatic Fallow skill installation',
        ],
        links: { homepage: 'https://www.anthropic.com/claude-code' },
      },
      portable: { surfaces: [], settings: claudeCodeSettings },
      permissions: ['settings.read', 'settings.write', 'events.emit', 'process.execute'],
      setupChecks: [
        {
          id: 'claude-code',
          name: 'Claude Code',
          command: 'claude',
          args: ['--version'],
          install: 'Run mise use -g claude-code, then claude auth login',
        },
      ],
      agents: [{ id: agent.id, name: agent.name, accent: 'orange' }],
    },
    register(registration) {
      registration.agents.register(agent)
      registerAgentEnvironmentSettings(registration, host, agent)
    },
  }
}
