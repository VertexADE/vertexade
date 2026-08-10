import { stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { jobs } from '../../database/schema/tables.ts'
import { jobRecord } from '../../database/contract-records.ts'
import { invalidateLogEventContext } from '../../log-files.ts'
import { removeProviderThread } from '../../work/provider-thread-cleanup.ts'
import { withWorktreeOwnershipRepair } from '../../work/worktree-ownership.ts'
import { isManagedJobWorkspacePath } from '../../work/workspace-layout.ts'
import {
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeBody as body,
  runtimeDb as db,
  runtimeDeleteThreadJob as deleteThreadJob,
  runtimeForkThreadJob as forkThreadJob,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimeRun as run,
  runtimeWorktreePreviews as worktreePreviews,
} from '../runtime-context.ts'
import { matchThreadRoute, rejectThreadRoute, storedJob, type MatchedThreadRoute, type ThreadRoute } from './support.ts'

const lifecycleRoutes = [
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/fork$/, handle: forkThread },
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/archive$/, handle: archiveThread },
  { method: 'DELETE', pattern: /^\/api\/agent-threads\/(\d+)$/, handle: deleteThread },
  { method: 'POST', pattern: /^\/api\/cleanup-worktrees\/(\d+)\/remove$/, handle: cleanupWorktree },
] satisfies MatchedThreadRoute[]

export const handleThreadLifecycleRoutes: ThreadRoute = (request, url) => matchThreadRoute(request, url, lifecycleRoutes)

async function forkThread(request: Request, _url: URL, match: RegExpMatchArray) {
  const source = requiredJob(match, 'Agent run not found')
  const runtimeAgent = agents.require(source.agent_id || agentProvider)
  assertThreadRetained(source, runtimeAgent.name)
  if (source.ephemeral) rejectThreadRoute(409, 'Ephemeral runs cannot be forked because their provider session is not retained')
  assertInactive(source, `Wait for the current ${runtimeAgent.name} turn to finish before forking`)
  const input = await body(request)
  const title = String(input.title || '').trim()
  const prompt = String(input.prompt || '').trim()
  if (!title) rejectThreadRoute(400, 'Fork title is required')
  if (!prompt) rejectThreadRoute(400, 'Tell the forked thread what to work on')
  return json(202, await forkThreadJob(source, title, prompt, String(input.base || 'current'), String(input.branch_type || 'feature')))
}

async function archiveThread(request: Request, _url: URL, match: RegExpMatchArray) {
  const job = mutableThread(match, 'archiving')
  const input = await body(request)
  const archived = input.archived !== false
  db.update(jobs)
    .set({ archivedAt: archived ? sql`CURRENT_TIMESTAMP` : null })
    .where(eq(jobs.id, job.id))
    .run()
  notifyClients(archived ? 'thread_archived' : 'thread_restored', job.id)
  return json(200, { archived, worktree_retained: true })
}

async function deleteThread(_request: Request, _url: URL, match: RegExpMatchArray) {
  const job = mutableThread(match, 'deleting')
  return json(200, await deleteThreadJob(job))
}

function mutableThread(match: RegExpMatchArray, action: 'archiving' | 'deleting') {
  const job = requiredJob(match, 'Agent run not found')
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  assertThreadRetained(job, runtimeAgent.name)
  assertInactive(job, `Wait for the active ${runtimeAgent.name} turn to finish before ${action}`)
  return job
}

function requiredJob(match: RegExpMatchArray, message: string) {
  const job = storedJob(Number(match[1]))
  if (!job) rejectThreadRoute(404, message)
  return job
}

function assertThreadRetained(job: ReturnType<typeof requiredJob>, agentName: string) {
  if (!job.thread_id) rejectThreadRoute(404, `${agentName} thread not found`)
}

function assertInactive(job: ReturnType<typeof requiredJob>, message: string) {
  if (['starting', 'running'].includes(job.status)) rejectThreadRoute(409, message)
}

async function cleanupWorktree(request: Request, _url: URL, match: RegExpMatchArray) {
  const job = cleanupCandidate(match)
  const input = await body(request)
  const removeThreadHistory = input.remove_thread_history === true
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  assertOwnedWorktree(job, runtimeAgent.name, runtimeAgent.workspaceRoot)
  assertNoActiveRun(job.worktree_path)
  const relatedJobs = jobsInWorktree(job.worktree_path)
  await stopPreviews(relatedJobs)
  await removeGitWorktree(job)
  const providerThreadsRetained = removeThreadHistory
    ? await removeThreadHistoryFor(relatedJobs, job.worktree_path)
    : retainHistory(job.worktree_path)
  notifyClients('closed_pr_worktree_removed', job.id)
  return json(200, {
    removed: true,
    thread_history_removed: removeThreadHistory,
    provider_threads_retained: providerThreadsRetained,
  })
}

function cleanupCandidate(match: RegExpMatchArray) {
  const job = storedJob(Number(match[1]))
  if (!job?.pr_closed_at || job.worktree_removed_at) rejectThreadRoute(404, 'Closed PR worktree not found')
  return job
}

function assertOwnedWorktree(job: ReturnType<typeof cleanupCandidate>, agentName: string, workspaceRoot: string) {
  if (isManagedJobWorkspacePath(job, job.worktree_path, workspaceRoot)) return
  rejectThreadRoute(409, `Refusing to remove a worktree outside VertexADE-managed workspace storage for ${agentName}`)
}

function assertNoActiveRun(worktreePath: string) {
  const active = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.worktreePath, worktreePath), inArray(jobs.status, ['starting', 'running'])))
    .get()
  if (active) rejectThreadRoute(409, `Run #${active.id} is still active in this worktree`)
}

function jobsInWorktree(worktreePath: string) {
  return db.select().from(jobs).where(eq(jobs.worktreePath, worktreePath)).orderBy(asc(jobs.id)).all().map(jobRecord)
}

async function stopPreviews(relatedJobs: ReturnType<typeof jobsInWorktree>) {
  for (const related of relatedJobs) await worktreePreviews.stopAndWait(related.id)
}

async function removeGitWorktree(job: ReturnType<typeof cleanupCandidate>) {
  try {
    await withWorktreeOwnershipRepair(run, job.worktree_path, () =>
      run('git', ['-C', job.base_repo_path, 'worktree', 'remove', '--force', job.worktree_path]),
    )
    await run('git', ['-C', job.base_repo_path, 'worktree', 'prune'])
  } catch (error) {
    await rethrowIfWorktreeRemains(job.worktree_path, error)
  }
}

async function rethrowIfWorktreeRemains(worktreePath: string, error: unknown) {
  try {
    await stat(worktreePath)
    throw error
  } catch (statError) {
    if (statError === error) throw error
  }
}

async function removeThreadHistoryFor(relatedJobs: ReturnType<typeof jobsInWorktree>, worktreePath: string) {
  let retained = 0
  for (const related of relatedJobs) retained += await removeRelatedProviderThread(related)
  for (const related of relatedJobs) await forgetRelatedJob(related)
  db.delete(jobs).where(eq(jobs.worktreePath, worktreePath)).run()
  return retained
}

async function removeRelatedProviderThread(related: ReturnType<typeof jobsInWorktree>[number]) {
  if (!related.thread_id || related.ephemeral) return 0
  const relatedAgent = agents.require(related.agent_id || agentProvider)
  return (await removeProviderThread(relatedAgent, related.thread_id, Boolean(related.ephemeral))) ? 0 : 1
}

async function forgetRelatedJob(related: ReturnType<typeof jobsInWorktree>[number]) {
  db.update(jobs).set({ sourceJobId: null }).where(eq(jobs.sourceJobId, related.id)).run()
  try {
    await unlink(related.log_path)
  } catch {}
  invalidateLogEventContext(related.log_path)
}

function retainHistory(worktreePath: string) {
  db.update(jobs)
    .set({ worktreeRemovedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(jobs.worktreePath, worktreePath))
    .run()
  return 0
}
