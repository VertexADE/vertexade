import { homedir } from 'node:os'
import { vertexWorktreeDirectory } from '@vertexade/platform-server/configuration'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type { Agent, AgentMcpServer } from '@vertexade/platform-contracts'
import {
  agentProcessEnvironment,
  appendAgentThreadArguments,
  parseAgentLaunchOptions,
  trustWorkspaceMiseConfigs,
} from '@vertexade/platform-server/agents'

type Runner = (command: string, args: string[], options?: { env?: Environment }) => Promise<unknown>
type Environment = Record<string, string | undefined>

function errorDetails(error: unknown) {
  if (typeof error === 'string') return { message: error, retryable: null, statusCode: null }
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const data = value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : {}
  const reference = data.ref ? ` (${String(data.ref)})` : ''
  return {
    message: `${String(data.message || value.message || value.name || 'OpenCode failed')}${reference}`,
    retryable: typeof data.isRetryable === 'boolean' ? data.isRetryable : null,
    statusCode: typeof data.statusCode === 'number' ? data.statusCode : null,
  }
}

function openCodeDatabasePath(env: Environment) {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'opencode.db')
}

function forwardedCliEnvironment(env: Environment) {
  const names = ['PATH', 'HOME', 'XDG_CONFIG_HOME', 'GH_CONFIG_DIR', 'GH_HOST', 'GH_TOKEN']
  return Object.fromEntries(names.flatMap((name) => (env[name] ? [[name, env[name] as string]] : [])))
}

export function openCodeMcpServers(values: AgentMcpServer[]) {
  return Object.fromEntries(
    values.map((server) => [
      server.name,
      server.transport === 'sse'
        ? { type: 'remote', url: server.url, enabled: true, headers: server.headers || {} }
        : {
            type: 'local',
            command: [server.command, ...(server.args || [])],
            enabled: true,
            environment: server.env || {},
          },
    ]),
  )
}

function normalizeTimestamp(value: unknown): string | null {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null
  const date = numeric === null ? new Date(String(value || '')) : new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function valueRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function openCodeStatus(status: string) {
  if (['error', 'failed'].includes(status)) return 'failed'
  if (status === 'completed') return 'completed'
  return 'running'
}

function openCodeActionTitle(input: Record<string, unknown>, kind: string) {
  return String([input.command, input.path, input.query, kind].find(Boolean))
}

function optionalActionField(name: string, value: unknown) {
  return value === undefined ? {} : { [name]: value }
}

function openCodeActionId(part: Record<string, unknown>, kind: string, input: Record<string, unknown>) {
  return String([part.callID, part.id, `${kind}-${JSON.stringify(input)}`].find(Boolean))
}

function openCodeAction(part: Record<string, unknown>) {
  const state = valueRecord(part.state)
  const input = valueRecord(state.input)
  const status = String(state.status || part.status || '')
  const completed = ['completed', 'error', 'failed'].includes(status)
  const kind = String(part.tool || part.type || 'tool')
  return {
    event: completed ? 'action_completed' : 'action_started',
    action: {
      id: openCodeActionId(part, kind, input),
      title: openCodeActionTitle(input, kind),
      kind,
      status: openCodeStatus(status),
      ...optionalActionField('input', Object.keys(input).length ? input : undefined),
      ...optionalActionField('output', state.output),
    },
  }
}

export function createOpenCodeAgent({
  run,
  env = process.env,
  environment = () => ({}),
}: {
  run: Runner
  env?: Environment
  environment?: () => Record<string, string>
}): Agent {
  const databasePath = openCodeDatabasePath(env)
  const skillPath = fileURLToPath(new URL('./skills', import.meta.url))
  const bridge = fileURLToPath(new URL('./bridge.ts', import.meta.url))
  const scriptArguments = () => (process.env.VERTEXADE_BUNDLED_RUNTIME === '1' ? [] : ['--import', import.meta.resolve('tsx')])
  let modelCache: { expiresAt: number; models: Record<string, unknown>[] } | null = null
  let toolingCheck: Promise<void> | null = null

  function ensureToolingAccess() {
    if (toolingCheck === null) {
      toolingCheck = (async () => {
        const toolingEnvironment = agentProcessEnvironment(env)
        try {
          await run('gh', ['--version'], { env: toolingEnvironment })
        } catch {
          throw new Error('OpenCode requires the GitHub CLI (`gh`) on PATH')
        }
        if (!env.GH_TOKEN) {
          try {
            await run('gh', ['auth', 'status', '--active'], { env: toolingEnvironment })
          } catch {
            throw new Error('OpenCode requires an authenticated GitHub CLI or GH_TOKEN')
          }
        }
        try {
          await run('fallow', ['--version'], { env: toolingEnvironment })
        } catch {
          throw new Error('OpenCode requires the Fallow CLI on PATH')
        }
      })().catch((error) => {
        toolingCheck = null
        throw error
      })
    }
    return toolingCheck
  }

  function withDatabase<T>(callback: (database: DatabaseSync) => T): T | null {
    let database: DatabaseSync | null = null
    try {
      database = new DatabaseSync(databasePath, { readOnly: true })
      return callback(database)
    } catch {
      return null
    } finally {
      database?.close()
    }
  }

  return {
    id: 'opencode',
    name: 'OpenCode',
    enabled: true,
    supportsCustomEnvironment: true,
    environment,
    workspaceRoot: vertexWorktreeDirectory('opencode', join(homedir(), '.local', 'share', 'opencode', 'worktrees')),
    bootstrapPrompt: 'hi',
    supportsLiveSteering: true,
    supportsReadOnlyMode: true,
    subagentOrchestration: 'native',
    async prepareWorkspace(worktree) {
      await ensureToolingAccess()
      await trustWorkspaceMiseConfigs(run, worktree)
    },
    parseLaunchOptions: parseAgentLaunchOptions,
    async launchOptions() {
      if (modelCache && modelCache.expiresAt > Date.now()) return { models: modelCache.models }
      try {
        const output = String(await run('opencode', ['models']))
        const variants = ['minimal', 'low', 'medium', 'high', 'max'].map((id) => ({
          id,
          description: `OpenCode ${id} model variant`,
        }))
        const models = [
          ...new Set(
            output
              .split(/\r?\n/)
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ].map((id) => ({
          id,
          name: id,
          description: '',
          default_reasoning_effort: '',
          reasoning_efforts: variants,
        }))
        modelCache = { expiresAt: Date.now() + 5 * 60_000, models }
        return { models }
      } catch {
        return { models: modelCache?.models || [] }
      }
    },
    normalizeEvent(event) {
      const sessionID = String(event.sessionID || '')
      const part = event.part && typeof event.part === 'object' ? (event.part as Record<string, unknown>) : {}
      const time = normalizeTimestamp(event.timestamp)
      if (event.type === 'step_start') return { event: 'turn_started', thread_id: sessionID, title: 'OpenCode is working', time }
      if (event.type === 'text') return { event: 'agent_message', thread_id: sessionID, text: String(part.text || ''), time }
      if (event.type === 'tool_use') return { ...openCodeAction(part), thread_id: sessionID, time }
      if (event.type === 'step_finish') {
        const reason = String(part.reason || '')
        return reason === 'tool-calls'
          ? { event: 'step_completed', thread_id: sessionID, status: 'continuing', reason, time }
          : { event: 'turn_completed', thread_id: sessionID, status: 'completed', reason, time }
      }
      if (event.type === 'error') return { event: 'error', thread_id: sessionID, ...errorDetails(event.error), time }
      return { ...event, timestamp: time }
    },
    launch({ cwd, prompt, resume, fork, model, reasoningEffort, permissionMode, allowSubagents = false, mcpServers = [] }) {
      const readOnly = permissionMode === 'read-only'
      const permission = {
        '*': readOnly ? 'deny' : 'allow',
        task: readOnly || !allowSubagents ? 'deny' : 'allow',
      }
      const args = appendAgentThreadArguments([...scriptArguments(), bridge, '--cwd', String(cwd)], {
        prompt,
        resume,
        fork,
        model,
        reasoningEffort,
        permissionMode,
        allowSubagents,
      })
      return {
        command: process.execPath,
        args,
        env: {
          ...forwardedCliEnvironment(env),
          OPENCODE_PERMISSION: JSON.stringify(permission),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            permission,
            lsp: true,
            skills: { paths: [skillPath] },
            mcp: openCodeMcpServers(mcpServers as AgentMcpServer[]),
          }),
        },
      }
    },
    async completedThreadSnapshot(threadId) {
      return withDatabase((database) => {
        const session = database.prepare('SELECT id FROM session WHERE id=?').get(threadId)
        if (!session) return null
        const row = database
          .prepare('SELECT id, time_updated, data FROM message WHERE session_id=? ORDER BY time_created DESC, id DESC LIMIT 1')
          .get(threadId) as { id: string; time_updated: number; data: string } | undefined
        if (!row) return null
        const message = JSON.parse(row.data) as {
          role?: string
          finish?: string
          error?: unknown
          time?: { completed?: number }
        }
        if (message.role !== 'assistant' || message.error || !message.finish || message.finish === 'tool-calls') return null
        const text = database
          .prepare('SELECT data FROM part WHERE message_id=? ORDER BY time_created, id')
          .all(row.id)
          .map(
            (part) =>
              JSON.parse(String((part as { data: string }).data)) as {
                type?: string
                text?: string
              },
          )
          .filter((part) => part.type === 'text')
          .map((part) => String(part.text || ''))
          .join('\n')
          .trim()
        const completedAtMs = message.time?.completed || row.time_updated
        return {
          message: text,
          completedAt: completedAtMs ? Math.floor(completedAtMs / 1000) : null,
        }
      })
    },
    async resumableThreadExists(threadId) {
      const exists = withDatabase((database) => Boolean(database.prepare('SELECT 1 FROM session WHERE id=?').get(threadId)))
      if (exists !== null) return exists
      try {
        await run('opencode', ['export', threadId, '--sanitize'])
        return true
      } catch {
        return false
      }
    },
    async deleteThread(threadId) {
      await run('opencode', ['session', 'delete', threadId])
    },
  }
}
