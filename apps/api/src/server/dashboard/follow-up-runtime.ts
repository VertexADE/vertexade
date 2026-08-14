import { appendFile, readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { CronExpressionParser } from 'cron-parser'
import { ensureEncryptionKey } from '../../encrypted-settings.ts'
import { loadModulePlatform } from '../platform/load-platform.ts'
import { HttpError, readRequestBody } from '@vertexade/platform-server/http'
import {
  isCodeReviewKind,
  isReviewSnapshotCurrent,
  reviewConversationPrompt,
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
import { reusedCombinedWorktree } from '../work/combined-worktree.ts'
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
import { DashboardReadModelStore, type DashboardReadModelEntry } from '../read-model/dashboard-read-model.ts'
import {
  runtimeLOGS as LOGS,
  runtimePROMPT_IMAGES as PROMPT_IMAGES,
  runtimeActiveJobs as activeJobs,
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentLogPath as agentLogPath,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeAutomationRecipes as automationRecipes,
  runtimeCreateNotification as createNotification,
  runtimeDb as db,
  runtimeDrainingJobFollowUps as drainingJobFollowUps,
  runtimeExtensions as extensions,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJobLifecycle as jobLifecycle,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimeRequestedAgent as requestedAgent,
  runtimeResolveAgentLaunch as resolveAgentLaunch,
  runtimeRun as run,
  runtimeSpawnAgentThread as spawnAgentThread,
  runtimeSystemConfiguration as systemConfiguration,
  runtimeWork as work,
  runtimeWorkMemory as workMemory,
} from './runtime-context.ts'
import {
  runtimeAllowedBranchTypes as allowedBranchTypes,
  runtimeDrainAutomaticReviewQueue as drainAutomaticReviewQueue,
  runtimeEnsureClone as ensureClone,
  runtimeParseRepo as parseRepo,
  runtimeStartReviewSummaryFollowUp as startReviewSummaryFollowUp,
  runtimeUsesReviewWorkspace as usesReviewWorkspace,
} from './runtime-context.ts'
import {
  runtimeCleanupFailedLaunch as cleanupFailedLaunch,
  runtimeCreateAgentWorktree as createAgentWorktree,
  runtimeExtractReviewSuggestions as extractReviewSuggestions,
  runtimeLinkImplementationBranch as linkImplementationBranch,
  runtimeMonitorJobProcess as monitorJobProcess,
  runtimePostAutomaticReviewToGitHub as postAutomaticReviewToGitHub,
  runtimeUpdateReviewBatchForJob as updateReviewBatchForJob,
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
import { resolveEphemeralLaunch } from '../agents/ephemeral.ts'
import { and, desc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'
import { jobs, repositories, workItems } from '../database/schema/tables.ts'
import { jobRecord } from '../database/contract-records.ts'

export async function followUpJob(
  job,
  prompt,
  {
    reviewMode = usesReviewWorkspace(job.kind),
    model = agentLaunchContext.getStore()?.model ?? job.agent_model,
    reasoningEffort = agentLaunchContext.getStore()?.reasoningEffort ?? job.agent_reasoning_effort,
    writableRoots = [],
  } = {},
) {
  const launchOptions = agentLaunchContext.getStore()
  const startsPersistentReviewThread = Boolean(job.ephemeral && isCodeReviewKind(job.kind))
  model ||= launchOptions?.model || job.agent_model
  reasoningEffort ||= launchOptions?.reasoningEffort || job.agent_reasoning_effort
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  const sessionCwd = jobSessionCwd(job, runtimeAgent.workspaceRoot)
  await stat(job.worktree_path)
  await stat(sessionCwd)
  const continuationPrompt = startsPersistentReviewThread
    ? reviewConversationPrompt({ reviewDetails: job.review_details, reviewSummary: job.review_summary }, prompt)
    : prompt
  const configuredPrompt = systemConfiguration.prompt(reviewMode ? 'review' : 'followUp', continuationPrompt)
  const memoryLaunch = job.work_item_id
    ? await workMemory.launchContext(job.work_item_id, configuredPrompt)
    : { prompt: configuredPrompt, writableRoots: [] }
  const launch = await resolveAgentLaunch(job.work_item_id, memoryLaunch.prompt, runtimeAgent.id)
  const resourcePrompt = launch.prompt
  const repository = db
    .select({ path: repositories.localPath, strategy: repositories.workspaceStrategy })
    .from(repositories)
    .where(eq(repositories.id, job.repo_id))
    .get()
  const directRoots = repository?.strategy === 'direct' ? [repository.path] : []
  const sharedWritableRoots = [...new Set([...memoryLaunch.writableRoots, ...writableRoots, ...directRoots])]
  db.update(jobs)
    .set({
      agentModel: sql`coalesce(${model || null}, ${jobs.agentModel})`,
      agentReasoningEffort: sql`coalesce(${reasoningEffort || null}, ${jobs.agentReasoningEffort})`,
    })
    .where(eq(jobs.id, job.id))
    .run()
  const log = createWriteStream(job.log_path, { flags: 'a' })
  log.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      event: 'follow_up_started',
      thread_id: startsPersistentReviewThread ? null : job.thread_id,
      previous_thread_id: startsPersistentReviewThread ? job.thread_id : undefined,
      model,
      reasoning_effort: reasoningEffort,
      prompt: resourcePrompt,
      display_prompt: prompt,
    })}\n`,
  )
  const child = spawnAgentThread(
    {
      jobId: job.id,
      cwd: sessionCwd,
      base: job.base_repo_path,
      ...(startsPersistentReviewThread ? { ephemeral: false } : { resume: job.thread_id }),
      prompt: resourcePrompt,
      reviewMode,
      model,
      reasoningEffort,
      allowSubagents: launchOptions?.allowSubagents ?? Boolean(job.allow_subagents),
      writableRoots: sharedWritableRoots,
      mcpServers: launch.mcpServers,
    },
    {
      cwd: sessionCwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
    runtimeAgent,
  )
  if (startsPersistentReviewThread) {
    db.update(jobs).set({ ephemeral: 0, threadId: null }).where(eq(jobs.id, job.id)).run()
  }
  db.update(jobs)
    .set({ latestActivity: `Follow-up sent to ${runtimeAgent.name}…`, activityAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(jobs.id, job.id))
    .run()
  monitorJobProcess(child, job.id, log, runtimeAgent)
  const storedJob = db.select().from(jobs).where(eq(jobs.id, job.id)).get()
  return storedJob ? jobRecord(storedJob) : undefined
}

export async function drainJobFollowUpQueue(jobId) {
  if (drainingJobFollowUps.has(jobId) || activeJobs.has(jobId)) return
  const storedJob = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
  const job = storedJob ? jobRecord(storedJob) : null
  if (!job || ['starting', 'running'].includes(job.status)) return
  const queued = jobFollowUps.claim(jobId)
  if (!queued) return
  drainingJobFollowUps.add(jobId)
  try {
    await followUpJob(job, queued.prompt, {
      reviewMode: usesReviewWorkspace(job.kind),
      model: queued.model,
      reasoningEffort: queued.reasoning_effort,
    })
    notifyClients('job_follow_up_started', jobId)
  } catch (error) {
    jobFollowUps.fail(queued.id, error)
    const message = error instanceof Error ? error.message : String(error)
    createNotification('task_failed', 'Queued follow-up could not start', `Run #${jobId}: ${message}`, { jobId })
    notifyClients('job_follow_up_failed', jobId)
  } finally {
    drainingJobFollowUps.delete(jobId)
  }
}

export async function contextTransferTargets(sourceJobId) {
  const storedSource = db
    .select({ id: jobs.id, worktreePath: jobs.worktreePath })
    .from(jobs)
    .where(eq(jobs.id, Number(sourceJobId)))
    .get()
  const source = storedSource ? jobRecord(storedSource) : null
  if (!source) throw new Error('Source run not found')
  const candidates = db
    .select({
      id: jobs.id,
      status: jobs.status,
      kind: jobs.kind,
      threadId: jobs.threadId,
      agentId: jobs.agentId,
      taskTitle: jobs.taskTitle,
      branchName: jobs.branchName,
      worktreePath: jobs.worktreePath,
      workItemId: jobs.workItemId,
      workItemKey: workItems.key,
      workItemTitle: workItems.title,
      fullName: repositories.fullName,
    })
    .from(jobs)
    .innerJoin(workItems, eq(workItems.id, jobs.workItemId))
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(
      and(
        sql`${jobs.id} <> ${source.id}`,
        isNotNull(jobs.threadId),
        notInArray(jobs.kind, ['review', 'work_review']),
        notInArray(jobs.status, ['starting', 'running']),
        isNull(workItems.archivedAt),
      ),
    )
    .orderBy(desc(jobs.activityAt), desc(jobs.id))
    .limit(200)
    .all()
    .map(jobRecord)
  const available = await Promise.all(
    candidates.map(async (candidate) => {
      if (resolve(candidate.worktree_path) === resolve(source.worktree_path)) return null
      try {
        await stat(candidate.worktree_path)
        return candidate
      } catch {
        return null
      }
    }),
  )
  return available.filter(Boolean)
}

export async function followUpInWorktree(input, expectedSourceWorkItemId = null) {
  const sourceJobId = Number(input?.sourceJobId)
  const destinationJobId = Number(input?.destinationJobId)
  const title = String(input?.title || '')
    .trim()
    .slice(0, 200)
  const instruction = String(input?.instruction || '')
    .trim()
    .slice(0, 20_000)
  if (!Number.isInteger(sourceJobId) || sourceJobId < 1) throw new Error('Choose a valid source run')
  if (!Number.isInteger(destinationJobId) || destinationJobId < 1) throw new Error('Choose a valid destination thread')
  if (sourceJobId === destinationJobId) throw new Error('Choose a different destination thread')
  if (!title) throw new Error('Sub-item title is required')
  if (!instruction) throw new Error('Follow-up instruction is required')

  const sourceResult = db
    .select({
      job: jobs,
      fullName: repositories.fullName,
      workItemKey: workItems.key,
      workItemTitle: workItems.title,
    })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .leftJoin(workItems, eq(workItems.id, jobs.workItemId))
    .where(eq(jobs.id, sourceJobId))
    .get()
  const destinationResult = db
    .select({
      job: jobs,
      fullName: repositories.fullName,
      workItemKey: workItems.key,
      workItemTitle: workItems.title,
      workItemKind: workItems.kind,
    })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .leftJoin(workItems, eq(workItems.id, jobs.workItemId))
    .where(eq(jobs.id, destinationJobId))
    .get()
  const source = sourceResult
    ? {
        ...jobRecord(sourceResult.job),
        full_name: sourceResult.fullName,
        work_item_key: sourceResult.workItemKey,
        work_item_title: sourceResult.workItemTitle,
      }
    : null
  const destination = destinationResult
    ? {
        ...jobRecord(destinationResult.job),
        full_name: destinationResult.fullName,
        work_item_key: destinationResult.workItemKey,
        work_item_title: destinationResult.workItemTitle,
        work_item_kind: destinationResult.workItemKind,
      }
    : null
  if (!source?.work_item_id) throw new Error('The source run is not linked to a work item')
  if (expectedSourceWorkItemId && source.work_item_id !== Number(expectedSourceWorkItemId))
    throw new Error('The source run does not belong to this work item')
  if (['starting', 'running'].includes(source.status)) throw new Error('Wait for the source run to produce its final output')
  const contextSnapshot = contextTransferSnapshot(source)
  if (!contextSnapshot) throw new Error('The source run has no output to hand off')
  if (!destination?.work_item_id) throw new Error('The destination thread is not linked to a work item')
  if (!destination.thread_id) throw new Error('The destination run has no resumable agent thread')
  if (isCodeReviewKind(destination.kind)) throw new Error('Private review threads cannot receive implementation sub-items')
  if (['starting', 'running'].includes(destination.status)) throw new Error('The destination thread is already running')
  if (resolve(source.worktree_path) === resolve(destination.worktree_path)) throw new Error('Choose a thread in a different worktree')
  await stat(destination.worktree_path)

  const claimed = jobLifecycle.claimStarting(destination.id, 'Preparing cross-worktree follow-up…')
  if (!claimed) throw new Error('The destination thread is already running')
  let child = null
  let transfer = null
  try {
    child = work.create({
      title,
      description: instruction,
      kind: destination.work_item_kind === 'investigation' ? 'investigation' : 'implementation',
      state: 'active',
      priority: 'normal',
      repositoryId: destination.repo_id,
    })
    work.linkRepository(child.id, { id: destination.repo_id, full_name: destination.full_name }, true)
    work.relate(source.work_item_id, child.id, 'child')
    work.relate(child.id, source.work_item_id, 'parent')
    work.relate(child.id, destination.work_item_id, 'related')
    if (source.work_item_id !== destination.work_item_id) work.relate(destination.work_item_id, child.id, 'related')
    work.linkResource(child.id, {
      provider: 'vertexade',
      kind: 'agent_thread',
      externalId: String(source.id),
      role: 'context_source',
      label: `${source.work_item_key || 'Work'} · run #${source.id}`,
      repositoryId: source.repo_id,
      url: `/threads?thread=${source.id}`,
      state: source.status,
      metadata: { jobId: source.id, workItemId: source.work_item_id },
    })
    work.linkResource(child.id, {
      provider: 'vertexade',
      kind: 'agent_thread',
      externalId: String(destination.id),
      role: 'destination',
      label: `${destination.work_item_key || 'Work'} · run #${destination.id}`,
      repositoryId: destination.repo_id,
      url: `/threads?thread=${destination.id}`,
      state: 'running',
      primary: true,
      metadata: {
        jobId: destination.id,
        workItemId: destination.work_item_id,
        worktreePath: destination.worktree_path,
      },
    })
    transfer = work.createContextTransfer({
      workItemId: child.id,
      sourceWorkItemId: source.work_item_id,
      destinationWorkItemId: destination.work_item_id,
      sourceJobId: source.id,
      destinationJobId: destination.id,
      instruction,
      contextSnapshot,
    })
    work.startContextTransfer(transfer.id)
    const childMemory = await workMemory.launchContext(
      child.id,
      contextTransferPrompt({
        title,
        instruction,
        sourceJobId: source.id,
        sourceWorkItemKey: source.work_item_key,
        sourceRepository: source.full_name,
        contextSnapshot,
      }),
    )
    await followUpJob(destination, childMemory.prompt, {
      reviewMode: false,
      model: destination.agent_model,
      reasoningEffort: destination.agent_reasoning_effort,
      writableRoots: childMemory.writableRoots,
    })
  } catch (error) {
    if (transfer) work.failContextTransfer(transfer.id, error)
    else if (child) work.launchFailed(child.id, error)
    if (!activeJobs.has(destination.id)) {
      jobLifecycle.restore(destination.id, {
        status: destination.status,
        activity: destination.latest_activity,
        finishedAt: destination.finished_at,
      })
    }
    throw error
  }
  return {
    workItem: work.get(child.id),
    destinationJobId: destination.id,
    transferId: transfer.id,
    status: 'running' as const,
  }
}

export { retryJob } from './thread-retry.ts'
