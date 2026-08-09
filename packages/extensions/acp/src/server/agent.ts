import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent, AgentMcpServer } from '@vertexade/platform-contracts'
import { vertexWorktreeDirectory } from '@vertexade/platform-server/configuration'
import { acpAgentId, type AcpHarnessConfiguration } from './config.ts'

export function createAcpAgent({ harnessId, configuration }: { harnessId: string; configuration: () => AcpHarnessConfiguration }): Agent {
  const bridge = fileURLToPath(new URL('./bridge.ts', import.meta.url))
  const scriptArguments = () => (process.env.VERTEXADE_BUNDLED_RUNTIME === '1' ? [] : ['--import', import.meta.resolve('tsx')])
  const initial = configuration()
  return {
    id: acpAgentId(harnessId),
    name: initial.name,
    enabled: true,
    selectable: initial.active && !initial.archived && Boolean(initial.command),
    supportsCustomEnvironment: true,
    subagentOrchestration: 'harness',
    environment: () => configuration().environment,
    workspaceRoot: vertexWorktreeDirectory(join('acp', harnessId), join(homedir(), '.acp', 'worktrees', harnessId)),
    bootstrapPrompt: 'hi',
    closeStdinAfterLaunch: true,
    launch({ cwd, prompt, resume, fork, reviewMode = false, allowSubagents = false, mcpServers = [] }) {
      const config = configuration()
      if (!config.command) throw new Error(`Configure the ${config.name} harness in Settings before launching it`)
      const args = [
        ...scriptArguments(),
        bridge,
        '--command',
        config.command,
        '--cwd',
        String(cwd),
        '--permission-policy',
        config.permissionPolicy,
      ]
      for (const argument of config.args) args.push('--agent-arg', argument)
      if (prompt) args.push('--prompt', String(prompt))
      if (resume) args.push('--resume', String(resume))
      if (fork) args.push('--fork', String(fork))
      if (reviewMode) args.push('--review-mode')
      if (allowSubagents) args.push('--allow-subagents')
      const servers = mcpServers as AgentMcpServer[]
      return {
        command: process.execPath,
        args,
        env: { VERTEXADE_MCP_SERVERS: JSON.stringify(servers) },
      }
    },
  }
}
