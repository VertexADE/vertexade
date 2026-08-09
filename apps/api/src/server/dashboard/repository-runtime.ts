import { appendFile, readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
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
  automaticReviewSyncTrigger,
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
import {
  agentProcessEnvironment,
  applySubagentInstructions,
  migrateAgentEnvironmentsV1,
  trustWorkspaceMiseConfigs,
} from '@vertexade/platform-server/agents'
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
import { removeProviderThread } from '../work/provider-thread-cleanup.ts'
import { withWorktreeOwnershipRepair } from '../work/worktree-ownership.ts'
import { localizePromptImages } from '../prompt-images.ts'
import { invalidateLogEventContext, readFileTail, readLogEventContext } from '../log-files.ts'
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
  runtimePROMPT_IMAGES as PROMPT_IMAGES,
  runtimeAgent as agent,
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeAuthenticatedScmUsers as authenticatedScmUsers,
  runtimeDb as db,
  runtimeJobLifecycle as jobLifecycle,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimePrDetailsCache as prDetailsCache,
  runtimeRequestedAgent as requestedAgent,
  runtimeReviewAutomationSettings as reviewAutomationSettings,
  runtimeRun as run,
  runtimeRunReadOnlyContentGeneration as runReadOnlyContentGeneration,
  runtimeScmProvider as scmProvider,
  runtimeWork as work,
  runtimeWorkCleanup as workCleanup,
  runtimeWorktreePreviews as worktreePreviews,
} from './runtime-context.ts'
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm'
import { automaticReviewQueue, jobs, pullRequests, repositories, repositoryAgentBootstraps } from '../database/schema/tables.ts'
import { automaticReviewQueueRecord, jobRecord, pullRequestRecord, repositoryRecord } from '../database/contract-records.ts'

function storedRepository(repositoryId: number) {
  const repository = db.select().from(repositories).where(eq(repositories.id, repositoryId)).get()
  return repository ? repositoryRecord(repository) : null
}

function storedPullRequest(repositoryId: number, number: number) {
  const pullRequest = db
    .select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repositoryId), eq(pullRequests.number, number)))
    .get()
  return pullRequest ? pullRequestRecord(pullRequest) : null
}

function storedJob(jobId: number) {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
  return job ? jobRecord(job) : null
}
import { runtimeFollowUpJob as followUpJob } from './runtime-context.ts'
import { runtimeLaunchAutomaticReview as launchAutomaticReview } from './runtime-context.ts'
import { runtimeMonitorJobProcess as monitorJobProcess, runtimeSpawnAgentThread as spawnAgentThread } from './runtime-context.ts'
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

export async function generateWorkItemTitle(input: { context: string; kind: string }, defaults: ContentGenerationDefaults) {
  return normalizeGeneratedWorkItemTitle(await runReadOnlyContentGeneration(workItemTitlePrompt(input), defaults))
}

function runAgentThread(options: any, runOptions: any, runtimeAgent = requestedAgent()) {
  const launch = runtimeAgent.launch(localizeAgentPrompt({ ...agentLaunchContext.getStore(), ...options }))
  return run(launch.command, launch.args, {
    ...runOptions,
    env: agentProcessEnvironment(process.env, runtimeAgent.environment?.() || {}, launch.env),
  })
}

export function localizeAgentPrompt(options: any) {
  if (!options.prompt) return options
  const prompt = localizePromptImages(String(options.prompt), PROMPT_IMAGES)
  return { ...options, prompt: applySubagentInstructions(prompt, options.allowSubagents) }
}

export function parseRepo(input) {
  return scmProvider(input).parseRepository(input).id
}

export const allowedBranchTypes = new Set(['feature', 'fix', 'chore', 'refactor', 'test', 'docs'])
export const usesReviewWorkspace = (kind) => ['review', 'work_review'].includes(kind)

export async function scmUser(repository = '') {
  const provider = scmProvider(repository)
  let authenticated = authenticatedScmUsers.get(provider.id)
  if (!authenticated) {
    const user = await provider.currentUser()
    authenticated = { login: user.login, avatar_url: user.avatarUrl }
    authenticatedScmUsers.set(provider.id, authenticated)
  }
  return authenticated
}

let automaticReviewQueueDraining = false
let automaticReviewQueueDrainRequested = false

function activeAutomaticReviewCount() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.automaticReview, 1), inArray(jobs.status, ['starting', 'running'])))
    .get()!.count
}

export function automaticReviewQueueState() {
  const queue = db
    .select({
      id: automaticReviewQueue.id,
      repo_id: automaticReviewQueue.repoId,
      pr_number: automaticReviewQueue.prNumber,
      head_sha: automaticReviewQueue.headSha,
      agent_id: automaticReviewQueue.agentId,
      attempts: automaticReviewQueue.attempts,
      last_error: automaticReviewQueue.lastError,
      queued_at: automaticReviewQueue.queuedAt,
      full_name: repositories.fullName,
      title: pullRequests.title,
    })
    .from(automaticReviewQueue)
    .innerJoin(repositories, eq(repositories.id, automaticReviewQueue.repoId))
    .leftJoin(
      pullRequests,
      and(eq(pullRequests.repoId, automaticReviewQueue.repoId), eq(pullRequests.number, automaticReviewQueue.prNumber)),
    )
    .orderBy(asc(automaticReviewQueue.queuedAt), asc(automaticReviewQueue.id))
    .all()
    .map((item, index) => ({ ...item, position: index + 1 }))
  return { activeReviews: activeAutomaticReviewCount(), queuedReviews: queue.length, queue }
}

export function enqueueAutomaticReview(repo, pr, agentId) {
  const headSha = pr.head?.sha || pr.head_sha
  if (!headSha) return
  const inserted = db
    .insert(automaticReviewQueue)
    .values({ repoId: repo.id, prNumber: pr.number, headSha, agentId })
    .onConflictDoUpdate({
      target: [automaticReviewQueue.repoId, automaticReviewQueue.prNumber, automaticReviewQueue.headSha],
      set: { agentId, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .run()
  if (inserted.changes) notifyClients('automatic_review_queued')
  void drainAutomaticReviewQueue()
}

async function processQueuedAutomaticReview(item) {
  const repo = storedRepository(item.repo_id)
  const pr = storedPullRequest(item.repo_id, item.pr_number)
  if (!repo || !pr || pr.head_sha !== item.head_sha) {
    db.delete(automaticReviewQueue).where(eq(automaticReviewQueue.id, item.id)).run()
    return 'removed'
  }
  const trigger = automaticReviewTrigger({
    headSha: item.head_sha,
    reviewedHeadSha: pr.auto_reviewed_head_sha,
    watched: Boolean(pr.auto_review_watch),
    initialMatched: true,
  })
  if (!trigger) {
    db.delete(automaticReviewQueue).where(eq(automaticReviewQueue.id, item.id)).run()
    return 'removed'
  }
  try {
    const outcome = await launchAutomaticReview(repo, pr, item.agent_id)
    if (outcome === 'deferred') return outcome
    db.delete(automaticReviewQueue).where(eq(automaticReviewQueue.id, item.id)).run()
    return outcome
  } catch (error) {
    db.update(automaticReviewQueue)
      .set({
        attempts: sql`${automaticReviewQueue.attempts} + 1`,
        lastError: String(error.message || error).slice(0, 2000),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(automaticReviewQueue.id, item.id))
      .run()
    return 'failed'
  }
}

export async function drainAutomaticReviewQueue() {
  if (automaticReviewQueueDraining) {
    automaticReviewQueueDrainRequested = true
    return
  }
  automaticReviewQueueDraining = true
  try {
    const automation = reviewAutomationSettings()
    if (!automation.enabled) return
    if (!automaticReviewCapacity(automation.concurrency, activeAutomaticReviewCount())) return
    const queued = db
      .select()
      .from(automaticReviewQueue)
      .orderBy(asc(automaticReviewQueue.queuedAt), asc(automaticReviewQueue.id))
      .all()
      .map(automaticReviewQueueRecord)
    let changed = false
    for (const item of queued) {
      const current = reviewAutomationSettings()
      if (!current.enabled || !automaticReviewCapacity(current.concurrency, activeAutomaticReviewCount())) break
      const outcome = await processQueuedAutomaticReview(item)
      if (outcome === 'deferred') continue
      changed = true
    }
    if (changed) notifyClients('automatic_review_queue_updated')
  } finally {
    automaticReviewQueueDraining = false
    if (automaticReviewQueueDrainRequested) {
      automaticReviewQueueDrainRequested = false
      queueMicrotask(() => {
        void drainAutomaticReviewQueue()
      })
    }
  }
}

export function startAutomaticReviewQueue() {
  setTimeout(() => {
    void drainAutomaticReviewQueue()
  }, 1_000).unref()
}

export async function syncRepository(repo) {
  const automation = reviewAutomationSettings()
  const currentUser = await scmUser(repo.full_name).catch(() => null)
  const autoReviewCandidates = []
  const [prs, statusItems] = await Promise.all([
    scmProvider(repo.full_name).listOpenPullRequests(repo.full_name),
    scmProvider(repo.full_name).pullRequestStatus(repo.full_name),
  ])
  const statuses = new Map<any, any>(statusItems.map((pr) => [pr.number, pr]))
  const seen = []
  for (const pr of prs) {
    const previous = storedPullRequest(repo.id, pr.number)
    seen.push(pr.number)
    const status = statuses.get(pr.number) || {}
    const checks = status.statusCheckRollup || []
    const pendingChecks = checks.filter(
      (check) => (check.status && check.status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(check.state),
    ).length
    const failedChecks = checks.filter(
      (check) =>
        (check.conclusion && !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion)) || ['ERROR', 'FAILURE'].includes(check.state),
    ).length
    const latestCommentAt =
      (status.comments || [])
        .map((comment) => comment.updatedAt || comment.createdAt)
        .filter(Boolean)
        .sort()
        .at(-1) || null
    const nextReviewers = (pr.requested_reviewers || []).map((reviewer) => ({
      login: reviewer.login,
      avatar_url: reviewer.avatar_url,
    }))
    const values = {
      repoId: repo.id,
      number: pr.number,
      title: pr.title,
      author: pr.user?.login || '',
      authorAvatarUrl: pr.user?.avatar_url || null,
      url: pr.html_url,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
      draft: pr.draft ? 1 : 0,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      labels: JSON.stringify((pr.labels || []).map((label) => ({ name: label.name, color: label.color }))),
      reviewers: JSON.stringify(nextReviewers),
      mergeStateStatus: status.mergeStateStatus || null,
      checksPending: pendingChecks,
      checksFailed: failedChecks,
      latestCommentAt,
      autoMergeEnabled: status.autoMergeRequest ? 1 : 0,
      reviewDecision: status.reviewDecision || null,
    }
    db.insert(pullRequests)
      .values(values)
      .onConflictDoUpdate({
        target: [pullRequests.repoId, pullRequests.number],
        set: values,
      })
      .run()
    const currentStoredPullRequest = storedPullRequest(repo.id, pr.number)
    const requestedForCurrentUser = Boolean(
      currentUser && nextReviewers.some((reviewer) => reviewer.login?.toLowerCase() === currentUser.login.toLowerCase()),
    )
    work.syncPullRequest(repo, currentStoredPullRequest, requestedForCurrentUser)
    const nextLabels = JSON.stringify((pr.labels || []).map((label) => ({ name: label.name, color: label.color })))
    const nextReviewerJson = JSON.stringify(nextReviewers)
    if (!previous) notifyClients('pr_opened', pr.number)
    else {
      if (previous.head_sha !== pr.head.sha) notifyClients('pr_head_changed', pr.number)
      if (previous.title !== pr.title) notifyClients('pr_title_changed', pr.number)
      if (previous.labels !== nextLabels) notifyClients('pr_labels_changed', pr.number)
      if (previous.reviewers !== nextReviewerJson) notifyClients('pr_reviewers_changed', pr.number)
      if (
        previous.merge_state_status !== (status.mergeStateStatus || null) ||
        Number(previous.checks_pending) !== pendingChecks ||
        Number(previous.checks_failed) !== failedChecks ||
        previous.review_decision !== (status.reviewDecision || null) ||
        Boolean(previous.draft) !== Boolean(pr.draft)
      )
        notifyClients('pr_status_changed', pr.number)
    }
    const watchedForUpdates = Boolean(previous?.auto_review_watch)
    if ((automation.enabled || watchedForUpdates) && previous?.auto_reviewed_head_sha !== pr.head.sha) {
      const normalizedTitle = String(pr.title || '').toLowerCase()
      const normalizedLabels = (pr.labels || []).map((label) => String(label.name || '').toLowerCase())
      const titleMatched = automation.titleSubstrings.some((value) => normalizedTitle.includes(value.toLowerCase()))
      const labelMatched = automation.labelSubstrings.some((value) => normalizedLabels.some((label) => label.includes(value.toLowerCase())))
      let assignmentMatched = false
      if (automation.onAssigned && currentUser && previous) {
        const wasAssigned = JSON.parse(previous.reviewers || '[]').some(
          (reviewer) => reviewer.login?.toLowerCase() === currentUser.login.toLowerCase(),
        )
        const isAssigned = nextReviewers.some((reviewer) => reviewer.login?.toLowerCase() === currentUser.login.toLowerCase())
        assignmentMatched = !wasAssigned && isAssigned
      }
      const trigger = automaticReviewSyncTrigger({
        automationEnabled: automation.enabled,
        headSha: pr.head.sha,
        reviewedHeadSha: previous?.auto_reviewed_head_sha,
        watched: watchedForUpdates,
        initialMatched: assignmentMatched || titleMatched || labelMatched,
      })
      if (trigger)
        autoReviewCandidates.push({
          pr: storedPullRequest(repo.id, pr.number),
          agentId: automation.enabled ? automation.agentId : agentProvider,
        })
    }
    const readiness = db
      .select({
        manual_not_ready_at: pullRequests.manualNotReadyAt,
        not_ready_head_sha: pullRequests.notReadyHeadSha,
        not_ready_comment_at: pullRequests.notReadyCommentAt,
      })
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
      .get()!
    if (readiness.manual_not_ready_at) {
      const migratingCommentBaseline = readiness.not_ready_comment_at === '__migrate__'
      if (migratingCommentBaseline) {
        db.update(pullRequests)
          .set({ notReadyCommentAt: latestCommentAt || '' })
          .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
          .run()
      }
      if (
        (readiness.not_ready_head_sha && readiness.not_ready_head_sha !== pr.head.sha) ||
        (!migratingCommentBaseline && latestCommentAt && latestCommentAt > (readiness.not_ready_comment_at || ''))
      ) {
        db.update(pullRequests)
          .set({
            updatedAfterNotReadyAt: sql`CURRENT_TIMESTAMP`,
            manualNotReadyAt: null,
            notReadyHeadSha: null,
            notReadyCommentAt: null,
          })
          .where(and(eq(pullRequests.repoId, repo.id), eq(pullRequests.number, pr.number)))
          .run()
      }
    }
    db.update(jobs)
      .set({ prClosedAt: null, prMergedAt: null, prTitle: pr.title, prUrl: pr.html_url })
      .where(and(eq(jobs.repoId, repo.id), or(eq(jobs.prNumber, pr.number), eq(jobs.linkedPrNumber, pr.number))))
      .run()
  }
  if (seen.length)
    db.delete(pullRequests)
      .where(and(eq(pullRequests.repoId, repo.id), notInArray(pullRequests.number, seen)))
      .run()
  else db.delete(pullRequests).where(eq(pullRequests.repoId, repo.id)).run()
  const prunedQueue = db
    .delete(automaticReviewQueue)
    .where(
      and(
        eq(automaticReviewQueue.repoId, repo.id),
        sql`NOT EXISTS (
          SELECT 1 FROM pull_requests p
          WHERE p.repo_id=${automaticReviewQueue.repoId}
            AND p.number=${automaticReviewQueue.prNumber}
            AND p.head_sha=${automaticReviewQueue.headSha}
        )`,
      ),
    )
    .run()
  if (prunedQueue.changes) notifyClients('automatic_review_queue_updated')
  db.update(repositories)
    .set({ syncedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(repositories.id, repo.id))
    .run()
  await linkRepositoryTasks(repo)
  for (const candidate of autoReviewCandidates) enqueueAutomaticReview(repo, candidate.pr, candidate.agentId)
  mergedStateCache.delete(repo.id)
  await refreshClosedThreadStateForRepo(repo)
  for (const key of prDetailsCache.keys()) if (key.startsWith(`${repo.id}:`)) prDetailsCache.delete(key)
  notifyClients('repository', repo.id)
  return prs.length
}

let scheduledRepositorySyncRunning = false
export async function refreshAllRepositories() {
  if (scheduledRepositorySyncRunning) return { running: true, repositories: 0, open_prs: 0, errors: [] }
  scheduledRepositorySyncRunning = true
  const summary = { running: false, repositories: 0, open_prs: 0, errors: [] }
  try {
    const storedRepositories = db.select().from(repositories).orderBy(asc(repositories.id)).all().map(repositoryRecord)
    for (const repo of storedRepositories) {
      try {
        summary.open_prs += await syncRepository(repo)
        summary.repositories += 1
      } catch (error) {
        console.error(`Scheduled PR refresh failed for ${repo.full_name}:`, error.message || error)
        summary.errors.push({ repository: repo.full_name, error: error.message || String(error) })
      }
    }
  } finally {
    scheduledRepositorySyncRunning = false
  }
  return summary
}

export function startRepositoryRefreshTimer() {
  setInterval(
    () => {
      void refreshAllRepositories()
    },
    5 * 60 * 1000,
  ).unref()
}

async function linkRepositoryTasks(repo) {
  const tasks = db
    .select({ id: jobs.id, branch_name: jobs.branchName })
    .from(jobs)
    .where(and(eq(jobs.repoId, repo.id), eq(jobs.kind, 'pre_pr'), isNull(jobs.linkedPrNumber), isNotNull(jobs.branchName)))
    .all()
  if (!tasks.length) return 0
  const pullRequests = await scmProvider(repo.full_name).listPullRequests(repo.full_name, 'all', 100, ['number', 'url', 'headRefName'])
  const byBranch = new Map<any, any>(pullRequests.map((pr) => [pr.headRefName, pr]))
  let linked = 0
  for (const task of tasks) {
    const pr = byBranch.get(task.branch_name)
    if (!pr) continue
    db.update(jobs).set({ linkedPrNumber: pr.number, linkedPrUrl: pr.url }).where(eq(jobs.id, task.id)).run()
    const currentPullRequest = storedPullRequest(repo.id, pr.number)
    if (currentPullRequest) work.linkRepositoryTaskPullRequest(task.id, repo, currentPullRequest)
    linked++
  }
  if (linked) notifyClients('task_linked')
  return linked
}

const mergedStateCache = new Map()
let mergedStateRefreshPromise
async function refreshClosedThreadStateForRepo(repo) {
  if (Date.now() - (mergedStateCache.get(repo.id) || 0) < 60_000) return
  const closed = await scmProvider(repo.full_name).listPullRequests(repo.full_name, 'closed', 500, [
    'number',
    'title',
    'url',
    'closedAt',
    'mergedAt',
    'mergeCommit',
  ])
  for (const pr of closed) {
    db.update(jobs)
      .set({
        prClosedAt: pr.closedAt || pr.mergedAt || new Date().toISOString(),
        prMergedAt: pr.mergedAt || null,
        prTitle: pr.title,
        prUrl: pr.url,
      })
      .where(and(eq(jobs.repoId, repo.id), or(eq(jobs.prNumber, pr.number), eq(jobs.linkedPrNumber, pr.number))))
      .run()
    work.syncPullRequest(repo, { ...pr, closed_at: pr.closedAt, merged_at: pr.mergedAt, merge_sha: pr.mergeCommit?.oid }, false)
  }
  const cleanup = await workCleanup.removeMergedWorktrees(repo.id)
  for (const error of cleanup.errors) {
    console.error(`Automatic merged worktree cleanup failed for ${error.target}: ${error.error}`)
  }
  mergedStateCache.set(repo.id, Date.now())
}

export function refreshMergedThreadState() {
  if (mergedStateRefreshPromise) return mergedStateRefreshPromise
  mergedStateRefreshPromise = (async () => {
    const repos = db
      .selectDistinct({ repository: repositories })
      .from(repositories)
      .innerJoin(jobs, eq(jobs.repoId, repositories.id))
      .where(isNotNull(jobs.threadId))
      .all()
      .map(({ repository }) => repositoryRecord(repository))
    await Promise.all(
      repos.map(async (repo) => {
        if (Date.now() - (mergedStateCache.get(repo.id) || 0) < 60_000) return
        try {
          await refreshClosedThreadStateForRepo(repo)
        } catch {}
      }),
    )
  })().finally(() => {
    mergedStateRefreshPromise = undefined
  })
  return mergedStateRefreshPromise
}

export function startMergedThreadRefreshTimer() {
  void refreshMergedThreadState()
  setInterval(() => {
    void refreshMergedThreadState()
  }, 60_000).unref()
}

export async function deleteThreadJob(job) {
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  if (['starting', 'running'].includes(job.status))
    throw new Error(`Stop or finish the active ${runtimeAgent.name} turn before deleting its thread`)
  await worktreePreviews.stopAndWait(job.id)
  const providerThreadRemoved = await removeProviderThread(runtimeAgent, job.thread_id, Boolean(job.ephemeral))
  db.update(jobs).set({ sourceJobId: null }).where(eq(jobs.sourceJobId, job.id)).run()
  db.delete(jobs).where(eq(jobs.id, job.id)).run()
  try {
    await unlink(job.log_path)
  } catch {}
  invalidateLogEventContext(job.log_path)
  const remaining = db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.worktreePath, job.worktree_path), isNotNull(jobs.threadId)))
    .get()!
  let worktreeRemoved = false
  if (Number(remaining.count) === 0) {
    try {
      await run('git', ['-C', job.base_repo_path, 'worktree', 'remove', '--force', job.worktree_path])
      await run('git', ['-C', job.base_repo_path, 'worktree', 'prune'])
      worktreeRemoved = true
    } catch {}
  }
  notifyClients('thread_deleted', job.id)
  return { deleted: true, worktree_removed: worktreeRemoved, provider_thread_retained: !providerThreadRemoved }
}

export async function pullRequestDetails(repo, pr) {
  const key = `${repo.id}:${pr.number}`
  const cached = prDetailsCache.get(key)
  if (cached) return cached
  const fields =
    'title,body,author,createdAt,updatedAt,additions,deletions,changedFiles,commits,comments,reviews,statusCheckRollup,assignees,milestone,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName,url,isDraft,labels'
  const ref = { repository: repo.full_name, number: pr.number }
  const selectedScm = scmProvider(ref.repository)
  const shadowReview = db
    .select({
      id: jobs.id,
      agentName: jobs.agentId,
      body: jobs.reviewSummary,
      fallbackBody: jobs.reviewDetails,
      resultText: jobs.resultText,
      createdAt: jobs.finishedAt,
    })
    .from(jobs)
    .where(and(eq(jobs.repoId, repo.id), eq(jobs.prNumber, pr.number), eq(jobs.kind, 'review'), eq(jobs.status, 'completed')))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  const [overview, diff, reviewThreads] = await Promise.all([
    selectedScm.pullRequestDetails(ref, fields.split(',')),
    selectedScm.pullRequestDiff(ref),
    selectedScm
      .reviewThreads(ref)
      .then((output) => output.data?.repository?.pullRequest?.reviewThreads?.nodes || [])
      .catch(() => []),
  ])
  const value = {
    ...overview,
    full_name: repo.full_name,
    number: pr.number,
    diff,
    diff_summary: summarizeDiff(diff),
    reviewThreads,
    reference_presentation: selectedScm.referencePresentation?.(ref.repository) || null,
    scm_provider_name: selectedScm.name,
    shadow_review: shadowReview
      ? {
          id: shadowReview.id,
          author: shadowReview.agentName,
          body: shadowReview.body || shadowReview.fallbackBody || shadowReview.resultText || '',
          created_at: shadowReview.createdAt,
        }
      : null,
  }
  prDetailsCache.set(key, value)
  return value
}

export function pullRequestContext(repoId: number, number: number) {
  const repo = storedRepository(repoId)
  const pr = storedPullRequest(repoId, number)
  return repo && pr ? { repo, pr } : null
}

export function publishReviewMutation(repoId: number, number: number, status: number, value: unknown) {
  prDetailsCache.delete(`${repoId}:${number}`)
  notifyClients('pr_review_comments_updated', number)
  return json(status, value)
}

export async function repositoryLabels(repo) {
  return (await scmProvider(repo.full_name).listLabels(repo.full_name))
    .map((label) => ({
      name: label.name,
      color: label.color,
      description: label.description || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function repositoryReviewers(repo) {
  return (await scmProvider(repo.full_name).listCollaborators(repo.full_name))
    .map((reviewer) => ({ login: reviewer.login, avatar_url: reviewer.avatar_url }))
    .sort((a, b) => a.login.localeCompare(b.login))
}

export async function ensureClone(repo) {
  let cloned = false
  try {
    await stat(join(repo.local_path, '.git'))
    cloned = true
  } catch {}
  if (cloned) {
    await run('git', ['-C', repo.local_path, 'fetch', '--prune', 'origin'])
  } else {
    await mkdir(dirname(repo.local_path), { recursive: true })
    await run('git', ['clone', repo.clone_url, repo.local_path])
  }
}

export async function bootstrapAgentRepository(repo) {
  await ensureClone(repo)
  await runAgentThread(
    { cwd: repo.local_path, base: repo.local_path, prompt: agent.bootstrapPrompt || 'hi' },
    {
      cwd: repo.local_path,
    },
  )
  db.insert(repositoryAgentBootstraps)
    .values({ repositoryId: repo.id, agentId: agentProvider })
    .onConflictDoUpdate({
      target: [repositoryAgentBootstraps.repositoryId, repositoryAgentBootstraps.agentId],
      set: { bootstrappedAt: sql`CURRENT_TIMESTAMP` },
    })
    .run()
}
export function repositoryAgentBootstrapped(repositoryId) {
  return Boolean(
    db
      .select({ repositoryId: repositoryAgentBootstraps.repositoryId })
      .from(repositoryAgentBootstraps)
      .where(and(eq(repositoryAgentBootstraps.repositoryId, repositoryId), eq(repositoryAgentBootstraps.agentId, agentProvider)))
      .get(),
  )
}
export { failReviewSummary, repairStoredReviewDetails, startReviewSummaryFollowUp } from './review-summary-runtime.ts'
