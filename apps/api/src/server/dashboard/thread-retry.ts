import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { eq, getTableColumns } from 'drizzle-orm'
import { jobs, repositories } from '../database/schema/tables.ts'
import { jobRecord } from '../database/contract-records.ts'
import { isCodeReviewKind } from '../reviews.ts'
import { jobSessionCwd } from '../work/workspace-layout.ts'
import {
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeDb as db,
  runtimeJobLifecycle as jobLifecycle,
  runtimeMonitorJobProcess as monitorJobProcess,
  runtimeSpawnAgentThread as spawnAgentThread,
  runtimeStartReviewSummaryFollowUp as startReviewSummaryFollowUp,
  runtimeUsesReviewWorkspace as usesReviewWorkspace,
  runtimeWorkMemory as workMemory,
} from './runtime-context.ts'
import { runtimeFollowUpJob as followUpJob } from './runtime-context.ts'

export async function retryJob(job) {
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  const mode = retryMode(job)
  if (mode === 'summary') return startReviewSummaryFollowUp(job.id)
  if (mode === 'resume') return retrySavedThread(job)
  return restartStoredRun(job, runtimeAgent)
}

function retryMode(job): 'summary' | 'resume' | 'restart' {
  if (!job.thread_id) return 'restart'
  if (isCodeReviewKind(job.kind) && ['summary', 'summary_failed'].includes(job.review_phase)) return 'summary'
  return job.ephemeral ? 'restart' : 'resume'
}

function retrySavedThread(job) {
  const prompt = `${job.status === 'cancelled' ? 'Resume the stopped turn' : 'Retry the failed turn'} and continue the original task until it is complete and verified.`
  return followUpJob(job, prompt, {
    reviewMode: usesReviewWorkspace(job.kind),
    model: job.agent_model,
    reasoningEffort: job.agent_reasoning_effort,
  })
}

async function restartStoredRun(job, runtimeAgent) {
  const sessionCwd = jobSessionCwd(job, runtimeAgent.workspaceRoot)
  await stat(job.worktree_path)
  await stat(sessionCwd)
  const memoryLaunch = job.work_item_id
    ? await workMemory.launchContext(job.work_item_id, job.prompt)
    : { prompt: job.prompt, writableRoots: [] }
  const repository = db
    .select({ path: repositories.localPath, strategy: repositories.workspaceStrategy })
    .from(repositories)
    .where(eq(repositories.id, job.repo_id))
    .get()
  const writableRoots = repository?.strategy === 'direct' ? [...memoryLaunch.writableRoots, repository.path] : memoryLaunch.writableRoots
  const log = createWriteStream(job.log_path, { flags: 'a' })
  log.write(`${JSON.stringify({ time: new Date().toISOString(), event: 'retry_started', prompt: memoryLaunch.prompt })}\n`)
  const child = spawnAgentThread(
    {
      jobId: job.id,
      cwd: sessionCwd,
      base: job.base_repo_path,
      prompt: memoryLaunch.prompt,
      reviewMode: usesReviewWorkspace(job.kind),
      ephemeral: Boolean(job.ephemeral),
      model: job.agent_model,
      reasoningEffort: job.agent_reasoning_effort,
      writableRoots,
    },
    { cwd: sessionCwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    runtimeAgent,
  )
  jobLifecycle.markStarting(job.id, `Retrying with ${runtimeAgent.name}…`)
  monitorJobProcess(child, job.id, log, runtimeAgent)
  const restarted = db.select(getTableColumns(jobs)).from(jobs).where(eq(jobs.id, job.id)).get()
  return restarted ? jobRecord(restarted) : undefined
}
