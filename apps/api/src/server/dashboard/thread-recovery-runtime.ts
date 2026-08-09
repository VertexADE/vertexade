import { appendFile } from 'node:fs/promises'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { isCodeReviewKind, isReviewSnapshotCurrent, reviewSummaryPrompt, shouldStartReviewSummary } from '../reviews.ts'
import { resolveDetailedReviewOutput } from '../review-output.ts'
import { processStartIdentity, processWorkingDirectory } from '../process.ts'
import { jobSessionCwd } from '../work/workspace-layout.ts'
import {
  runtimeActiveJobs as activeJobs,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeAutomationRecipes as automationRecipes,
  runtimeCreateNotification as createNotification,
  runtimeDb as db,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJobLifecycle as jobLifecycle,
  runtimeNotifyClients as notifyClients,
  runtimeWork as work,
} from './runtime-context.ts'
import {
  runtimeDrainAutomaticReviewQueue as drainAutomaticReviewQueue,
  runtimeStartReviewSummaryFollowUp as startReviewSummaryFollowUp,
  runtimeUsesReviewWorkspace as usesReviewWorkspace,
} from './runtime-context.ts'
import {
  runtimeExtractReviewSuggestions as extractReviewSuggestions,
  runtimePostAutomaticReviewToGitHub as postAutomaticReviewToGitHub,
  runtimeUpdateReviewBatchForJob as updateReviewBatchForJob,
} from './runtime-context.ts'
import { jobs as jobTable, notifications } from '../database/schema/tables.ts'
import { jobRecord } from '../database/contract-records.ts'

export function createThreadRecoveryRuntime({
  followUpJob,
  drainJobFollowUpQueue,
}: {
  followUpJob: (...args: any[]) => Promise<any>
  drainJobFollowUpQueue: (jobId: number) => Promise<any>
}) {
  let reconcilingPersistentThreads = false
  async function reconcilePersistentThreads() {
    if (reconcilingPersistentThreads) return
    reconcilingPersistentThreads = true
    try {
      const jobs = db
        .select()
        .from(jobTable)
        .where(and(isNotNull(jobTable.threadId), isNull(jobTable.exitCode), inArray(jobTable.status, ['starting', 'running', 'failed'])))
        .all()
        .map(jobRecord)
      for (const job of jobs) {
        if (activeJobs.has(job.id)) continue
        const runtimeAgent = agents.get(job.agent_id || agentProvider)
        if (!runtimeAgent) continue
        if (job.pid && job.pid_start_identity) {
          const identity = await processStartIdentity(job.pid)
          if (identity === job.pid_start_identity) continue
        } else if (job.pid) {
          const [identity, cwd] = await Promise.all([processStartIdentity(job.pid), processWorkingDirectory(job.pid)])
          let expectedCwd = null
          try {
            expectedCwd = jobSessionCwd(job, runtimeAgent.workspaceRoot)
          } catch {}
          if (identity && expectedCwd && cwd === expectedCwd) {
            db.update(jobTable)
              .set({ pidStartIdentity: identity })
              .where(and(eq(jobTable.id, job.id), eq(jobTable.pid, job.pid)))
              .run()
            continue
          }
        }
        if (job.ephemeral) {
          const message = `The ${runtimeAgent.name} ephemeral run was interrupted and has no provider session to resume`
          jobLifecycle.markFailed(job.id, message)
          createNotification('task_failed', 'Ephemeral run interrupted', `Run #${job.id} can be retried from its stored request.`, {
            jobId: job.id,
          })
          notifyClients('ephemeral_job_interrupted', job.id)
          continue
        }
        try {
          let snapshot = await runtimeAgent.completedThreadSnapshot?.(job.thread_id)
          if (
            snapshot &&
            !isReviewSnapshotCurrent(
              {
                kind: job.kind,
                reviewPhase: job.review_phase,
                reviewPhaseStartedAt: job.review_phase_started_at,
              },
              snapshot.completedAt,
            )
          )
            snapshot = null
          if (!snapshot && runtimeAgent.resumableThreadExists && (await runtimeAgent.resumableThreadExists(job.thread_id))) {
            jobLifecycle.markResumable(job.id, `${runtimeAgent.name} stopped, but its saved session can be resumed`)
            notifyClients('job_reconciled_resumable', job.id)
            const storedJob = db.select().from(jobTable).where(eq(jobTable.id, job.id)).get()
            const resumableJob = storedJob ? jobRecord(storedJob) : null
            try {
              const resumePrompt =
                isCodeReviewKind(resumableJob.kind) && resumableJob.review_phase === 'summary'
                  ? reviewSummaryPrompt()
                  : 'The dashboard service restarted while this task was running. Resume from the saved session state and continue the original task autonomously until it is complete and verified. Do not redo completed work.'
              await followUpJob(resumableJob, resumePrompt, {
                reviewMode: usesReviewWorkspace(resumableJob.kind),
                model: resumableJob.agent_model,
                reasoningEffort: resumableJob.agent_reasoning_effort,
              })
              createNotification(
                'task_resumed',
                'Task resumed automatically',
                `Run #${job.id} was interrupted by the service restart and has continued from its saved ${runtimeAgent.name} session.`,
                { jobId: job.id },
              )
              notifyClients('job_auto_resumed', job.id)
            } catch (error) {
              jobLifecycle.markResumable(job.id, `Automatic resume failed: ${String(error.message || error)}`)
              createNotification(
                'task_resumable',
                'Task needs to be resumed',
                `Run #${job.id} has a saved ${runtimeAgent.name} session, but automatic resume failed. Open the run and select Resume.`,
                { jobId: job.id },
              )
              notifyClients('job_auto_resume_failed', job.id)
            }
            continue
          }
          if (!snapshot) {
            if (job.status !== 'running') {
              jobLifecycle.markRunning(job.id, {
                activity: `Persistent ${runtimeAgent.name} thread is still active`,
              })
              notifyClients('job_reconciled_running', job.id)
            }
            continue
          }
          const finishedAt = snapshot.completedAt ? new Date(snapshot.completedAt * 1000).toISOString() : new Date().toISOString()
          let snapshotMessage = String(snapshot.message || '').trim()
          db.update(jobTable)
            .set({
              resultText: sql`coalesce(nullif(${snapshotMessage}, ''), ${jobTable.resultText})`,
              latestActivity: sql`coalesce(nullif(${snapshotMessage}, ''), ${jobTable.latestActivity})`,
              activityAt: finishedAt,
            })
            .where(eq(jobTable.id, job.id))
            .run()
          if (isCodeReviewKind(job.kind) && job.review_phase === 'details') {
            const stored = db
              .select({ resultText: jobTable.resultText, worktreePath: jobTable.worktreePath })
              .from(jobTable)
              .where(eq(jobTable.id, job.id))
              .get()
            const details = await resolveDetailedReviewOutput(stored?.resultText, stored?.worktreePath)
            if (details) {
              snapshotMessage = details
              db.update(jobTable).set({ resultText: details }).where(eq(jobTable.id, job.id)).run()
            }
          }
          if (
            shouldStartReviewSummary({
              kind: job.kind,
              reviewRole: job.review_role,
              reviewPhase: job.review_phase,
            })
          ) {
            await appendFile(
              job.log_path,
              `${JSON.stringify({ time: finishedAt, event: 'agent_message', text: snapshotMessage, reconciled: true })}\n${JSON.stringify({ time: finishedAt, event: 'turn_completed', status: 'details_completed', reconciled: true })}\n`,
            )
            try {
              await startReviewSummaryFollowUp(job.id)
              notifyClients('review_summary_reconciled', job.id)
            } catch (error) {
              const message = `Review details completed, but the summary follow-up failed: ${String(error.message || error)}`
              db.update(jobTable)
                .set({ reviewDetails: sql`coalesce(${jobTable.reviewDetails}, ${jobTable.resultText})`, reviewPhase: 'summary_failed' })
                .where(eq(jobTable.id, job.id))
                .run()
              jobLifecycle.markFailed(job.id, message)
              createNotification('task_failed', 'Review summary failed', `Run #${job.id}: ${message}`, { jobId: job.id })
              notifyClients('review_summary_failed', job.id)
              await automationRecipes.handleJobTurnFinished(job.id, false, message)
              void updateReviewBatchForJob(job.id)
              void drainAutomaticReviewQueue()
            }
            continue
          }
          if (isCodeReviewKind(job.kind) && job.review_phase === 'summary') {
            db.update(jobTable)
              .set({
                reviewSummary: sql`coalesce(nullif(${snapshotMessage}, ''), ${jobTable.resultText})`,
                resultText: sql`${jobTable.reviewDetails}`,
                reviewPhase: 'complete',
              })
              .where(eq(jobTable.id, job.id))
              .run()
          } else if (isCodeReviewKind(job.kind)) {
            db.update(jobTable)
              .set({ reviewDetails: sql`coalesce(${jobTable.reviewDetails}, ${jobTable.resultText})`, reviewPhase: 'complete' })
              .where(eq(jobTable.id, job.id))
              .run()
          }
          jobLifecycle.markReconciledCompleted(job.id, snapshotMessage, finishedAt)
          work.finishContextTransfers(job.id, true, snapshotMessage)
          db.delete(notifications)
            .where(and(eq(notifications.jobId, job.id), eq(notifications.kind, 'task_failed')))
            .run()
          await appendFile(
            job.log_path,
            `${JSON.stringify({ time: finishedAt, event: 'agent_message', text: snapshot.message, reconciled: true })}\n${JSON.stringify({ time: finishedAt, event: 'turn_completed', status: 'completed', reconciled: true })}\n`,
          )
          createNotification('task_completed', 'Task finished', `Run #${job.id} completed successfully.`, {
            jobId: job.id,
          })
          notifyClients('job_reconciled_completed', job.id)
          extractReviewSuggestions(job.id)
          await postAutomaticReviewToGitHub(job.id)
          if (jobFollowUps.finishRunning(job.id, true)) notifyClients('job_follow_up_completed', job.id)
          await automationRecipes.handleJobTurnFinished(job.id, true)
          void drainJobFollowUpQueue(job.id)
          void updateReviewBatchForJob(job.id)
          void drainAutomaticReviewQueue()
        } catch (error) {
          console.error(`Could not reconcile ${runtimeAgent.name} thread for run #${job.id}:`, error.message || error)
        }
      }
    } finally {
      reconcilingPersistentThreads = false
    }
  }

  function startThreadRecoveryTimers() {
    setTimeout(() => {
      void reconcilePersistentThreads()
    }, 1_000).unref()
    setInterval(() => {
      void reconcilePersistentThreads()
    }, 15_000).unref()
    setTimeout(() => {
      for (const jobId of jobFollowUps.queuedJobIds()) void drainJobFollowUpQueue(jobId)
    }, 1_500).unref()
  }

  return { startThreadRecoveryTimers }
}
