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
import { EXTENSION_PERMISSIONS, defineExtension } from './extension'
import { validatePortableManifest, validatePortableSettings, validatePortableSurface } from './portable-validation'
export { validatePortableSettings, validatePortableSurface } from './portable-validation'
import type {
  PortableFieldStyle,
  PortableFieldPlacement,
  PortableCollectionItemMapping,
  PortableActionValue,
  PortableActionCondition,
  PortableActionOption,
  PortableActionInput,
  PortableItemAction,
  PortableCollectionAction,
  PortableCollectionFacet,
  PortableCollectionSourceControl,
  PortableSwimlaneOption,
  PortableSwimlaneConfig,
  PortableDetailSection,
  PortableCollectionSurface,
  PortableSurface,
  PortableSettingsField,
  PortableSettingsAction,
  PortableSettingsSurface,
  PortableModuleManifest,
  ExtensionPermission,
  ModuleManifest,
  ModuleInstallationOrigin,
  ExtensionFailurePhase,
  ExtensionDiagnostic,
  ModuleLifecycleState,
  ModuleCatalogEntry,
  ModuleCatalog,
  WorkDeletionError,
  WorkDeletionPreview,
  WorkDeletionResult,
  WorkBatchDeletionPreview,
  WorkBatchDeletionResult,
  ExtensionMigration,
  DashboardExtension,
  ExtensionCommandOptions,
  ExtensionCommandRunner,
  ExtensionRuntimeContext,
  ExtensionFactoryContext,
  ExtensionFactory,
  ExtensionRepository,
  ExtensionWorkKind,
  ExtensionWorkState,
  ExtensionWorkPriority,
  ExtensionWorkRelation,
  ExtensionWorkResourceInput,
  ExtensionWorkItemInput,
  ExtensionWorkItem,
  CrossWorktreeFollowUpInput,
  CrossWorktreeFollowUpResult,
  ExtensionPlanningJob,
  PlanningWorkflowRequest,
  PlanningRefinementRequest,
  PlanningTaskServices,
  ExtensionWorkMemory,
  WorkLaunchContext,
  ExtensionTaskServices,
  ScmAuthenticationState,
  ScmAuthenticationServices,
  ExtensionCacheState,
  ExtensionCacheOptions,
  ExtensionCacheMetadata,
  ExtensionCacheResult,
  ExtensionCacheInvalidation,
  ExtensionCacheStats,
  ExtensionCacheServices,
  ExtensionHostServices,
} from './extension'

const moduleIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const capabilityIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const resourceKindPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i
const catalogIconPattern = /^assets\/[a-z0-9][a-z0-9._/-]*\.svg$/i
const moduleAccents = new Set<ModuleAccent>(['blue', 'cyan', 'emerald', 'amber', 'orange', 'rose', 'violet', 'slate'])

function requireText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
}

function validateNavigation(navigation: ModuleNavigation | undefined, moduleId: string) {
  if (!navigation) return
  requireText(navigation.to, `${moduleId} navigation requires a path`)
  if (!navigation.to.startsWith('/')) throw new Error(`${moduleId} navigation path must be absolute`)
  requireText(navigation.label, `${moduleId} navigation requires a label`)
}

function validateHttpUrl(value: string | undefined, message: string) {
  if (!value) return
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(message)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(message)
}

function validateCatalog(catalog: ModuleCatalogMetadata | undefined, moduleId: string) {
  if (!catalog) return
  requireText(catalog.tagline, `${moduleId} catalog metadata requires a tagline`)
  if (!moduleIdPattern.test(catalog.category)) throw new Error(`${moduleId} has an invalid catalog category`)
  requireText(catalog.publisher?.name, `${moduleId} catalog metadata requires a publisher`)
  validateHttpUrl(catalog.publisher.url, `${moduleId} publisher URL must use http or https`)
  if (catalog.icon) {
    requireText(catalog.icon.asset, `${moduleId} catalog icon requires an asset`)
    if (!catalogIconPattern.test(catalog.icon.asset) || catalog.icon.asset.split('/').includes('..'))
      throw new Error(`${moduleId} has an invalid catalog icon asset`)
  }
  if (catalog.accent && !moduleAccents.has(catalog.accent)) throw new Error(`${moduleId} has an invalid catalog accent`)
  for (const [label, values] of [
    ['tags', catalog.tags],
    ['highlights', catalog.highlights],
  ] as const) {
    if (!values) continue
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value.trim()))
      throw new Error(`${moduleId} catalog ${label} must contain non-empty text`)
    if (new Set(values.map((value) => value.toLowerCase())).size !== values.length)
      throw new Error(`${moduleId} catalog ${label} contains duplicates`)
  }
  for (const [label, value] of Object.entries(catalog.links || {}))
    validateHttpUrl(value, `${moduleId} catalog ${label} URL must use http or https`)
}

function validateContributions(contributes: ModuleContributions | undefined, moduleId: string) {
  if (!contributes) return
  for (const [kind, capabilities] of Object.entries(contributes)) {
    if (kind === 'custom') {
      if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))
        throw new Error(`${moduleId} custom contributions must be an object`)
      for (const [customKind, customCapabilities] of Object.entries(capabilities)) {
        if (!capabilityIdPattern.test(customKind)) throw new Error(`${moduleId} has an invalid custom primitive kind: ${customKind}`)
        validateContributions({ actions: customCapabilities }, `${moduleId} ${customKind}`)
      }
      continue
    }
    if (!Array.isArray(capabilities)) throw new Error(`${moduleId} ${kind} contributions must be an array`)
    const seen = new Set<string>()
    for (const capability of capabilities) {
      if (!capabilityIdPattern.test(capability.id)) throw new Error(`${moduleId} has an invalid ${kind} capability id: ${capability.id}`)
      if (seen.has(capability.id)) throw new Error(`${moduleId} declares ${capability.id} more than once`)
      requireText(capability.name, `${moduleId} capability ${capability.id} requires a name`)
      if (
        capability.timeoutMs !== undefined &&
        (!Number.isInteger(capability.timeoutMs) || capability.timeoutMs < 100 || capability.timeoutMs > 3_600_000)
      ) {
        throw new Error(`${moduleId} capability ${capability.id} has an invalid timeout`)
      }
      if (
        capability.retry &&
        (!Number.isInteger(capability.retry.attempts) || capability.retry.attempts < 1 || capability.retry.attempts > 10)
      ) {
        throw new Error(`${moduleId} capability ${capability.id} has an invalid retry policy`)
      }
      seen.add(capability.id)
    }
  }
}

function validateUiContributions(ui: ModuleUiContributions | undefined, contributes: ModuleContributions | undefined, moduleId: string) {
  if (!ui) return
  const workResourceKinds = new Set<string>()
  for (const resource of ui.workResources || []) {
    if (!resourceKindPattern.test(resource.kind)) throw new Error(`${moduleId} has an invalid Work resource kind: ${resource.kind}`)
    if (workResourceKinds.has(resource.kind)) throw new Error(`${moduleId} declares Work resource ${resource.kind} more than once`)
    requireText(resource.label, `${moduleId} Work resource ${resource.kind} requires a label`)
    workResourceKinds.add(resource.kind)
  }
  const runKinds = new Set<string>()
  for (const runKind of ui.runKinds || []) {
    if (!resourceKindPattern.test(runKind.kind)) throw new Error(`${moduleId} has an invalid run kind: ${runKind.kind}`)
    if (runKinds.has(runKind.kind)) throw new Error(`${moduleId} declares run kind ${runKind.kind} more than once`)
    requireText(runKind.label, `${moduleId} run kind ${runKind.kind} requires a label`)
    runKinds.add(runKind.kind)
  }
  const commandIds = new Set<string>()
  for (const command of ui.commands || []) {
    if (!capabilityIdPattern.test(command.id)) throw new Error(`${moduleId} has an invalid command id: ${command.id}`)
    if (commandIds.has(command.id)) throw new Error(`${moduleId} declares command ${command.id} more than once`)
    requireText(command.label, `${moduleId} command ${command.id} requires a label`)
    if (!command.to.startsWith('/')) throw new Error(`${moduleId} command ${command.id} requires an absolute route`)
    commandIds.add(command.id)
  }
  const notificationKinds = new Set<string>()
  for (const notification of ui.notifications || []) {
    if (!resourceKindPattern.test(notification.kind)) throw new Error(`${moduleId} has an invalid notification kind: ${notification.kind}`)
    if (notificationKinds.has(notification.kind)) throw new Error(`${moduleId} declares notification ${notification.kind} more than once`)
    requireText(notification.label, `${moduleId} notification ${notification.kind} requires a label`)
    if (notification.actionLabel !== undefined)
      requireText(notification.actionLabel, `${moduleId} notification ${notification.kind} requires valid action copy`)
    if (notification.to !== undefined && !notification.to.startsWith('/'))
      throw new Error(`${moduleId} notification ${notification.kind} requires an absolute route`)
    if (notification.actionLabel && !notification.to)
      throw new Error(`${moduleId} notification ${notification.kind} action requires a route`)
    notificationKinds.add(notification.kind)
  }
  const templateIds = new Set<string>()
  for (const template of ui.automationTemplates || []) {
    if (!resourceKindPattern.test(template.id)) throw new Error(`${moduleId} has an invalid automation template id: ${template.id}`)
    if (templateIds.has(template.id)) throw new Error(`${moduleId} declares automation template ${template.id} more than once`)
    requireText(template.name, `${moduleId} automation template ${template.id} requires a name`)
    requireText(template.description, `${moduleId} automation template ${template.id} requires a description`)
    if (!capabilityIdPattern.test(template.triggerId))
      throw new Error(`${moduleId} automation template ${template.id} requires a valid trigger`)
    if (!['work', 'review', 'improve'].includes(template.threadAction))
      throw new Error(`${moduleId} automation template ${template.id} requires a valid agent flow`)
    if (
      !Array.isArray(template.promptSteps) ||
      !template.promptSteps.length ||
      template.promptSteps.some((step) => !step.name?.trim() || !step.prompt?.trim())
    ) {
      throw new Error(`${moduleId} automation template ${template.id} requires at least one complete prompt phase`)
    }
    if (template.threadAction === 'improve' && template.promptSteps.length !== 1)
      throw new Error(`${moduleId} improve template ${template.id} requires exactly one review brief`)
    templateIds.add(template.id)
  }
  const declaredActions = new Set((contributes?.actions || []).map((action) => action.id))
  const actionIds = new Set<string>()
  for (const action of ui.contextualActions || []) {
    if (!capabilityIdPattern.test(action.id)) throw new Error(`${moduleId} has an invalid contextual action id: ${action.id}`)
    if (actionIds.has(action.id)) throw new Error(`${moduleId} declares contextual action ${action.id} more than once`)
    if (!declaredActions.has(action.capabilityId))
      throw new Error(`${moduleId} contextual action ${action.id} references undeclared capability ${action.capabilityId}`)
    requireText(action.label, `${moduleId} contextual action ${action.id} requires a label`)
    if (
      !Array.isArray(action.placements) ||
      !action.placements.length ||
      action.placements.some((placement) => typeof placement !== 'string' || !placement.trim())
    ) {
      throw new Error(`${moduleId} contextual action ${action.id} requires at least one placement`)
    }
    if (
      !Array.isArray(action.entityKinds) ||
      !action.entityKinds.length ||
      action.entityKinds.some((kind) => !resourceKindPattern.test(kind))
    ) {
      throw new Error(`${moduleId} contextual action ${action.id} requires valid entity kinds`)
    }
    if (action.confirmation?.level === 'typed' && !action.confirmation.confirmationField?.trim()) {
      throw new Error(`${moduleId} contextual action ${action.id} typed confirmation requires a confirmation field`)
    }
    for (const [input, field] of Object.entries(action.inputMapping || {})) {
      if (!resourceKindPattern.test(input) || typeof field !== 'string' || !field.trim())
        throw new Error(`${moduleId} contextual action ${action.id} has an invalid input mapping`)
    }
    for (const field of action.inputFields || []) {
      if (!resourceKindPattern.test(field.name)) throw new Error(`${moduleId} contextual action ${action.id} has an invalid input field`)
      requireText(field.label, `${moduleId} contextual action ${action.id} input field ${field.name} requires a label`)
      if (field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 1_000_000)) {
        throw new Error(`${moduleId} contextual action ${action.id} input field ${field.name} has an invalid maximum length`)
      }
    }
    for (const condition of action.conditions || []) {
      requireText(condition.field, `${moduleId} contextual action ${action.id} condition requires a field`)
      if (['equals', 'not_equals', 'in', 'not_in'].includes(condition.operator) && condition.value === undefined) {
        throw new Error(`${moduleId} contextual action ${action.id} condition ${condition.field} requires a value`)
      }
    }
    for (const followUp of action.followUpCapabilityIds || []) {
      if (!declaredActions.has(followUp))
        throw new Error(`${moduleId} contextual action ${action.id} references undeclared follow-up capability ${followUp}`)
    }
    actionIds.add(action.id)
  }
}

function validateProviders(providers: ProviderDeclaration[] | undefined, moduleId: string) {
  if (!providers) return
  const seen = new Set<string>()
  for (const provider of providers) {
    if (!moduleIdPattern.test(provider.kind)) throw new Error(`${moduleId} has an invalid provider kind: ${provider.kind}`)
    if (!moduleIdPattern.test(provider.id)) throw new Error(`${moduleId} has an invalid provider id: ${provider.id}`)
    requireText(provider.name, `${moduleId} provider ${provider.id} requires a name`)
    const key = `${provider.kind}:${provider.id}`
    if (seen.has(key)) throw new Error(`${moduleId} declares provider ${key} more than once`)
    seen.add(key)
  }
}

function validateAgents(agents: AgentDeclaration[] | undefined, moduleId: string) {
  if (!agents) return
  const seen = new Set<string>()
  const accents = new Set<PresentationAccent>(['neutral', 'blue', 'cyan', 'violet', 'emerald', 'amber', 'orange', 'rose'])
  for (const agent of agents) {
    if (!moduleIdPattern.test(agent.id)) throw new Error(`${moduleId} has an invalid agent id: ${agent.id}`)
    requireText(agent.name, `${moduleId} agent ${agent.id} requires a name`)
    if (agent.accent && !accents.has(agent.accent)) throw new Error(`${moduleId} agent ${agent.id} has an invalid accent`)
    if (seen.has(agent.id)) throw new Error(`${moduleId} declares agent ${agent.id} more than once`)
    seen.add(agent.id)
  }
}

function validateIdentity(manifest: ModuleManifest) {
  if (!manifest || !moduleIdPattern.test(manifest.id)) throw new Error('Modules require a kebab-case manifest id')
  requireText(manifest.name, `${manifest.id} requires a name`)
  if (!semanticVersionPattern.test(manifest.version)) throw new Error(`${manifest.id} requires a semantic version`)
  if (manifest.platformApi !== PLATFORM_API_VERSION)
    throw new Error(`${manifest.id} requires unsupported platform API ${String(manifest.platformApi)}`)
  if (!moduleIdPattern.test(manifest.kind)) throw new Error(`${manifest.id} has an invalid kind`)
}

function validatePermissions(permissions: string[] | undefined, moduleId: string) {
  if (!permissions) return
  const invalid = permissions.find((permission) => !capabilityIdPattern.test(permission))
  if (invalid) throw new Error(`${moduleId} has an invalid permission: ${invalid}`)
  if (new Set(permissions).size !== permissions.length) throw new Error(`${moduleId} declares a permission more than once`)
  const unknown = permissions.find((permission) => !(EXTENSION_PERMISSIONS as readonly string[]).includes(permission))
  if (unknown) throw new Error(`${moduleId} declares an unsupported permission: ${unknown}`)
}

function validateRequirements(requires: ModuleManifest['requires'], moduleId: string) {
  const features = requires?.platformFeatures
  if (features) {
    if (new Set(features).size !== features.length) throw new Error(`${moduleId} requires a platform feature more than once`)
    const unsupported = features.find((feature) => !(PLATFORM_FEATURES as readonly string[]).includes(feature))
    if (unsupported) throw new Error(`${moduleId} requires unsupported platform feature ${unsupported}`)
  }
  for (const [label, values] of [
    ['primitive', requires?.parts?.primitives],
    ['capability', requires?.parts?.capabilities],
  ] as const) {
    if (!values) continue
    if (new Set(values).size !== values.length) throw new Error(`${moduleId} requires a ${label} more than once`)
    const invalid = values.find((value) => !capabilityIdPattern.test(value))
    if (invalid) throw new Error(`${moduleId} requires an invalid ${label}: ${invalid}`)
  }
  for (const provider of requires?.parts?.providers || []) {
    if (!capabilityIdPattern.test(provider.kind) || !capabilityIdPattern.test(provider.id))
      throw new Error(`${moduleId} requires an invalid provider part`)
  }
}

function validatePrimitives(primitives: CapabilityPrimitiveDeclaration[] | undefined, moduleId: string) {
  if (!primitives) return
  const seen = new Set<string>()
  for (const primitive of primitives) {
    if (!capabilityIdPattern.test(primitive.id)) throw new Error(`${moduleId} has an invalid primitive id: ${primitive.id}`)
    if (seen.has(primitive.id)) throw new Error(`${moduleId} declares primitive ${primitive.id} more than once`)
    requireText(primitive.name, `${moduleId} primitive ${primitive.id} requires a name`)
    seen.add(primitive.id)
  }
}

export function validateModuleManifest(manifest: ModuleManifest): ModuleManifest {
  validateIdentity(manifest)
  validateCatalog(manifest.catalog, manifest.id)
  validateNavigation(manifest.navigation, manifest.id)
  validateContributions(manifest.contributes, manifest.id)
  validatePrimitives(manifest.primitives, manifest.id)
  validateUiContributions(manifest.ui, manifest.contributes, manifest.id)
  validateProviders(manifest.providers, manifest.id)
  validateAgents(manifest.agents, manifest.id)
  validatePermissions(manifest.permissions, manifest.id)
  const setupIds = new Set<string>()
  for (const check of manifest.setupChecks || []) {
    if (!capabilityIdPattern.test(check.id) || setupIds.has(check.id))
      throw new Error(`${manifest.id} has an invalid or duplicate setup check: ${check.id}`)
    requireText(check.name, `${manifest.id} setup check ${check.id} requires a name`)
    requireText(check.command, `${manifest.id} setup check ${check.id} requires a command`)
    requireText(check.install, `${manifest.id} setup check ${check.id} requires install guidance`)
    if (!Array.isArray(check.args) || check.args.some((argument) => typeof argument !== 'string'))
      throw new Error(`${manifest.id} setup check ${check.id} has invalid arguments`)
    setupIds.add(check.id)
  }
  validateRequirements(manifest.requires, manifest.id)
  validatePortableManifest(manifest.portable, manifest.id)
  return manifest
}
