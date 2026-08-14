export const PLATFORM_API_VERSION = '1' as const
export const PORTABLE_SURFACE_API_VERSION = 1 as const
export const PLATFORM_FEATURES = [
  'capability-schemas',
  'durable-capability-executions',
  'automation-recipes',
  'ui-contributions',
  'open-provider-selection',
  'query-transform-capabilities',
] as const

export type PlatformApiVersion = typeof PLATFORM_API_VERSION
export type PlatformFeature = (typeof PLATFORM_FEATURES)[number]
export type {
  ReactiveCheckpoint,
  ReactiveProjectionPolicy,
  ReactiveProjectionSensitivity,
  ReactiveProjectionStorage,
  ReactivePullResult,
  ReactiveStorageAdapter,
} from './reactive.ts'
import type { ProviderKind } from './providers'
export type OpenLiteral<T extends string> = T | (string & {})

export type UnknownRecord = Record<string, unknown>

export type AgentLaunch = { command: string; args: string[]; env?: Record<string, string> }
export type AgentLaunchOptionsContext = { environment?: Record<string, string> }
export type AgentSkill = {
  id: string
  source: string
  skill: string
  name: string
  description: string
  url: string
  defaultEnabled: boolean
}
export type AgentResolvedSkill = AgentSkill & { instructions: string }
export type AgentMcpServer = {
  id: string
  name: string
  defaultEnabled: boolean
} & (
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http' | 'sse'; url: string; headers: Record<string, string> }
)
export type AgentLaunchResources = { skills: AgentResolvedSkill[]; mcpServers: AgentMcpServer[] }
export type AgentSubagentOrchestration = 'native' | 'harness'
export type AgentWorkspaceContext =
  | { path: string; sourceKind: 'git'; strategy: 'worktree' | 'direct' }
  | { path: string; sourceKind: 'directory' | 'workspace'; strategy: 'direct' | 'copy' | 'move' }
export type SetupCheck = {
  id: string
  name: string
  command: string
  args: string[]
  install: string
  required?: boolean
}
export type AgentActionStatus = 'pending' | 'running' | 'completed' | 'failed'
export type AgentAction = {
  id: string
  title: string
  kind: string
  status: AgentActionStatus
  detail?: string
  input?: unknown
  output?: unknown
}
export type AgentTimelineEvent = {
  event: 'action_started' | 'action_updated' | 'action_completed'
  thread_id?: string
  time?: string | null
  action: AgentAction
}
export type CustomAgentProfile = {
  id: string
  name: string
  description: string
  agentId: string
  model: string
  reasoningEffort: string
  promptPrefix: string
  skillIds: string[]
  mcpServerIds: string[]
  archived?: boolean
}
export type AgentPreset = Pick<CustomAgentProfile, 'model' | 'reasoningEffort'>
export type Agent = {
  id: string
  name: string
  enabled: boolean
  launch(options: Record<string, unknown>): AgentLaunch
  deleteThread?(threadId: string): Promise<void>
  workspaceRoot: string
  bootstrapPrompt?: string
  closeStdinAfterLaunch?: boolean
  supportsLiveSteering?: boolean
  supportsCustomEnvironment?: boolean
  supportsReadOnlyMode?: boolean
  supportsEphemeral?: boolean
  /**
   * How this runtime exposes sub-agent delegation. Native integrations can
   * enforce the permission at their tool boundary; ACP harnesses receive the
   * same launch permission but ultimately expose the tools implemented by the
   * configured harness.
   */
  subagentOrchestration?: AgentSubagentOrchestration
  environment?(): Record<string, string>
  prepareWorkspace?(workspace: AgentWorkspaceContext): Promise<void>
  normalizeEvent?(event: Record<string, unknown>): Record<string, unknown>
  completedThreadSnapshot?(threadId: string): Promise<{ message: string; completedAt: number | null } | null>
  resumableThreadExists?(threadId: string): Promise<boolean>
  launchOptions?(context?: AgentLaunchOptionsContext): Promise<Record<string, unknown>>
  parseLaunchOptions?(headers: Record<string, string>): Record<string, unknown>
  threadUrl?(threadId: string): string
  preset?: AgentPreset
  selectable?: boolean
  setupCheck?: SetupCheck
}

export const WORK_ITEM_WORKSPACE_MODES = ['combined'] as const
export type WorkItemWorkspaceMode = (typeof WORK_ITEM_WORKSPACE_MODES)[number]

export type PresentationAccent = 'neutral' | 'blue' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'orange' | 'rose'

export type AgentDeclaration = Pick<Agent, 'id' | 'name'> & {
  /** Host-neutral visual identity used wherever this agent is presented. */
  accent?: PresentationAccent
}

export type ScopedAgentRegistry = {
  register(agent: Agent): void
  unregister(id: string): void
}

export type KnownModuleKind = 'work-management' | 'records' | 'ai' | 'source-control' | 'ci' | 'deployment' | 'findings' | 'other'

export type ModuleKind = OpenLiteral<KnownModuleKind>

export type KnownModuleCatalogCategory = 'source-control' | 'planning' | 'quality' | 'observability' | 'automation' | 'data' | 'other'

export type ModuleCatalogCategory = OpenLiteral<KnownModuleCatalogCategory>

export type ModuleAccent = 'blue' | 'cyan' | 'emerald' | 'amber' | 'orange' | 'rose' | 'violet' | 'slate'

export type ModulePublisher = {
  name: string
  url?: string
}

export type ModuleCatalogIcon = {
  asset: string
}

export type ModuleCatalogMetadata = {
  tagline: string
  category: ModuleCatalogCategory
  publisher: ModulePublisher
  icon?: ModuleCatalogIcon
  accent?: ModuleAccent
  tags?: string[]
  featured?: boolean
  highlights?: string[]
  links?: {
    homepage?: string
    documentation?: string
    support?: string
    source?: string
  }
}

export type ModuleNavigation = {
  to: string
  label: string
  description?: string
  group?: string
}

export type CapabilityDeclaration = {
  id: string
  name: string
  description?: string
  inputSchema?: CapabilitySchema
  outputSchema?: CapabilitySchema
  timeoutMs?: number
  retry?: CapabilityRetryPolicy
}

export type CapabilityPrimitive = string | number | boolean | null
export type CapabilityValue = CapabilityPrimitive | CapabilityValue[] | { [key: string]: CapabilityValue }

export type CapabilitySchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  title?: string
  description?: string
  enum?: CapabilityPrimitive[]
  properties?: Record<string, CapabilitySchema>
  required?: string[]
  items?: CapabilitySchema
  additionalProperties?: boolean
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
}

export type CapabilityRetryPolicy = {
  attempts: number
  delayMs?: number
}

export type ModuleContributions = {
  actions?: CapabilityDeclaration[]
  queries?: CapabilityDeclaration[]
  transforms?: CapabilityDeclaration[]
  gates?: CapabilityDeclaration[]
  evidence?: CapabilityDeclaration[]
  triggers?: CapabilityDeclaration[]
  custom?: Record<string, CapabilityDeclaration[]>
}

export type CapabilityExecutionContext = {
  moduleId: string
  signal?: AbortSignal
  workflowInstanceId?: number
}

export type ActionCapability<TInput = unknown, TOutput = unknown> = CapabilityDeclaration & {
  execute(input: TInput, context: CapabilityExecutionContext): Promise<TOutput>
}

export type QueryCapability<TInput = unknown, TOutput = unknown> = CapabilityDeclaration & {
  query(input: TInput, context: CapabilityExecutionContext): Promise<TOutput>
}

export type TransformCapability<TInput = unknown, TOutput = unknown> = CapabilityDeclaration & {
  transform(input: TInput, context: CapabilityExecutionContext): Promise<TOutput>
}

export type GateResult = {
  passed: boolean
  summary: string
  details?: Record<string, unknown>
}

export type GateCapability<TInput = unknown> = CapabilityDeclaration & {
  evaluate(input: TInput, context: CapabilityExecutionContext): Promise<GateResult>
}

export type EvidenceResult = {
  status: 'passed' | 'failed' | 'unknown'
  summary: string
  url?: string
  details?: Record<string, unknown>
}

export type EvidenceCapability<TInput = unknown> = CapabilityDeclaration & {
  collect(input: TInput, context: CapabilityExecutionContext): Promise<EvidenceResult>
}

export type TriggerEvent = {
  id?: string
  occurredAt?: string
  subject?: string
  data?: CapabilityValue
}

export type TriggerCapability = CapabilityDeclaration & {
  subscribe(emit: (event: TriggerEvent) => void): void | (() => void) | Promise<void | (() => void)>
}

export type BuiltinCapabilityKind = 'action' | 'query' | 'transform' | 'gate' | 'evidence'
export type CapabilityKind = OpenLiteral<BuiltinCapabilityKind>
export type CapabilityExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out'

export type CapabilityExecution = {
  id: number
  capabilityKind: CapabilityKind
  capabilityId: string
  moduleId: string
  status: CapabilityExecutionStatus
  workflowInstanceId: number | null
  idempotencyKey: string | null
  contextualActionId: string | null
  entityKind: string | null
  entityKey: string | null
  input: CapabilityValue
  output: CapabilityValue | null
  error: string | null
  attempts: number
  maxAttempts: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type AutomationStepInputSource = 'trigger' | 'previous' | 'literal'

export type AutomationStep = {
  kind: CapabilityKind
  capabilityId: string
  inputSource?: AutomationStepInputSource
  input?: CapabilityValue
  conditionMode?: AutomationConditionMode
  conditions?: AutomationCondition[]
}

export type AutomationPromptStep = {
  name: string
  prompt: string
}

export type AutomationConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'exists'
  | 'not_exists'

export type AutomationCondition = {
  field: string
  operator: AutomationConditionOperator
  value?: CapabilityValue
}

export type AutomationConditionMode = 'all' | 'any'
export type AutomationThreadAction = 'none' | 'work' | 'review' | 'improve'

export type AutomationImprovementItem = {
  id: string
  title: string
  description: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  files: string[]
}

export type AutomationImprovementApprovalStatus = 'not-required' | 'pending' | 'approved' | 'declined'

export type AutomationBoundAction = {
  capabilityId: string
  input?: CapabilityValue
  conditionMode: AutomationConditionMode
  conditions: AutomationCondition[]
}

export type AutomationTemplateContribution = {
  id: string
  name: string
  description: string
  triggerId: string
  conditionMode?: AutomationConditionMode
  conditions?: AutomationCondition[]
  threadAction: Exclude<AutomationThreadAction, 'none'>
  promptSteps: AutomationPromptStep[]
  boundActions?: AutomationBoundAction[]
  steps?: AutomationStep[]
}

export type AutomationRecipe = {
  id: number
  name: string
  description: string
  triggerId: string | null
  enabled: boolean
  conditionMode: AutomationConditionMode
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
  schedule: AutomationSchedule | null
  steps: AutomationStep[]
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastStatus: CapabilityExecutionStatus | null
  lastError: string | null
}

export type AutomationSchedule = {
  repositoryIds: number[]
  executionMode: 'independent' | 'unified'
  branchType: string
  scheduleMode: 'simple' | 'cron'
  simpleSchedule: 'hourly' | 'daily' | 'weekly' | null
  cronExpression: string
  timezone: string
  nextRunAt: string | null
  agentId: string | null
  model: string | null
  reasoningEffort: string | null
  allowSubagents: boolean
}

export type AutomationFlowRun = {
  id: number
  recipeId: number
  status: CapabilityExecutionStatus
  idempotencyKey: string | null
  triggerEvent: TriggerEvent | null
  threadJobId: number | null
  currentPhase: number
  phaseCount: number
  improvementItems: AutomationImprovementItem[]
  improvementApprovalStatus: AutomationImprovementApprovalStatus
  selectedImprovementIds: string[]
  approvalRequestedAt: string | null
  approvedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type AutomationAuditEvent = {
  id: number
  automationRunId: number
  recipeId: number
  eventType: string
  capabilityId: string | null
  details: Record<string, CapabilityValue>
  createdAt: string
}

export type WorkResourcePresentation = {
  kind: string
  label: string
  description?: string
  tone?: PresentationAccent
  routeTemplate?: string
}

export type RunKindPresentation = {
  kind: string
  label: string
  titleFallback?: string
  workKind?: 'implementation' | 'investigation' | 'pr_review' | (string & {})
  tone?: PresentationAccent
}

export type CommandContribution = {
  id: string
  label: string
  description?: string
  to: string
  keywords?: string[]
}

export type NotificationContribution = {
  kind: string
  label: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  actionLabel?: string
  to?: string
}

export type ContextualActionPlacement =
  | 'pull-request.primary'
  | 'pull-request.review'
  | 'pull-request.secondary'
  | 'pull-request.menu'
  | 'pull-request.review-result'
  | 'work.primary'
  | 'work.menu'
  | 'run.primary'
  | 'run.menu'
  | 'finding.row'
  | 'finding.bulk'
  | 'deployment.row'
  | 'notification'
  | 'command-palette'
  | (string & {})

export type ContextualActionTone = 'default' | 'neutral' | 'positive' | 'warning' | 'destructive'
export type ContextualActionConfirmation = {
  level: 'none' | 'confirm' | 'typed'
  title?: string
  description?: string
  confirmLabel?: string
  /** Entity field whose current value must be typed for a typed confirmation. */
  confirmationField?: string
}

export type ContextualActionCondition = {
  field: string
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'exists' | 'not_exists'
  value?: CapabilityValue
  disabledReason?: string
}

export type ContextualActionInputField = {
  name: string
  label: string
  description?: string
  type: 'text' | 'textarea'
  required?: boolean
  placeholder?: string
  maxLength?: number
}

export type ContextualActionContribution = {
  id: string
  capabilityId: string
  label: string
  description?: string
  placements: ContextualActionPlacement[]
  entityKinds: string[]
  tone?: ContextualActionTone
  /** Maps capability input property names to dotted fields on the selected entity. */
  inputMapping?: Record<string, string>
  inputFields?: ContextualActionInputField[]
  conditions?: ContextualActionCondition[]
  confirmation?: ContextualActionConfirmation
  preview?: boolean
  successMessage?: string
  invalidates?: string[]
  keywords?: string[]
  /** Capability ids executed after this action succeeds. */
  followUpCapabilityIds?: string[]
}

export type ModuleUiContributions = {
  workResources?: WorkResourcePresentation[]
  runKinds?: RunKindPresentation[]
  commands?: CommandContribution[]
  notifications?: NotificationContribution[]
  contextualActions?: ContextualActionContribution[]
  automationTemplates?: AutomationTemplateContribution[]
}

export type ScopedCapabilityRegistries = {
  actions: { register(capability: ActionCapability): void }
  queries: { register(capability: QueryCapability): void }
  transforms: { register(capability: TransformCapability): void }
  gates: { register(capability: GateCapability): void }
  evidence: { register(capability: EvidenceCapability): void }
  triggers: { register(capability: TriggerCapability): void }
  custom: { register(kind: string, capability: CustomCapability): void }
}

export type CapabilityPrimitiveDeclaration = {
  id: string
  name: string
  description?: string
}

export type CustomCapability<TInput = unknown, TOutput = unknown> = CapabilityDeclaration & {
  run(input: TInput, context: CapabilityExecutionContext): Promise<TOutput>
}

export type ExtensionPartRequirements = {
  primitives?: string[]
  capabilities?: string[]
  providers?: Array<{ kind: ProviderKind; id: string }>
}
