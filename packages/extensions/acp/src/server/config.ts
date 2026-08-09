import { normalizeAgentEnvironment, publicAgentEnvironment, updateAgentEnvironment } from '@vertexade/platform-server/agents'

export type AcpPermissionPolicy = 'approve' | 'deny'

export type AcpHarnessConfiguration = {
  id: string
  name: string
  command: string
  args: string[]
  permissionPolicy: AcpPermissionPolicy
  active: boolean
  archived?: boolean
  registryAgentId?: string
  environment: Record<string, string>
}

export type AcpConfiguration = { harnesses: AcpHarnessConfiguration[] }

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function executable(value: unknown) {
  const command = String(value || '').trim()
  if (command.length > 1_000 || /[\0\r\n]/.test(command))
    throw new Error('ACP command must be a single executable name or path under 1,000 characters')
  return command
}

function argumentsList(value: unknown) {
  if (!Array.isArray(value)) throw new Error('ACP arguments must be an array')
  if (value.length > 100) throw new Error('ACP supports at most 100 command arguments')
  return value.map((argument) => {
    if (typeof argument !== 'string' || argument.length > 5_000 || argument.includes('\0'))
      throw new Error('Each ACP argument must be a string under 5,000 characters')
    return argument
  })
}

function identifier(value: unknown) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id))
    throw new Error('ACP harness IDs may use 1-64 lowercase letters, numbers, underscores, or hyphens')
  return id
}

function harnessName(value: unknown) {
  const name = String(value || '').trim()
  if (!name || name.length > 200) throw new Error('ACP harness names must contain 1-200 characters')
  return name
}

function normalizeHarness(value: unknown, fallbackEnvironment: unknown = {}): AcpHarnessConfiguration {
  if (!record(value)) throw new Error('ACP harness configuration must be an object')
  const registryAgentId = executable(value.registryAgentId)
  return {
    id: identifier(value.id),
    name: harnessName(value.name),
    command: executable(value.command),
    args: value.args === undefined ? [] : argumentsList(value.args),
    permissionPolicy: value.permissionPolicy === 'deny' ? 'deny' : 'approve',
    active: value.active !== false,
    ...(value.archived === true ? { archived: true } : {}),
    ...(registryAgentId ? { registryAgentId } : {}),
    environment: normalizeAgentEnvironment(value.environment ?? fallbackEnvironment),
  }
}

function migratedSingleHarness(value: Record<string, unknown>, environment: unknown) {
  return normalizeHarness(
    {
      id: 'default',
      name: 'ACP Agent',
      command: value.command,
      args: value.args,
      permissionPolicy: value.permissionPolicy,
      registryAgentId: value.registryAgentId,
      active: true,
    },
    environment,
  )
}

function defaultAcpConfiguration(): AcpConfiguration {
  return { harnesses: [migratedSingleHarness({}, {})] }
}

export function migrateAcpConfiguration(value: unknown, environment: unknown = {}): AcpConfiguration {
  if (!record(value)) return defaultAcpConfiguration()
  if (Array.isArray(value.harnesses)) return normalizeAcpConfiguration(value)
  const harness = migratedSingleHarness(value, environment)
  return { harnesses: [harness] }
}

export function normalizeAcpConfiguration(value: unknown): AcpConfiguration {
  if (!record(value)) return defaultAcpConfiguration()
  const candidates = Array.isArray(value.harnesses) ? value.harnesses : []
  if (candidates.length > 32) throw new Error('ACP supports at most 32 harnesses')
  const harnesses = candidates.map((candidate) => normalizeHarness(candidate))
  if (!harnesses.length) return defaultAcpConfiguration()
  if (new Set(harnesses.map(({ id }) => id)).size !== harnesses.length) throw new Error('ACP harness IDs must be unique')
  return { harnesses }
}

export function replaceAcpConfiguration(current: unknown, input: unknown): AcpConfiguration {
  if (!record(input) || !Array.isArray(input.harnesses)) throw new Error('ACP harnesses must be an array')
  if (input.harnesses.length > 32) throw new Error('ACP supports at most 32 harnesses')
  const previous = normalizeAcpConfiguration(current)
  const harnesses = input.harnesses.map((candidate) => {
    if (!record(candidate)) throw new Error('ACP harness configuration must be an object')
    const id = identifier(candidate.id)
    const existing = previous.harnesses.find((harness) => harness.id === id)
    const environment = updateAgentEnvironment(existing?.environment || {}, {
      variables: candidate.variables || [],
    })
    return normalizeHarness({
      id,
      name: candidate.name,
      command: candidate.command,
      args: candidate.args || [],
      permissionPolicy: candidate.permission_policy,
      registryAgentId: candidate.registry_agent_id,
      active: candidate.active,
      environment,
    })
  })
  if (new Set(harnesses.map(({ id }) => id)).size !== harnesses.length) throw new Error('ACP harness IDs must be unique')
  return { harnesses }
}

export function acpAgentId(harnessId: string) {
  return harnessId === 'default' ? 'acp' : `acp:${harnessId}`
}

function harnessById(configuration: AcpConfiguration, id: string) {
  const harness = configuration.harnesses.find((candidate) => candidate.id === id)
  if (!harness) throw new Error('ACP harness not found')
  return harness
}

function submitted(input: Record<string, unknown>, name: string, fallback: unknown) {
  return Object.hasOwn(input, name) ? input[name] : fallback
}

function ensureHarnessCapacity(configuration: AcpConfiguration, previous: AcpHarnessConfiguration | undefined) {
  if (!previous && configuration.harnesses.length >= 32) throw new Error('ACP supports at most 32 harnesses')
}

function withUpdatedHarness(
  configuration: AcpConfiguration,
  previous: AcpHarnessConfiguration | undefined,
  harness: AcpHarnessConfiguration,
) {
  if (previous)
    return {
      harnesses: configuration.harnesses.map((candidate) => (candidate.id === harness.id ? harness : candidate)),
    }
  return { harnesses: [...configuration.harnesses, harness] }
}

export function updateAcpHarness(current: unknown, input: unknown, generatedId: string) {
  if (!record(input)) throw new Error('ACP harness settings must be an object')
  const configuration = normalizeAcpConfiguration(current)
  const id = identifier(input.id || generatedId)
  const previous = configuration.harnesses.find((candidate) => candidate.id === id)
  ensureHarnessCapacity(configuration, previous)
  const basis: AcpHarnessConfiguration = previous || {
    id,
    name: '',
    command: '',
    args: [],
    permissionPolicy: 'approve',
    active: true,
    environment: {},
  }
  const harness = normalizeHarness({
    ...basis,
    id,
    name: submitted(input, 'name', basis.name),
    command: submitted(input, 'command', basis.command),
    args: submitted(input, 'args', basis.args),
    permissionPolicy: submitted(input, 'permission_policy', basis.permissionPolicy),
    registryAgentId: submitted(input, 'registry_agent_id', basis.registryAgentId),
    active: submitted(input, 'active', basis.active) !== false,
    archived: false,
    environment: basis.environment,
  })
  if (!harness.command) throw new Error('ACP harness executable is required')
  return withUpdatedHarness(configuration, previous, harness)
}

export function setAcpHarnessActive(current: unknown, id: string, active: boolean) {
  const configuration = normalizeAcpConfiguration(current)
  harnessById(configuration, id)
  return {
    harnesses: configuration.harnesses.map((harness) => (harness.id === id ? { ...harness, active, archived: false } : harness)),
  }
}

export function archiveAcpHarness(current: unknown, id: string) {
  const configuration = normalizeAcpConfiguration(current)
  harnessById(configuration, id)
  return {
    harnesses: configuration.harnesses.map((harness) => (harness.id === id ? { ...harness, active: false, archived: true } : harness)),
  }
}

export function updateAcpHarnessEnvironment(current: unknown, id: string, input: unknown) {
  const configuration = normalizeAcpConfiguration(current)
  harnessById(configuration, id)
  return {
    harnesses: configuration.harnesses.map((harness) =>
      harness.id === id ? { ...harness, environment: updateAgentEnvironment(harness.environment, input) } : harness,
    ),
  }
}

export function publicAcpHarness(harness: AcpHarnessConfiguration) {
  return {
    id: harness.id,
    agent_id: acpAgentId(harness.id),
    name: harness.name,
    command: harness.command,
    args: harness.args,
    permission_policy: harness.permissionPolicy,
    active: harness.active,
    ...(harness.registryAgentId ? { registry_agent_id: harness.registryAgentId } : {}),
    variables: publicAgentEnvironment(harness.environment),
  }
}

export function registryAgentConfiguration(agent: unknown, permissionPolicy: AcpPermissionPolicy, id: string): AcpHarnessConfiguration {
  if (!record(agent)) throw new Error('ACP registry agent is invalid')
  const registryAgentId = executable(agent.id)
  const distribution = record(agent.distribution) ? agent.distribution : {}
  const npx = record(distribution.npx) ? distribution.npx : null
  const uvx = record(distribution.uvx) ? distribution.uvx : null
  const launch = registryLaunch(npx, uvx)
  return normalizeHarness({
    id,
    name: String(agent.name || registryAgentId),
    ...launch,
    permissionPolicy,
    registryAgentId,
    active: true,
    environment: {},
  })
}

function registryLaunch(npx: Record<string, unknown> | null, uvx: Record<string, unknown> | null) {
  if (npx)
    return {
      command: 'npx',
      args: ['--yes', executable(npx.package), ...argumentsList(npx.args || [])],
    }
  if (uvx) return { command: 'uvx', args: [executable(uvx.package), ...argumentsList(uvx.args || [])] }
  throw new Error('This ACP registry agent requires a manual binary installation')
}
