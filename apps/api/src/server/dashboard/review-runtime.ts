import { appendFile, readFile, mkdir, mkdtemp, realpath, stat, unlink } from 'node:fs/promises'
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
import { allocateAgentWorktree } from '../work/agent-worktree.ts'
import { assertCombinedWorktreeIdle, reusedCombinedWorktree } from '../work/combined-worktree.ts'
import { jobSessionCwd, parseWorkItemWorkspaceMode, relativeWorktreePath, workItemWorkspaceLayout } from '../work/workspace-layout.ts'
import { createCoreRoutes } from '../core-routes.ts'
import { worktreeCodeReviewPrompt } from '../work/prompts.ts'
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
import { resolveEphemeralLaunch } from '../agents/ephemeral.ts'
import { createJobProcessMonitor } from './job-process-monitor.ts'
import { resolveSubagentLaunch } from '../agents/subagents.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions } from '../agents/resources.ts'
import { createAgentResourceRoutes } from '../agents/resource-routes.ts'
import { CustomAgentSynchronizer } from '../agents/custom-agents.ts'
import { createDiffPreview, storedDiffSummary, summarizeDiff } from '../diff-preview.ts'
import { JobFollowUpQueue } from '../job-follow-up-queue.ts'
import { parseAgentLogEvents } from '../agent-timeline.ts'
import { DashboardReadModelStore, type DashboardReadModelEntry } from '../read-model/dashboard-read-model.ts'
import {
  runtimeMAX_AGENT_EVENT_LINE_BYTES as MAX_AGENT_EVENT_LINE_BYTES,
  runtimeActiveJobs as activeJobs,
  runtimeAgent as agent,
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentLogPath as agentLogPath,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeAutomationRecipes as automationRecipes,
  runtimeCancellingJobs as cancellingJobs,
  runtimeCreateNotification as createNotification,
  runtimeDb as db,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJobLifecycle as jobLifecycle,
  runtimeNotifyClients as notifyClients,
  runtimeResolveAgentLaunch as resolveAgentLaunch,
  runtimeReviewAutomationSettings as reviewAutomationSettings,
  runtimeRepositoryEnvironments as repositoryEnvironments,
  runtimeRun as run,
  runtimeScmProvider as scmProvider,
  runtimeStoreJobDiff as storeJobDiff,
  runtimeSystemConfiguration as systemConfiguration,
  runtimeWork as work,
  runtimeWorkMemory as workMemory,
} from './runtime-context.ts'
import { persistDetectedThreadContext } from './thread-context-store.ts'
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { jobs, pullRequests, repositories, reviewBatches, reviewSuggestions } from '../database/schema/tables.ts'
import { jobRecord, pullRequestRecord, repositoryRecord, reviewBatchRecord } from '../database/contract-records.ts'
import {
  runtimeDrainAutomaticReviewQueue as drainAutomaticReviewQueue,
  runtimeEnsureClone as ensureClone,
  runtimeFailReviewSummary as failReviewSummary,
  runtimeParseRepo as parseRepo,
  runtimeStartReviewSummaryFollowUp as startReviewSummaryFollowUp,
  runtimeSyncRepository as syncRepository,
} from './runtime-context.ts'
import { runtimeDrainJobFollowUpQueue as drainJobFollowUpQueue, runtimeStartMonitoredJob as startMonitoredJob } from './runtime-context.ts'
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
export { linkImplementationBranch } from './implementation-branch.ts'

export function extractReviewSuggestions(jobId) {
  const job = db.select({ kind: jobs.kind, result_text: jobs.resultText }).from(jobs).where(eq(jobs.id, jobId)).get()
  if (job?.kind !== 'review' || !job.result_text) return
  const marker = /<!--\s*REVIEW_SUGGESTIONS_JSON\s*\n([\s\S]*?)\n\s*-->/i
  const match = String(job.result_text).match(marker)
  if (!match) return
  let suggestions
  try {
    suggestions = JSON.parse(match[1])
  } catch {
    return
  }
  if (!Array.isArray(suggestions)) return
  suggestions.slice(0, 100).forEach((suggestion, index) => {
    const path = String(suggestion?.path || '').trim()
    const line = Number(suggestion?.line)
    const side = suggestion?.side
    const description = String(suggestion?.description || '')
      .trim()
      .slice(0, 10_000)
    const replacement = String(suggestion?.replacement || '')
      .replace(/\r\n/g, '\n')
      .slice(0, 50_000)
    if (path && Number.isInteger(line) && line > 0 && side === 'RIGHT' && description && typeof suggestion?.replacement === 'string')
      db.insert(reviewSuggestions)
        .values({ jobId, position: index, path, line, side, description, replacement })
        .onConflictDoUpdate({
          target: [reviewSuggestions.jobId, reviewSuggestions.position],
          set: { path, line, side, description, replacement },
        })
        .run()
  })
  db.update(jobs)
    .set({ resultText: String(job.result_text).replace(marker, '').trim() })
    .where(eq(jobs.id, jobId))
    .run()
  notifyClients('review_suggestions_ready', jobId)
}

export async function postAutomaticReviewToGitHub(jobId) {
  const storedJob = db
    .select({ job: jobs, fullName: repositories.fullName })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(eq(jobs.id, jobId))
    .get()
  const job = storedJob ? { ...jobRecord(storedJob.job), full_name: storedJob.fullName } : null
  if (!job?.auto_post_review || job.review_delivery_status === 'posted' || !job.result_text) return
  db.update(jobs)
    .set({ reviewDeliveryProvider: scmProvider(job.full_name).id, reviewDeliveryStatus: 'posting' })
    .where(eq(jobs.id, jobId))
    .run()
  try {
    const body = String(job.result_text).slice(0, 65_000)
    await scmProvider(job.full_name).postReviewComment({ repository: job.full_name, number: job.pr_number }, body)
    db.update(jobs)
      .set({ reviewDeliveryStatus: 'posted', reviewDeliveredAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(jobs.id, jobId))
      .run()
    createNotification('review_posted', 'Automatic review posted', `${job.full_name} #${job.pr_number} received the agent review.`, {
      jobId,
    })
    notifyClients('review_delivery_succeeded', jobId)
  } catch (error) {
    db.update(jobs)
      .set({ reviewDeliveryStatus: 'failed', latestActivity: `Review completed, but delivery failed: ${error.message || error}` })
      .where(eq(jobs.id, jobId))
      .run()
    createNotification('task_failed', 'Automatic review posting failed', `${job.full_name} #${job.pr_number}: ${error.message || error}`, {
      jobId,
    })
    notifyClients('review_delivery_failed', jobId)
  }
}

export async function cleanupFailedLaunch(repoPath: string, worktreePath: string | null, branchName: string | null = null) {
  if (!worktreePath) return
  try {
    await run('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath])
  } catch (error) {
    console.error(`Could not clean up failed worktree ${worktreePath}:`, error instanceof Error ? error.message : error)
  }
  if (!branchName) return
  try {
    await run('git', ['-C', repoPath, 'branch', '-D', branchName])
  } catch (error) {
    console.error(`Could not clean up failed branch ${branchName}:`, error instanceof Error ? error.message : error)
  }
}

export async function createAgentWorktree(repo, runtimeAgent, revision: string, branchName: string | null = null, workspace: any = {}) {
  return allocateAgentWorktree(repo, runtimeAgent, revision, branchName, workspace, {
    run,
    assertReusable: (repository, worktree) => assertCombinedWorktreeIdle(db, worktree, repository.full_name),
    prepare: prepareRepositoryWorktree,
    cleanup: cleanupFailedLaunch,
  })
}

function requireWorktreeReviewSource(sourceJobId: number, workItemId: number) {
  const storedSource = db
    .select({
      job: jobs,
      repositoryFullName: repositories.fullName,
      repositoryCloneUrl: repositories.cloneUrl,
      repositoryLocalPath: repositories.localPath,
    })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(
      and(
        eq(jobs.id, sourceJobId),
        eq(jobs.workItemId, workItemId),
        sql`${jobs.worktreePath} IS NOT NULL`,
        sql`${jobs.worktreeRemovedAt} IS NULL`,
        notInArray(jobs.status, ['starting', 'running']),
        notInArray(jobs.kind, ['review', 'work_review', 'stack_analysis', 'planning']),
      ),
    )
    .get()
  const source = storedSource
    ? {
        ...jobRecord(storedSource.job),
        repository_full_name: storedSource.repositoryFullName,
        repository_clone_url: storedSource.repositoryCloneUrl,
        repository_local_path: storedSource.repositoryLocalPath,
      }
    : null
  const workItem = work.get(Number(workItemId))
  if (!source) throw new Error('The selected thread is not a stopped implementation worktree for this Work item')
  if (!workItem) throw new Error('The Work item is no longer available')
  const repo = {
    id: source.repo_id,
    full_name: source.repository_full_name,
    clone_url: source.repository_clone_url,
    local_path: source.repository_local_path,
  }
  return { source, workItem, repo }
}

function worktreeReviewRuntimeOptions(options: any) {
  const resolved = {
    agentId: agentProvider,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    ...agentLaunchContext.getStore(),
    ...options,
  }
  return {
    runtimeAgent: agents.require(resolved.agentId),
    model: resolved.model,
    reasoningEffort: resolved.reasoningEffort,
    serviceTier: resolved.serviceTier,
  }
}

function launchErrorMessage(error: any) {
  return String(error?.message ?? error)
}

async function inspectWorktreeReviewSource(source, repo) {
  const sourcePath = await realpath(source.worktree_path)
  const sourceGitDir = resolve((await run('git', ['-C', sourcePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
  const repositoryGitDir = resolve(
    (await run('git', ['-C', repo.local_path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
  )
  if (sourceGitDir !== repositoryGitDir) throw new Error('The selected worktree does not belong to its recorded repository')
  const sourceHead = (await run('git', ['-C', sourcePath, 'rev-parse', 'HEAD'])).trim()
  const baseSha = String(source.head_sha || sourceHead)
  await run('git', ['-C', sourcePath, 'rev-parse', '--verify', `${baseSha}^{commit}`])
  return { sourceHead, baseSha }
}

export async function launchWorktreeReview(sourceJobId: number, options: any = {}) {
  const reviewOptions = { focus: '', ...options }
  const { source, workItem, repo } = requireWorktreeReviewSource(sourceJobId, reviewOptions.workItemId)
  const { runtimeAgent, model, reasoningEffort, serviceTier } = worktreeReviewRuntimeOptions(reviewOptions)
  const ephemeral = resolveEphemeralLaunch(runtimeAgent, reviewOptions.ephemeral ?? agentLaunchContext.getStore()?.ephemeral, true)
  let failedWorktree: string | null = null
  try {
    const { sourceHead, baseSha } = await inspectWorktreeReviewSource(source, repo)
    const allocation = await createAgentWorktree(repo, runtimeAgent, sourceHead, null, {
      mode: 'combined',
      workItemKey: workItem.key,
    })
    const { worktree, baseGitDir, sessionCwd } = allocation
    const reviewHeadSha = allocation.created
      ? sourceHead
      : reusedCombinedWorktree(db, allocation, {
          workItemId: workItem.id,
          repositoryId: repo.id,
          repositoryName: repo.full_name,
          fallbackHeadSha: sourceHead,
        }).headSha
    failedWorktree = allocation.created ? worktree : null
    const prompt = systemConfiguration.prompt(
      'review',
      worktreeCodeReviewPrompt({
        key: workItem.key,
        title: workItem.title,
        description: workItem.description,
        repository: repo.full_name,
        connectedRepositories: workItem.repository_names,
        sourceRunId: source.id,
        sourceBranch: source.branch_name,
        baseSha,
        focus: String(reviewOptions.focus),
      }),
    )
    const context = `\n\nWork item workspace: ${sessionCwd}\nRepository: ${repo.full_name}\nShared repository worktree: ${worktree}\nSource Work run: #${source.id}\nReview base commit: ${baseSha}\nThis review reuses the Work item's existing repository worktree. Inspect its current state and keep the review read-only; do not modify files, branches, commits, or the linked pull request.\n\nContinue autonomously until the detailed review and relevant safe checks are complete.`
    const memoryLaunch = await workMemory.launchContext(workItem.id, `${agentSafetyBoundary()}\n\n${prompt}${context}`)
    const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
    const finalPrompt = launch.prompt
    const logPath = agentLogPath(workItem, repo, `worktree-${source.id}`)
    const result = db
      .insert(jobs)
      .values({
        repoId: repo.id,
        prNumber: 0,
        prompt: finalPrompt,
        worktreePath: worktree,
        sessionCwd,
        workspaceMode: 'combined',
        logPath,
        status: 'starting',
        baseRepoPath: repo.local_path,
        baseGitDir,
        headSha: reviewHeadSha,
        latestActivity: `Starting review in the shared worktree for thread #${source.id}…`,
        activityAt: sql`CURRENT_TIMESTAMP`,
        kind: 'work_review',
        sourceJobId: source.id,
        taskTitle: `Review ${repo.full_name} worktree · thread #${source.id}`,
        workItemId: workItem.id,
        agentModel: model,
        agentReasoningEffort: reasoningEffort,
        reviewPhase: 'details',
        reviewPhaseStartedAt: sql`CURRENT_TIMESTAMP`,
        ephemeral: ephemeral ? 1 : 0,
      })
      .run()
    const jobId = Number(result.lastInsertRowid)
    work.attachUpfrontReviewJob(workItem.id, jobId, `${repo.full_name} · thread #${source.id}`)
    const started = startMonitoredJob({
      jobId,
      logPath,
      runtimeAgent,
      userMessage: reviewOptions.focus || `Review ${workItem.key}: ${workItem.title}`,
      launch: {
        cwd: sessionCwd,
        base: repo.local_path,
        prompt: finalPrompt,
        reviewMode: true,
        model,
        reasoningEffort,
        serviceTier,
        ephemeral,
        writableRoots: memoryLaunch.writableRoots,
        mcpServers: launch.mcpServers,
      },
    })
    failedWorktree = null
    return started
  } catch (error) {
    await cleanupFailedLaunch(repo.local_path, failedWorktree)
    work.launchFailed(workItem.id, `${repo.full_name} · thread #${source.id}: ${launchErrorMessage(error)}`)
    throw error
  }
}

async function prepareRepositoryWorktree(repo, workspace, runtimeAgent) {
  await trustWorkspaceMiseConfigs(run, workspace.path)
  await runtimeAgent.prepareWorkspace?.(workspace)
  await repositoryEnvironments.prepareWorktree(repo, workspace.path)
}

export async function launchJob(
  repo,
  pr,
  prompt,
  {
    kind = 'task',
    sourceJobId = null,
    reviewMode = false,
    agentId = null,
    model = null,
    reasoningEffort = null,
    serviceTier = null,
    allowSubagents: requestedSubagents = undefined,
    ephemeral: requestedEphemeral = undefined,
    reviewBatchId = null,
    reviewRole = 'single',
    autoPostReview = false,
    automaticReview = false,
    workItemId = null,
  } = {},
) {
  const launchOptions = agentLaunchContext.getStore()
  agentId ||= launchOptions?.agentId || null
  model ||= launchOptions?.model || null
  reasoningEffort ||= launchOptions?.reasoningEffort || null
  serviceTier ||= launchOptions?.serviceTier || null
  const runtimeAgent = agents.require(agentId || agentProvider)
  const allowSubagents = resolveSubagentLaunch(runtimeAgent, requestedSubagents ?? launchOptions?.allowSubagents)
  const ephemeral = resolveEphemeralLaunch(runtimeAgent, requestedEphemeral ?? launchOptions?.ephemeral, kind === 'review')
  const sourceWork = sourceJobId
    ? db.select({ workItemId: jobs.workItemId }).from(jobs).where(eq(jobs.id, sourceJobId)).get()?.workItemId
    : null
  const workItem =
    sourceWork || workItemId
      ? work.raw(Number(sourceWork || workItemId))
      : kind === 'review' || kind === 'review_handoff'
        ? work.ensurePullRequestReview(repo, pr)
        : work.ensureRepositoryTask(repo, `Work on PR #${pr.number}: ${pr.title}`)
  if (!workItem) throw new Error('Work item not found')
  if (kind !== 'review' && kind !== 'review_handoff') work.ensurePullRequestDelivery(workItem.id, repo, pr)
  let failedWorktree: string | null = null
  try {
    await ensureClone(repo)
    const origin = (await run('git', ['-C', repo.local_path, 'remote', 'get-url', 'origin'])).trim()
    if (parseRepo(origin).toLowerCase() !== repo.full_name.toLowerCase()) {
      throw new Error(`Repository origin mismatch: expected ${repo.full_name}, found ${origin}`)
    }
    await run('git', ['-C', repo.local_path, 'fetch', 'origin', `pull/${pr.number}/head`])
    const headSha = (await run('git', ['-C', repo.local_path, 'rev-parse', 'FETCH_HEAD'])).trim()
    const allocation = await createAgentWorktree(repo, runtimeAgent, headSha, null, {
      mode: 'combined',
      workItemKey: workItem.key,
    })
    const { worktree, baseGitDir, sessionCwd } = allocation
    const recordedHeadSha = allocation.created
      ? headSha
      : reusedCombinedWorktree(db, allocation, {
          workItemId: workItem.id,
          repositoryId: repo.id,
          repositoryName: repo.full_name,
          fallbackHeadSha: headSha,
        }).headSha
    failedWorktree = allocation.created ? worktree : null
    const context = `\n\nWork item workspace: ${sessionCwd}\nRepository: ${repo.full_name}\nOriginal checkout: ${repo.local_path}\nAssigned pull-request worktree: ${worktree}\nPull request: #${pr.number} — ${pr.title}\nPR URL: ${pr.url}\nStart from the Work item workspace and work only in the assigned PR worktree. It is linked to the original checkout through shared Git metadata.\n\nContinue autonomously until the requested work is fully complete and verified. Progress messages, acknowledgements, and plans are not completion. Do not end the turn after describing what you will do; perform the work and its relevant checks first. End only with the completed outcome or a concrete blocking question that requires user input.`
    const configuredPrompt = systemConfiguration.prompt(kind === 'review' || kind === 'review_handoff' ? 'review' : 'work', prompt)
    const memoryLaunch = await workMemory.launchContext(workItem.id, `${agentSafetyBoundary()}\n\n${configuredPrompt.trim()}${context}`)
    const launch = await resolveAgentLaunch(workItem.id, memoryLaunch.prompt, runtimeAgent.id)
    const finalPrompt = launch.prompt
    const logPath = agentLogPath(workItem, repo, `pr-${pr.number}`)
    const result = db
      .insert(jobs)
      .values({
        repoId: repo.id,
        prNumber: pr.number,
        prompt: finalPrompt,
        worktreePath: worktree,
        sessionCwd,
        workspaceMode: 'combined',
        logPath,
        status: 'starting',
        baseRepoPath: repo.local_path,
        baseGitDir,
        headSha: recordedHeadSha,
        latestActivity: allocation.created ? 'Preparing agent worktree…' : 'Reusing Work item repository worktree…',
        activityAt: sql`CURRENT_TIMESTAMP`,
        kind,
        sourceJobId,
        reviewBatchId,
        reviewRole,
        autoPostReview: autoPostReview ? 1 : 0,
        automaticReview: automaticReview ? 1 : 0,
        agentModel: model,
        agentReasoningEffort: reasoningEffort,
        reviewPhase: kind === 'review' ? 'details' : null,
        reviewPhaseStartedAt: sql`CURRENT_TIMESTAMP`,
        taskTitle: kind === 'review' ? `Review PR #${pr.number}: ${pr.title}`.slice(0, 200) : null,
        workItemId: workItem.id,
        ephemeral: ephemeral ? 1 : 0,
      })
      .run()
    const jobId = Number(result.lastInsertRowid)
    work.attachJob(
      workItem.id,
      jobId,
      kind === 'review' ? `Started review thread for PR #${pr.number}` : `Started thread for PR #${pr.number}`,
    )
    const started = startMonitoredJob({
      jobId,
      logPath,
      runtimeAgent,
      userMessage: prompt,
      launch: {
        cwd: sessionCwd,
        base: repo.local_path,
        prompt: finalPrompt,
        reviewMode,
        model,
        reasoningEffort,
        serviceTier,
        allowSubagents,
        ephemeral,
        writableRoots: memoryLaunch.writableRoots,
        mcpServers: launch.mcpServers,
      },
    })
    if (kind === 'review') capturePullRequestDiff(jobId, repo.full_name, pr.number)
    failedWorktree = null
    return started
  } catch (error) {
    await cleanupFailedLaunch(repo.local_path, failedWorktree)
    work.launchFailed(workItem.id, error)
    throw error
  }
}

function capturePullRequestDiff(jobId: number, repository: string, number: number) {
  void scmProvider(repository)
    .pullRequestDiff({ repository, number })
    .then((diff) => {
      if (diff.trim()) storeJobDiff(jobId, diff)
    })
    .catch(() => undefined)
}

export async function updateReviewBatchForJob(jobId) {
  const job = db
    .select({ reviewBatchId: jobs.reviewBatchId, reviewRole: jobs.reviewRole, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .get()
  if (!job?.reviewBatchId) return
  if (job.reviewRole === 'aggregate') {
    db.update(reviewBatches)
      .set({ status: job.status === 'completed' ? 'completed' : 'failed', finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewBatches.id, job.reviewBatchId))
      .run()
    notifyClients('review_batch_completed', jobId)
    return
  }
  await maybeLaunchReviewAggregate(job.reviewBatchId)
}

export async function maybeLaunchReviewAggregate(batchId) {
  const storedBatch = db
    .select()
    .from(reviewBatches)
    .where(and(eq(reviewBatches.id, batchId), eq(reviewBatches.status, 'pending')))
    .get()
  const batch = storedBatch ? reviewBatchRecord(storedBatch) : null
  if (!batch) return
  const members = db
    .select({
      id: jobs.id,
      agent_id: jobs.agentId,
      status: jobs.status,
      result_text: jobs.resultText,
      source_job_id: jobs.sourceJobId,
    })
    .from(jobs)
    .where(and(eq(jobs.reviewBatchId, batchId), eq(jobs.reviewRole, 'member')))
    .orderBy(asc(jobs.id))
    .all()
  if (!members.length || members.some((member) => ['starting', 'running'].includes(member.status))) return
  const claimed = db
    .update(reviewBatches)
    .set({ status: 'aggregating' })
    .where(and(eq(reviewBatches.id, batchId), eq(reviewBatches.status, 'pending')))
    .run()
  if (!claimed.changes) return
  const storedRepository = db.select().from(repositories).where(eq(repositories.id, batch.repo_id)).get()
  const storedPullRequest = db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, batch.repo_id), eq(pullRequests.number, batch.pr_number)))
    .get()
  const repo = storedRepository ? repositoryRecord(storedRepository) : null
  const pr = storedPullRequest ? pullRequestRecord(storedPullRequest) : null
  if (!repo || !pr)
    return db
      .update(reviewBatches)
      .set({ status: 'failed', finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewBatches.id, batchId))
      .run()
  let launchErrors = []
  try {
    launchErrors = JSON.parse(batch.launch_errors || '[]')
  } catch {}
  const failedLaunches = launchErrors.length
    ? `## Review agents that could not start\n\n${launchErrors.map((entry) => `- ${entry.agent_id}: ${entry.error}`).join('\n')}\n\n---\n\n`
    : ''
  const reports = `${failedLaunches}${members.map((member) => `## ${agents.get(member.agent_id)?.name || member.agent_id} review (run #${member.id}, ${member.status})\n\n${member.result_text || 'No review report was produced.'}`).join('\n\n---\n\n')}`
  const prompt = aggregateReviewPrompt(reports)
  try {
    const aggregate = await launchJob(repo, pr, prompt, {
      kind: 'review',
      reviewMode: true,
      agentId: batch.aggregator_agent_id,
      reviewBatchId: batchId,
      reviewRole: 'aggregate',
      sourceJobId: members.find((member) => member.source_job_id)?.source_job_id || null,
    })
    db.update(reviewBatches).set({ aggregateJobId: aggregate.id }).where(eq(reviewBatches.id, batchId)).run()
    notifyClients('review_aggregation_started', aggregate.id)
  } catch (error) {
    db.update(reviewBatches)
      .set({ status: 'failed', finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewBatches.id, batchId))
      .run()
    createNotification('task_failed', 'Review aggregation failed', `${repo.full_name} #${pr.number}: ${error.message || error}`)
  }
}

export async function launchAutomaticReview(repo, pr, agentId) {
  const headSha = pr.head?.sha || pr.head_sha
  const stored = db
    .select({ auto_reviewed_head_sha: pullRequests.autoReviewedHeadSha, auto_review_watch: pullRequests.autoReviewWatch })
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
    .get()
  const latestAutomatic = db
    .select({ id: jobs.id, head_sha: jobs.headSha })
    .from(jobs)
    .where(and(eq(jobs.repoId, repo.id), eq(jobs.prNumber, pr.number), eq(jobs.automaticReview, 1)))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  if (
    !automaticReviewLaunchAllowed({
      headSha,
      reviewedHeadSha: stored?.auto_reviewed_head_sha,
      latestAutomaticHeadSha: latestAutomatic?.head_sha,
      watched: Boolean(stored?.auto_review_watch),
    })
  ) {
    const reviewedHeadSha = stored?.auto_reviewed_head_sha || latestAutomatic?.head_sha
    if (reviewedHeadSha && stored?.auto_reviewed_head_sha !== reviewedHeadSha) {
      db.update(pullRequests)
        .set({ autoReviewedHeadSha: reviewedHeadSha })
        .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
        .run()
    }
    return 'already_started'
  }
  const active = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.repoId, repo.id), eq(jobs.prNumber, pr.number), eq(jobs.kind, 'review'), inArray(jobs.status, ['starting', 'running'])),
    )
    .get()
  if (active) return 'deferred'
  try {
    const automation = reviewAutomationSettings()
    const useConfiguredOptions = automation.agentId === agentId
    const job = await launchJob(repo, pr, codeReviewPrompt(pr), {
      kind: 'review',
      reviewMode: true,
      agentId,
      model: useConfiguredOptions ? automation.model : null,
      reasoningEffort: useConfiguredOptions ? automation.reasoningEffort : null,
      allowSubagents: useConfiguredOptions ? automation.allowSubagents : false,
      autoPostReview: automation.postToGitHub,
      automaticReview: true,
    })
    db.update(pullRequests)
      .set({ autoReviewedHeadSha: headSha })
      .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
      .run()
    createNotification('review_started', 'Automatic review started', `${repo.full_name} #${pr.number} was assigned to you.`, {
      jobId: job.id,
    })
    return 'started'
  } catch (error) {
    createNotification('task_failed', 'Automatic review failed', `${repo.full_name} #${pr.number}: ${error.message || error}`)
    throw error
  }
}

export async function launchReviewSelection(repo, pr, agentIds, aggregatorAgentId = null, launchOptions: any = {}) {
  const selected = [...new Set<string>(agentIds.map(String))].slice(0, 8)
  if (!selected.length) throw new Error('Choose at least one review agent')
  for (const agentId of selected) agents.require(agentId)
  const reviewWorkItem = launchOptions.workItemId || work.ensurePullRequestReview(repo, pr).id
  const reviewPrompt = launchOptions.promptPrefix
    ? `${String(launchOptions.promptPrefix).trim()}\n\n${codeReviewPrompt(pr)}`
    : codeReviewPrompt(pr)
  if (selected.length === 1)
    return {
      threads: [
        await launchJob(repo, pr, reviewPrompt, {
          kind: 'review',
          reviewMode: true,
          agentId: selected[0],
          model: launchOptions.model,
          reasoningEffort: launchOptions.reasoningEffort,
          serviceTier: launchOptions.serviceTier,
          allowSubagents: launchOptions.allowSubagents,
          ephemeral: launchOptions.ephemeral,
          sourceJobId: launchOptions.sourceJobId,
          workItemId: reviewWorkItem,
        }),
      ],
      batch_id: null,
    }
  const aggregator = aggregatorAgentId || selected[0]
  agents.require(aggregator)
  const batch = db.insert(reviewBatches).values({ repoId: repo.id, prNumber: pr.number, aggregatorAgentId: aggregator }).run()
  const batchId = Number(batch.lastInsertRowid)
  const threads = []
  const launchErrors = []
  for (const agentId of selected) {
    try {
      threads.push(
        await launchJob(repo, pr, reviewPrompt, {
          kind: 'review',
          reviewMode: true,
          agentId,
          allowSubagents: launchOptions.allowSubagents,
          ephemeral: launchOptions.ephemeral,
          reviewBatchId: batchId,
          reviewRole: 'member',
          sourceJobId: launchOptions.sourceJobId,
          workItemId: reviewWorkItem,
        }),
      )
    } catch (error) {
      launchErrors.push({
        agent_id: agentId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (launchErrors.length)
    db.update(reviewBatches)
      .set({ launchErrors: JSON.stringify(launchErrors) })
      .where(eq(reviewBatches.id, batchId))
      .run()
  if (!threads.length) {
    db.update(reviewBatches)
      .set({ status: 'failed', finishedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewBatches.id, batchId))
      .run()
    throw new AggregateError(
      launchErrors.map((entry) => new Error(`${entry.agent_id}: ${entry.error}`)),
      'No review agents could be started',
    )
  }
  return { threads, batch_id: batchId, launch_errors: launchErrors }
}

export const monitorJobProcess = createJobProcessMonitor({
  updateReviewBatchForJob,
  extractReviewSuggestions,
  postAutomaticReviewToGitHub,
  persistDetectedThreadContext,
})
