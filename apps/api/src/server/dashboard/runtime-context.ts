import type { MobilePairingService } from '../settings/mobile-pairing.ts'

type DashboardRuntimeBindings = Record<string, any>

export let runtimeAPI_TOKEN: any
export let runtimeLOGS: any
export let runtimeMAX_AGENT_EVENT_LINE_BYTES: any
export let runtimePROMPT_IMAGES: any
export let runtimeREPOS: any
export let runtimeActiveJobs: any
export let runtimeAgent: any
export let runtimeAgentLaunchContext: any
export let runtimeAgentLogPath: any
export let runtimeAgentProvider: any
export let runtimeAgentResourceRoutes: any
export let runtimeAgentResources: any
export let runtimeAgents: any
export let runtimeAllowedBranchTypes: any
export let runtimeAppSettings: any
export let runtimeAuthenticatedScmUsers: any
export let runtimeAutomaticReviewQueueState: any
export let runtimeAutomationRecipes: any
export let runtimeBody: any
export let runtimeBootstrapAgentRepository: any
export let runtimeCancellingJobs: any
export let runtimeCleanupFailedLaunch: any
export let runtimeCodeReviewPrompt: any
export let runtimeContextTransferTargets: any
export let runtimeCoreRoutes: any
export let runtimeCreateAgentWorktree: any
export let runtimeCreateNotification: any
export let runtimeDashboardReadModelStore: any
export let runtimeDb: any
export let runtimeDeleteThreadJob: any
export let runtimeDeploymentOverview: any
export let runtimeDrainAutomaticReviewQueue: any
export let runtimeDrainJobFollowUpQueue: any
export let runtimeDrainingJobFollowUps: any
export let runtimeEnqueueAutomaticReview: any
export let runtimeEnsureClone: any
export let runtimeExtensions: any
export let runtimeExtractReviewSuggestions: any
export let runtimeFailReviewSummary: any
export let runtimeFindOrAddRepository: any
export let runtimeFollowUpInWorktree: any
export let runtimeFollowUpJob: any
export let runtimeForkThreadJob: any
export let runtimeJobFollowUps: any
export let runtimeJobLifecycle: any
export let runtimeJobLogStatement: any
export let runtimeJson: any
export let runtimeLaunchAutomaticReview: any
export let runtimeLaunchJob: any
export let runtimeLaunchRepositoryTask: any
export let runtimeLaunchReviewSelection: any
export let runtimeLaunchStackAnalysis: any
export let runtimeLaunchWorktreeReview: any
export let runtimeLinkImplementationBranch: any
export let runtimeMonitorJobProcess: any
export let runtimeMobilePairing: MobilePairingService
export let runtimeNotifyClients: any
export let runtimeParseRepo: any
export let runtimePersistedThreadContext: any
export let runtimePostAutomaticReviewToGitHub: any
export let runtimePrDetailsCache: any
export let runtimePromptSelection: any
export let runtimePublishReviewMutation: any
export let runtimePullRequestContext: any
export let runtimePullRequestDetails: any
export let runtimeRefreshAllRepositories: any
export let runtimeRefreshMergedThreadState: any
export let runtimeRepositoryAgentBootstrapped: any
export let runtimeRepositoryEnvironments: any
export let runtimeRepositoryLabels: any
export let runtimeRepositoryReviewers: any
export let runtimeRequestedAgent: any
export let runtimeResolveAgentLaunch: any
export let runtimeResolvePrompt: any
export let runtimeRetryJob: any
export let runtimeReviewAutomationSettings: any
export let runtimeRun: any
export let runtimeRunReadOnlyContentGeneration: any
export let runtimeScmProvider: any
export let runtimeScmUser: any
export let runtimeSelectedProviderId: any
export let runtimeSpawnAgentThread: any
export let runtimeStartMonitoredJob: any
export let runtimeStartReviewSummaryFollowUp: any
export let runtimeSteerResponse: any
export let runtimeStoreJobDiff: any
export let runtimeSyncRepository: any
export let runtimeSystemConfiguration: any
export let runtimeTaskTarget: any
export let runtimeThreadSummaries: any
export let runtimeUpdateReviewBatchForJob: any
export let runtimeUsesReviewWorkspace: any
export let runtimeWithAgentMetadata: any
export let runtimeWork: any
export let runtimeWorkCleanup: any
export let runtimeWorkMemory: any
export let runtimeWorktreePreviews: any

export function configureDashboardRuntime(values: DashboardRuntimeBindings) {
  runtimeAPI_TOKEN = values.API_TOKEN
  runtimeLOGS = values.LOGS
  runtimeMAX_AGENT_EVENT_LINE_BYTES = values.MAX_AGENT_EVENT_LINE_BYTES
  runtimePROMPT_IMAGES = values.PROMPT_IMAGES
  runtimeREPOS = values.REPOS
  runtimeActiveJobs = values.activeJobs
  runtimeAgent = values.agent
  runtimeAgentLaunchContext = values.agentLaunchContext
  runtimeAgentLogPath = values.agentLogPath
  runtimeAgentProvider = values.agentProvider
  runtimeAgentResourceRoutes = values.agentResourceRoutes
  runtimeAgentResources = values.agentResources
  runtimeAgents = values.agents
  runtimeAllowedBranchTypes = values.allowedBranchTypes
  runtimeAppSettings = values.appSettings
  runtimeAuthenticatedScmUsers = values.authenticatedScmUsers
  runtimeAutomaticReviewQueueState = values.automaticReviewQueueState
  runtimeAutomationRecipes = values.automationRecipes
  runtimeBody = values.body
  runtimeBootstrapAgentRepository = values.bootstrapAgentRepository
  runtimeCancellingJobs = values.cancellingJobs
  runtimeCleanupFailedLaunch = values.cleanupFailedLaunch
  runtimeCodeReviewPrompt = values.codeReviewPrompt
  runtimeContextTransferTargets = values.contextTransferTargets
  runtimeCoreRoutes = values.coreRoutes
  runtimeCreateAgentWorktree = values.createAgentWorktree
  runtimeCreateNotification = values.createNotification
  runtimeDashboardReadModelStore = values.dashboardReadModelStore
  runtimeDb = values.db
  runtimeDeleteThreadJob = values.deleteThreadJob
  runtimeDeploymentOverview = values.deploymentOverview
  runtimeDrainAutomaticReviewQueue = values.drainAutomaticReviewQueue
  runtimeDrainJobFollowUpQueue = values.drainJobFollowUpQueue
  runtimeDrainingJobFollowUps = values.drainingJobFollowUps
  runtimeEnqueueAutomaticReview = values.enqueueAutomaticReview
  runtimeEnsureClone = values.ensureClone
  runtimeExtensions = values.extensions
  runtimeExtractReviewSuggestions = values.extractReviewSuggestions
  runtimeFailReviewSummary = values.failReviewSummary
  runtimeFindOrAddRepository = values.findOrAddRepository
  runtimeFollowUpInWorktree = values.followUpInWorktree
  runtimeFollowUpJob = values.followUpJob
  runtimeForkThreadJob = values.forkThreadJob
  runtimeJobFollowUps = values.jobFollowUps
  runtimeJobLifecycle = values.jobLifecycle
  runtimeJobLogStatement = values.jobLogStatement
  runtimeJson = values.json
  runtimeLaunchAutomaticReview = values.launchAutomaticReview
  runtimeLaunchJob = values.launchJob
  runtimeLaunchRepositoryTask = values.launchRepositoryTask
  runtimeLaunchReviewSelection = values.launchReviewSelection
  runtimeLaunchStackAnalysis = values.launchStackAnalysis
  runtimeLaunchWorktreeReview = values.launchWorktreeReview
  runtimeLinkImplementationBranch = values.linkImplementationBranch
  runtimeMonitorJobProcess = values.monitorJobProcess
  runtimeMobilePairing = values.mobilePairing
  runtimeNotifyClients = values.notifyClients
  runtimeParseRepo = values.parseRepo
  runtimePersistedThreadContext = values.persistedThreadContext
  runtimePostAutomaticReviewToGitHub = values.postAutomaticReviewToGitHub
  runtimePrDetailsCache = values.prDetailsCache
  runtimePromptSelection = values.promptSelection
  runtimePublishReviewMutation = values.publishReviewMutation
  runtimePullRequestContext = values.pullRequestContext
  runtimePullRequestDetails = values.pullRequestDetails
  runtimeRefreshAllRepositories = values.refreshAllRepositories
  runtimeRefreshMergedThreadState = values.refreshMergedThreadState
  runtimeRepositoryAgentBootstrapped = values.repositoryAgentBootstrapped
  runtimeRepositoryEnvironments = values.repositoryEnvironments
  runtimeRepositoryLabels = values.repositoryLabels
  runtimeRepositoryReviewers = values.repositoryReviewers
  runtimeRequestedAgent = values.requestedAgent
  runtimeResolveAgentLaunch = values.resolveAgentLaunch
  runtimeResolvePrompt = values.resolvePrompt
  runtimeRetryJob = values.retryJob
  runtimeReviewAutomationSettings = values.reviewAutomationSettings
  runtimeRun = values.run
  runtimeRunReadOnlyContentGeneration = values.runReadOnlyContentGeneration
  runtimeScmProvider = values.scmProvider
  runtimeScmUser = values.scmUser
  runtimeSelectedProviderId = values.selectedProviderId
  runtimeSpawnAgentThread = values.spawnAgentThread
  runtimeStartMonitoredJob = values.startMonitoredJob
  runtimeStartReviewSummaryFollowUp = values.startReviewSummaryFollowUp
  runtimeSteerResponse = values.steerResponse
  runtimeStoreJobDiff = values.storeJobDiff
  runtimeSyncRepository = values.syncRepository
  runtimeSystemConfiguration = values.systemConfiguration
  runtimeTaskTarget = values.taskTarget
  runtimeThreadSummaries = values.threadSummaries
  runtimeUpdateReviewBatchForJob = values.updateReviewBatchForJob
  runtimeUsesReviewWorkspace = values.usesReviewWorkspace
  runtimeWithAgentMetadata = values.withAgentMetadata
  runtimeWork = values.work
  runtimeWorkCleanup = values.workCleanup
  runtimeWorkMemory = values.workMemory
  runtimeWorktreePreviews = values.worktreePreviews
}

export function setDashboardReadModelStore(store: any) {
  runtimeDashboardReadModelStore = store
}
