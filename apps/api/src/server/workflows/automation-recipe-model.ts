import type {
  AutomationAuditEvent,
  AutomationBoundAction,
  AutomationCondition,
  AutomationFlowRun,
  AutomationImprovementItem,
  AutomationPromptStep,
  AutomationRecipe,
  AutomationSchedule,
  AutomationStep,
  AutomationThreadAction,
  CapabilityExecutionStatus,
  CapabilityValue,
  TriggerEvent,
} from '@vertexade/platform-contracts'
import { normalizeAutomationConditions, normalizeConditionMode } from './automation-conditions.ts'
import type { AutomationThreadLaunchOptions } from './automation-thread-launcher.ts'

export type RecipeInput = {
  name?: unknown
  description?: unknown
  triggerId?: unknown
  enabled?: unknown
  conditionMode?: unknown
  conditions?: unknown
  threadAction?: unknown
  agentId?: unknown
  model?: unknown
  reasoningEffort?: unknown
  serviceTier?: unknown
  allowSubagents?: unknown
  resourceSelection?: unknown
  promptSteps?: unknown
  boundActions?: unknown
  steps?: unknown
  schedule?: unknown
}

export type NormalizedRecipeInput = {
  name: string
  description: string
  triggerId: string | null
  enabled: boolean
  conditionMode: AutomationRecipe['conditionMode']
  conditions: AutomationCondition[]
  threadAction: AutomationThreadAction
  agentId: string | null
  model: string | null
  reasoningEffort: string | null
  serviceTier: string | null
  allowSubagents: boolean
  resourceSelection: { skills: string[]; mcpServers: string[] } | null
  promptSteps: AutomationPromptStep[]
  boundActions: AutomationBoundAction[]
  steps: AutomationStep[]
}

function steps(value: unknown, maximum: number): AutomationStep[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Automation recipes support up to ${maximum} capability steps`)
  return value.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error('Automation steps must be objects')
    const input = step as Record<string, unknown>
    const kind = String(input.kind || '') as AutomationStep['kind']
    const capabilityId = String(input.capabilityId || '').trim()
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(kind) || !capabilityId) throw new Error('Automation steps require a capability kind and id')
    const inputSource = String(input.inputSource || (input.input === undefined ? 'trigger' : 'literal')) as NonNullable<
      AutomationStep['inputSource']
    >
    if (!['trigger', 'previous', 'literal'].includes(inputSource))
      throw new Error(`Automation step ${index + 1} has an invalid input source`)
    if (inputSource === 'previous' && index === 0) throw new Error('The first automation step cannot use previous-step output')
    if (inputSource === 'literal' && input.input === undefined) throw new Error(`Automation step ${index + 1} requires literal JSON input`)
    return {
      kind,
      capabilityId,
      inputSource,
      ...(inputSource === 'literal' ? { input: input.input as CapabilityValue } : {}),
      conditionMode: normalizeConditionMode(input.conditionMode),
      conditions: normalizeAutomationConditions(input.conditions),
    }
  })
}

function threadAction(value: unknown): AutomationThreadAction {
  const action = String(value || 'none') as AutomationThreadAction
  if (!['none', 'work', 'review', 'improve'].includes(action)) throw new Error('Choose a valid automation thread action')
  return action
}

function resourceSelection(value: unknown): NormalizedRecipeInput['resourceSelection'] {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent resources must be a selection object')
  const input = value as Record<string, unknown>
  const ids = (candidate: unknown) =>
    [...new Set((Array.isArray(candidate) ? candidate : []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 100)
  return { skills: ids(input.skills), mcpServers: ids(input.mcpServers) }
}

function promptSteps(value: unknown, maximum: number): AutomationPromptStep[] {
  const source = value === undefined ? [] : value
  if (!Array.isArray(source) || source.length > maximum) throw new Error(`Automation flows support up to ${maximum} prompt phases`)
  return source.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Prompt phases must be objects')
    const input = candidate as Record<string, unknown>
    const prompt = String(input.prompt || '')
      .trim()
      .slice(0, 20_000)
    if (!prompt) throw new Error(`Prompt phase ${index + 1} requires instructions`)
    return {
      name:
        String(input.name || `Phase ${index + 1}`)
          .trim()
          .slice(0, 80) || `Phase ${index + 1}`,
      prompt,
    }
  })
}

function boundActions(value: unknown, maximum: number): AutomationBoundAction[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Automation flows support up to ${maximum} bound actions`)
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Bound actions must be objects')
    const input = candidate as Record<string, unknown>
    const capabilityId = String(input.capabilityId || '').trim()
    if (!capabilityId) throw new Error('Bound actions require an action capability')
    return {
      capabilityId,
      ...(input.input === undefined ? {} : { input: input.input as CapabilityValue }),
      conditionMode: normalizeConditionMode(input.conditionMode),
      conditions: normalizeAutomationConditions(input.conditions),
    }
  })
}

export function supportsThreadTarget(
  action: Exclude<AutomationThreadAction, 'none'>,
  trigger: { outputSchema?: { properties?: Record<string, { enum?: unknown[] }> } },
) {
  const supported =
    action !== 'review'
      ? new Set(['work-item', 'agent-thread', 'pull-request', 'repository'])
      : new Set(['work-item', 'agent-thread', 'pull-request'])
  const entityTypes = trigger.outputSchema?.properties?.entityType?.enum || []
  return entityTypes.some((value) => supported.has(String(value)))
}

export function normalizeRecipeInput(input: RecipeInput, maximumSteps: number): NormalizedRecipeInput {
  const prompts = promptSteps(input.promptSteps, maximumSteps)
  return {
    name: String(input.name || '')
      .trim()
      .slice(0, 120),
    description: String(input.description || '')
      .trim()
      .slice(0, 1_000),
    triggerId: String(input.triggerId || '').trim() || null,
    enabled: input.enabled !== false,
    conditionMode: normalizeConditionMode(input.conditionMode),
    conditions: normalizeAutomationConditions(input.conditions),
    threadAction: threadAction(input.threadAction),
    agentId: String(input.agentId || '').trim() || null,
    model: String(input.model || '').trim() || null,
    reasoningEffort: String(input.reasoningEffort || '').trim() || null,
    serviceTier: input.agentId === 'codex' && input.serviceTier === 'priority' ? 'priority' : null,
    allowSubagents: Boolean(input.allowSubagents),
    resourceSelection: resourceSelection(input.resourceSelection),
    promptSteps: prompts,
    boundActions: boundActions(input.boundActions, maximumSteps),
    steps: steps(input.steps, maximumSteps),
  }
}

export function validateRecipeInput(value: NormalizedRecipeInput) {
  if (!value.name) throw new Error('Automation recipes require a name')
  if (!value.steps.length && !value.boundActions.length && value.threadAction === 'none')
    throw new Error('Choose a thread flow or add at least one capability step')
  if (value.threadAction === 'none') return
  if (!value.triggerId) throw new Error('Thread automations require an event trigger to identify their target')
  if (!value.promptSteps.length) throw new Error('Thread automations require at least one prompt phase')
  if (value.threadAction === 'improve' && value.promptSteps.length !== 1)
    throw new Error('Improve automations require exactly one review brief')
}

export function recipeThreadLaunchOptions(recipe: AutomationRecipe): AutomationThreadLaunchOptions {
  return {
    agentId: recipe.agentId,
    model: recipe.model,
    reasoningEffort: recipe.reasoningEffort,
    serviceTier: recipe.serviceTier,
    allowSubagents: recipe.allowSubagents,
    resourceSelection: recipe.resourceSelection,
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value !== null && value !== undefined && typeof value !== 'string') return value as T
  try {
    return JSON.parse(String(value || '')) as T
  } catch {
    return fallback
  }
}

function scheduleFromRow(row: Record<string, unknown> | null | undefined): AutomationSchedule | null {
  if (!row?.recipeId) return null
  return {
    repositoryIds: parseJson<number[]>(row.repositoryIds, []),
    executionMode: row.executionMode === 'unified' ? 'unified' : 'independent',
    branchType: String(row.branchType || 'chore'),
    scheduleMode: row.scheduleMode === 'cron' ? 'cron' : 'simple',
    simpleSchedule: ['hourly', 'daily', 'weekly'].includes(String(row.simpleSchedule))
      ? (String(row.simpleSchedule) as AutomationSchedule['simpleSchedule'])
      : null,
    cronExpression: String(row.cronExpression || ''),
    timezone: String(row.timezone || 'UTC'),
    nextRunAt: row.nextRunAt === null || row.nextRunAt === undefined ? null : String(row.nextRunAt),
    agentId: row.agentId === null || row.agentId === undefined ? null : String(row.agentId),
    model: row.model === null || row.model === undefined ? null : String(row.model),
    reasoningEffort: row.reasoningEffort === null || row.reasoningEffort === undefined ? null : String(row.reasoningEffort),
    allowSubagents: Boolean(row.allowSubagents),
  }
}

export function recipeFromRow(row: Record<string, unknown>, schedule?: Record<string, unknown> | null): AutomationRecipe {
  const storedPrompts = parseJson<AutomationPromptStep[]>(row.promptSteps, [])
  const action = String(row.flowMode || 'direct') === 'improve' ? 'improve' : threadAction(row.threadAction)
  return {
    id: Number(row.id),
    name: String(row.name),
    description: String(row.description || ''),
    triggerId: row.triggerId === null ? null : String(row.triggerId),
    enabled: Boolean(row.enabled),
    conditionMode: normalizeConditionMode(row.conditionMode),
    conditions: parseJson(row.conditions, []),
    threadAction: action,
    agentId: row.agentId == null ? null : String(row.agentId),
    model: row.model == null ? null : String(row.model),
    reasoningEffort: row.reasoningEffort == null ? null : String(row.reasoningEffort),
    serviceTier: row.serviceTier == null ? null : String(row.serviceTier),
    allowSubagents: Boolean(row.allowSubagents),
    resourceSelection: parseJson(row.resourceSelection, null),
    promptSteps: storedPrompts,
    boundActions: parseJson(row.boundActions, []),
    schedule: scheduleFromRow(schedule),
    steps: parseJson(row.steps, []),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    lastRunAt: row.lastRunAt === null ? null : String(row.lastRunAt),
    lastStatus: row.lastStatus === null ? null : (String(row.lastStatus) as CapabilityExecutionStatus),
    lastError: row.lastError === null ? null : String(row.lastError),
  }
}

export function flowRunFromRow(row: Record<string, unknown>): AutomationFlowRun {
  return {
    id: Number(row.id),
    recipeId: Number(row.recipeId),
    status: String(row.status) as CapabilityExecutionStatus,
    idempotencyKey: row.idempotencyKey === null || row.idempotencyKey === undefined ? null : String(row.idempotencyKey),
    triggerEvent: parseJson<TriggerEvent | null>(row.triggerEvent, null),
    threadJobId: row.threadJobId === null ? null : Number(row.threadJobId),
    currentPhase: Number(row.currentPhase),
    phaseCount: Number(row.phaseCount),
    improvementItems: parseJson<AutomationImprovementItem[]>(row.improvementItems, []),
    improvementApprovalStatus: String(row.improvementApprovalStatus || 'not-required') as AutomationFlowRun['improvementApprovalStatus'],
    selectedImprovementIds: parseJson<string[]>(row.selectedImprovementIds, []),
    approvalRequestedAt: row.approvalRequestedAt === null || row.approvalRequestedAt === undefined ? null : String(row.approvalRequestedAt),
    approvedAt: row.approvedAt === null || row.approvedAt === undefined ? null : String(row.approvedAt),
    lastError: row.lastError === null ? null : String(row.lastError),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    finishedAt: row.finishedAt === null ? null : String(row.finishedAt),
  }
}

export function auditEventFromRow(row: Record<string, unknown>): AutomationAuditEvent {
  return {
    id: Number(row.id),
    automationRunId: Number(row.automationRunId),
    recipeId: Number(row.recipeId),
    eventType: String(row.eventType),
    capabilityId: row.capabilityId === null ? null : String(row.capabilityId),
    details: parseJson(row.details, {}),
    createdAt: String(row.createdAt),
  }
}

const improvementPriorities = new Set<AutomationImprovementItem['priority']>(['P0', 'P1', 'P2', 'P3'])

function improvementText(value: unknown, maximumLength: number) {
  return String(value ?? '')
    .trim()
    .slice(0, maximumLength)
}

function improvementItem(candidate: unknown, index: number): AutomationImprovementItem {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error(`Improvement item ${index + 1} is invalid`)
  const input = candidate as Record<string, unknown>
  const title = improvementText(input.title, 200)
  const description = improvementText(input.description, 4_000)
  if (!title || !description) throw new Error(`Improvement item ${index + 1} requires a title and description`)
  const priority = String(input.priority ?? 'P2').toUpperCase() as AutomationImprovementItem['priority']
  const files = Array.isArray(input.files)
    ? [...new Set(input.files.map((file) => improvementText(file, 500)).filter(Boolean))].slice(0, 20)
    : []
  return {
    id: `improvement-${index + 1}`,
    title,
    description,
    priority: improvementPriorities.has(priority) ? priority : 'P2',
    files,
  }
}

export function parseImprovementPlan(output: unknown) {
  const match = String(output || '').match(/<!--\s*AUTOMATION_IMPROVEMENTS_JSON\s*\n([\s\S]*?)\n\s*-->/i)
  if (!match) throw new Error('The improvement review did not include its structured improvement plan')
  try {
    const value: unknown = JSON.parse(match[1]!)
    if (!Array.isArray(value)) throw new Error('The improvement review did not return an itemized plan')
    const items = value.slice(0, 50).map(improvementItem)
    if (!items.length) throw new Error('The improvement review found no selectable improvements')
    return items
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The improvement review returned invalid plan JSON')
    throw error
  }
}
