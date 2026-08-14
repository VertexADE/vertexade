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
import { jobSessionCwd, parseWorkItemWorkspaceMode, relativeWorktreePath, workItemWorkspaceLayout } from '../work/workspace-layout.ts'
import { createCoreRoutes } from '../core-routes.ts'
import { worktreeCodeReviewPrompt } from '../work/prompts.ts'
import { populateWorktreeSnapshot } from '../work/worktree-snapshot.ts'
import { previewDirectoryApply, previewDirectoryChanges } from '../work/directory-workspace.ts'
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
import { resolveSubagentLaunch } from '../agents/subagents.ts'
import { AgentResourceService, applyCustomAgentPrompt, applySkillInstructions } from '../agents/resources.ts'
import { createAgentResourceRoutes } from '../agents/resource-routes.ts'
import { CustomAgentSynchronizer } from '../agents/custom-agents.ts'
import { createDiffPreview, storedDiffSummary, summarizeDiff } from '../diff-preview.ts'
import { JobFollowUpQueue } from '../job-follow-up-queue.ts'
import { parseAgentLogEvents } from '../agent-timeline.ts'
import { DashboardReadModelStore, type DashboardReadModelEntry } from '../read-model/dashboard-read-model.ts'
import {
  runtimeLOGS as LOGS,
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
import { and, eq, sql } from 'drizzle-orm'
import { jobs, repositories } from '../database/schema/tables.ts'
import { jobRecord, repositoryRecord } from '../database/contract-records.ts'
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

export function createJobProcessMonitor({
  updateReviewBatchForJob,
  extractReviewSuggestions,
  postAutomaticReviewToGitHub,
  persistDetectedThreadContext,
}: {
  updateReviewBatchForJob: (jobId: number) => Promise<any>
  extractReviewSuggestions: (jobId: number) => any
  postAutomaticReviewToGitHub: (jobId: number) => Promise<any>
  persistDetectedThreadContext: (jobId: number, event: any) => void
}) {
  function storeDirectoryDiff(jobId: number, preview: { changed: string[]; deleted: string[] }) {
    db.update(jobs)
      .set({ diffFiles: JSON.stringify(preview.changed), diffAdditions: 0, diffDeletions: preview.deleted.length })
      .where(eq(jobs.id, jobId))
      .run()
    notifyClients('diff', jobId)
  }

  function updateActivity(jobId: number, latestActivity: string) {
    db.update(jobs)
      .set({ latestActivity, activityAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(jobs.id, jobId))
      .run()
  }

  function monitorJobProcess(child, jobId, log, runtimeAgent = child.runtimeAgent || agent) {
    activeJobs.set(jobId, child)
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    let stdoutBuffer = ''
    let lastError = ''
    let processErrored = false
    let hasThread = Boolean(db.select({ threadId: jobs.threadId }).from(jobs).where(eq(jobs.id, jobId)).get()?.threadId)
    const processLine = (line) => {
      if (!line.trim()) return
      try {
        const rawEvent = JSON.parse(line)
        const event = runtimeAgent.normalizeEvent?.(rawEvent) || rawEvent
        publishAgentControlEvent(child, event)
        persistDetectedThreadContext(jobId, event)
        if (event.thread_id && !hasThread) {
          hasThread = true
          db.update(jobs)
            .set({
              threadId: event.thread_id,
              latestActivity: `${runtimeAgent.name} thread started`,
              activityAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(jobs.id, jobId))
            .run()
          notifyClients('thread_started', jobId)
        }
        if (event.event === 'thread_started' && !event.thread_id) updateActivity(jobId, `${runtimeAgent.name} thread started`)
        if (event.event === 'thread_forked')
          db.update(jobs)
            .set({
              threadId: sql`coalesce(${jobs.threadId}, ${event.thread_id})`,
              latestActivity: `${runtimeAgent.name} thread forked`,
              activityAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(jobs.id, jobId))
            .run()
        if (event.event === 'thread_roots_updated') updateActivity(jobId, `${runtimeAgent.name} thread resumed`)
        if (['action_started', 'action_updated', 'action_completed'].includes(event.event)) {
          const action = event.action && typeof event.action === 'object' ? event.action : {}
          const activity = String(action.title || action.kind || `${runtimeAgent.name} action`).slice(0, 2000)
          updateActivity(jobId, activity)
        }
        if (event.event === 'agent_message')
          db.update(jobs)
            .set({ latestActivity: event.text, resultText: event.text, activityAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(jobs.id, jobId))
            .run()
        if (event.event === 'error') {
          lastError = String(event.message || `${runtimeAgent.name} failed`).slice(0, 2000)
          updateActivity(jobId, lastError)
        }
        if (event.event === 'diff_updated') storeJobDiff(jobId, event.diff || '')
        if (event.event === 'input_required')
          db.update(jobs)
            .set({
              inputRequestId: JSON.stringify(event.request_id),
              inputQuestions: JSON.stringify(event.questions || []),
              inputRequestedAt: sql`CURRENT_TIMESTAMP`,
              latestActivity: 'Waiting for your input',
              activityAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(jobs.id, jobId))
            .run()
        if (event.event === 'input_answered')
          db.update(jobs)
            .set({
              inputRequestId: null,
              inputQuestions: null,
              inputRequestedAt: null,
              latestActivity: `Input received; ${runtimeAgent.name} is continuing…`,
              activityAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(jobs.id, jobId))
            .run()
        if (event.event === 'steer_accepted') updateActivity(jobId, `Steering received; ${runtimeAgent.name} is adjusting the active turn…`)
        if (event.event === 'turn_completed') {
          const completed = event.status === 'completed'
          createNotification(
            'turn_complete',
            completed ? 'Turn complete' : 'Turn stopped',
            `${runtimeAgent.name} ${completed ? 'completed' : 'stopped'} run #${jobId}.`,
            { jobId },
          )
        }
        if (
          [
            'thread_started',
            'thread_roots_updated',
            'action_started',
            'action_updated',
            'action_completed',
            'agent_message',
            'error',
            'input_required',
            'input_answered',
            'steer_accepted',
            'turn_completed',
          ].includes(event.event)
        )
          notifyClients(event.event, jobId)
      } catch {}
    }
    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString()
      if (Buffer.byteLength(stdoutBuffer) > MAX_AGENT_EVENT_LINE_BYTES) {
        stdoutBuffer = stdoutBuffer.slice(-MAX_AGENT_EVENT_LINE_BYTES)
        updateActivity(jobId, 'Agent emitted an oversized event; dashboard parsing retained only the final segment')
      }
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    })
    child.on('error', (error) => {
      processErrored = true
      activeJobs.delete(jobId)
      failReviewSummary(jobId, `Review details completed, but the summary could not start: ${error.message}`)
      jobLifecycle.markFailed(jobId, error.message)
      work.finishContextTransfers(jobId, false, null, error.message)
      createNotification('task_failed', 'Task failed', `Run #${jobId} could not start ${runtimeAgent.name}: ${error.message}`, { jobId })
      notifyClients('job_failed', jobId)
      log.end(`\n${error.stack || error.message}\n`)
      if (jobFollowUps.finishRunning(jobId, false, error.message)) notifyClients('job_follow_up_failed', jobId)
      void automationRecipes.handleJobTurnFinished(jobId, false, error)
      queueMicrotask(() => {
        void drainJobFollowUpQueue(jobId)
      })
      void updateReviewBatchForJob(jobId)
      void drainAutomaticReviewQueue()
    })
    jobLifecycle.markRunning(jobId, { pid: child.pid, agentId: runtimeAgent.id })
    void processStartIdentity(child.pid).then((identity) => {
      if (identity)
        db.update(jobs)
          .set({ pidStartIdentity: identity })
          .where(and(eq(jobs.id, jobId), eq(jobs.pid, child.pid)))
          .run()
    })
    notifyClients('job_running', jobId)
    child.on('close', async (code, signal) => {
      if (processErrored) return
      processLine(stdoutBuffer)
      activeJobs.delete(jobId)
      if (cancellingJobs.delete(jobId)) {
        jobLifecycle.markCancelled(jobId)
        work.finishContextTransfers(jobId, false, null, 'Stopped by user')
        if (jobFollowUps.finishRunning(jobId, false, 'Stopped by user')) notifyClients('job_follow_up_cancelled', jobId)
        await automationRecipes.handleJobTurnFinished(jobId, false, 'Stopped by user')
        notifyClients('job_cancelled', jobId)
        log.end()
        queueMicrotask(() => {
          void drainJobFollowUpQueue(jobId)
        })
        void updateReviewBatchForJob(jobId)
        void drainAutomaticReviewQueue()
        return
      }
      if (code === null && !signal) {
        jobLifecycle.markRunning(jobId, {
          activity: `Reconnecting to persistent ${runtimeAgent.name} thread…`,
        })
        notifyClients('job_bridge_disconnected', jobId)
        log.end()
        return
      }
      let exitCode = code ?? 1
      let failure = lastError || `${runtimeAgent.name} process failed${signal ? ` (${signal})` : ''}`
      const storedClosingJob = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
      let closingJob = storedClosingJob ? jobRecord(storedClosingJob) : null
      if (exitCode === 0 && isCodeReviewKind(closingJob?.kind) && closingJob.review_phase === 'details') {
        const details = await resolveDetailedReviewOutput(closingJob.result_text, closingJob.worktree_path)
        if (details && details !== closingJob.result_text) {
          db.update(jobs).set({ resultText: details }).where(eq(jobs.id, jobId)).run()
          closingJob = { ...closingJob, result_text: details }
        }
      }
      if (
        exitCode === 0 &&
        shouldStartReviewSummary({
          kind: closingJob?.kind,
          reviewRole: closingJob?.review_role,
          reviewPhase: closingJob?.review_phase,
        })
      ) {
        await new Promise((resolveEnd) => {
          log.end(resolveEnd)
        })
        try {
          await startReviewSummaryFollowUp(jobId)
        } catch (error) {
          const message = `Review details completed, but the summary follow-up failed: ${error.message || error}`
          failReviewSummary(jobId, message)
          jobLifecycle.markFailed(jobId, message)
          createNotification('task_failed', 'Review summary failed', `Run #${jobId}: ${message}`, {
            jobId,
          })
          notifyClients('review_summary_failed', jobId)
          void updateReviewBatchForJob(jobId)
          void drainAutomaticReviewQueue()
        }
        return
      }
      if (isCodeReviewKind(closingJob?.kind) && closingJob.review_phase === 'summary') {
        if (exitCode === 0 && String(closingJob.result_text || '').trim()) {
          db.update(jobs)
            .set({ reviewSummary: sql`${jobs.resultText}`, resultText: sql`${jobs.reviewDetails}`, reviewPhase: 'complete' })
            .where(eq(jobs.id, jobId))
            .run()
        } else {
          if (exitCode === 0) {
            exitCode = 1
            failure = `${runtimeAgent.name} completed the summary turn without returning a summary`
          }
          failReviewSummary(jobId, failure)
        }
      } else if (isCodeReviewKind(closingJob?.kind) && exitCode === 0) {
        db.update(jobs)
          .set({ reviewDetails: sql`coalesce(${jobs.reviewDetails}, ${jobs.resultText})`, reviewPhase: 'complete' })
          .where(eq(jobs.id, jobId))
          .run()
      }
      jobLifecycle.markFinished(jobId, exitCode, failure)
      const transferOutput = db.select({ resultText: jobs.resultText }).from(jobs).where(eq(jobs.id, jobId)).get()?.resultText
      work.finishContextTransfers(jobId, exitCode === 0, transferOutput, failure)
      notifyClients('job_finished', jobId)
      const finished = db
        .select({
          task_title: jobs.taskTitle,
          pr_number: jobs.prNumber,
          kind: jobs.kind,
          full_name: repositories.fullName,
        })
        .from(jobs)
        .innerJoin(repositories, eq(repositories.id, jobs.repoId))
        .where(eq(jobs.id, jobId))
        .get()
      if (finished) {
        const label = finished.task_title || (finished.pr_number ? `${finished.full_name} #${finished.pr_number}` : finished.full_name)
        createNotification(
          exitCode === 0 ? 'task_completed' : 'task_failed',
          exitCode === 0 ? 'Task finished' : 'Task failed',
          `${label}${exitCode === 0 ? ' completed successfully.' : ` failed: ${failure}`}`,
          { jobId },
        )
      }
      try {
        const storedJob = db
          .select({
            headSha: jobs.headSha,
            worktreePath: jobs.worktreePath,
            kind: jobs.kind,
            repoId: jobs.repoId,
            sourcePath: repositories.localPath,
            sourceKind: repositories.sourceKind,
            workspaceStrategy: repositories.workspaceStrategy,
          })
          .from(jobs)
          .innerJoin(repositories, eq(repositories.id, jobs.repoId))
          .where(eq(jobs.id, jobId))
          .get()
        const job = storedJob ? jobRecord(storedJob) : null
        if (storedJob?.sourceKind !== 'git' && storedJob?.workspaceStrategy === 'direct') {
          const preview = await previewDirectoryChanges(`${storedJob.worktreePath}.baseline`, storedJob.worktreePath)
          storeDirectoryDiff(jobId, preview)
        } else if (storedJob?.sourceKind !== 'git' && storedJob && ['copy', 'move'].includes(storedJob.workspaceStrategy)) {
          const preview = await previewDirectoryApply(
            storedJob.sourcePath,
            storedJob.worktreePath,
            storedJob.workspaceStrategy as 'copy' | 'move',
          )
          storeDirectoryDiff(jobId, preview)
        } else if (storedJob?.sourceKind === 'git') {
          const diff = await run('git', ['-C', job.worktree_path, 'diff', '--no-ext-diff', '--binary', job.head_sha, '--'])
          if (diff.trim()) storeJobDiff(jobId, diff)
        }
        if (job.kind === 'pre_pr') {
          const storedRepository = db.select().from(repositories).where(eq(repositories.id, job.repo_id)).get()
          const repo = storedRepository ? repositoryRecord(storedRepository) : null
          if (repo) await syncRepository(repo)
        }
      } catch {}
      if (exitCode === 0) {
        extractReviewSuggestions(jobId)
        await postAutomaticReviewToGitHub(jobId)
      }
      log.end()
      if (jobFollowUps.finishRunning(jobId, exitCode === 0, failure))
        notifyClients(exitCode === 0 ? 'job_follow_up_completed' : 'job_follow_up_failed', jobId)
      await automationRecipes.handleJobTurnFinished(jobId, exitCode === 0, failure)
      void drainJobFollowUpQueue(jobId)
      void updateReviewBatchForJob(jobId)
      void drainAutomaticReviewQueue()
    })
    child.unref()
  }

  return monitorJobProcess
}
