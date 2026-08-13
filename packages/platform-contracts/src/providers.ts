import { PLATFORM_API_VERSION, PORTABLE_SURFACE_API_VERSION, PLATFORM_FEATURES, WORK_ITEM_WORKSPACE_MODES } from './core'
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
import type { ScmAuthenticationState } from './extension'

export type KnownProviderKind = 'scm' | 'work-management' | 'records' | 'findings' | 'deployment' | 'work-reference' | 'inbox' | 'search'
export type ProviderKind = OpenLiteral<KnownProviderKind>

export type ProviderDeclaration = {
  id: string
  name: string
  kind: ProviderKind
}

export type ExtensionProvider = {
  id: string
  name: string
}

export type ProviderContext = {
  moduleId: string
  signal?: AbortSignal
  forceRefresh?: boolean
}

export type RepositoryIdentity = {
  id: string
  webUrl: string
  cloneUrl: string
}

export type ScmRepositorySearchResult = RepositoryIdentity & {
  name: string
  description?: string
  private: boolean
  ownerType?: 'user' | 'organization'
  source: 'authenticated' | 'public'
  updatedAt?: string
}

export type ScmRepositorySearchPage = {
  repositories: ScmRepositorySearchResult[]
  source: 'authenticated' | 'public'
  hasMore: boolean
}

export type ScmUser = {
  login: string
  avatarUrl?: string
}

export type ScmPullRequestRef = {
  repository: string
  number: number
}

export type ScmCreatePullRequest = {
  repository: string
  head: string
  base: string
  title: string
  body: string
  draft: boolean
}

export type ScmInlineComment = {
  body: string
  commitId: string
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  startLine?: number
  startSide?: 'LEFT' | 'RIGHT'
}

export type ScmData = Record<string, any>

export type ScmReferencePresentation = {
  providerName: string
  repositoryUrl: string
  issueUrlTemplate?: string
  userUrlTemplate?: string
  teamUrlTemplate?: string
}

export type ScmPresentation = {
  /** Provider-specific name for a proposed change, for example "pull request" or "merge request". */
  changeRequestLabel: string
  /** Plural form of changeRequestLabel. */
  changeRequestLabelPlural: string
}

export function resolveScmPresentation(provider: Pick<ScmProvider, 'presentation'>): ScmPresentation {
  const singular = provider.presentation?.changeRequestLabel?.trim() || 'change request'
  return {
    changeRequestLabel: singular,
    changeRequestLabelPlural: provider.presentation?.changeRequestLabelPlural?.trim() || `${singular}s`,
  }
}

export type ScmProvider = {
  id: string
  name: string
  presentation?: ScmPresentation
  setupChecks?: SetupCheck[]
  authentication?(): ScmAuthenticationState
  branchUrl?(repository: string, branch: string): string
  parsePullRequestUrl?(url: string): ScmPullRequestRef | null
  referencePresentation?(repository: string): ScmReferencePresentation
  parseRepository(input: string): RepositoryIdentity
  searchRepositories?(query: string, limit: number, context?: ProviderContext): Promise<ScmRepositorySearchPage>
  currentUser(context?: ProviderContext): Promise<ScmUser>
  listPullRequests(
    repository: string,
    state: 'open' | 'closed' | 'all',
    limit: number,
    fields: string[],
    context?: ProviderContext,
  ): Promise<ScmData[]>
  listOpenPullRequests(repository: string, context?: ProviderContext): Promise<ScmData[]>
  pullRequestStatus(repository: string, context?: ProviderContext): Promise<ScmData[]>
  pullRequestDetails(ref: ScmPullRequestRef, fields: string[], context?: ProviderContext): Promise<ScmData>
  pullRequestDiff(ref: ScmPullRequestRef, context?: ProviderContext): Promise<string>
  reviewThreads(ref: ScmPullRequestRef, context?: ProviderContext): Promise<ScmData>
  listLabels(repository: string, context?: ProviderContext): Promise<ScmData[]>
  listCollaborators(repository: string, context?: ProviderContext): Promise<ScmData[]>
  addLabel(ref: ScmPullRequestRef, label: string, context?: ProviderContext): Promise<ScmData[]>
  removeLabel(ref: ScmPullRequestRef, label: string, context?: ProviderContext): Promise<ScmData[]>
  requestReviewers(ref: ScmPullRequestRef, reviewers: string[], context?: ProviderContext): Promise<ScmData>
  createPullRequest?(input: ScmCreatePullRequest, context?: ProviderContext): Promise<ScmData>
  approve(ref: ScmPullRequestRef, comment?: string, context?: ProviderContext): Promise<void>
  requestChanges?(ref: ScmPullRequestRef, comment: string, context?: ProviderContext): Promise<void>
  enableAutoMerge(ref: ScmPullRequestRef, context?: ProviderContext): Promise<void>
  updateBranch(ref: ScmPullRequestRef, expectedHeadSha: string, context?: ProviderContext): Promise<{ message?: string }>
  markReady(ref: ScmPullRequestRef, context?: ProviderContext): Promise<void>
  postReviewComment(ref: ScmPullRequestRef, body: string, context?: ProviderContext): Promise<void>
  postReviewSuggestions(ref: ScmPullRequestRef, body: string, comments: unknown[], context?: ProviderContext): Promise<ScmData>
  postInlineComment?(ref: ScmPullRequestRef, comment: ScmInlineComment, context?: ProviderContext): Promise<ScmData>
  replyToReviewComment?(ref: ScmPullRequestRef, commentId: number, body: string, context?: ProviderContext): Promise<ScmData>
  setReviewThreadResolved?(ref: ScmPullRequestRef, threadId: string, resolved: boolean, context?: ProviderContext): Promise<ScmData>
}

export type WorkManagementProvider<TConfig = any, TClient = any> = {
  id: string
  name: string
  normalizeConfig(input?: Record<string, unknown>): TConfig
  createClient(config: TConfig): TClient
}

export type RecordsProvider<TConfig = any, TClient = any> = {
  id: string
  name: string
  createClient(config: TConfig): TClient
  detectStructure?(schema: unknown): unknown
}

export type Finding = {
  id: string
  key: string
  title: string
  message?: string
  severity: string
  status: string
  project?: string
  link: string
  [key: string]: unknown
}

export type FindingsProvider<TConfig = any> = {
  id: string
  name: string
  defaultConfig: TConfig
  normalizeConfig(input: Record<string, unknown>, current?: TConfig): TConfig
  isConfigured(config: TConfig): boolean
  publicConfig(config: TConfig): Record<string, unknown>
  verify(config: TConfig, context?: ProviderContext): Promise<void>
  findings(config: TConfig, query?: string, context?: ProviderContext): Promise<Finding[]>
  findingDetails?(config: TConfig, findingId: string, context?: ProviderContext): Promise<Finding>
  remediationPrompt(finding: Finding, repository: string, instruction?: string): string
}

export type WorkReference = {
  provider: string
  kind: string
  externalId: string
  label: string
  url?: string | null
  state?: string | null
  summary?: string | null
  metadata?: Record<string, unknown>
}

export type WorkReferenceProvider = ExtensionProvider & {
  references(query?: string, context?: ProviderContext): Promise<WorkReference[]>
}

export type InboxItem = {
  id: string
  type: string
  severity: 'info' | 'warning' | 'error'
  title: string
  summary: string
  source?: string
  createdAt?: string
  href?: string | null
  actionLabel?: string
  unread?: boolean
}

export type InboxProvider = ExtensionProvider & {
  items(context?: ProviderContext): Promise<InboxItem[]>
}

export type SearchResult = {
  id: string
  type: string
  title: string
  subtitle?: string
  to: string
}

export type SearchProvider = ExtensionProvider & {
  search(query: string, context?: ProviderContext): Promise<SearchResult[]>
}

export type DeploymentStage = {
  status: string
  conclusion: string | null
  url: string
  started_at: string | null
  completed_at: string | null
  attempt_sha?: string | null
  attempt_title?: string | null
  run_id?: number
  deployed_sha?: string | null
  deployed_title?: string | null
  deployed_at?: string | null
}

export type DeploymentCommit = {
  run_id: number
  sha: string
  title: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  url: string
  stages: Record<string, DeploymentStage>
}

export type DeploymentTarget = {
  id: string
  label: string
  repository: string
  workflow: string
  branch: string
  event: string
  environments: string[]
  production_environment: string
  comparison_environment: string
}

export type DeploymentService = {
  key: string
  name: string
  target: DeploymentTarget
  state: 'deployed' | 'deploying' | 'waiting' | 'failed' | 'pending' | 'outdated' | 'unknown'
  latest: DeploymentCommit | null
  environments: Record<string, DeploymentStage | null>
  production_outdated: boolean
  deployment_delta: {
    from_sha: string
    to_sha: string
    commit_count: number
    compare_url: string
  } | null
  pending_commits: DeploymentCommit[]
}

export type DeploymentOverview = {
  repository: string
  workflow: string
  refreshed_at: string
  targets: DeploymentTarget[]
  services: DeploymentService[]
  summary: { deployed: number; attention: number; active: number; pending_commits: number }
}

export type DeploymentSnapshot = Omit<DeploymentOverview, 'services'> & {
  services: Array<DeploymentService & { runs: DeploymentCommit[] }>
}

export type DeploymentProvider = {
  id: string
  name: string
  overview(refresh?: boolean, context?: ProviderContext): Promise<DeploymentSnapshot>
  rerun(runId: number, mode: 'all' | 'failed', targetId?: string, context?: ProviderContext): Promise<void>
}

export type ScopedProviderRegistries = {
  register<TProvider extends ExtensionProvider>(kind: ProviderKind, provider: TProvider): void
  scm: { register(provider: ScmProvider): void }
  workManagement: { register(provider: WorkManagementProvider): void }
  records: { register(provider: RecordsProvider): void }
  findings: { register(provider: FindingsProvider): void }
  deployment: { register(provider: DeploymentProvider): void }
  workReferences: { register(provider: WorkReferenceProvider): void }
  inbox: { register(provider: InboxProvider): void }
  search: { register(provider: SearchProvider): void }
}

export type ExtensionRouteContext = {
  moduleId: string
  params: Record<string, string>
  signal: AbortSignal
}

export type ExtensionRoute = {
  method: string
  path: string
  availability?: 'enabled' | 'installed'
  timeoutMs?: number
  handler(request: Request, context: ExtensionRouteContext): Response | Promise<Response>
}

export type ExtensionRegistrationContext = ScopedCapabilityRegistries & {
  primitives: { register(primitive: CapabilityPrimitiveDeclaration): void }
  routes: { register(route: ExtensionRoute): void }
  providers: ScopedProviderRegistries
  agents: ScopedAgentRegistry
}

export type ModuleStatus = {
  configured?: boolean
  healthy?: boolean
  message?: string
  checkedAt?: string
}
