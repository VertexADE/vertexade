import { spawn, type SpawnOptions } from 'node:child_process'
import type { AsyncLocalStorage } from 'node:async_hooks'
import type { Agent } from '@vertexade/platform-contracts'
import type { AgentRegistry } from './registry.ts'
import { agentProcessEnvironment } from '@vertexade/platform-server/agents'

type LaunchContext = Record<string, unknown> & { agentId?: string | null }
type SpawnedAgentThread = ReturnType<typeof spawn> & { runtimeAgent?: Agent }

export function createAgentThreadSpawner(input: {
  agents: AgentRegistry
  defaultAgentId: string
  launchContext: AsyncLocalStorage<LaunchContext>
  localize(options: Record<string, unknown>): Record<string, unknown>
  decorate(jobId: number, options: Record<string, unknown>): Record<string, unknown>
  resolveCommand(command: string): string
  tools(): Record<string, string>
  environment?(cwd: string, jobId?: number): Record<string, string>
}) {
  return (options: Record<string, unknown>, spawnOptions: SpawnOptions, explicitAgent?: Agent): SpawnedAgentThread => {
    const context = input.launchContext.getStore() || {}
    const runtimeAgent = explicitAgent || input.agents.require(context.agentId || input.defaultAgentId)
    const localized = input.localize({ ...context, ...options })
    const decorated = localized.jobId ? input.decorate(Number(localized.jobId), localized) : localized
    const { jobId: _jobId, ...agentOptions } = decorated
    const launch = runtimeAgent.launch(agentOptions)
    const cwd = String(spawnOptions.cwd || '')
    const child = spawn(input.resolveCommand(launch.command), launch.args, {
      ...spawnOptions,
      env: agentProcessEnvironment(process.env, runtimeAgent.environment?.() || {}, launch.env, {
        VERTEXADE_TOOL_PATHS: JSON.stringify(input.tools()),
        ...input.environment?.(cwd, localized.jobId ? Number(localized.jobId) : undefined),
      }),
    }) as SpawnedAgentThread
    child.runtimeAgent = runtimeAgent
    if (runtimeAgent.closeStdinAfterLaunch) child.stdin?.end()
    return child
  }
}
