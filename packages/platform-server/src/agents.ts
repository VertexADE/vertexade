import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, ExtensionHostServices, ExtensionRegistrationContext } from '@vertexade/platform-contracts'
import { readJsonObject } from './http.ts'

export type AgentEnvironment = Record<string, string | undefined>
export type AgentRunner = (command: string, args: string[], options?: { env?: AgentEnvironment }) => Promise<unknown>
export type AgentEnvironmentMap = Record<string, Record<string, string>>
export type AgentThreadOptions = {
  cwd?: string
  prompt: string
  resume: string
  fork: string
  model: string
  reasoningEffort: string
  serviceTier: string
  permissionMode: string
  ephemeral: boolean
  allowSubagents: boolean
}

const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/
const reservedNames = new Set(['NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'])

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function agentProcessEnvironment(parent: AgentEnvironment, ...overrides: AgentEnvironment[]) {
  const environment = Object.assign({}, parent, ...overrides)
  delete environment.NODE_CHANNEL_FD
  delete environment.NODE_CHANNEL_SERIALIZATION_MODE
  return environment
}

export function parseAgentLaunchOptions(headers: Record<string, string>) {
  return {
    model: String(headers['x-agent-model'] || '').trim() || null,
    reasoningEffort: String(headers['x-agent-reasoning-effort'] || '').trim() || null,
    serviceTier: String(headers['x-agent-service-tier'] || '').trim() || null,
  }
}

export function appendAgentThreadArguments(
  args: string[],
  options: {
    prompt?: unknown
    resume?: unknown
    fork?: unknown
    model?: unknown
    reasoningEffort?: unknown
    serviceTier?: unknown
    permissionMode?: unknown
    ephemeral?: unknown
    allowSubagents?: unknown
  },
) {
  const values = [
    ['prompt', options.prompt],
    ['resume', options.resume],
    ['fork', options.fork],
    ['model', options.model],
    ['reasoning-effort', options.reasoningEffort],
    ['service-tier', options.serviceTier],
    ['permission-mode', options.permissionMode],
  ] as const
  for (const [name, value] of values) if (value) args.push(`--${name}`, String(value))
  if (options.ephemeral === true) args.push('--ephemeral')
  if (options.allowSubagents === true) args.push('--allow-subagents')
  return args
}

export function parseAgentThreadArguments({ cwd = false }: { cwd?: boolean } = {}): AgentThreadOptions {
  const option = (name: string) => {
    const index = process.argv.indexOf(`--${name}`)
    return index === -1 ? '' : String(process.argv[index + 1] || '')
  }
  return {
    ...(cwd ? { cwd: option('cwd') } : {}),
    prompt: option('prompt'),
    resume: option('resume'),
    fork: option('fork'),
    model: option('model'),
    reasoningEffort: option('reasoning-effort'),
    serviceTier: option('service-tier'),
    permissionMode: option('permission-mode'),
    ephemeral: process.argv.includes('--ephemeral'),
    allowSubagents: process.argv.includes('--allow-subagents'),
  }
}

export function applySubagentInstructions(prompt: string, allowSubagents: unknown) {
  if (allowSubagents !== true) return prompt
  return `${prompt.trim()}

<subagent_orchestration>
Sub-agent delegation is enabled for this run. VertexADE provides a sub-agent MCP tool that can launch bounded child runs using any enabled agent and model; use its list tool before selecting a different runtime. Native provider sub-agents may also be available. VertexADE children work in isolated writable worktrees: wait for their result, validate it, then explicitly integrate useful changes with the integration tool. Delegate only concrete, independent work when it materially improves speed or quality. Keep ownership of the overall result, give every child a narrow task and expected output, and do not delegate unresolved user decisions. VertexADE child runs cannot recursively delegate.
</subagent_orchestration>`
}

export async function trustWorkspaceMiseConfigs(run: AgentRunner, worktree: string) {
  for (const name of ['mise.toml', '.mise.toml']) {
    const config = join(worktree, name)
    try {
      await access(config)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await run('mise', ['trust', '--yes', config])
  }
}

export function normalizeAgentEnvironment(value: unknown): Record<string, string> {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, variable]) =>
      environmentName.test(name) && !reservedNames.has(name) && typeof variable === 'string' ? [[name, variable]] : [],
    ),
  )
}

export function normalizeAgentEnvironments(value: unknown): AgentEnvironmentMap {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([agentId, environment]) =>
      record(environment) ? [[agentId, normalizeAgentEnvironment(environment)]] : [],
    ),
  )
}

export function migrateAgentEnvironmentsV1(
  settings: { has(name: string): boolean; write(name: string, value: unknown): void },
  value: unknown,
) {
  const migrated: string[] = []
  for (const [agentId, environment] of Object.entries(normalizeAgentEnvironments(value))) {
    const setting = `extension:${agentId}:environment`
    if (!Object.keys(environment).length || settings.has(setting)) continue
    settings.write(setting, environment)
    migrated.push(agentId)
  }
  return migrated
}

export function publicAgentEnvironment(value: unknown) {
  return Object.keys(normalizeAgentEnvironment(value))
    .sort()
    .map((name) => ({ name, has_value: true }))
}

function inputVariables(input: unknown) {
  if (!record(input) || !Array.isArray(input.variables)) throw new Error('Environment variables must be an array')
  if (input.variables.length > 100) throw new Error('At most 100 environment variables can be configured per agent')
  return input.variables
}

function checkedName(raw: Record<string, unknown>, next: Record<string, string>) {
  const name = String(raw.name || '').trim()
  if (!environmentName.test(name) || name.length > 128) throw new Error(`Invalid environment variable name: ${name || '(empty)'}`)
  if (reservedNames.has(name)) throw new Error(`${name} is reserved by the process runtime`)
  if (Object.hasOwn(next, name)) throw new Error(`Duplicate environment variable: ${name}`)
  return name
}

function resolvedValue(raw: Record<string, unknown>, previous: Record<string, string>, name: string) {
  const previousName = String(raw.previous_name || '').trim()
  const replacement = typeof raw.value === 'string' && raw.value.length > 0 ? raw.value : null
  const previousValue = previousName && Object.hasOwn(previous, previousName) ? previous[previousName] : null
  const value = replacement ?? previousValue
  if (typeof value !== 'string') throw new Error(`${name} requires a value`)
  if (value.length > 20_000) throw new Error(`${name} exceeds the 20,000 character limit`)
  return value
}

export function updateAgentEnvironment(value: unknown, input: unknown) {
  const previous = normalizeAgentEnvironment(value)
  const next: Record<string, string> = Object.create(null)
  let totalSize = 0
  for (const raw of inputVariables(input)) {
    if (!record(raw)) throw new Error('Each environment variable must be an object')
    const name = checkedName(raw, next)
    const variable = resolvedValue(raw, previous, name)
    totalSize += name.length + variable.length
    if (totalSize > 100_000) throw new Error('Agent environment exceeds the 100,000 character limit')
    next[name] = variable
  }
  return next
}

export function agentEnvironment(host: ExtensionHostServices) {
  return normalizeAgentEnvironment(host.settings.read('environment', {}))
}

export function registerAgentEnvironmentSettings(
  registration: ExtensionRegistrationContext,
  host: ExtensionHostServices,
  agent: Pick<Agent, 'id' | 'name'>,
) {
  registration.routes.register({
    method: 'GET',
    path: '/settings',
    availability: 'installed',
    handler: () =>
      Response.json({
        agent: {
          id: agent.id,
          name: agent.name,
          variables: publicAgentEnvironment(host.settings.read('environment', {})),
        },
      }),
  })
  registration.routes.register({
    method: 'POST',
    path: '/settings',
    availability: 'installed',
    handler: async (request) => {
      try {
        const environment = updateAgentEnvironment(host.settings.read('environment', {}), await readJsonObject(request))
        host.settings.write('environment', environment)
        host.events.emit('agent_environment_updated')
        return Response.json({
          agent: { id: agent.id, name: agent.name, variables: publicAgentEnvironment(environment) },
        })
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid agent environment settings' }, { status: 400 })
      }
    },
  })
}
