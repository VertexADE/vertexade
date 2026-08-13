import { appendFile, readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { ensureEncryptionKey } from '../../encrypted-settings.ts'
import { loadModulePlatform } from '../platform/load-platform.ts'
import { HttpError, readRequestBody } from '@vertexade/platform-server/http'
import {
  isCodeReviewKind,
  isReviewSnapshotCurrent,
  reviewRerunSelection,
  reviewSummaryPrompt,
  shouldStartReviewSummary,
} from '../reviews.ts'
import {
  automaticReviewCapacity,
  automaticReviewLaunchAllowed,
  automaticReviewTrigger,
  normalizeAutomaticReviewConcurrency,
} from '../automatic-review-queue.ts'
import { isCompleteDetailedReview, resolveDetailedReviewOutput } from '../review-output.ts'
import {
  aggregateReviewPrompt,
  hardReviewChecks,
  qualityScorecardReviewContract,
  repositoryTopologyReviewContract,
  reviewIntentContract,
} from '../review-prompt-contract.ts'
import { agentProcessEnvironment, migrateAgentEnvironmentsV1, trustWorkspaceMiseConfigs } from '@vertexade/platform-server/agents'
import { selectContextualProvider } from '../platform/provider-selection.ts'
import {
  resolveScmPresentation,
  type Agent,
  type PlanningRefinementRequest,
  type PlanningWorkflowRequest,
} from '@vertexade/platform-contracts'
import type { AgentRegistry } from '../agents/registry.ts'
import type { DashboardExtensionHostServices } from '../extensions/host-services.ts'
import { ExtensionCacheStore } from '../extensions/cache.ts'
import { WorkService } from '../work/service.ts'
import { handleWorkApi } from '../work/http.ts'
import { createWorkCleanup } from '../work/cleanup.ts'
import { withWorktreeOwnershipRepair } from '../work/worktree-ownership.ts'
import { localizePromptImages } from '../prompt-images.ts'
import { readFileTail, readLogEventContext } from '../log-files.ts'
import { processStartIdentity, processWorkingDirectory, runCommand } from '../process.ts'
import { agentSafetyBoundary, untrustedExternalTask } from '../prompts/security.ts'
import { contextTransferPrompt, contextTransferSnapshot } from '../work/context-transfer.ts'
import { WorkMemoryService } from '../work/memory.ts'
import { jobSessionCwd, parseWorkItemWorkspaceMode, relativeWorktreePath, workItemWorkspaceLayout } from '../work/workspace-layout.ts'
import { createCoreRoutes } from '../core-routes.ts'
import { inspectRepositoryEnvironmentEntries, snapshotRepositoryEnvironment } from '../repository-environment.ts'
import { worktreeCodeReviewPrompt } from '../work/prompts.ts'
import { populateWorktreeSnapshot } from '../work/worktree-snapshot.ts'
import { WorktreePreviewRuntime, normalizePreviewSettings } from '../previews/runtime.ts'
import { WorktreePreviewGateway } from '../previews/gateway.ts'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { DashboardEvents } from '../events/dashboard-events.ts'
import { EncryptedSettingsStore, JsonSettingsStore } from '../settings/settings-store.ts'
import { SystemConfiguration } from '../settings/system-configuration.ts'
import { threadRuntimeDefaults } from './runtime-settings.ts'
import { createPlatformManagementRoutes, type ContentGenerationDefaults } from '../platform/management-routes.ts'
import { normalizeGeneratedWorkItemTitle, workItemTitlePrompt } from '../platform/work-item-title.ts'
import { createWorkspaceRoutes } from '../platform/workspace-routes.ts'
import { NotificationService } from '../notifications/service.ts'
import { createNotificationRoutes } from '../notifications/routes.ts'
import { JobLifecycle } from '../workflows/job-lifecycle.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { createCapabilityRoutes } from '../workflows/capability-routes.ts'
import { AutomationRecipeService } from '../workflows/automation-recipes.ts'
import { createAutomationRoutes } from '../workflows/automation-routes.ts'
import { CoreAutomationTriggers } from '../workflows/core-automation-triggers.ts'
import { registerCoreAutomationActions } from '../workflows/core-automation-actions.ts'
import { createAutomationThreadLauncher } from '../workflows/automation-thread-launcher.ts'
import { publishAgentControlEvent, sendAgentControlCommand } from '../agents/live-control.ts'
import { agentThreadContext, mergeAgentThreadContext } from '../agents/thread-context.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions } from '../agents/resources.ts'
import { createAgentResourceRoutes } from '../agents/resource-routes.ts'
import { CustomAgentSynchronizer } from '../agents/custom-agents.ts'
import { createDiffPreview, storedDiffSummary, summarizeDiff } from '../diff-preview.ts'
import { JobFollowUpQueue } from '../job-follow-up-queue.ts'
import { parseAgentLogEvents } from '../agent-timeline.ts'
import { handleRepositoryEnvironmentApi } from '../repository-environment-routes.ts'
import { DashboardReadModelStore, type DashboardReadModelEntry } from '../read-model/dashboard-read-model.ts'
import {
  runtimeAPI_TOKEN as API_TOKEN,
  runtimeREPOS as REPOS,
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentProvider as agentProvider,
  runtimeAgentResourceRoutes as agentResourceRoutes,
  runtimeAgentResources as agentResources,
  runtimeAgents as agents,
  runtimeAppSettings as appSettings,
  runtimeBody as body,
  runtimeCoreRoutes as coreRoutes,
  runtimeDashboardReadModelStore as dashboardReadModelStore,
  runtimeDb as db,
  runtimeExtensions as extensions,
  runtimeJson as json,
  runtimeMobilePairing as mobilePairing,
  runtimeNotifyClients as notifyClients,
  runtimeReviewAutomationSettings as reviewAutomationSettings,
  runtimeRun as run,
  runtimeScmProvider as scmProvider,
  runtimeSelectedProviderId as selectedProviderId,
  runtimeWork as work,
  runtimeWorkCleanup as workCleanup,
  runtimeWorkMemory as workMemory,
} from './runtime-context.ts'
import { highlightRules, jobs, presets, pullRequests, repositories } from '../database/schema/tables.ts'
import { applyDirectoryWorkspace, previewDirectoryApply } from '../work/directory-workspace.ts'
import { highlightRuleRecord, presetRecord, pullRequestRecord, repositoryRecord } from '../database/contract-records.ts'
import {
  LinkedServerAccessError,
  normalizeLinkedServer,
  readLinkedServers,
  verifyLinkedServerAccess,
  writeLinkedServers,
} from '../settings/linked-servers.ts'
import { serverRuntimeStatus, updateServerRuntimeConfiguration } from '../settings/server-runtime.ts'
import { MobilePairingError } from '../settings/mobile-pairing.ts'

function repositoryRow(id: number) {
  const row = db.select().from(repositories).where(eq(repositories.id, id)).get()
  return row ? repositoryRecord(row) : null
}

function pullRequestRow(repoId: number, number: number) {
  const row = db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
    .get()
  return row ? pullRequestRecord(row) : null
}

function linkedServerErrorResponse(error: unknown): Response {
  const status = error instanceof LinkedServerAccessError ? (error.code === 'operator_token_not_configured' ? 503 : 401) : 400
  return json(status, { error: error instanceof Error ? error.message : 'Invalid linked server' })
}

function mobilePairingErrorResponse(error: unknown): Response {
  const status = error instanceof MobilePairingError ? error.status : 500
  return json(status, {
    error: error instanceof Error ? error.message : 'Mobile pairing request is invalid',
    code: error instanceof MobilePairingError ? error.code : 'invalid_request',
  })
}

function requestRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

import { resolveSubagentLaunch } from '../agents/subagents.ts'
import type { UiPreferencesPatch } from '@vertexade/platform-contracts'
import { defaultUiPreferences, normalizeUiPreferences, patchUiPreferences } from '../ui-preferences.ts'
import {
  runtimeContextTransferTargets as contextTransferTargets,
  runtimeFollowUpInWorktree as followUpInWorktree,
  runtimeLaunchRepositoryTask as launchRepositoryTask,
  runtimeLaunchStackAnalysis as launchStackAnalysis,
} from './runtime-context.ts'
import {
  runtimeAutomaticReviewQueueState as automaticReviewQueueState,
  runtimeBootstrapAgentRepository as bootstrapAgentRepository,
  runtimeDrainAutomaticReviewQueue as drainAutomaticReviewQueue,
  runtimeEnsureClone as ensureClone,
  runtimeRefreshAllRepositories as refreshAllRepositories,
  runtimeRefreshMergedThreadState as refreshMergedThreadState,
  runtimeRepositoryAgentBootstrapped as repositoryAgentBootstrapped,
  runtimeScmUser as scmUser,
  runtimeSyncRepository as syncRepository,
} from './runtime-context.ts'
import {
  runtimeLaunchJob as launchJob,
  runtimeLaunchReviewSelection as launchReviewSelection,
  runtimeLaunchWorktreeReview as launchWorktreeReview,
  runtimeRepositoryEnvironments as repositoryEnvironments,
} from './runtime-context.ts'
import {
  runtimePersistedThreadContext as persistedThreadContext,
  runtimeThreadSummaries as threadSummaries,
  runtimePromptSelection as promptSelection,
  runtimeResolvePrompt as resolvePrompt,
  runtimeCodeReviewPrompt as codeReviewPrompt,
  runtimeTaskTarget as taskTarget,
  runtimeFindOrAddRepository as findOrAddRepository,
  runtimeDeploymentOverview as deploymentOverview,
} from './runtime-context.ts'

export async function handleSystemApi(request: Request, url: URL): Promise<Response | null> {
  const coreResponse = await coreRoutes(request, url)
  if (coreResponse) return coreResponse
  const workResponse = await handleWorkApi(request, url, {
    work,
    memory: workMemory,
    db,
    body,
    json,
    agentContext: () => agentLaunchContext.getStore() || {},
    defaultAgentId: agentProvider,
    previewWorkDeletion: workCleanup.preview,
    deleteWorkItem: workCleanup.remove,
    detachCleanupArtifact: workCleanup.detachArtifact,
    removeMergedWorktrees: workCleanup.removeMergedWorktrees,
    launchReview: launchReviewSelection,
    launchWorktreeReview,
    launchRepositoryTask,
    contextTransferTargets,
    followUpInWorktree,
    referenceProviders: () => extensions.providers.workReferences.available(),
    agentResources,
  })
  if (workResponse) return workResponse
  const agentResourceResponse = await agentResourceRoutes(request)
  if (agentResourceResponse) return agentResourceResponse
  const repositoryEnvironmentResponse = await handleRepositoryEnvironmentApi(request, url, {
    body,
    database: db,
    json,
    notify: notifyClients,
    profiles: repositoryEnvironments,
  })
  if (repositoryEnvironmentResponse) return repositoryEnvironmentResponse
  if (request.method === 'GET' && url.pathname === '/api/settings/workspace-overview') {
    return json(200, {
      repositories: db
        .select()
        .from(repositories)
        .orderBy(sql`${repositories.fullName} COLLATE NOCASE`)
        .all()
        .map(repositoryRecord),
      presets: db
        .select()
        .from(presets)
        .orderBy(sql`${presets.name} COLLATE NOCASE`)
        .all()
        .map(presetRecord),
      highlights: db
        .select()
        .from(highlightRules)
        .orderBy(sql`${highlightRules.text} COLLATE NOCASE`)
        .all()
        .map(highlightRuleRecord),
    })
  }
  if (url.pathname === '/api/settings/server-runtime' && ['GET', 'POST'].includes(request.method)) {
    try {
      if (request.method === 'POST') {
        const status = await updateServerRuntimeConfiguration(await body(request))
        notifyClients('server_runtime_updated')
        return json(200, status)
      }
      return json(200, await serverRuntimeStatus())
    } catch (error) {
      return json(request.method === 'POST' ? 400 : 500, {
        error: error instanceof Error ? error.message : 'Server runtime configuration could not be read',
      })
    }
  }
  if (url.pathname === '/api/settings/mobile-pairing' && request.method === 'GET') {
    return json(200, mobilePairing.status())
  }
  if (url.pathname === '/api/settings/mobile-pairing/invitations' && request.method === 'POST') {
    try {
      const input = requestRecord(await body(request))
      const invitation = mobilePairing.createInvitation(input.publicOrigin)
      notifyClients('mobile_pairing_updated')
      return json(201, invitation)
    } catch (error) {
      return mobilePairingErrorResponse(error)
    }
  }
  const mobileDeviceMatch = url.pathname.match(/^\/api\/settings\/mobile-pairing\/devices\/([^/]+)$/)
  if (mobileDeviceMatch && request.method === 'DELETE') {
    try {
      const status = mobilePairing.revoke(decodeURIComponent(mobileDeviceMatch[1]))
      notifyClients('mobile_pairing_updated')
      return json(200, status)
    } catch (error) {
      return mobilePairingErrorResponse(error)
    }
  }
  if (url.pathname === '/api/mobile-pairing/redeem' && request.method === 'POST') {
    try {
      const input = requestRecord(await body(request))
      const redemption = mobilePairing.redeem(input.token, input.deviceName)
      notifyClients('mobile_pairing_updated')
      return json(201, redemption)
    } catch (error) {
      return mobilePairingErrorResponse(error)
    }
  }
  if (url.pathname === '/api/mobile-pairing/session/validate' && request.method === 'POST') {
    try {
      return json(200, mobilePairing.validate(request.headers.get('authorization')))
    } catch (error) {
      return mobilePairingErrorResponse(error)
    }
  }
  if (url.pathname === '/api/settings/linked-servers') {
    if (request.method === 'GET') {
      return json(200, {
        servers: readLinkedServers(appSettings),
      })
    }
    if (request.method === 'POST') {
      try {
        const current = readLinkedServers(appSettings)
        const server = {
          ...normalizeLinkedServer(await body(request)),
          namespace: Math.max(0, ...current.map((candidate) => candidate.namespace)) + 1,
        }
        await verifyLinkedServerAccess(server.url, request.headers.get('authorization'), API_TOKEN)
        const duplicate = current.find((candidate) => candidate.id === server.id || candidate.url === server.url)
        if (duplicate) return json(409, { error: `Linked server conflicts with ${duplicate.label}` })
        writeLinkedServers(appSettings, [...current, server])
        notifyClients('linked_servers_updated')
        return json(201, server)
      } catch (error) {
        return linkedServerErrorResponse(error)
      }
    }
  }
  const linkedServerMatch = url.pathname.match(/^\/api\/settings\/linked-servers\/([a-z0-9_-]+)$/)
  if (linkedServerMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const current = readLinkedServers(appSettings)
    const index = current.findIndex((server) => server.id === linkedServerMatch[1])
    if (index < 0) return json(404, { error: 'Linked server not found' })
    if (request.method === 'DELETE') {
      writeLinkedServers(
        appSettings,
        current.filter((_, candidateIndex) => candidateIndex !== index),
      )
      notifyClients('linked_servers_updated')
      return json(200, { deleted: true })
    }
    try {
      const patch = await body(request)
      const next = normalizeLinkedServer({ ...current[index], ...patch, id: current[index].id })
      if (next.url !== current[index].url) await verifyLinkedServerAccess(next.url, request.headers.get('authorization'), API_TOKEN)
      const duplicate = current.find((candidate, candidateIndex) => candidateIndex !== index && candidate.url === next.url)
      if (duplicate) return json(409, { error: `Linked server conflicts with ${duplicate.label}` })
      const updated = [...current]
      updated[index] = next
      writeLinkedServers(appSettings, updated)
      notifyClients('linked_servers_updated')
      return json(200, next)
    } catch (error) {
      return linkedServerErrorResponse(error)
    }
  }
  if (url.pathname === '/api/settings/thread-runtime-defaults') {
    if (request.method === 'GET') return json(200, threadRuntimeDefaults(appSettings, agentProvider))
    if (request.method === 'POST') {
      const input = await body(request)
      const clean = (value) => ({
        agentId: String(value?.agentId || agentProvider),
        model: String(value?.model || '')
          .trim()
          .slice(0, 200),
        reasoningEffort: String(value?.reasoningEffort || '')
          .trim()
          .slice(0, 50),
        serviceTier: value?.agentId === 'codex' && value?.serviceTier === 'priority' ? 'priority' : '',
      })
      const value = { workItem: clean(input.workItem), review: clean(input.review) }
      agents.require(value.workItem.agentId)
      agents.require(value.review.agentId)
      appSettings.write('thread_runtime_defaults', value)
      notifyClients('thread_runtime_defaults_updated')
      return json(200, value)
    }
  }
  if (url.pathname === '/api/settings/review-automation') {
    if (request.method === 'GET')
      return json(200, {
        ...reviewAutomationSettings(),
        ...automaticReviewQueueState(),
        agents: agents.capabilities(),
      })
    if (request.method === 'POST') {
      const input = await body(request)
      const requestedConcurrency = input.concurrency === undefined ? reviewAutomationSettings().concurrency : Number(input.concurrency)
      if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1 || requestedConcurrency > 8)
        return json(400, { error: 'Automatic review concurrency must be an integer from 1 to 8' })
      const cleanRules = (values) =>
        [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))].slice(0, 50)
      const value = {
        enabled: Boolean(input.enabled),
        agentId: String(input.agentId || agentProvider),
        model: String(input.model || '')
          .trim()
          .slice(0, 200),
        reasoningEffort: String(input.reasoningEffort || '')
          .trim()
          .slice(0, 50),
        allowSubagents: resolveSubagentLaunch(agents.require(String(input.agentId || agentProvider)), input.allowSubagents),
        concurrency: requestedConcurrency,
        postToGitHub: Boolean(input.postToGitHub),
        onAssigned: input.onAssigned !== false,
        titleSubstrings: cleanRules(input.titleSubstrings),
        labelSubstrings: cleanRules(input.labelSubstrings),
      }
      agents.require(value.agentId)
      appSettings.write('review_automation', value)
      notifyClients('review_automation_updated')
      void drainAutomaticReviewQueue()
      return json(200, { ...value, ...automaticReviewQueueState() })
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/deployments') {
    return json(200, await deploymentOverview(url.searchParams.get('refresh') === '1'))
  }
  const deploymentRerunMatch = url.pathname.match(/^\/api\/deployments\/runs\/(\d+)\/rerun$/)
  if (request.method === 'POST' && deploymentRerunMatch) {
    const input = await body(request)
    const mode = input.mode === 'all' ? 'all' : 'failed'
    const providerId = selectedProviderId('deployment', { explicit: String(input.provider || '') })
    const targetId = String(input.target_id || '').trim()
    await extensions.providers.deployment.require(providerId).rerun(Number(deploymentRerunMatch[1]), mode, targetId || undefined)
    return json(202, { accepted: true, mode, provider: providerId, target_id: targetId || null })
  }
  if (request.method === 'POST' && url.pathname === '/api/highlights') {
    const input = await body(request)
    const text = String(input.text || '').trim()
    const color = String(input.color || '')
      .trim()
      .toLowerCase()
    if (!text || text.length > 100) return json(400, { error: 'Highlight text must contain 1–100 characters' })
    if (!/^#[0-9a-f]{6}$/.test(color)) return json(400, { error: 'Choose a valid highlight color' })
    db.insert(highlightRules)
      .values({ text, color })
      .onConflictDoUpdate({ target: highlightRules.text, set: { color, updatedAt: sql`CURRENT_TIMESTAMP` } })
      .run()
    notifyClients('highlights')
    return json(200, highlightRuleRecord(db.select().from(highlightRules).where(eq(highlightRules.text, text)).get()!))
  }
  const highlightDeleteMatch = url.pathname.match(/^\/api\/highlights\/(\d+)$/)
  if (request.method === 'DELETE' && highlightDeleteMatch) {
    const result = db
      .delete(highlightRules)
      .where(eq(highlightRules.id, Number(highlightDeleteMatch[1])))
      .run()
    if (result.changes) notifyClients('highlights')
    return result.changes ? json(200, { deleted: true }) : json(404, { error: 'Highlight rule not found' })
  }
  if (request.method === 'POST' && url.pathname === '/api/presets') {
    const input = await body(request)
    const name = String(input.name || '')
      .trim()
      .replace(/^\[|\]$/g, '')
    const prompt = String(input.prompt || '').trim()
    if (!/^[a-z0-9_-]{1,32}$/i.test(name))
      return json(400, {
        error: 'Preset names may use 1–32 letters, numbers, underscores, or hyphens',
      })
    if (!prompt) return json(400, { error: 'Preset message is required' })
    db.insert(presets)
      .values({ name, prompt })
      .onConflictDoUpdate({ target: presets.name, set: { prompt, updatedAt: sql`CURRENT_TIMESTAMP` } })
      .run()
    notifyClients('presets')
    return json(200, presetRecord(db.select().from(presets).where(eq(presets.name, name)).get()!))
  }
  const presetMatch = url.pathname.match(/^\/api\/presets\/(\d+)$/)
  if (request.method === 'POST' && presetMatch) {
    const id = Number(presetMatch[1])
    if (!db.select({ id: presets.id }).from(presets).where(eq(presets.id, id)).get()) return json(404, { error: 'Preset not found' })
    const input = await body(request)
    const name = String(input.name || '')
      .trim()
      .replace(/^\[|\]$/g, '')
    const prompt = String(input.prompt || '').trim()
    if (!/^[a-z0-9_-]{1,32}$/i.test(name))
      return json(400, {
        error: 'Preset names may use 1–32 letters, numbers, underscores, or hyphens',
      })
    if (!prompt) return json(400, { error: 'Preset message is required' })
    if (
      db
        .select({ id: presets.id })
        .from(presets)
        .where(and(eq(presets.name, name), ne(presets.id, id)))
        .get()
    )
      return json(409, { error: `A preset named [${name}] already exists` })
    db.update(presets)
      .set({ name, prompt, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(presets.id, id))
      .run()
    notifyClients('presets')
    return json(200, presetRecord(db.select().from(presets).where(eq(presets.id, id)).get()!))
  }
  const presetDeleteMatch = url.pathname.match(/^\/api\/presets\/(\d+)$/)
  if (request.method === 'DELETE' && presetDeleteMatch) {
    const result = db
      .delete(presets)
      .where(eq(presets.id, Number(presetDeleteMatch[1])))
      .run()
    if (result.changes) notifyClients('presets')
    return result.changes ? json(200, { deleted: true }) : json(404, { error: 'Preset not found' })
  }
  if (request.method === 'POST' && url.pathname === '/api/work-items/from-pull-request') {
    if (!API_TOKEN) return json(503, { error: 'Extension API is not configured' })
    if (request.headers.get('authorization') !== `Bearer ${API_TOKEN}`) return json(401, { error: 'Invalid API token' })
    const input = await body(request)
    const selection = promptSelection(input)
    if ('error' in selection) return json(selection.status, { error: selection.error })
    const target = taskTarget(input)
    const repo = await findOrAddRepository(target.fullName, target.routingHint)
    const pr = pullRequestRow(repo.id, target.number)
    if (!pr) return json(404, { error: 'Open pull request not found' })
    const resolved = resolvePrompt(input, repo, pr, selection)
    if ('error' in resolved) return json(resolved.status, { error: resolved.error })
    const job = await launchJob(repo, pr, resolved.prompt)
    return json(202, {
      ...job,
      repository: repo.full_name,
      pr_url: pr.url,
      preset: resolved.preset?.name || null,
    })
  }
  if (request.method === 'GET' && url.pathname === '/api/read-model') {
    const since = Number(url.searchParams.get('since') || 0)
    if (!Number.isFinite(since) || since < 0) return json(400, { error: 'since must be a non-negative number' })
    return json(200, await dashboardReadModelStore.changes(since, url.searchParams.get('instance') || undefined))
  }
  if (request.method === 'GET' && url.pathname === '/api/read-model/status') {
    return json(200, dashboardReadModelStore.status())
  }
  if (request.method === 'GET' && url.pathname === '/api/ui-preferences') {
    return json(200, normalizeUiPreferences(appSettings.read('ui_preferences', defaultUiPreferences)))
  }
  if (request.method === 'PATCH' && url.pathname === '/api/ui-preferences') {
    const current = normalizeUiPreferences(appSettings.read('ui_preferences', defaultUiPreferences))
    const next = patchUiPreferences(current, (await body(request)) as UiPreferencesPatch)
    appSettings.write('ui_preferences', next)
    notifyClients('ui_preferences_updated')
    return json(200, next)
  }
  if (request.method === 'POST' && url.pathname === '/api/repositories/sync-all') {
    const summary = await refreshAllRepositories()
    if (summary.running) return json(409, { error: 'A repository refresh is already running' })
    return json(summary.errors.length ? 207 : 200, summary)
  }
  const directoryApplyMatch = url.pathname.match(/^\/api\/agent-threads\/(\d+)\/directory-apply(?:\/(preview))?$/)
  if (directoryApplyMatch && ['GET', 'POST'].includes(request.method)) {
    const row = db
      .select({
        status: jobs.status,
        workspace: jobs.worktreePath,
        source: repositories.localPath,
        sourceKind: repositories.sourceKind,
        strategy: repositories.workspaceStrategy,
      })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(eq(jobs.id, Number(directoryApplyMatch[1])))
      .get()
    if (!row) return json(404, { error: 'Agent thread not found' })
    if (row.sourceKind !== 'directory' || !['copy', 'move'].includes(row.strategy)) {
      return json(400, { error: 'This thread does not use an applicable directory workspace' })
    }
    if (['starting', 'running'].includes(row.status))
      return json(409, { error: 'Wait for the agent session to finish before applying changes' })
    const strategy = row.strategy as 'copy' | 'move'
    if (request.method === 'GET' || directoryApplyMatch[2]) {
      return json(200, await previewDirectoryApply(row.source, row.workspace, strategy))
    }
    const result = await applyDirectoryWorkspace(row.source, row.workspace, strategy)
    notifyClients('directory_workspace_applied', Number(directoryApplyMatch[1]))
    return json(200, { ...result, applied: true })
  }
  if (request.method === 'GET' && url.pathname === '/api/agent-threads') {
    void refreshMergedThreadState()
    const archive = url.searchParams.get('archive') || 'open'
    return json(200, { threads: threadSummaries(archive) })
  }
  if (request.method === 'GET' && url.pathname === '/api/scm/me') {
    const user = await scmUser()
    return json(200, { login: user.login, avatar_url: user.avatar_url })
  }
  if (request.method === 'POST' && url.pathname === '/api/repositories') {
    const input = await body(request)
    if (input.local_path) {
      const localPath = await realpath(String(input.local_path))
      const localStat = await stat(localPath)
      if (!localStat.isDirectory()) return json(400, { error: 'Local path must be a directory' })
      let git = false
      try {
        const root = await run('git', ['-C', localPath, 'rev-parse', '--show-toplevel'])
        git = resolve(root.trim()) === resolve(localPath)
      } catch {}
      const requested = String(input.workspace_strategy || '').trim()
      const allowed = git ? ['worktree', 'direct'] : ['direct', 'copy', 'move']
      const workspaceStrategy = requested || (git ? 'worktree' : 'direct')
      if (!allowed.includes(workspaceStrategy)) {
        return json(400, {
          error: git ? 'Git directories support worktree or direct mode' : 'Plain directories support direct, copy, or move mode',
        })
      }
      const existing = db.select().from(repositories).where(eq(repositories.localPath, localPath)).get()
      if (existing) return json(200, { repo: repositoryRecord(existing), open_prs: 0, agent_bootstrapped: false })
      const label =
        String(input.name || basename(localPath))
          .trim()
          .slice(0, 100) || basename(localPath)
      let fullName = `Local/${label}`
      let suffix = 2
      while (db.select({ id: repositories.id }).from(repositories).where(eq(repositories.fullName, fullName)).get()) {
        fullName = `Local/${label} ${suffix++}`
      }
      db.insert(repositories)
        .values({ fullName, cloneUrl: localPath, localPath, sourceKind: git ? 'git' : 'directory', workspaceStrategy })
        .run()
      const stored = db.select().from(repositories).where(eq(repositories.fullName, fullName)).get()!
      notifyClients('repository')
      return json(201, { repo: repositoryRecord(stored), open_prs: 0, agent_bootstrapped: false })
    }
    const identity = scmProvider(input.repository).parseRepository(input.repository)
    const fullName = identity.id
    const localPath = join(REPOS, fullName.split('/')[1])
    const cloneUrl = identity.cloneUrl
    db.insert(repositories).values({ fullName, cloneUrl, localPath }).onConflictDoNothing().run()
    let storedRepo = db.select().from(repositories).where(eq(repositories.fullName, fullName)).get()
    let repo = storedRepo ? repositoryRecord(storedRepo) : null
    const needsBootstrap = !repositoryAgentBootstrapped(repo.id)
    if (needsBootstrap) {
      await bootstrapAgentRepository(repo)
      repo = repositoryRow(repo.id)
    }
    const count = await syncRepository(repo)
    return json(200, { repo, open_prs: count, agent_bootstrapped: needsBootstrap })
  }
  const syncMatch = url.pathname.match(/^\/api\/repositories\/(\d+)\/sync$/)
  if (request.method === 'POST' && syncMatch) {
    const repo = repositoryRow(Number(syncMatch[1]))
    if (!repo) return json(404, { error: 'Repository not found' })
    return json(200, { open_prs: await syncRepository(repo) })
  }
  const forkPullMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/fork$/)
  if (request.method === 'POST' && forkPullMatch) {
    const repoId = Number(forkPullMatch[1])
    const number = Number(forkPullMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const title = String(input.title || '').trim()
    const prompt = String(input.prompt || '').trim()
    if (!title || title.length > 100) return json(400, { error: 'Task title must contain 1–100 characters' })
    if (!prompt) return json(400, { error: 'Task prompt is required' })
    const branchType = String(input.branch_type || 'feature')
      .trim()
      .toLowerCase()
    await ensureClone(repo)
    try {
      await run('git', ['-C', repo.local_path, 'ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${pr.head_ref}`])
    } catch {
      return json(409, {
        error: `PR #${pr.number} uses a branch outside ${repo.full_name}; GitHub cannot use it as the base of a stacked PR`,
      })
    }
    await run('git', ['-C', repo.local_path, 'fetch', 'origin', `pull/${pr.number}/head`])
    const revision = (await run('git', ['-C', repo.local_path, 'rev-parse', 'FETCH_HEAD'])).trim()
    return json(
      202,
      await launchRepositoryTask(repo, title, prompt, true, branchType, {
        revision,
        branch: pr.head_ref,
        pr,
      }),
    )
  }
  const stackAnalysisMatch = url.pathname.match(/^\/api\/repositories\/(\d+)\/stack-analysis$/)
  if (request.method === 'POST' && stackAnalysisMatch) {
    const repo = repositoryRow(Number(stackAnalysisMatch[1]))
    if (!repo) return json(404, { error: 'Repository not found' })
    const active = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.repoId, repo.id), eq(jobs.kind, 'stack_analysis'), inArray(jobs.status, ['starting', 'running'])))
      .get()
    if (active) return json(409, { error: `Stack analysis run #${active.id} is already active` })
    return json(202, await launchStackAnalysis(repo))
  }
  return null
}
