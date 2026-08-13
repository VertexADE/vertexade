import { appendFile, readFile, mkdir, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { and, asc, eq } from 'drizzle-orm'
import { ensureEncryptionKey } from './encrypted-settings.ts'
import { loadModulePlatform } from './server/platform/load-platform.ts'
import {
  isCodeReviewKind,
  isReviewSnapshotCurrent,
  reviewRerunSelection,
  reviewSummaryPrompt,
  shouldStartReviewSummary,
} from './server/reviews.ts'
import { automaticReviewCapacity, automaticReviewLaunchAllowed, automaticReviewTrigger } from './server/automatic-review-queue.ts'
import { isCompleteDetailedReview, resolveDetailedReviewOutput } from './server/review-output.ts'
import {
  aggregateReviewPrompt,
  hardReviewChecks,
  qualityScorecardReviewContract,
  repositoryTopologyReviewContract,
  reviewIntentContract,
} from './server/review-prompt-contract.ts'
import { migrateAgentEnvironmentsV1, trustWorkspaceMiseConfigs } from '@vertexade/platform-server/agents'
import { vertexDataDirectory } from '@vertexade/platform-server/configuration'
import { guardedIntegrationFetch } from '@vertexade/platform-server/outbound-policy'
import {
  resolveScmPresentation,
  type Agent,
  type PlanningRefinementRequest,
  type PlanningWorkflowRequest,
} from '@vertexade/platform-contracts'
import type { AgentRegistry } from './server/agents/registry.ts'
import type { DashboardExtensionHostServices } from './server/extensions/host-services.ts'
import { ExtensionCacheStore } from './server/extensions/cache.ts'
import { initializeExtensionStateStore, startExtensionState } from './server/extensions/state-coordinator.ts'
import { WorkService } from './server/work/service.ts'
import { handleWorkApi } from './server/work/http.ts'
import { createWorkCleanup, legacyLogRoots } from './server/work/cleanup.ts'
import { withWorktreeOwnershipRepair } from './server/work/worktree-ownership.ts'
import { localizePromptImages } from './server/prompt-images.ts'
import { invalidateLogEventContext, readLogEventContext } from './server/log-files.ts'
import { processStartIdentity, processWorkingDirectory } from './server/process.ts'
import { agentSafetyBoundary, untrustedExternalTask } from './server/prompts/security.ts'
import { contextTransferPrompt, contextTransferSnapshot } from './server/work/context-transfer.ts'
import { WorkMemoryService } from './server/work/memory.ts'
import { jobSessionCwd, parseWorkItemWorkspaceMode, relativeWorktreePath, workItemWorkspaceLayout } from './server/work/workspace-layout.ts'
import { createCoreRoutes } from './server/core-routes.ts'
import { inspectRepositoryEnvironmentEntries, snapshotRepositoryEnvironment } from './server/repository-environment.ts'
import { worktreeCodeReviewPrompt } from './server/work/prompts.ts'
import { WorktreePreviewRuntime, normalizePreviewSettings } from './server/previews/runtime.ts'
import { WorktreePreviewGateway } from './server/previews/gateway.ts'
import { openDashboardDatabase } from './server/database/dashboard-database.ts'
import { jobRecord, repositoryRecord } from './server/database/contract-records.ts'
import { jobs, notifications, pullRequests, repositories, reviewBatches, workItems } from './server/database/schema/tables.ts'
import { DashboardEvents, configuredDashboardEventLimits } from './server/events/dashboard-events.ts'
import { createDashboardApiDispatcher, createDashboardRequestHandler } from './server/dashboard/request-handler.ts'
import { createPullRequestDetailsCache } from './server/dashboard/pr-details-cache.ts'
import { createPreviewTargetResolver } from './server/dashboard/preview-target.ts'
import {
  reviewAutomationSettings as readReviewAutomationSettings,
  resolveThreadRuntime,
  worktreePreviewSettings as readWorktreePreviewSettings,
} from './server/dashboard/runtime-settings.ts'
import { backfillJobActivity, createJobDiffStore } from './server/dashboard/job-state.ts'
import {
  agentLogPath as createAgentLogPath,
  body,
  configureCommandResolver,
  json,
  run,
  runResult,
} from './server/dashboard/server-utils.ts'
import { createProviderSelectionRuntime } from './server/dashboard/provider-selection-runtime.ts'
import { createJobLogQuery } from './server/dashboard/job-log-query.ts'
import { createExtensionMigrationStore } from './server/dashboard/extension-migration-store.ts'
import { EncryptedSettingsStore, JsonSettingsStore } from './server/settings/settings-store.ts'
import { MobilePairingService } from './server/settings/mobile-pairing.ts'
import { RepositoryEnvironmentProfileService } from './server/repository-environment-profiles.ts'
import { createGitHubRepositoryCredentialResolver, repositoryCredentialEnvironment } from './server/github-repository-credentials.ts'
import { SystemConfiguration } from './server/settings/system-configuration.ts'
import { createPlatformManagementRoutes } from './server/platform/management-routes.ts'
import { normalizeGeneratedWorkItemTitle, workItemTitlePrompt } from './server/platform/work-item-title.ts'
import { createWorkspaceRoutes } from './server/platform/workspace-routes.ts'
import { NotificationService } from './server/notifications/service.ts'
import { createNotificationRoutes } from './server/notifications/routes.ts'
import { JobLifecycle } from './server/workflows/job-lifecycle.ts'
import { AutomationRecipeService } from './server/workflows/automation-recipes.ts'
import { createAutomationRoutes } from './server/workflows/automation-routes.ts'
import { CoreAutomationTriggers } from './server/workflows/core-automation-triggers.ts'
import { registerCoreAutomationActions } from './server/workflows/core-automation-actions.ts'
import { createAutomationThreadLauncher } from './server/workflows/automation-thread-launcher.ts'
import { publishAgentControlEvent, sendAgentControlCommand } from './server/agents/live-control.ts'
import { agentThreadContext, mergeAgentThreadContext } from './server/agents/thread-context.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions } from './server/agents/resources.ts'
import { createAgentResourceRoutes } from './server/agents/resource-routes.ts'
import { CustomAgentSynchronizer } from './server/agents/custom-agents.ts'
import { SubagentHarness } from './server/agents/subagent-harness.ts'
import { createAgentThreadSpawner } from './server/agents/agent-thread-spawner.ts'
import { createSubagentWorkspace, integrateSubagentWorkspace } from './server/agents/subagent-workspace.ts'
import { createReadOnlyContentGenerator } from './server/agents/content-generation.ts'
import { createDiffPreview, storedDiffSummary } from './server/diff-preview.ts'
import { JobFollowUpQueue } from './server/job-follow-up-queue.ts'
import { createDevelopmentRuntime } from './server/development/runtime.ts'
import { DashboardReadModelStore, type DashboardReadModelEntry } from './server/read-model/dashboard-read-model.ts'
import {
  persistedThreadContext,
  readModelEntry,
  threadSummaries,
  dashboardReadModel,
  initializeDashboardReadModel,
  hslToHex,
  ensureServiceColors,
  renderPreset,
  promptSelection,
  resolvePrompt,
  codeReviewPrompt,
  taskTarget,
  findOrAddRepository,
  deploymentOverview,
  workDeploymentSyncRunning,
  refreshWorkDeployments,
  pathWithin,
  storedPreviewJob,
  previewRuntimeAgent,
  assertManagedPreviewPath,
  requirePreviewJob,
  assertRecordedPreviewRepository,
} from './server/dashboard/read-model.ts'
import type { PromptSelection, ResolvedPrompt } from './server/dashboard/read-model.ts'
import {
  launchRepositoryTask,
  startMonitoredJob,
  startThreadRecoveryTimers,
  launchStackAnalysis,
  launchPlanningWorkflow,
  followUpJob,
  drainJobFollowUpQueue,
  contextTransferTargets,
  followUpInWorktree,
  retryJob,
  refinePlanningWorkflow,
  forkThreadJob,
  withAgentMetadata,
  steerResponse,
} from './server/dashboard/thread-runtime.ts'
import {
  generateWorkItemTitle,
  localizeAgentPrompt,
  parseRepo,
  allowedBranchTypes,
  usesReviewWorkspace,
  scmUser,
  automaticReviewQueueState,
  enqueueAutomaticReview,
  drainAutomaticReviewQueue,
  startAutomaticReviewQueue,
  syncRepository,
  refreshAllRepositories,
  startRepositoryRefreshTimer,
  refreshMergedThreadState,
  startMergedThreadRefreshTimer,
  deleteThreadJob,
  pullRequestDetails,
  pullRequestContext,
  publishReviewMutation,
  repositoryLabels,
  repositoryReviewers,
  ensureClone,
  configureRepositoryCredentialResolver,
  bootstrapAgentRepository,
  repositoryAgentBootstrapped,
  failReviewSummary,
  startReviewSummaryFollowUp,
  repairStoredReviewDetails,
} from './server/dashboard/repository-runtime.ts'
import {
  monitorJobProcess,
  extractReviewSuggestions,
  postAutomaticReviewToGitHub,
  cleanupFailedLaunch,
  createAgentWorktree,
  launchWorktreeReview,
  linkImplementationBranch,
  launchJob,
  updateReviewBatchForJob,
  maybeLaunchReviewAggregate,
  launchAutomaticReview,
  launchReviewSelection,
} from './server/dashboard/review-runtime.ts'
import { handleSystemApi } from './server/dashboard/system-api.ts'
import { handlePullRequestApi } from './server/dashboard/pull-request-api.ts'
import { handleThreadApi } from './server/dashboard/thread-api.ts'
import { configureDashboardRuntime, setDashboardReadModelStore } from './server/dashboard/runtime-context.ts'
import { stopDashboardRuntimeResources } from './server/dashboard/runtime-stop.ts'
const MONOREPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const ROOT = resolve(process.env.APP_ROOT || MONOREPO_ROOT)
const DATA = vertexDataDirectory()
const REPOS = join(homedir(), 'repos')
const LOGS = join(DATA, 'logs')
const PROMPT_IMAGES = join(DATA, 'prompt-images')
const WORK_MEMORY = join(DATA, 'work-memory')
const DEPLOYMENT_RECORD = join(DATA, 'deployment.json')
const API_TOKEN = process.env.VERTEXADE_API_TOKEN || process.env.DASHBOARD_API_TOKEN || ''
const INTERNAL_API_URL = process.env.VERTEXADE_INTERNAL_API_URL || `http://127.0.0.1:${process.env.API_PORT || 4174}`
const authenticatedScmUsers = new Map<string, { login: string; avatar_url?: string }>()
const activeJobs = new Map<any, any>()
const cancellingJobs = new Set<number>()
const MAX_AGENT_EVENT_LINE_BYTES = 1024 * 1024
const prDetailsCache = createPullRequestDetailsCache()
const agentLaunchContext = new AsyncLocalStorage<{
  agentId?: string
  model?: string
  reasoningEffort?: string
  serviceTier?: string
  ephemeral?: boolean
  allowSubagents?: boolean
}>()
let agents: AgentRegistry
let agentProvider: string
let agent: Readonly<Agent>
let agentResources: AgentResourceService
let subagentHarness: SubagentHarness
let work: WorkService
let workMemory: WorkMemoryService
let workCleanup: ReturnType<typeof createWorkCleanup>
let worktreePreviews: WorktreePreviewRuntime
const previewGateway = new WorktreePreviewGateway()
const dashboardEvents = new DashboardEvents(configuredDashboardEventLimits())
let coreAutomationTriggers: CoreAutomationTriggers | undefined
let dashboardReadModelStore: DashboardReadModelStore | undefined
function notifyClients(reason, jobId = null) {
  dashboardEvents.emit(reason, jobId)
  coreAutomationTriggers?.emit(reason, jobId)
  dashboardReadModelStore?.schedule()
}
await Promise.all([DATA, REPOS, LOGS, PROMPT_IMAGES, WORK_MEMORY].map((dir) => mkdir(dir, { recursive: true })))
const SETTINGS_KEY_PATH = process.env.SETTINGS_KEY_PATH || join(DATA, 'settings.key')
const SETTINGS_KEY = await ensureEncryptionKey(SETTINGS_KEY_PATH)
const db = openDashboardDatabase(join(DATA, 'dashboard.sqlite'))
const jobFollowUps = new JobFollowUpQueue(db)
const drainingJobFollowUps = new Set<number>()
const jobLogStatement = createJobLogQuery(db)
const jobLifecycle = new JobLifecycle(db)
const encryptedSettings = new EncryptedSettingsStore(db, SETTINGS_KEY)
const githubCredentialsForRepository = createGitHubRepositoryCredentialResolver(encryptedSettings)
configureRepositoryCredentialResolver(githubCredentialsForRepository)
const mobilePairing = new MobilePairingService(encryptedSettings)
const appSettings = new JsonSettingsStore(db)
const worktreePreviewSettings = () => readWorktreePreviewSettings(appSettings)
const systemConfiguration = new SystemConfiguration(appSettings)
configureCommandResolver((command) => systemConfiguration.tool(command))
const repositoryEnvironments = new RepositoryEnvironmentProfileService(db, encryptedSettings, run)
worktreePreviews = new WorktreePreviewRuntime({
  db,
  dataDirectory: DATA,
  run,
  settings: worktreePreviewSettings,
  environment: (repositoryId, targetPath) => repositoryEnvironments.resolve(repositoryId, targetPath),
  onChange: (reason, jobId) => notifyClients(reason, jobId),
})
const notificationService = new NotificationService(db, notifyClients)
const notificationRoutes = createNotificationRoutes(notificationService)
const extensionCache = new ExtensionCacheStore(1_000, () => notifyClients('extension_cache_updated'))
const stateStore = initializeExtensionStateStore(db, encryptedSettings)
const extensionHost: DashboardExtensionHostServices = {
  settings: encryptedSettings,
  repositories: {
    get(id) {
      const row = db.select().from(repositories).where(eq(repositories.id, id)).get()
      return row ? repositoryRecord(row) : null
    },
    list() {
      return db
        .select({ id: repositories.id, full_name: repositories.fullName })
        .from(repositories)
        .orderBy(asc(repositories.fullName))
        .all()
    },
  },
  tasks: {
    launch: (repository, title, prompt, createPullRequest, branchType, context) =>
      launchRepositoryTask(repository, title, prompt, createPullRequest, branchType, null, {
        workSource: context?.source || null,
        workKind: context?.kind || 'implementation',
        workspaceMode: context?.workspaceMode || 'combined',
      }),
    followUpInWorktree: (input) => followUpInWorktree(input),
    plan: (request) => launchPlanningWorkflow(request),
    refinePlan: (request) => refinePlanningWorkflow(request),
    planningJob(id, kind) {
      const row = db
        .select({ job: jobs, full_name: repositories.fullName })
        .from(jobs)
        .innerJoin(repositories, eq(repositories.id, jobs.repoId))
        .where(and(eq(jobs.id, id), eq(jobs.kind, kind)))
        .get()
      return row ? ({ ...jobRecord(row.job), full_name: row.full_name } as any) : null
    },
  },
  work: {
    create: (input) => work.create(input as any) as any,
    linkResource: (workItemId, resource) => work.linkResource(workItemId, resource),
    relate: (fromWorkItemId, toWorkItemId, relation) => work.relate(fromWorkItemId, toWorkItemId, relation),
    memory: (workItemId) => workMemory.read(workItemId),
    writeMemory: (workItemId, content) => workMemory.write(workItemId, content, 'extension'),
  },
  events: { emit: (reason, id = null) => notifyClients(reason, id) },
  network: { fetch: guardedIntegrationFetch },
  cache: extensionCache,
  workspacePreviews: {
    settings: worktreePreviewSettings,
    async updateSettings(input) {
      const previous = worktreePreviewSettings()
      try {
        const value = normalizePreviewSettings(input)
        await previewGateway.configure(value, previewTarget)
        appSettings.write('worktree_previews', value)
        worktreePreviews.refreshUrls(value)
        notifyClients('worktree_preview_settings_updated')
        return value
      } catch (error) {
        await previewGateway.configure(previous, previewTarget).catch(() => undefined)
        throw error
      }
    },
    async get(jobId) {
      await requirePreviewJob(jobId)
      return worktreePreviews.get(jobId)
    },
    async start(jobId) {
      return worktreePreviews.start(await requirePreviewJob(jobId))
    },
    async restart(jobId) {
      return worktreePreviews.restart(await requirePreviewJob(jobId))
    },
    async stop(jobId) {
      await requirePreviewJob(jobId)
      return worktreePreviews.stop(jobId)
    },
    async logs(jobId) {
      await requirePreviewJob(jobId)
      return worktreePreviews.logs(jobId)
    },
  },
}
if (!extensionHost.settings.has('migration:agent-environments-v1')) {
  migrateAgentEnvironmentsV1(extensionHost.settings, extensionHost.settings.read('agent_environments', {}))
  extensionHost.settings.delete('agent_environments')
  extensionHost.settings.write('migration:agent-environments-v1', true)
}
const extensions = await loadModulePlatform({
  root: ROOT,
  run,
  host: extensionHost,
  isEnabled: (id) => stateStore.desired(id, true),
  extensionDirectories: String(process.env.VERTEXADE_EXTENSION_DIRS || '')
    .split(delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean)
    .map((directory) => resolve(ROOT, directory)),
  migrationStore: createExtensionMigrationStore(db),
})
coreAutomationTriggers = new CoreAutomationTriggers(db, extensions.contributions)
coreAutomationTriggers.register()
registerCoreAutomationActions(db, extensions.contributions, {
  run,
  scm: (repository) => scmProvider(repository),
  created: async (repository) => {
    await syncRepository(repository)
  },
})
const {
  executions: capabilityExecutions,
  capabilityRoutes,
  developmentRoutes,
  migrationRoutes,
} = createDevelopmentRuntime({
  database: db,
  run,
  runResult,
  contributions: extensions.contributions,
  launchTask: launchRepositoryTask,
  notify: notifyClients,
  notifyExecutionFailure: (title, message) => notificationService.create('extension_failed', title, message),
  runtimeDefaults: () => systemConfiguration.read().runtime,
})
const workRuntime = (options) => resolveThreadRuntime(appSettings, agentProvider, 'workItem', options)
const reviewRuntime = (options) => resolveThreadRuntime(appSettings, agentProvider, 'review', options)
const automationThreadLauncher = createAutomationThreadLauncher(db, {
  launchWork: (target, prompt, options) => {
    const selectedRepositories = options.repositoryIds?.length
      ? options.repositoryIds
          .map((id) => db.select().from(repositories).where(eq(repositories.id, id)).get())
          .filter(Boolean)
          .map(repositoryRecord)
      : undefined
    return launchRepositoryTask(target.repository, target.title, prompt, false, options.branchType || 'feature', null, {
      workItemId: target.workItemId,
      workKind: options.workKind || 'implementation',
      workSource: options.source,
      ...workRuntime(options),
      allowSubagents: options.allowSubagents,
      permissionMode: options.source ? 'full' : undefined,
      githubWrite: Boolean(options.source),
      repositories: selectedRepositories || target.repositories,
    })
  },
  launchPullRequestWork: (repository, pullRequest, prompt, options) =>
    launchJob(repository, pullRequest, prompt, { kind: 'task', ...workRuntime(options) }),
  resumeWork: (jobId, prompt) => {
    const stored = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
    const job = stored ? jobRecord(stored) : null
    if (!job) throw new Error('The Improve thread is no longer available')
    return followUpJob(job, prompt, { reviewMode: false })
  },
  launchPullRequestReview: (repository, pullRequest, prompt, options) => {
    const runtime = reviewRuntime(options)
    return launchReviewSelection(repository, pullRequest, [runtime.agentId], null, {
      promptPrefix: prompt,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      serviceTier: runtime.serviceTier,
    })
  },
  launchWorktreeReview: (sourceJobId, workItemId, prompt, options) =>
    launchWorktreeReview(sourceJobId, {
      workItemId,
      focus: prompt,
      ...reviewRuntime(options),
    }),
})
const automationRecipes = new AutomationRecipeService(
  db,
  extensions.contributions,
  capabilityExecutions,
  (reason, id) => {
    notifyClients(reason, id)
    if (!id) return
    if (reason.startsWith('automation_schedule_')) {
      const recipe = automationRecipes.get(id)
      if (reason === 'automation_schedule_failed' && recipe) {
        notificationService.create(
          'automation_failed',
          `${recipe.name} failed`,
          recipe.lastError || 'The scheduled automation could not start',
          { automationRecipeId: recipe.id },
        )
      }
      return
    }
    const run = automationRecipes.getRun(id)
    const recipe = run ? automationRecipes.get(run.recipeId) : null
    if (reason === 'automation_flow_approval_requested' && run && recipe) {
      notificationService.create(
        'automation_approval_required',
        `${recipe.name} needs approval`,
        `Choose which of the ${run.improvementItems.length} proposed improvements this flow may implement in Settings → Automation.`,
        {
          jobId: run.threadJobId,
        },
      )
    }
    if (reason === 'automation_flow_approval_resolved' && run?.threadJobId) {
      db.delete(notifications)
        .where(and(eq(notifications.kind, 'automation_approval_required'), eq(notifications.jobId, run.threadJobId)))
        .run()
      notifyClients('notification_dismissed', run.threadJobId)
    }
    if (reason === 'automation_flow_failed' && recipe) {
      notificationService.create('automation_failed', `${recipe.name} failed`, recipe.lastError || 'Extension automation failed')
    }
  },
  () => systemConfiguration.read().runtime.automationMaxSteps,
  () => systemConfiguration.read().runtime.automationMaxConcurrentRuns,
  automationThreadLauncher,
  (jobId, prompt, metadata) => {
    jobFollowUps.enqueue(jobId, prompt, null, null, metadata)
    notifyClients('automation_flow_phase_queued', metadata.automationRunId)
    void drainJobFollowUpQueue(jobId)
  },
)
jobFollowUps.recoverFinishedJobs()
await automationRecipes.recoverRuns()
const automationRecoveryTimer = setInterval(() => {
  const staleBefore = new Date(Date.now() - 60 * 60_000).toISOString()
  void automationRecipes.recoverRuns(staleBefore).catch((error) => {
    console.error('Could not reconcile stale automation flows:', error)
  })
}, 5 * 60_000)
automationRecoveryTimer.unref()
const automationRoutes = createAutomationRoutes(automationRecipes)
const syncExtensionTriggers = () => automationRecipes.syncTriggers()
const extensionStateCoordinator = await startExtensionState(stateStore, extensions, syncExtensionTriggers, extensionCache, notifyClients)
agents = extensions.agents
const configuredAgentProvider = process.env.AGENT_PROVIDER || process.env.AI_PROVIDER || 'codex'
const configuredAgent = agents.capabilities().find(({ id }) => id === configuredAgentProvider)
if (!configuredAgent) throw new Error(`Unknown configured agent extension: ${configuredAgentProvider}`)
agentProvider = configuredAgent.enabled ? configuredAgentProvider : agents.capabilities().find(({ enabled }) => enabled)?.id
if (!agentProvider) throw new Error('At least one agent extension must be enabled')
agent = agents.require(agentProvider)
await Promise.all(agents.capabilities().map(({ id }) => mkdir(agents.get(id).workspaceRoot, { recursive: true })))
const { selectedProviderId, extensionEnabled, scmProvider } = createProviderSelectionRuntime({
  database: db,
  extensions,
  settings: encryptedSettings,
  state: extensionStateCoordinator,
})
const coreRoutes = createCoreRoutes({
  database: db,
  deploymentRecordPath: DEPLOYMENT_RECORD,
  promptImagesDirectory: PROMPT_IMAGES,
  systemConfiguration,
  workspacePreviews: {
    read: worktreePreviewSettings,
    write: async (input) => normalizePreviewSettings(await extensionHost.workspacePreviews.updateSettings(input)),
  },
  json,
  readBody: body,
  notify: notifyClients,
  setup: {
    run,
    selectedScm: () => scmProvider(),
    extensions: () => extensions.catalog(),
    agents: () => agents.capabilities(),
  },
})
const platformManagementRoutes = createPlatformManagementRoutes({
  extensions,
  agents,
  encryptedSettings,
  cache: extensionCache,
  defaultAgentId: () => agentProvider,
  extensionEnabled,
  decorateExtension: (extension) => extensionStateCoordinator.decorate(extension),
  toggleExtension: (id, enabled) => extensionStateCoordinator.toggle(id, enabled),
  notify: notifyClients,
  generateWorkItemTitle,
})
const reviewAutomationSettings = () => readReviewAutomationSettings(appSettings, agentProvider)
const previewTarget = createPreviewTargetResolver(db)
export async function startDashboardPreviewGateway() {
  await worktreePreviews.reconcile()
  await previewGateway.configure(worktreePreviewSettings(), previewTarget)
}
export const stopDashboardRuntime = () =>
  stopDashboardRuntimeResources(automationRecoveryTimer, workCleanup, dashboardReadModelStore, dashboardEvents, previewGateway)
const createNotification = notificationService.create.bind(notificationService)
work = new WorkService(
  db,
  (reason, workItemId) => {
    notifyClients(reason, workItemId)
    if (reason === 'work_item_created' && workItemId)
      void workMemory?.ensure(workItemId).catch((error) => console.error(`Could not initialize Work memory for #${workItemId}:`, error))
  },
  {
    scm(repository) {
      const provider = scmProvider(repository.full_name)
      return {
        id: provider.id,
        repositoryUrl: provider.parseRepository(repository.full_name).webUrl,
      }
    },
    deployment: () => ({ id: selectedProviderId('deployment') }),
    runKindWorkKind: (kind) =>
      (extensions
        .catalog()
        .filter(({ enabled }) => enabled)
        .flatMap(({ ui }) => ui?.runKinds || [])
        .find((presentation) => presentation.kind === kind)?.workKind as any) || null,
  },
)
work.initialize()
agentResources = new AgentResourceService(db, encryptedSettings, run, (id) => Boolean(agents.get(id)))
agentResources.initialize()
const customAgents = new CustomAgentSynchronizer(agents, agentResources)
customAgents.sync()
const agentResourceRoutes = createAgentResourceRoutes(agentResources, () => customAgents.sync())
async function resolveAgentLaunch(workItemId, prompt, agentId = agentLaunchContext.getStore()?.agentId) {
  const profile = agentResources.profileForAgent(agentId)
  const resources = workItemId ? await agentResources.resolve(workItemId, agentId) : { skills: [], mcpServers: [] }
  const profilePrompt = applyCustomAgentPrompt(prompt, profile)
  return {
    prompt: applySkillInstructions(profilePrompt, resources),
    mcpServers: resources.mcpServers,
    resourceSummary: { skills: resources.skills.map((skill) => skill.name), mcpServers: resources.mcpServers.map((server) => server.name) },
  }
}
subagentHarness = new SubagentHarness({
  database: db,
  agents,
  activeJobs,
  cancellingJobs,
  logsRoot: LOGS,
  apiUrl: INTERNAL_API_URL,
  notify: notifyClients,
  resolveLaunch: resolveAgentLaunch,
  createWorkspace: (parent) =>
    createSubagentWorkspace(parent, {
      repository: (id) => {
        const row = db.select().from(repositories).where(eq(repositories.id, id)).get()
        return row ? repositoryRecord(row) : null
      },
      run,
    }),
  discardWorkspace: async () => undefined,
  integrateWorkspace: (parent, child) => integrateSubagentWorkspace(parent, child, { run }),
  startChild: (options) => startMonitoredJob(options),
})
const agentLogPath = (workItem, repository, suffix) => createAgentLogPath(LOGS, workItem, repository, suffix)
const workspaceRoutes = createWorkspaceRoutes({
  database: db,
  extensions,
  executions: capabilityExecutions,
})
workMemory = new WorkMemoryService(WORK_MEMORY, work, (workItemId) => notifyClients('work_memory_updated', workItemId))
await Promise.all(
  db
    .select({ id: workItems.id })
    .from(workItems)
    .all()
    .map((item) => workMemory.ensure(item.id)),
)
workCleanup = createWorkCleanup({
  db,
  work,
  memory: workMemory,
  agents,
  defaultAgentId: agentProvider,
  activeJobs,
  logsRoot: LOGS,
  legacyLogsRoots: legacyLogRoots(process.env.VERTEXADE_LEGACY_LOG_ROOTS),
  run,
  invalidateLog: invalidateLogEventContext,
  beforeRemoveJobs: async (jobs) => {
    for (const job of jobs) await worktreePreviews.stopAndWait(job.id)
  },
  notify: notifyClients,
})
workCleanup.startRecovery()
await automationRecipes.syncTriggers()
const storeJobDiff = createJobDiffStore(db, notifyClients)
await backfillJobActivity(db, agents, agent)
const requestedAgent = () => agents.require(agentLaunchContext.getStore()?.agentId || agentProvider)
const spawnAgentThread = createAgentThreadSpawner({
  agents,
  defaultAgentId: agentProvider,
  launchContext: agentLaunchContext,
  localize: localizeAgentPrompt,
  decorate: (jobId, options) => subagentHarness.decorateLaunch(jobId, options),
  resolveCommand: (command) => systemConfiguration.tool(command),
  tools: () => systemConfiguration.read().tools,
  environment: (cwd, jobId) => repositoryCredentialEnvironment(db, githubCredentialsForRepository, cwd, jobId),
})
const runReadOnlyContentGeneration = createReadOnlyContentGenerator({
  agents,
  dataDirectory: DATA,
  spawnAgentThread,
})
configureDashboardRuntime({
  API_TOKEN,
  LOGS,
  MAX_AGENT_EVENT_LINE_BYTES,
  PROMPT_IMAGES,
  REPOS,
  activeJobs,
  agent,
  agentLaunchContext,
  agentLogPath,
  agentProvider,
  agentResourceRoutes,
  agentResources,
  agents,
  allowedBranchTypes,
  appSettings,
  assertManagedPreviewPath,
  assertRecordedPreviewRepository,
  authenticatedScmUsers,
  automaticReviewQueueState,
  automationRecipes,
  body,
  bootstrapAgentRepository,
  cancellingJobs,
  cleanupFailedLaunch,
  codeReviewPrompt,
  contextTransferTargets,
  coreRoutes,
  createAgentWorktree,
  createNotification,
  dashboardReadModel,
  dashboardReadModelStore,
  db,
  deleteThreadJob,
  deploymentOverview,
  drainAutomaticReviewQueue,
  drainJobFollowUpQueue,
  drainingJobFollowUps,
  enqueueAutomaticReview,
  ensureClone,
  ensureServiceColors,
  extensions,
  extractReviewSuggestions,
  failReviewSummary,
  findOrAddRepository,
  followUpInWorktree,
  followUpJob,
  forkThreadJob,
  hslToHex,
  initializeDashboardReadModel,
  jobFollowUps,
  jobLifecycle,
  jobLogStatement,
  json,
  launchAutomaticReview,
  launchJob,
  launchRepositoryTask,
  launchReviewSelection,
  launchStackAnalysis,
  launchWorktreeReview,
  linkImplementationBranch,
  monitorJobProcess,
  mobilePairing,
  notifyClients,
  parseRepo,
  pathWithin,
  persistedThreadContext,
  postAutomaticReviewToGitHub,
  prDetailsCache,
  previewRuntimeAgent,
  promptSelection,
  publishReviewMutation,
  pullRequestContext,
  pullRequestDetails,
  readModelEntry,
  refreshAllRepositories,
  refreshMergedThreadState,
  refreshWorkDeployments,
  renderPreset,
  repositoryAgentBootstrapped,
  repositoryEnvironments,
  repositoryLabels,
  repositoryReviewers,
  requestedAgent,
  requirePreviewJob,
  resolveAgentLaunch,
  resolvePrompt,
  retryJob,
  reviewAutomationSettings,
  run,
  runReadOnlyContentGeneration,
  scmProvider,
  scmUser,
  selectedProviderId,
  spawnAgentThread,
  startMonitoredJob,
  startReviewSummaryFollowUp,
  steerResponse,
  storeJobDiff,
  storedPreviewJob,
  syncRepository,
  systemConfiguration,
  taskTarget,
  threadSummaries,
  updateReviewBatchForJob,
  usesReviewWorkspace,
  withAgentMetadata,
  work,
  workCleanup,
  workDeploymentSyncRunning,
  workMemory,
  worktreePreviews,
})
startAutomaticReviewQueue()
startRepositoryRefreshTimer()
startMergedThreadRefreshTimer()
repairStoredReviewDetails()
setInterval(() => {
  for (const batch of db.select({ id: reviewBatches.id }).from(reviewBatches).where(eq(reviewBatches.status, 'pending')).all())
    void maybeLaunchReviewAggregate(batch.id)
}, 15_000).unref()
startThreadRecoveryTimers()
automationRecipes.startScheduleTimers()
dashboardReadModelStore = initializeDashboardReadModel()
setDashboardReadModelStore(dashboardReadModelStore)
const api = createDashboardApiDispatcher([handleSystemApi, handlePullRequestApi, handleThreadApi], () => json(404, { error: 'Not found' }))
export const handleDashboardRequest = createDashboardRequestHandler({
  agents,
  agentProvider,
  launchContext: agentLaunchContext,
  events: dashboardEvents,
  subagentDispatch: (request) => subagentHarness.dispatch(request),
  coreRouters: [
    platformManagementRoutes,
    capabilityRoutes,
    developmentRoutes,
    migrationRoutes,
    automationRoutes,
    workspaceRoutes,
    notificationRoutes,
  ],
  extensionDispatch: (request) => extensions.routes.dispatch(request),
  api,
})
