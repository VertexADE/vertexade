import { constants } from 'node:fs'
import { access, cp, glob, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { vertexWorktreeDirectory } from '@vertexade/platform-server/configuration'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent, AgentLaunchOptionsContext, AgentMcpServer } from '@vertexade/platform-contracts'
import {
  agentProcessEnvironment,
  appendAgentThreadArguments,
  parseAgentLaunchOptions,
  trustWorkspaceMiseConfigs,
  type AgentEnvironment,
  type AgentRunner,
} from '@vertexade/platform-server/agents'
import { resilientFetch } from '@vertexade/platform-server/effect'

const reasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({
  id,
  description: `Claude Code ${id} effort`,
}))

function messageText(message: unknown) {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: string; text: string } =>
      Boolean(block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'),
    )
    .map((block) => String(block.text || ''))
    .filter(Boolean)
    .join('\n')
}

function messageBlock(message: unknown, type: string) {
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  return (
    (content.find((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === type) as
      | Record<string, unknown>
      | undefined) || null
  )
}

const toolBlock = (message: unknown) => messageBlock(message, 'tool_use')
const toolResultBlock = (message: unknown) => messageBlock(message, 'tool_result')

function firstValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function optionalField(name: string, value: unknown) {
  return value === undefined ? {} : { [name]: value }
}

function claudeActionStatus(tool: Record<string, unknown>, completed: boolean) {
  if (tool.is_error === true) return 'failed'
  return completed ? 'completed' : 'running'
}

function claudeToolAction(tool: Record<string, unknown>, completed: boolean) {
  const input = tool.input && typeof tool.input === 'object' ? (tool.input as Record<string, unknown>) : {}
  const name = String(tool.name || 'Tool action')
  const action: Record<string, unknown> = {
    id: String(firstValue(tool.id, tool.tool_use_id, `${name}-${JSON.stringify(input)}`)),
    title: String(firstValue(input.command, input.path, name)),
    kind: name,
    status: claudeActionStatus(tool, completed),
    ...optionalField('input', Object.keys(input).length ? input : undefined),
    ...optionalField('output', tool.content),
  }
  return {
    event: completed ? 'action_completed' : 'action_started',
    action,
  }
}

function normalizeAssistantEvent(event: Record<string, unknown>, threadId: string) {
  const text = messageText(event.message)
  if (text) return { event: 'agent_message', thread_id: threadId, text, time: event.time || null }
  const tool = toolBlock(event.message)
  return tool ? { ...claudeToolAction(tool, false), thread_id: threadId, time: event.time || null } : event
}

function normalizeUserEvent(event: Record<string, unknown>, threadId: string) {
  const tool = toolResultBlock(event.message)
  return tool ? { ...claudeToolAction(tool, true), thread_id: threadId, time: event.time || null } : event
}

function normalizeResultEvent(event: Record<string, unknown>, threadId: string) {
  if (event.is_error || event.subtype !== 'success') {
    return {
      event: 'error',
      thread_id: threadId,
      message: String(event.result || event.subtype || 'Claude Code failed'),
      retryable: null,
      statusCode: null,
      time: event.time || null,
    }
  }
  return {
    event: 'agent_message',
    thread_id: threadId,
    text: String(event.result || ''),
    time: event.time || null,
  }
}

function normalizeClaudeEvent(event: Record<string, unknown>) {
  const threadId = String(event.session_id || '')
  if (event.type === 'system' && event.subtype === 'init')
    return {
      event: 'thread_started',
      thread_id: threadId,
      model: event.model || null,
      reasoning_effort: firstValue(event.reasoning_effort, event.reasoningEffort, event.effort),
      time: event.time || null,
    }
  if (event.type === 'assistant') return normalizeAssistantEvent(event, threadId)
  if (event.type === 'user') return normalizeUserEvent(event, threadId)
  if (event.type === 'result') return normalizeResultEvent(event, threadId)
  return event
}

function claudeLaunchOptions() {
  return {
    models: ['sonnet', 'opus', 'fable'].map((id) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      description: `Claude Code ${id} model alias`,
      default_reasoning_effort: 'medium',
      reasoning_efforts: reasoningEfforts,
    })),
  }
}

function validatedThreadId(threadId: string) {
  const value = String(threadId || '').trim()
  if (!/^[a-z0-9_-]{1,200}$/i.test(value)) throw new Error('Claude Code thread ID is invalid')
  return value
}

function modelsEndpoints(baseUrl: string) {
  let endpoint: URL
  try {
    endpoint = new URL(baseUrl || 'https://api.anthropic.com')
  } catch {
    throw new Error('Claude Code model discovery requires ANTHROPIC_BASE_URL to be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error('Claude Code model discovery requires a valid HTTP(S) ANTHROPIC_BASE_URL')
  const basePath = endpoint.pathname.replace(/\/+$/, '')
  endpoint.search = ''
  endpoint.hash = ''
  const modelsPath = basePath.endsWith('/v1/models/info')
    ? basePath.slice(0, -5)
    : basePath.endsWith('/v1/models')
      ? basePath
      : basePath.endsWith('/v1')
        ? `${basePath}/models`
        : `${basePath}/v1/models`
  const at = (pathname: string) => {
    const url = new URL(endpoint)
    url.pathname = pathname
    return url
  }
  return [
    { url: at(`${modelsPath}/info`), detailed: true },
    { url: at(modelsPath), detailed: false },
  ]
}

function modelHeaders(environment: Record<string, string>) {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (environment.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${environment.ANTHROPIC_AUTH_TOKEN}`
  if (environment.ANTHROPIC_API_KEY) headers['x-api-key'] = environment.ANTHROPIC_API_KEY
  return headers
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function modelCandidates(payload: unknown, detailed: boolean) {
  if (!record(payload)) return []
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.models)) return payload.models
  return detailed
    ? Object.entries(payload)
        .map(([id, value]) => (record(value) ? { ...value, id } : null))
        .filter(Boolean)
    : []
}

function reasoningMetadata(model: Record<string, unknown>, detailed: boolean) {
  if (!detailed) return { default_reasoning_effort: 'medium', reasoning_efforts: reasoningEfforts }
  const capabilities = record(model.capabilities) ? model.capabilities : {}
  const reasoning = record(capabilities.reasoning) ? capabilities.reasoning : {}
  const levels = Array.isArray(reasoning.levels)
    ? reasoning.levels.flatMap((level) => {
        if (typeof level === 'string' && level.trim()) return [{ id: level.trim(), description: '' }]
        if (!record(level)) return []
        const id = String(level.id || level.effort || level.value || '').trim()
        return id ? [{ id, description: String(level.description || '') }] : []
      })
    : []
  const defaultEffort = String(reasoning.default_level || reasoning.default_effort || '').trim()
  return { default_reasoning_effort: defaultEffort, reasoning_efforts: levels }
}

function discoveredModels(payload: unknown, detailed: boolean) {
  const models = modelCandidates(payload, detailed).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const model = candidate as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (!id || id.length > 200) return []
    const name =
      (typeof model.display_name === 'string' && model.display_name.trim()) || (typeof model.name === 'string' && model.name.trim()) || id
    return [
      {
        id,
        name,
        description: typeof model.description === 'string' ? model.description : '',
        ...reasoningMetadata(model, detailed),
      },
    ]
  })
  return [...new Map(models.map((model) => [model.id, model])).values()]
}

async function customClaudeLaunchOptions(environment: Record<string, string>) {
  let failure = 'returned no models'
  for (const endpoint of modelsEndpoints(environment.ANTHROPIC_BASE_URL)) {
    try {
      const response = await resilientFetch({
        service: 'Claude Code model discovery',
        fetch: globalThis.fetch,
        url: endpoint.url,
        init: { headers: modelHeaders(environment) },
        timeoutMs: 10_000,
      })
      if (!response.ok) {
        failure = `failed with HTTP ${response.status}`
        continue
      }
      const text = await response.text()
      if (text.length > 1_000_000) {
        failure = 'returned too much data'
        continue
      }
      const models = discoveredModels(JSON.parse(text), endpoint.detailed)
      if (models.length) return { models }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Claude Code model discovery ${failure}`)
}

async function verifyClaudeAccess(run: AgentRunner, environment: AgentEnvironment) {
  try {
    await run('claude', ['--version'], { env: environment })
  } catch {
    throw new Error('Claude Code requires the `claude` CLI on PATH; install it with `mise use -g claude-code`')
  }
}

async function verifyGitHubAccess(run: AgentRunner, environment: AgentEnvironment) {
  try {
    await run('gh', ['--version'], { env: environment })
  } catch {
    throw new Error('Claude Code requires the GitHub CLI (`gh`) on PATH')
  }
}

async function executablePath(name: string, environment: AgentEnvironment) {
  const path = environment.PATH || process.env.PATH || ''
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error
    }
  }
  throw new Error(`Could not locate ${name} on PATH`)
}

async function fallowSkillDirectory(fallowExecutable: string) {
  const executableDirectory = dirname(fallowExecutable)
  const candidates = [
    // npm, pnpm, and mise place executable shims in node_modules/.bin.
    join(executableDirectory, '..', 'fallow', 'skills', 'fallow'),
    // A direct global package executable lives in fallow/bin.
    join(dirname(executableDirectory), 'skills', 'fallow'),
  ]

  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'SKILL.md'))
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('Fallow is installed, but its bundled skill could not be found')
}

async function installFallowSkill(configDirectory: string, environment: AgentEnvironment) {
  const fallowExecutable = await executablePath('fallow', environment)
  const source = await fallowSkillDirectory(fallowExecutable)
  const sourceManifest = join(source, 'SKILL.md')
  const destination = join(configDirectory, 'skills', 'fallow')
  const destinationManifest = join(destination, 'SKILL.md')

  const [sourceContents, destinationContents] = await Promise.all([
    readFile(sourceManifest),
    readFile(destinationManifest).catch(() => null),
  ])
  if (destinationContents?.equals(sourceContents)) return

  await mkdir(join(configDirectory, 'skills'), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true })
}

export function createClaudeCodeAgent({
  run,
  env = process.env,
  environment = () => ({}),
}: {
  run: AgentRunner
  env?: AgentEnvironment
  environment?: () => Record<string, string>
}): Agent {
  const home = env.HOME || homedir()
  const configDirectory = join(home, '.claude')
  const bridge = fileURLToPath(new URL('./bridge.ts', import.meta.url))
  const tsxLoader = import.meta.resolve('tsx')

  async function ensureToolingAccess() {
    const toolingEnvironment = agentProcessEnvironment(env)
    await verifyClaudeAccess(run, toolingEnvironment)
    await verifyGitHubAccess(run, toolingEnvironment)
    try {
      await run('fallow', ['--version'], { env: toolingEnvironment })
    } catch {
      throw new Error('Claude Code requires the Fallow CLI on PATH')
    }
  }

  return {
    id: 'claude-code',
    name: 'Claude Code',
    enabled: true,
    supportsCustomEnvironment: true,
    environment,
    workspaceRoot: vertexWorktreeDirectory('claude-code', join(configDirectory, 'worktrees')),
    bootstrapPrompt: 'hi',
    supportsLiveSteering: true,
    supportsReadOnlyMode: true,
    supportsEphemeral: true,
    subagentOrchestration: 'native',
    async prepareWorkspace(worktree) {
      await ensureToolingAccess()
      await installFallowSkill(configDirectory, agentProcessEnvironment(env))
      await trustWorkspaceMiseConfigs(run, worktree)
    },
    parseLaunchOptions: parseAgentLaunchOptions,
    launchOptions: async (context?: AgentLaunchOptionsContext) => {
      const environment = context?.environment || {}
      return Object.keys(environment).length ? customClaudeLaunchOptions(environment) : claudeLaunchOptions()
    },
    normalizeEvent: normalizeClaudeEvent,
    launch({ prompt, resume, fork, model, reasoningEffort, permissionMode, ephemeral = false, allowSubagents = false, mcpServers = [] }) {
      const args = appendAgentThreadArguments(['--import', tsxLoader, bridge], {
        prompt,
        resume,
        fork,
        model,
        reasoningEffort,
        permissionMode,
        ephemeral,
        allowSubagents,
      })
      const servers = mcpServers as AgentMcpServer[]
      return {
        command: process.execPath,
        args,
        env: { VERTEXADE_MCP_SERVERS: JSON.stringify(servers) },
      }
    },
    async resumableThreadExists(threadId) {
      const name = `${validatedThreadId(threadId)}.jsonl`
      for await (const _candidate of glob(join(configDirectory, 'projects', '**', name))) return true
      return false
    },
    async deleteThread(threadId) {
      const name = `${validatedThreadId(threadId)}.jsonl`
      for await (const candidate of glob(join(configDirectory, 'projects', '**', name))) await rm(candidate, { force: true })
    },
  }
}
