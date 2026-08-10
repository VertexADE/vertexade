import { PLATFORM_API_VERSION, PORTABLE_SURFACE_API_VERSION, PLATFORM_FEATURES, WORK_ITEM_WORKSPACE_MODES } from './core'
import type { WorkCleanupArtifact } from './work-cleanup'
import type {
  PlatformApiVersion,
  PlatformFeature,
  OpenLiteral,
  UnknownRecord,
  AgentLaunch,
  AgentLaunchOptionsContext,
  AgentSkill,
  AgentResolvedSkill,
  AgentMcpServer,
  AgentLaunchResources,
  SetupCheck,
  AgentActionStatus,
  AgentAction,
  AgentTimelineEvent,
  CustomAgentProfile,
  AgentPreset,
  Agent,
  WorkItemWorkspaceMode,
  PresentationAccent,
  AgentDeclaration,
  ScopedAgentRegistry,
  KnownModuleKind,
  ModuleKind,
  KnownModuleCatalogCategory,
  ModuleCatalogCategory,
  ModuleAccent,
  ModulePublisher,
  ModuleCatalogIcon,
  ModuleCatalogMetadata,
  ModuleNavigation,
  CapabilityDeclaration,
  CapabilityPrimitive,
  CapabilityValue,
  CapabilitySchema,
  CapabilityRetryPolicy,
  ModuleContributions,
  CapabilityExecutionContext,
  ActionCapability,
  QueryCapability,
  TransformCapability,
  GateResult,
  GateCapability,
  EvidenceResult,
  EvidenceCapability,
  TriggerEvent,
  TriggerCapability,
  BuiltinCapabilityKind,
  CapabilityKind,
  CapabilityExecutionStatus,
  CapabilityExecution,
  AutomationStepInputSource,
  AutomationStep,
  AutomationPromptStep,
  AutomationConditionOperator,
  AutomationCondition,
  AutomationConditionMode,
  AutomationThreadAction,
  AutomationImprovementItem,
  AutomationImprovementApprovalStatus,
  AutomationBoundAction,
  AutomationTemplateContribution,
  AutomationRecipe,
  AutomationFlowRun,
  AutomationAuditEvent,
  WorkResourcePresentation,
  RunKindPresentation,
  CommandContribution,
  NotificationContribution,
  ContextualActionPlacement,
  ContextualActionTone,
  ContextualActionConfirmation,
  ContextualActionCondition,
  ContextualActionInputField,
  ContextualActionContribution,
  ModuleUiContributions,
  ScopedCapabilityRegistries,
  CapabilityPrimitiveDeclaration,
  CustomCapability,
  ExtensionPartRequirements,
} from './core'
import { resolveScmPresentation } from './providers'
import type {
  KnownProviderKind,
  ProviderKind,
  ProviderDeclaration,
  ExtensionProvider,
  ProviderContext,
  RepositoryIdentity,
  ScmUser,
  ScmPullRequestRef,
  ScmCreatePullRequest,
  ScmInlineComment,
  ScmData,
  ScmReferencePresentation,
  ScmPresentation,
  ScmProvider,
  WorkManagementProvider,
  RecordsProvider,
  Finding,
  FindingsProvider,
  WorkReference,
  WorkReferenceProvider,
  InboxItem,
  InboxProvider,
  SearchResult,
  SearchProvider,
  DeploymentStage,
  DeploymentCommit,
  DeploymentTarget,
  DeploymentService,
  DeploymentOverview,
  DeploymentSnapshot,
  DeploymentProvider,
  ScopedProviderRegistries,
  ExtensionRouteContext,
  ExtensionRoute,
  ExtensionRegistrationContext,
  ModuleStatus,
} from './providers'

export type PortableFieldStyle = 'text' | 'badge' | 'date' | 'person' | 'links'
export type PortableFieldPlacement = 'card' | 'detail'

export type PortableCollectionItemMapping = {
  idPath: string
  titlePath: string
  subtitlePath?: string
  fieldsPath: string
  fieldNamePath: string
  fieldValuePath: string
  fieldStylePath?: string
  fieldPlacementPath?: string
  fieldImagePath?: string
  relationItemsPath?: string
  relationIdPath?: string
  relationTitlePath?: string
  relationUrlPath?: string
  relationImagePath?: string
}

export type PortableActionValue = string | number | boolean | string[] | Record<string, unknown> | unknown[] | null

export type PortableActionCondition = {
  input: string
  equals?: PortableActionValue
  notEquals?: PortableActionValue
}

export type PortableActionOption = {
  value: string
  label: string
  parentValue?: string
}

export type PortableActionInput = {
  name: string
  label: string
  type: 'select' | 'multiselect' | 'boolean' | 'text' | 'textarea' | 'number' | 'hidden'
  description?: string
  placeholder?: string
  required?: boolean
  defaultValue?: PortableActionValue
  defaultPath?: string
  defaultSource?: 'surface' | 'item'
  options?: PortableActionOption[]
  optionsPath?: string
  optionValuePath?: string
  optionLabelPath?: string
  optionsSource?: 'surface' | 'item'
  optionsFilterPath?: string
  optionsFilterInput?: string
  visibleWhen?: PortableActionCondition
  /** Places the value in a nested request body. Segments are literal and may contain punctuation. */
  bodyPath?: string[]
  omitWhenEmpty?: boolean
  emptyValue?: 'null'
}

export type PortableItemAction = {
  id: string
  label: string
  description?: string
  method: 'POST' | 'PATCH'
  path: string
  inputs?: PortableActionInput[]
  successMessage?: string
  intent?: 'launch-work'
  job?: {
    idPath: string
    statusPath: string
    statusValuePath: string
    resultPath?: string
    errorPath?: string
    completedValues: string[]
    failedValues: string[]
    pollIntervalMs?: number
    resultBodyPath?: string[]
    completeAction?: Omit<PortableItemAction, 'job'>
    refineAction?: Omit<PortableItemAction, 'job'>
  }
}

export type PortableCollectionAction = PortableItemAction

export type PortableCollectionFacet = {
  id: string
  label: string
  field: string
}

export type PortableCollectionSourceControl = {
  id: string
  label: string
  queryParameter: string
  optionsPath: string
  optionValuePath: string
  optionLabelPath: string
  selectedPath?: string
}

export type PortableSwimlaneOption = {
  id: string
  label: string
  kind: 'none' | 'hierarchy' | 'field'
  field?: string
  anchorValues?: string[]
  nestedAnchorValues?: string[]
  nestedLabel?: string
}

export type PortableSwimlaneConfig = {
  defaultOption: string
  nestedByDefault?: boolean
  options: PortableSwimlaneOption[]
}

export type PortableDetailSection = {
  id: string
  title: string
  kind: 'fields' | 'text' | 'markdown' | 'code' | 'list' | 'timeline' | 'json'
  path: string
}

export type PortableCollectionSurface = {
  contractVersion: typeof PORTABLE_SURFACE_API_VERSION
  id: string
  kind: 'collection'
  title: string
  description?: string
  source: {
    path: string
    configuredPath?: string
    itemsPath: string
  }
  item: PortableCollectionItemMapping
  views: {
    list: boolean
    default?: 'list' | 'kanban'
    pagination?: {
      enabled: boolean
      pageSize?: number
    }
    kanban?: {
      enabled: boolean
      groupFieldsPath: string
      groupFieldNamePath: string
      defaultField?: string
      groupOrder?: string[]
      groupOrderPath?: string
      groupOrderValuePath?: string
      groupOrderEntriesPath?: string
      groupOrderEntryFieldPath?: string
      groupOrderEntryValuePath?: string
      swimlanes?: PortableSwimlaneConfig
    }
    hierarchy?: { parentIdPath: string }
  }
  actions?: PortableItemAction[]
  itemActionsPath?: string
  collectionActions?: PortableCollectionAction[]
  collectionActionsPath?: string
  facets?: PortableCollectionFacet[]
  sourceControls?: PortableCollectionSourceControl[]
  detail?: {
    source?: { path: string }
    titlePath?: string
    sections?: PortableDetailSection[]
    sectionsPath?: string
  }
  setup?: {
    message: string
    settingsSurfaceId: string
  }
  refresh?: {
    eventPrefixes: string[]
  }
}

export type PortableSurface = PortableCollectionSurface

export type PortableSettingsField = {
  name: string
  label: string
  type: 'text' | 'textarea' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect' | 'string-list' | 'object-list' | 'hidden'
  description?: string
  placeholder?: string
  required?: boolean
  valuePath?: string
  storedPath?: string
  defaultValue?: PortableActionValue
  options?: PortableActionOption[]
  optionsPath?: string
  optionValuePath?: string
  optionLabelPath?: string
  optionsAction?: string
  optionsFilterPath?: string
  optionsFilterInput?: string
  visibleWhen?: PortableActionCondition
  fields?: PortableSettingsField[]
  minItems?: number
  maxItems?: number
  addLabel?: string
  allowReorder?: boolean
}

export type PortableSettingsAction = {
  id: string
  label: string
  description?: string
  method: 'POST' | 'DELETE'
  path: string
  intent?: 'discover' | 'reset'
  includeFields?: string[]
  successMessage?: string
  confirm?: {
    title: string
    description: string
    confirmLabel: string
    destructive?: boolean
  }
}

export type PortableSettingsSurface = {
  contractVersion: typeof PORTABLE_SURFACE_API_VERSION
  id: string
  title: string
  description?: string
  source: {
    path: string
    configuredPath?: string
  }
  fields: PortableSettingsField[]
  sections?: Array<{
    id: string
    title: string
    description?: string
    fields: string[]
  }>
  submit?: {
    method: 'POST'
    path: string
    label: string
    successMessage?: string
  }
  actions?: PortableSettingsAction[]
}

export type PortableModuleManifest = {
  surfaces: PortableSurface[]
  settings?: PortableSettingsSurface
}

export const EXTENSION_PERMISSIONS = [
  'settings.read',
  'settings.write',
  'repositories.read',
  'tasks.launch',
  'tasks.follow-up',
  'tasks.plan',
  'work.read',
  'work.write',
  'events.emit',
  'cache.read',
  'cache.write',
  'scm-auth.manage',
  'network.request',
  'process.execute',
] as const

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number]

export type ModuleManifest = {
  id: string
  name: string
  version: string
  platformApi: PlatformApiVersion
  kind: ModuleKind
  description?: string
  catalog?: ModuleCatalogMetadata
  navigation?: ModuleNavigation
  requires?: {
    agent?: boolean
    platformFeatures?: PlatformFeature[]
    parts?: ExtensionPartRequirements
  }
  permissions?: ExtensionPermission[]
  setupChecks?: SetupCheck[]
  contributes?: ModuleContributions
  primitives?: CapabilityPrimitiveDeclaration[]
  ui?: ModuleUiContributions
  providers?: ProviderDeclaration[]
  agents?: AgentDeclaration[]
  portable?: PortableModuleManifest
}

export type ModuleInstallationOrigin = 'bundled' | 'local'
export type ExtensionFailurePhase =
  | 'load'
  | 'manifest'
  | 'assets'
  | 'migration'
  | 'register'
  | 'requirements'
  | 'initialize'
  | 'status'
  | 'dispose'
export type ExtensionDiagnostic = {
  moduleId: string
  phase: ExtensionFailurePhase
  message: string
}
export type ModuleLifecycleState = 'disabled' | 'setup-required' | 'degraded' | 'ready' | 'failed'

export type ModuleCatalogEntry = ModuleManifest &
  ModuleStatus & {
    installed: boolean
    enabled: boolean
    installation: {
      origin: ModuleInstallationOrigin
      removable: boolean
      checksum?: string
    }
    lifecycle: ModuleLifecycleState
    failure?: ExtensionDiagnostic
    desiredEnabled?: boolean
    pending?: boolean
    stateError?: string
  }

export type ModuleCatalog = {
  platformApi: PlatformApiVersion
  platformFeatures?: readonly PlatformFeature[]
  modules: ModuleCatalogEntry[]
  diagnostics?: ExtensionDiagnostic[]
  cache?: ExtensionCacheStats[]
}

export type WorkDeletionError = { target: string; error: string }

export type WorkDeletionPreview = {
  work_item: { id: number; key: string; title: string }
  threads: { total: number; active: number }
  worktrees: Array<{ path: string; repository: string; removable: boolean; reason: string | null }>
  local_branches: Array<{
    repository: string
    branch: string
    removable: boolean
    reason: string | null
  }>
  logs: number
  logs_retained: number
  memory_file: boolean
  preserved_pull_requests: Array<{ label: string; url: string | null; state: string | null }>
  preserves: { repositories: true; pull_requests: true; remote_branches: true }
}

export type WorkDeletionResult = {
  deleted: boolean
  cleanup_complete?: boolean
  cleanup_tombstone_id?: number
  cleanup_pending?: number
  cleanup_next_retry_at?: string | null
  cleanup_artifacts?: WorkCleanupArtifact[]
  work_item_key: string
  threads_deleted: number
  worktrees_removed: number
  local_branches_deleted: number
  logs_deleted: number
  logs_retained: number
  provider_threads_retained: number
  memory_deleted: boolean
  shared_worktrees_retained: number
  shared_branches_retained: number
  preserved_pull_requests: WorkDeletionPreview['preserved_pull_requests']
  errors: WorkDeletionError[]
}

export type WorkBatchDeletionPreview = {
  items: WorkDeletionPreview[]
}

export type WorkBatchDeletionResult = {
  requested: number
  deleted: number
  failed: number
  results: WorkDeletionResult[]
}

export type MergedWorktreeCleanupResult = {
  removed: number
  paths: string[]
  errors: WorkDeletionError[]
}

export type ExtensionMigration = {
  version: number
  name: string
  migrate(): void | Promise<void>
}

export type DashboardExtension<TRegistrationContext = ExtensionRegistrationContext> = {
  manifest: ModuleManifest
  migrations?: ExtensionMigration[]
  status?: () => ModuleStatus
  register?: (context: TRegistrationContext) => void | Promise<void>
  initialize?: () => void | Promise<void>
  dispose?: () => void | Promise<void>
}

export type ExtensionCommandOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  input?: string
  signal?: AbortSignal
}

export type ExtensionCommandRunner<TResult = unknown> = (
  command: string,
  args: string[],
  options?: ExtensionCommandOptions,
) => Promise<TResult>

export type ExtensionRuntimeContext<
  THostServices extends ExtensionHostServices = ExtensionHostServices,
  TCommandResult = unknown,
> = UnknownRecord & {
  root?: string
  host?: THostServices
  run?: ExtensionCommandRunner<TCommandResult>
}

export type ExtensionFactoryContext<THostServices extends ExtensionHostServices = ExtensionHostServices, TCommandResult = unknown> = {
  root: string
  host: THostServices
  run: ExtensionCommandRunner<TCommandResult>
}

export type ExtensionFactory<
  TContext extends ExtensionFactoryContext = ExtensionFactoryContext,
  TExtension extends DashboardExtension = DashboardExtension,
> = (context: TContext) => TExtension | Promise<TExtension>

export function defineExtension<TExtension extends DashboardExtension>(extension: TExtension): TExtension {
  return extension
}

export type ExtensionRepository = {
  id: number
  full_name: string
  [key: string]: unknown
}

export type ExtensionWorkKind = 'implementation' | 'pr_review' | 'investigation' | 'operational'
export type ExtensionWorkState = 'backlog' | 'active' | 'review' | 'deploy' | 'done'
export type ExtensionWorkPriority = 'low' | 'normal' | 'high' | 'urgent'
export type ExtensionWorkRelation = 'parent' | 'child' | 'blocks' | 'blocked_by' | 'related' | 'duplicate'

export type ExtensionWorkResourceInput = {
  provider: string
  kind: string
  externalId: string
  role: string
  label: string
  url?: string | null
  repositoryId?: number | null
  state?: string | null
  metadata?: Record<string, unknown>
  primary?: boolean
}

export type ExtensionWorkItemInput = {
  title: string
  description?: string
  sequentialExecution?: boolean
  kind?: ExtensionWorkKind
  state?: ExtensionWorkState
  priority?: ExtensionWorkPriority
  owner?: string | null
  repositoryId?: number | null
  source?: ExtensionWorkResourceInput | null
}

export type ExtensionWorkItem = {
  id: number
  key: string
  title: string
  description: string
  kind: ExtensionWorkKind
  state: ExtensionWorkState
  priority: ExtensionWorkPriority
  [key: string]: unknown
}

export type CrossWorktreeFollowUpInput = {
  sourceJobId: number
  destinationJobId: number
  title: string
  instruction: string
}

export type CrossWorktreeFollowUpResult = {
  workItem: ExtensionWorkItem
  destinationJobId: number
  transferId: number
  status: 'running'
}

export type ExtensionPlanningJob = Record<string, unknown> & {
  id: number
  status: string
  kind: string
  thread_id?: string | null
  result_text?: string | null
  work_item_id?: number | null
  worktree_path: string
  session_cwd?: string | null
  workspace_mode?: WorkItemWorkspaceMode
  base_repo_path: string
  log_path: string
  agent_id?: string | null
}

export type PlanningWorkflowRequest = {
  repositories: ExtensionRepository[]
  title: string
  prompt: string
  source: ExtensionWorkResourceInput
  activity: string
  jobKind: string
  taskTitle: string
  logPrefix?: string
  workspaceMode?: WorkItemWorkspaceMode
}

export type PlanningRefinementRequest = {
  job: ExtensionPlanningJob
  prompt: string
  activity: string
  event: string
}

export type PlanningTaskServices = {
  plan(request: PlanningWorkflowRequest): Promise<unknown>
  refinePlan(request: PlanningRefinementRequest): Promise<unknown>
  planningJob(id: number, kind: string): ExtensionPlanningJob | null
}

export type ExtensionWorkMemory = {
  workItemId: number
  key: string
  path: string
  content: string
  updatedAt: string
}

export type WorkLaunchContext = {
  kind?: ExtensionWorkKind
  source?: ExtensionWorkResourceInput
  workspaceMode?: WorkItemWorkspaceMode
}

export type ExtensionTaskServices = {
  launch(
    repository: ExtensionRepository,
    title: string,
    prompt: string,
    createPullRequest: boolean,
    branchType: string,
    context?: WorkLaunchContext,
  ): Promise<unknown>
  followUpInWorktree(input: CrossWorktreeFollowUpInput): Promise<CrossWorktreeFollowUpResult>
}

export type ScmAuthenticationState = {
  source: string
  connected: boolean
  error: string
  expiresAt: string | null
  /** Setup check that must pass for the selected authentication source. */
  requiredSetupCheckId?: string
}

export type ScmAuthenticationServices = {
  state(): ScmAuthenticationState
  useToken(source: string, token: string, expiresAt?: string | null): void
  restore(): void
  clearCachedUser(): void
  fail(source: string, error: unknown): void
}

export type ExtensionCacheState = 'fresh' | 'stale' | 'miss' | 'refreshed'

export type ExtensionCacheOptions = {
  ttlMs: number
  staleWhileRevalidateMs?: number
  tags?: string[]
  forceRefresh?: boolean
}

export type ExtensionCacheMetadata = {
  state: ExtensionCacheState
  key: string
  cachedAt: string
  expiresAt: string
  staleUntil: string
  refreshing: boolean
}

export type ExtensionCacheResult<T> = {
  value: T
  cache: ExtensionCacheMetadata
}

export type ExtensionCacheInvalidation = {
  key?: string
  prefix?: string
  tags?: string[]
}

export type ExtensionCacheStats = {
  namespace: string
  entries: number
  hits: number
  misses: number
  staleHits: number
  refreshes: number
  errors: number
  evictions: number
  coalesced: number
  lastRefreshAt?: string
}

export type ExtensionCacheServices = {
  getOrLoad<T>(key: string, loader: () => Promise<T>, options: ExtensionCacheOptions): Promise<ExtensionCacheResult<T>>
  invalidate(input?: ExtensionCacheInvalidation): number
  stats(): ExtensionCacheStats
}

export type ExtensionHostServices<
  TTaskServices extends object = Record<never, never>,
  TAdditionalServices extends object = Record<never, never>,
> = {
  settings: {
    read<T>(name: string, fallback: T): T
    write(name: string, value: unknown): void
    delete(name: string): void
    has(name: string): boolean
  }
  repositories: {
    get(id: number): ExtensionRepository | null
    list(): ExtensionRepository[]
  }
  tasks: ExtensionTaskServices & TTaskServices
  work?: {
    create(input: ExtensionWorkItemInput): ExtensionWorkItem
    linkResource(workItemId: number, resource: ExtensionWorkResourceInput): Record<string, unknown>
    relate(fromWorkItemId: number, toWorkItemId: number, relation: ExtensionWorkRelation): void
    memory(workItemId: number): Promise<ExtensionWorkMemory>
    writeMemory(workItemId: number, content: string): Promise<ExtensionWorkMemory>
  }
  events: { emit(reason: string, id?: number | null): void }
  network?: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> }
  cache?: ExtensionCacheServices
  scmAuthentication?: ScmAuthenticationServices
  workspacePreviews?: {
    settings(): unknown
    updateSettings(input: unknown): Promise<unknown>
    get(jobId: number): Promise<unknown>
    start(jobId: number): Promise<unknown>
    restart(jobId: number): Promise<unknown>
    stop(jobId: number): Promise<unknown>
    logs(jobId: number): Promise<unknown>
  }
} & TAdditionalServices
