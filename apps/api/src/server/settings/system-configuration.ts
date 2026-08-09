import type { JsonSettingsStore } from './settings-store.ts'

const promptPolicyKinds = ['work', 'review', 'planning', 'followUp', 'scheduled'] as const
export type PromptPolicyKind = (typeof promptPolicyKinds)[number]
export const toolNames = ['git', 'gh', 'codex', 'claude', 'opencode', 'pnpm', 'pm2', 'docker', 'fallow'] as const
export type ToolName = (typeof toolNames)[number]

export type SystemConfigurationValue = {
  prompts: Record<PromptPolicyKind, string>
  tools: Record<ToolName, string>
  runtime: {
    capabilityTimeoutMs: number
    retryAttempts: number
    retryDelayMs: number
    automationMaxSteps: number
    automationMaxConcurrentRuns: number
  }
}

export const defaultSystemConfiguration: SystemConfigurationValue = {
  prompts: { work: '', review: '', planning: '', followUp: '', scheduled: '' },
  tools: { git: '', gh: '', codex: '', claude: '', opencode: '', pnpm: '', pm2: '', docker: '', fallow: '' },
  runtime: {
    capabilityTimeoutMs: 30_000,
    retryAttempts: 1,
    retryDelayMs: 250,
    automationMaxSteps: 20,
    automationMaxConcurrentRuns: 4,
  },
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function checkedUpdate(input: unknown, current: SystemConfigurationValue): SystemConfigurationValue {
  if (!record(input)) throw new Error('System configuration must be an object')
  for (const key of Object.keys(input))
    if (!['prompts', 'tools', 'runtime'].includes(key)) throw new Error(`Unknown system configuration section: ${key}`)
  const prompts = { ...current.prompts }
  if (input.prompts !== undefined) {
    if (!record(input.prompts)) throw new Error('Prompt policies must be an object')
    const promptKeys = new Set<string>(promptPolicyKinds)
    for (const [key, value] of Object.entries(input.prompts)) {
      if (!promptKeys.has(key)) throw new Error(`Unknown prompt policy: ${key}`)
      if (typeof value !== 'string') throw new Error(`${key} prompt policy must be text`)
      if (value.length > 20_000) throw new Error(`${key} prompt policy exceeds 20,000 characters`)
      if (value.includes('</workspace_admin_instructions>')) throw new Error(`${key} prompt policy contains a reserved closing tag`)
      prompts[key as PromptPolicyKind] = value.trim()
    }
  }
  const tools = { ...current.tools }
  if (input.tools !== undefined) {
    if (!record(input.tools)) throw new Error('Tool paths must be an object')
    const knownTools = new Set<string>(toolNames)
    for (const [key, value] of Object.entries(input.tools)) {
      if (!knownTools.has(key)) throw new Error(`Unknown tool: ${key}`)
      if (typeof value !== 'string') throw new Error(`${key} tool path must be text`)
      const path = value.trim()
      if (path.length > 4096) throw new Error(`${key} tool path exceeds 4,096 characters`)
      if (path.includes('\0')) throw new Error(`${key} tool path contains an invalid character`)
      tools[key as ToolName] = path
    }
  }
  const runtime = { ...current.runtime }
  const constraints = {
    capabilityTimeoutMs: [100, 3_600_000],
    retryAttempts: [1, 10],
    retryDelayMs: [0, 60_000],
    automationMaxSteps: [1, 100],
    automationMaxConcurrentRuns: [1, 32],
  } as const
  if (input.runtime !== undefined) {
    if (!record(input.runtime)) throw new Error('Runtime settings must be an object')
    for (const [key, value] of Object.entries(input.runtime)) {
      if (!Object.hasOwn(constraints, key)) throw new Error(`Unknown runtime setting: ${key}`)
      const [minimum, maximum] = constraints[key as keyof typeof constraints]
      if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum)
        throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`)
      runtime[key as keyof typeof runtime] = Number(value)
    }
  }
  return { prompts, tools, runtime }
}

export function normalizeSystemConfiguration(input: unknown): SystemConfigurationValue {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const promptInput = value.prompts && typeof value.prompts === 'object' ? (value.prompts as Record<string, unknown>) : {}
  const runtimeInput = value.runtime && typeof value.runtime === 'object' ? (value.runtime as Record<string, unknown>) : {}
  const toolInput = value.tools && typeof value.tools === 'object' ? (value.tools as Record<string, unknown>) : {}
  const prompts = Object.fromEntries(
    promptPolicyKinds.map((kind) => [
      kind,
      String(promptInput[kind] || '')
        .trim()
        .slice(0, 20_000),
    ]),
  ) as Record<PromptPolicyKind, string>
  return {
    prompts,
    tools: Object.fromEntries(
      toolNames.map((name) => [name, typeof toolInput[name] === 'string' ? toolInput[name].trim().slice(0, 4096) : '']),
    ) as Record<ToolName, string>,
    runtime: {
      capabilityTimeoutMs: integer(
        runtimeInput.capabilityTimeoutMs,
        defaultSystemConfiguration.runtime.capabilityTimeoutMs,
        100,
        3_600_000,
      ),
      retryAttempts: integer(runtimeInput.retryAttempts, defaultSystemConfiguration.runtime.retryAttempts, 1, 10),
      retryDelayMs: integer(runtimeInput.retryDelayMs, defaultSystemConfiguration.runtime.retryDelayMs, 0, 60_000),
      automationMaxSteps: integer(runtimeInput.automationMaxSteps, defaultSystemConfiguration.runtime.automationMaxSteps, 1, 100),
      automationMaxConcurrentRuns: integer(
        runtimeInput.automationMaxConcurrentRuns,
        defaultSystemConfiguration.runtime.automationMaxConcurrentRuns,
        1,
        32,
      ),
    },
  }
}

export class SystemConfiguration {
  constructor(private readonly settings: Pick<JsonSettingsStore, 'read' | 'write'>) {}

  read() {
    return normalizeSystemConfiguration(this.settings.read('system_configuration', defaultSystemConfiguration))
  }

  write(input: unknown) {
    const value = checkedUpdate(input, this.read())
    this.settings.write('system_configuration', value)
    return value
  }

  prompt(kind: PromptPolicyKind, base: string) {
    const instructions = this.read().prompts[kind]
    if (!instructions) return base
    return `${base.trim()}\n\n<workspace_admin_instructions purpose="${kind}">\n${instructions}\n</workspace_admin_instructions>`
  }

  tool(command: string) {
    return toolNames.includes(command as ToolName) ? this.read().tools[command as ToolName] || command : command
  }
}
