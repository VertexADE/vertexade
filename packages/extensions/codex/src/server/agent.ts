import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { glob, open, readFile } from 'node:fs/promises'
import type { Agent, AgentMcpServer } from '@vertexade/platform-contracts'
import { appendAgentThreadArguments } from '@vertexade/platform-server/agents'
import { vertexWorktreeDirectory } from '@vertexade/platform-server/configuration'

type CodexModel = {
  slug: string
  display_name?: string
  description?: string
  visibility?: string
  default_reasoning_level?: string
  supported_reasoning_levels?: Array<{ effort: string; description?: string }>
}

type CodexModelCache = { models?: CodexModel[] }

export function codexConfigDefaults(content: string) {
  const setting = (name: string) => content.match(new RegExp(`^\\s*${name}\\s*=\\s*["']([^"']+)["']`, 'm'))?.[1] || null
  return { model: setting('model'), reasoningEffort: setting('model_reasoning_effort') }
}

export function createCodexAgent({
  run,
  environment = () => ({}),
}: {
  run: (command: string, args: string[]) => Promise<unknown>
  environment?: () => Record<string, string>
}): Agent {
  const launcher = fileURLToPath(new URL('./start-thread.ts', import.meta.url))
  // Child processes run inside target repositories, so a bare `tsx` import
  // would be resolved from that repository instead of this application.
  const tsxLoader = import.meta.resolve('tsx')
  const rolloutPaths = new Map<string, string>()
  return {
    id: 'codex',
    name: 'Codex',
    enabled: true,
    supportsLiveSteering: true,
    supportsReadOnlyMode: true,
    supportsEphemeral: true,
    subagentOrchestration: 'native',
    supportsCustomEnvironment: true,
    environment,
    workspaceRoot: vertexWorktreeDirectory('codex', join(homedir(), '.codex', 'worktrees')),
    bootstrapPrompt: 'hi',
    async prepareWorkspace(worktree) {
      await run('git', ['-C', worktree, 'config', '--worktree', 'codex.localEnvironmentConfigPath', '__none__'])
    },
    normalizeEvent(event) {
      return event
    },
    parseLaunchOptions(headers) {
      let defaults = { model: null as string | null, reasoningEffort: null as string | null }
      try {
        defaults = codexConfigDefaults(readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8'))
      } catch {}
      return {
        model: String(headers['x-agent-model'] || '').trim() || defaults.model,
        reasoningEffort: String(headers['x-agent-reasoning-effort'] || '').trim() || defaults.reasoningEffort,
        serviceTier: String(headers['x-agent-service-tier'] || '').trim() || null,
      }
    },
    async launchOptions() {
      try {
        const cache = JSON.parse(await readFile(join(homedir(), '.codex', 'models_cache.json'), 'utf8')) as CodexModelCache
        return {
          models: (cache.models || [])
            .filter((model: CodexModel) => model.visibility === 'list')
            .map((model: CodexModel) => ({
              id: model.slug,
              name: model.display_name || model.slug,
              description: model.description || '',
              default_reasoning_effort: model.default_reasoning_level || 'medium',
              reasoning_efforts: (model.supported_reasoning_levels || []).map(
                (level: NonNullable<CodexModel['supported_reasoning_levels']>[number]) => ({
                  id: level.effort,
                  description: level.description || '',
                }),
              ),
            })),
        }
      } catch {
        return { models: [] }
      }
    },
    threadUrl(threadId) {
      return `codex://threads/${threadId}`
    },
    async completedThreadSnapshot(threadId) {
      let path = rolloutPaths.get(threadId)
      if (!path) {
        for await (const candidate of glob(join(homedir(), '.codex', 'sessions', '**', `*-${threadId}.jsonl`))) {
          path = candidate
          rolloutPaths.set(threadId, candidate)
          break
        }
      }
      if (!path) return null
      const file = await open(path, 'r')
      try {
        const info = await file.stat()
        const length = Math.min(info.size, 1_048_576)
        const buffer = Buffer.alloc(length)
        await file.read(buffer, 0, length, info.size - length)
        const lines = buffer.toString('utf8').split(/\r?\n/)
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          try {
            const event = JSON.parse(lines[index])
            if (event.type === 'event_msg' && event.payload?.type === 'task_complete') {
              const eventTime = Date.parse(String(event.timestamp || ''))
              return {
                message: event.payload.last_agent_message || '',
                completedAt: event.payload.completed_at || (Number.isNaN(eventTime) ? null : eventTime / 1_000),
              }
            }
          } catch {}
        }
        return null
      } finally {
        await file.close()
      }
    },
    async resumableThreadExists(threadId) {
      if (rolloutPaths.has(threadId)) return true
      for await (const candidate of glob(join(homedir(), '.codex', 'sessions', '**', `*-${threadId}.jsonl`))) {
        rolloutPaths.set(threadId, candidate)
        return true
      }
      return false
    },
    launch({
      cwd,
      base,
      prompt,
      resume,
      fork,
      reviewMode = false,
      model,
      reasoningEffort,
      serviceTier,
      permissionMode,
      ephemeral = false,
      allowSubagents = false,
      writableRoots,
      mcpServers = [],
    }) {
      const args = appendAgentThreadArguments([launcher, '--cwd', String(cwd), '--base', String(base)], {
        prompt,
        resume,
        fork,
        model,
        reasoningEffort,
        serviceTier,
        ephemeral,
        allowSubagents,
      })
      if (Array.isArray(writableRoots)) for (const root of writableRoots) args.push('--writable-root', String(root))
      if (reviewMode) args.push('--review-mode')
      if (permissionMode === 'full') args.push('--full-access')
      if (permissionMode === 'read-only') args.push('--read-only')
      const servers = mcpServers as AgentMcpServer[]
      return {
        command: process.execPath,
        args: ['--import', tsxLoader, ...args],
        env: { VERTEXADE_MCP_SERVERS: JSON.stringify(servers) },
      }
    },
    async deleteThread(threadId) {
      const socketPath = join(homedir(), '.codex', 'app-server-control', 'app-server-control.sock')
      await run('codex', ['delete', '--remote', `unix://${socketPath}`, '--force', threadId])
    },
  }
}
