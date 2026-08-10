import { appendFile, readFile, mkdir, mkdtemp, realpath, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, basename, delimiter, dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { CronExpressionParser } from 'cron-parser'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
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
  automaticReviewBaseline,
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
  diffLineContent,
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
  runtimeAgentLaunchContext as agentLaunchContext,
  runtimeAgentProvider as agentProvider,
  runtimeBody as body,
  runtimeDb as db,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimePrDetailsCache as prDetailsCache,
  runtimeReviewAutomationSettings as reviewAutomationSettings,
  runtimeScmProvider as scmProvider,
  runtimeWork as work,
} from './runtime-context.ts'
import { automaticReviewQueue, jobs, pullRequests, repositories } from '../database/schema/tables.ts'
import { pullRequestRecord, repositoryRecord } from '../database/contract-records.ts'

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

function updatePullRequest(repoId: number, number: number, values: Record<string, any>) {
  return db
    .update(pullRequests)
    .set(values)
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
    .run()
}
import {
  runtimeEnqueueAutomaticReview as enqueueAutomaticReview,
  runtimePublishReviewMutation as publishReviewMutation,
  runtimePullRequestContext as pullRequestContext,
  runtimePullRequestDetails as pullRequestDetails,
  runtimeRepositoryLabels as repositoryLabels,
  runtimeRepositoryReviewers as repositoryReviewers,
  runtimeScmUser as scmUser,
  runtimeSyncRepository as syncRepository,
} from './runtime-context.ts'
import { runtimeLaunchJob as launchJob, runtimeLaunchReviewSelection as launchReviewSelection } from './runtime-context.ts'
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

export async function handlePullRequestApi(request: Request, url: URL): Promise<Response | null> {
  const labelsMatch = url.pathname.match(/^\/api\/repositories\/(\d+)\/labels$/)
  if (request.method === 'GET' && labelsMatch) {
    const repo = repositoryRow(Number(labelsMatch[1]))
    if (!repo) return json(404, { error: 'Repository not found' })
    return json(200, { labels: await repositoryLabels(repo) })
  }
  const detailsMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/details$/)
  if (request.method === 'GET' && detailsMatch) {
    const repoId = Number(detailsMatch[1])
    const number = Number(detailsMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    return json(200, await pullRequestDetails(repo, pr))
  }
  const inlineCommentMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/comments$/)
  if (request.method === 'POST' && inlineCommentMatch) {
    const repoId = Number(inlineCommentMatch[1])
    const number = Number(inlineCommentMatch[2])
    const context = pullRequestContext(repoId, number)
    if (!context) return json(404, { error: 'Pull request not found' })
    const { repo } = context
    const input = await body(request)
    const commentBody = String(input.body || '').trim()
    const path = String(input.path || '').trim()
    const line = Number(input.line)
    const side = input.side === 'LEFT' ? 'LEFT' : input.side === 'RIGHT' ? 'RIGHT' : null
    const commitId = String(input.commit_id || '').trim()
    if (!commentBody || commentBody.length > 65_536) return json(400, { error: 'Inline comments must be between 1 and 65,536 characters' })
    if (!path || path.length > 2_000 || path.includes('\0')) return json(400, { error: 'Choose a valid changed file' })
    if (!Number.isInteger(line) || line < 1 || !side) return json(400, { error: 'Choose a valid changed line' })
    if (!/^[a-f0-9]{7,64}$/i.test(commitId)) return json(409, { error: 'The pull request changed; refresh it before commenting' })
    const provider = scmProvider(repo.full_name)
    if (!provider.postInlineComment) return json(501, { error: `${provider.name} does not support inline comments` })
    const ref = { repository: repo.full_name, number }
    const [current, diff] = await Promise.all([provider.pullRequestDetails(ref, ['headRefOid', 'state']), provider.pullRequestDiff(ref)])
    if (String(current.state || '').toUpperCase() !== 'OPEN') return json(409, { error: 'The pull request is no longer open' })
    if (String(current.headRefOid || '') !== commitId) return json(409, { error: 'The pull request changed; refresh it before commenting' })
    if (diffLineContent(diff, { path, line, side }) === null)
      return json(409, { error: 'That line is no longer part of the pull request diff; refresh before commenting' })
    const comment = await provider.postInlineComment(ref, { body: commentBody, commitId, path, line, side })
    return publishReviewMutation(repoId, number, 201, { comment })
  }
  const inlineReplyMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/comments\/(\d+)\/replies$/)
  if (request.method === 'POST' && inlineReplyMatch) {
    const repoId = Number(inlineReplyMatch[1])
    const number = Number(inlineReplyMatch[2])
    const commentId = Number(inlineReplyMatch[3])
    const context = pullRequestContext(repoId, number)
    if (!context) return json(404, { error: 'Pull request not found' })
    const { repo } = context
    const input = await body(request)
    const reply = String(input.body || '').trim()
    if (!reply || reply.length > 65_536) return json(400, { error: 'Replies must be between 1 and 65,536 characters' })
    const provider = scmProvider(repo.full_name)
    if (!provider.replyToReviewComment) return json(501, { error: `${provider.name} does not support inline replies` })
    const comment = await provider.replyToReviewComment({ repository: repo.full_name, number }, commentId, reply)
    return publishReviewMutation(repoId, number, 201, { comment })
  }
  const reviewThreadMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/threads\/([^/]+)$/)
  if (request.method === 'POST' && reviewThreadMatch) {
    const repoId = Number(reviewThreadMatch[1])
    const number = Number(reviewThreadMatch[2])
    const context = pullRequestContext(repoId, number)
    if (!context) return json(404, { error: 'Pull request not found' })
    const { repo } = context
    const input = await body(request)
    if (typeof input.resolved !== 'boolean') return json(400, { error: 'resolved must be a boolean' })
    const provider = scmProvider(repo.full_name)
    if (!provider.setReviewThreadResolved) return json(501, { error: `${provider.name} does not support resolving review threads` })
    const result = await provider.setReviewThreadResolved(
      { repository: repo.full_name, number },
      decodeURIComponent(reviewThreadMatch[3]),
      input.resolved,
    )
    return publishReviewMutation(repoId, number, 200, { thread: result })
  }
  const reviewersMatch = url.pathname.match(/^\/api\/repositories\/(\d+)\/reviewers$/)
  if (request.method === 'GET' && reviewersMatch) {
    const repo = repositoryRow(Number(reviewersMatch[1]))
    if (!repo) return json(404, { error: 'Repository not found' })
    const [reviewers, currentUser] = await Promise.all([repositoryReviewers(repo), scmUser(repo.full_name)])
    return json(200, {
      reviewers,
      current_user: { login: currentUser.login, avatar_url: currentUser.avatar_url },
    })
  }
  const addLabelMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/labels$/)
  if (request.method === 'POST' && addLabelMatch) {
    const repoId = Number(addLabelMatch[1])
    const number = Number(addLabelMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const labelName = String(input.label || '').trim()
    if (!labelName || labelName.length > 100) return json(400, { error: 'Choose a valid label' })
    const labels = (await scmProvider(repo.full_name).addLabel({ repository: repo.full_name, number }, labelName)).map((label) => ({
      name: label.name,
      color: label.color,
    }))
    updatePullRequest(repoId, number, { labels: JSON.stringify(labels) })
    prDetailsCache.delete(`${repoId}:${number}`)
    notifyClients('labels')
    return json(200, { labels })
  }
  if (request.method === 'DELETE' && addLabelMatch) {
    const repoId = Number(addLabelMatch[1])
    const number = Number(addLabelMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const labelName = String(input.label || '').trim()
    if (!labelName || labelName.length > 100) return json(400, { error: 'Choose a valid label' })
    const labels = (await scmProvider(repo.full_name).removeLabel({ repository: repo.full_name, number }, labelName)).map((label) => ({
      name: label.name,
      color: label.color,
    }))
    updatePullRequest(repoId, number, { labels: JSON.stringify(labels) })
    prDetailsCache.delete(`${repoId}:${number}`)
    notifyClients('labels')
    return json(200, { labels })
  }
  const addReviewersMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/reviewers$/)
  if (request.method === 'POST' && addReviewersMatch) {
    const repoId = Number(addReviewersMatch[1])
    const number = Number(addReviewersMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const requested = Array.isArray(input.reviewers) ? input.reviewers.map((reviewer) => String(reviewer).trim()) : []
    if (input.me) requested.push((await scmUser(repo.full_name)).login)
    const reviewers = Array.from(new Set<string>(requested)).filter((login) => /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login))
    if (!reviewers.length) return json(400, { error: 'Choose at least one reviewer' })
    const output = await scmProvider(repo.full_name).requestReviewers({ repository: repo.full_name, number }, reviewers)
    const assigned = (output.requested_reviewers || []).map((reviewer) => ({
      login: reviewer.login,
      avatar_url: reviewer.avatar_url,
    }))
    updatePullRequest(repoId, number, { reviewers: JSON.stringify(assigned) })
    if (input.me) work.ensurePullRequestReview(repo, { ...pr, reviewers: JSON.stringify(assigned) })
    prDetailsCache.delete(`${repoId}:${number}`)
    notifyClients('pr_reviewers_changed', number)
    const automation = reviewAutomationSettings()
    if (input.me && automation.enabled) enqueueAutomaticReview(repo, pr, automation.agentId)
    return json(200, { reviewers: assigned })
  }
  const reviewWatchMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/review-watch$/)
  if (request.method === 'POST' && reviewWatchMatch) {
    const repoId = Number(reviewWatchMatch[1])
    const number = Number(reviewWatchMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    if (typeof input.enabled !== 'boolean') return json(400, { error: 'enabled must be a boolean' })
    let reviewedHeadSha = pr.auto_reviewed_head_sha
    if (input.enabled) {
      const completedReview = and(
        eq(jobs.repoId, repoId),
        eq(jobs.prNumber, number),
        eq(jobs.kind, 'review'),
        eq(jobs.status, 'completed'),
        sql`coalesce(${jobs.reviewRole}, 'single') <> 'member'`,
      )
      const currentHeadReview = pr.head_sha
        ? db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(completedReview, eq(jobs.headSha, pr.head_sha)))
            .orderBy(desc(jobs.id))
            .limit(1)
            .get()
        : null
      const latestReview = currentHeadReview
        ? null
        : db.select({ headSha: jobs.headSha }).from(jobs).where(completedReview).orderBy(desc(jobs.id)).limit(1).get()
      reviewedHeadSha = automaticReviewBaseline({
        currentHeadSha: pr.head_sha,
        currentHeadReviewed: Boolean(currentHeadReview),
        latestReviewHeadSha: latestReview?.headSha,
        storedReviewedHeadSha: reviewedHeadSha,
      })
    }
    updatePullRequest(repoId, number, { autoReviewWatch: input.enabled ? 1 : 0, autoReviewedHeadSha: reviewedHeadSha || null })
    let queued = false
    const automation = reviewAutomationSettings()
    if (
      input.enabled &&
      automaticReviewTrigger({
        headSha: pr.head_sha,
        reviewedHeadSha,
        watched: true,
        initialMatched: true,
      })
    ) {
      enqueueAutomaticReview(
        repo,
        { ...pr, auto_review_watch: 1, auto_reviewed_head_sha: reviewedHeadSha },
        automation.enabled ? automation.agentId : agentProvider,
      )
      queued = true
    }
    if (!input.enabled && reviewedHeadSha) {
      const removed = db
        .delete(automaticReviewQueue)
        .where(
          and(
            eq(automaticReviewQueue.repoId, repoId),
            eq(automaticReviewQueue.prNumber, number),
            ne(automaticReviewQueue.headSha, reviewedHeadSha),
          ),
        )
        .run()
      if (removed.changes) notifyClients('automatic_review_queue_updated')
    }
    notifyClients('review_watch_updated', number)
    return json(200, { watched: input.enabled, queued, automation_enabled: automation.enabled })
  }
  const reviewMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/review$/)
  if (request.method === 'POST' && reviewMatch) {
    const repoId = Number(reviewMatch[1])
    const number = Number(reviewMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const requested = Array.isArray(input.agent_ids)
      ? input.agent_ids
      : [input.agent_id || agentLaunchContext.getStore()?.agentId || agentProvider]
    return json(
      202,
      await launchReviewSelection(repo, pr, requested, input.aggregator_agent_id, {
        ...(agentLaunchContext.getStore() || {}),
        model: String(input.model || agentLaunchContext.getStore()?.model || '') || null,
        reasoningEffort: String(input.reasoning_effort || agentLaunchContext.getStore()?.reasoningEffort || '') || null,
        serviceTier: String(input.service_tier || agentLaunchContext.getStore()?.serviceTier || '') || null,
        ephemeral: input.ephemeral,
      }),
    )
  }
  const approveMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/approve$/)
  if (request.method === 'POST' && approveMatch) {
    const repoId = Number(approveMatch[1])
    const number = Number(approveMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const user = await scmUser(repo.full_name)
    if (user.login.toLowerCase() === String(pr.author).toLowerCase())
      return json(409, {
        error: 'GitHub does not allow authors to approve their own pull requests',
      })
    if (Number(pr.checks_failed) > 0) return json(409, { error: 'Resolve failing GitHub Actions before approval' })
    const input = await body(request)
    const comment = String(input.comment || '').trim()
    if (comment.length > 65_536) return json(400, { error: 'Review comments must be 65,536 characters or fewer' })
    const ref = { repository: repo.full_name, number }
    await scmProvider(ref.repository).approve(ref, comment)
    const review = await scmProvider(ref.repository).pullRequestDetails(ref, ['reviewDecision'])
    updatePullRequest(repoId, number, { reviewDecision: review.reviewDecision || null })
    work.syncPullRequest(repo, { ...pr, review_decision: review.reviewDecision || null }, false)
    prDetailsCache.delete(`${repoId}:${number}`)
    notifyClients('pr_approved', number)
    return json(200, { message: `Approved #${number}${comment ? ' with comments' : ''}` })
  }
  const autoMergeMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/auto-merge$/)
  if (request.method === 'POST' && autoMergeMatch) {
    const repoId = Number(autoMergeMatch[1])
    const number = Number(autoMergeMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    if (pr.auto_merge_enabled) return json(200, { message: `Auto-merge is already enabled for #${number}` })
    await scmProvider(repo.full_name).enableAutoMerge({ repository: repo.full_name, number })
    updatePullRequest(repoId, number, { autoMergeEnabled: 1 })
    notifyClients('pr_auto_merge_enabled', number)
    return json(202, { message: `Enabled squash auto-merge for #${number}` })
  }
  const updateBranchMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/update-branch$/)
  if (request.method === 'POST' && updateBranchMatch) {
    const repoId = Number(updateBranchMatch[1])
    const number = Number(updateBranchMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const result = await scmProvider(repo.full_name).updateBranch({ repository: repo.full_name, number }, pr.head_sha)
    await syncRepository(repo)
    return json(202, { message: result.message || 'Branch update requested' })
  }
  const readyForReviewMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/ready-for-review$/)
  if (request.method === 'POST' && readyForReviewMatch) {
    const repoId = Number(readyForReviewMatch[1])
    const number = Number(readyForReviewMatch[2])
    const repo = repositoryRow(repoId)
    const pr = pullRequestRow(repoId, number)
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    if (!pr.draft) return json(409, { error: 'Pull request is already ready for review' })
    await scmProvider(repo.full_name).markReady({ repository: repo.full_name, number })
    updatePullRequest(repoId, number, { draft: 0 })
    prDetailsCache.delete(`${repoId}:${number}`)
    notifyClients('pr_ready_for_review', number)
    return json(200, { message: `Pull request #${number} is ready for review` })
  }
  const readinessMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/readiness$/)
  if (request.method === 'POST' && readinessMatch) {
    const repoId = Number(readinessMatch[1])
    const number = Number(readinessMatch[2])
    const pr = pullRequestRow(repoId, number)
    if (!pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const action = String(input.action || '')
    if (action === 'mark')
      updatePullRequest(repoId, number, {
        manualNotReadyAt: sql`CURRENT_TIMESTAMP`,
        updatedAfterNotReadyAt: null,
        notReadyHeadSha: sql`${pullRequests.headSha}`,
        notReadyCommentAt: sql`coalesce(${pullRequests.latestCommentAt}, '')`,
      })
    else if (action === 'clear')
      updatePullRequest(repoId, number, { manualNotReadyAt: null, notReadyHeadSha: null, notReadyCommentAt: null })
    else if (action === 'dismiss-update') updatePullRequest(repoId, number, { updatedAfterNotReadyAt: null })
    else return json(400, { error: 'Choose a valid readiness action' })
    notifyClients('pr_readiness', number)
    return json(
      200,
      db
        .select({
          manual_not_ready_at: pullRequests.manualNotReadyAt,
          updated_after_not_ready_at: pullRequests.updatedAfterNotReadyAt,
        })
        .from(pullRequests)
        .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
        .get(),
    )
  }
  const launchMatch = url.pathname.match(/^\/api\/pulls\/(\d+)\/(\d+)\/launch$/)
  if (request.method === 'POST' && launchMatch) {
    const repo = repositoryRow(Number(launchMatch[1]))
    const pr = pullRequestRow(Number(launchMatch[1]), Number(launchMatch[2]))
    if (!repo || !pr) return json(404, { error: 'Pull request not found' })
    const input = await body(request)
    const resolved = resolvePrompt(input, repo, pr)
    if ('error' in resolved) return json(resolved.status, { error: resolved.error })
    const job = await launchJob(repo, pr, resolved.prompt)
    if (resolved.architectureContext && job.work_item_id) {
      work.event(
        job.work_item_id,
        'architecture_context_attached',
        `Attached architecture context ${String(resolved.architectureContext.digest).slice(0, 12)}`,
        'user',
        resolved.architectureContext,
      )
    }
    return json(202, job)
  }
  return null
}
