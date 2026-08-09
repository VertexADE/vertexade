import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentGenerationDefaults } from '../platform/management-routes.ts'
import type { AgentRegistry } from './registry.ts'

type Dependencies = {
  agents: AgentRegistry
  dataDirectory: string
  spawnAgentThread(options: Record<string, unknown>, spawnOptions: Record<string, unknown>, runtimeAgent: unknown): any
}

const timeoutMs = 90_000
const maximumEventLineBytes = 1024 * 1024
const maximumErrorBytes = 20_000

export function createReadOnlyContentGenerator(dependencies: Dependencies) {
  return async (prompt: string, defaults: ContentGenerationDefaults) => {
    if (!defaults.agentId) throw new Error('Choose a provider for generated text in Settings')
    const runtimeAgent = dependencies.agents.require(defaults.agentId)
    if (!runtimeAgent.supportsReadOnlyMode) throw new Error(`${runtimeAgent.name} does not support read-only generation`)
    const directory = await mkdtemp(join(dependencies.dataDirectory, 'content-generation-'))
    let threadId = ''
    try {
      const child = dependencies.spawnAgentThread(
        {
          cwd: directory,
          base: directory,
          prompt,
          reviewMode: true,
          permissionMode: defaults.permissionMode,
          model: defaults.model || null,
          reasoningEffort: defaults.reasoningEffort || null,
          serviceTier: defaults.serviceTier || null,
          ephemeral: Boolean(runtimeAgent.supportsEphemeral),
          mcpServers: [],
        },
        { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
        runtimeAgent,
      )
      let stdoutBuffer = ''
      let stderr = ''
      let answer = ''
      let providerError = ''

      const processLine = (line: string) => {
        if (!line.trim()) return
        try {
          const raw = JSON.parse(line) as Record<string, unknown>
          const event = runtimeAgent.normalizeEvent?.(raw) || raw
          if (event.thread_id) threadId = String(event.thread_id)
          if (event.event === 'agent_message' && event.text) answer = String(event.text)
          if (event.event === 'error' && event.message) providerError = String(event.message)
        } catch {}
      }

      child.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString()
        if (Buffer.byteLength(stdoutBuffer) > maximumEventLineBytes) stdoutBuffer = stdoutBuffer.slice(-maximumEventLineBytes)
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() || ''
        for (const line of lines) processLine(line)
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr = `${stderr}${data.toString()}`.slice(-maximumErrorBytes)
      })

      await new Promise<void>((resolveGeneration, rejectGeneration) => {
        let settled = false
        const finish = (callback: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          callback()
        }
        const timeout = setTimeout(() => {
          child.kill('SIGTERM')
          finish(() => rejectGeneration(new Error(`${runtimeAgent.name} title generation timed out`)))
        }, timeoutMs)
        child.once('error', (error: Error) => finish(() => rejectGeneration(error)))
        child.once('close', (code: number | null, signal: string | null) => {
          processLine(stdoutBuffer)
          if (code === 0 && answer.trim()) return finish(resolveGeneration)
          const detail = providerError || stderr.trim() || (signal ? `stopped by ${signal}` : `exited with code ${code ?? 1}`)
          finish(() => rejectGeneration(new Error(`${runtimeAgent.name} could not generate a title: ${detail}`)))
        })
      })
      return answer
    } finally {
      if (threadId) await runtimeAgent.deleteThread?.(threadId).catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  }
}
