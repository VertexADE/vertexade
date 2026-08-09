import { createWriteStream } from 'node:fs'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { isCompleteDetailedReview, resolveDetailedReviewOutput } from '../review-output.ts'
import { isCodeReviewKind, reviewSummaryPrompt } from '../reviews.ts'
import { jobSessionCwd } from '../work/workspace-layout.ts'
import { jobs } from '../database/schema/tables.ts'
import { jobRecord } from '../database/contract-records.ts'
import {
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeDb as db,
  runtimeJobLifecycle as jobLifecycle,
  runtimeNotifyClients as notifyClients,
  runtimeSpawnAgentThread as spawnAgentThread,
} from './runtime-context.ts'
import { runtimeFollowUpJob as followUpJob, runtimeMonitorJobProcess as monitorJobProcess } from './runtime-context.ts'

function storedJob(jobId: number) {
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get()
  return job ? jobRecord(job) : null
}

export function failReviewSummary(jobId, message) {
  const job = db.select({ kind: jobs.kind, reviewPhase: jobs.reviewPhase }).from(jobs).where(eq(jobs.id, jobId)).get()
  if (!isCodeReviewKind(job?.kind) || job.reviewPhase !== 'summary') return
  db.update(jobs)
    .set({
      reviewPhase: 'summary_failed',
      resultText: sql`coalesce(${jobs.reviewDetails}, ${jobs.resultText})`,
      latestActivity: message,
    })
    .where(eq(jobs.id, jobId))
    .run()
}

export async function startReviewSummaryFollowUp(jobId) {
  const job = storedJob(jobId)
  if (!job) throw new Error('The completed review no longer exists')
  const details = await resolveDetailedReviewOutput(job.review_details || job.result_text, job.worktree_path)
  if (!job.thread_id) throw new Error('The completed review has no agent thread to summarize')
  if (!details) throw new Error('The completed review did not produce a detailed report')
  db.update(jobs)
    .set({ reviewDetails: details, reviewSummary: null, reviewPhase: 'summary', reviewPhaseStartedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(jobs.id, jobId))
    .run()
  jobLifecycle.markStarting(jobId, job.ephemeral ? 'Preparing stored-review summary…' : 'Preparing same-thread review summary…', {
    clearResult: true,
  })
  notifyClients('review_summary_started', jobId)
  if (job.ephemeral) {
    const runtimeAgent = agents.require(job.agent_id || agentProvider)
    const sessionCwd = jobSessionCwd(job, runtimeAgent.workspaceRoot)
    const log = createWriteStream(job.log_path, { flags: 'a' })
    const prompt = reviewSummaryPrompt(details)
    log.write(`${JSON.stringify({ time: new Date().toISOString(), event: 'review_summary_started', prompt })}\n`)
    const child = spawnAgentThread(
      {
        jobId,
        cwd: sessionCwd,
        base: job.base_repo_path,
        prompt,
        reviewMode: true,
        ephemeral: true,
        model: job.agent_model,
        reasoningEffort: job.agent_reasoning_effort,
        mcpServers: [],
      },
      { cwd: sessionCwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
      runtimeAgent,
    )
    monitorJobProcess(child, jobId, log, runtimeAgent)
    return storedJob(jobId)
  }
  return followUpJob(storedJob(jobId), reviewSummaryPrompt(), {
    reviewMode: true,
    model: job.agent_model,
    reasoningEffort: job.agent_reasoning_effort,
  })
}

async function repairIncompleteReviewDetails() {
  const reviewJobs = db
    .select({
      id: jobs.id,
      review_phase: jobs.reviewPhase,
      review_details: jobs.reviewDetails,
      worktree_path: jobs.worktreePath,
    })
    .from(jobs)
    .where(and(inArray(jobs.kind, ['review', 'work_review']), isNotNull(jobs.reviewPhase), isNotNull(jobs.reviewDetails)))
    .all()
  let repaired = 0
  for (const job of reviewJobs) {
    if (isCompleteDetailedReview(job.review_details)) continue
    const details = await resolveDetailedReviewOutput(job.review_details, job.worktree_path)
    if (!isCompleteDetailedReview(details) || details === job.review_details) continue
    db.update(jobs)
      .set({
        reviewDetails: details,
        resultText: sql`CASE WHEN ${jobs.reviewPhase} IN ('complete','summary_failed') THEN ${details} ELSE ${jobs.resultText} END`,
      })
      .where(eq(jobs.id, job.id))
      .run()
    repaired += 1
  }
  if (repaired) notifyClients('review_details_repaired')
}

export function repairStoredReviewDetails() {
  setTimeout(() => {
    void repairIncompleteReviewDetails().catch((error) => {
      console.error('Failed to repair incomplete review details:', error)
    })
  }, 750).unref()
}
