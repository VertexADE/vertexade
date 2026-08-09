import { reviewRerunSelection } from '../../reviews.ts'
import { createDiffLineIndex, indexedDiffLineContent, suggestionMarkdown } from '@vertexade/platform-contracts'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { jobs, prTasks, pullRequests, repositories, reviewBatches, reviewSuggestions } from '../../database/schema/tables.ts'
import { jobRecord, reviewSuggestionRecord } from '../../database/contract-records.ts'
import {
  runtimeBody as body,
  runtimeAgentProvider as agentProvider,
  runtimeCreateNotification as createNotification,
  runtimeDb as db,
  runtimeJson as json,
  runtimeLaunchJob as launchJob,
  runtimeLaunchReviewSelection as launchReviewSelection,
  runtimeNotifyClients as notifyClients,
  runtimeScmProvider as scmProvider,
  runtimeScmUser as scmUser,
} from '../runtime-context.ts'
import {
  matchThreadRoute,
  rejectThreadRoute,
  storedJob,
  storedPullRequest,
  storedRepository,
  type MatchedThreadRoute,
  type ThreadRoute,
} from './support.ts'

const reviewRoutes = [
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/save-stack-tasks$/, handle: saveStackTasks },
  { method: 'POST', pattern: /^\/api\/pr-tasks\/(\d+)$/, handle: updatePrTask },
  { method: 'POST', pattern: /^\/api\/pr-tasks\/(\d+)\/(approve|approve-auto-merge)$/, handle: approvePrTask },
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/re-review$/, handle: reReview },
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/handoff$/, handle: handoffReview },
  { method: 'GET', pattern: /^\/api\/agent-threads\/(\d+)\/suggestions$/, handle: getSuggestions },
  { method: 'POST', pattern: /^\/api\/agent-threads\/(\d+)\/suggestions$/, handle: postSuggestions },
] satisfies MatchedThreadRoute[]

export const handleThreadReviewRoutes: ThreadRoute = (request, url) => matchThreadRoute(request, url, reviewRoutes)

async function saveStackTasks(_request: Request, _url: URL, match: RegExpMatchArray) {
  const job = storedJob(Number(match[1]))
  if (job?.kind !== 'stack_analysis') rejectThreadRoute(404, 'PR stack analysis not found')
  if (job.status !== 'completed' || !job.result_text) rejectThreadRoute(409, 'Wait for the stack analysis to complete')
  const tasks = stackTaskManifest(job.result_text)
  const openPullRequests = openPullRequestNumbers(job.repo_id)
  const saved = saveManifestTasks(tasks, openPullRequests, job.repo_id, job.id)
  notifyClients('pr_tasks_saved', job.id)
  return json(200, { saved })
}

function stackTaskManifest(result: string) {
  const manifest = result.match(/<!--\s*PR_TASKS_JSON\s*\n([\s\S]*?)\n\s*-->/i)
  if (!manifest) rejectThreadRoute(422, 'This analysis did not include a task manifest. Ask Codex to regenerate the report.')
  let tasks: unknown
  try {
    tasks = JSON.parse(manifest[1])
  } catch {
    rejectThreadRoute(422, 'Codex returned an invalid task manifest')
  }
  if (!Array.isArray(tasks)) rejectThreadRoute(422, 'Codex returned an invalid task manifest')
  return tasks
}

function openPullRequestNumbers(repositoryId: number): Set<number> {
  return new Set(
    db
      .select({ number: pullRequests.number })
      .from(pullRequests)
      .where(eq(pullRequests.repoId, repositoryId))
      .all()
      .map((pullRequest) => Number(pullRequest.number)),
  )
}

function saveManifestTasks(tasks: unknown[], openPullRequests: Set<number>, repositoryId: number, jobId: number) {
  let saved = 0
  for (const task of tasks.slice(0, 100)) saved += saveManifestTask(task, openPullRequests, repositoryId, jobId)
  return saved
}

function saveManifestTask(task: any, openPullRequests: Set<number>, repositoryId: number, jobId: number) {
  const number = Number(task?.pr_number)
  const title = limitedText(task?.title, 200)
  const rationale = limitedText(task?.rationale, 4_000)
  if (!openPullRequests.has(number) || !title || !rationale) return 0
  const recommendedBase = optionalLimitedText(task?.recommended_base, 255)
  db.insert(prTasks)
    .values({ repoId: repositoryId, prNumber: number, analysisJobId: jobId, title, rationale, recommendedBase })
    .onConflictDoUpdate({
      target: [prTasks.repoId, prTasks.prNumber],
      set: { analysisJobId: jobId, title, rationale, recommendedBase, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .run()
  return 1
}

function limitedText(value: unknown, limit: number) {
  return String(value || '')
    .trim()
    .slice(0, limit)
}

function optionalLimitedText(value: unknown, limit: number) {
  if (value == null) return null
  return limitedText(value, limit) || null
}

async function updatePrTask(request: Request, _url: URL, match: RegExpMatchArray) {
  const input = await body(request)
  const status = String(input.status || '')
  if (!['open', 'done', 'dismissed'].includes(status)) rejectThreadRoute(400, 'Choose a valid task status')
  const taskId = Number(match[1])
  const result = db
    .update(prTasks)
    .set({ status, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(prTasks.id, taskId))
    .run()
  if (!result.changes) rejectThreadRoute(404, 'PR task not found')
  notifyClients('pr_task_updated', taskId)
  return json(200, { status })
}

async function approvePrTask(_request: Request, _url: URL, match: RegExpMatchArray) {
  const task = approvalTask(Number(match[1]))
  await assertTaskApprovable(task)
  const ref = { repository: task.full_name, number: task.pr_number }
  await scmProvider(ref.repository).approve(ref)
  if (match[2] === 'approve-auto-merge') return approveAndAutoMerge(task, ref)
  notifyClients('pr_task_approved', task.id)
  return json(200, { message: `Approved #${task.pr_number}` })
}

function approvalTask(taskId: number) {
  const task = db.get(
    sql`SELECT t.*, r.full_name, p.author, p.checks_failed FROM pr_tasks t
      JOIN repositories r ON r.id=t.repo_id
      LEFT JOIN pull_requests p ON p.repo_id=t.repo_id AND p.number=t.pr_number
      WHERE t.id=${taskId}`,
  ) as any
  if (!task) rejectThreadRoute(404, 'PR task not found')
  if (!task.author) rejectThreadRoute(409, 'The pull request is no longer open')
  return task
}

async function assertTaskApprovable(task: any) {
  const user = await scmUser(task.full_name)
  if (user.login.toLowerCase() === String(task.author).toLowerCase())
    rejectThreadRoute(409, 'GitHub does not allow authors to approve their own pull requests')
  if (Number(task.checks_failed) > 0) rejectThreadRoute(409, 'Resolve failing GitHub Actions before approval')
}

async function approveAndAutoMerge(task: any, ref: { repository: string; number: number }) {
  await scmProvider(ref.repository).enableAutoMerge(ref)
  db.update(prTasks)
    .set({ status: 'done', updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(prTasks.id, task.id))
    .run()
  notifyClients('pr_task_auto_merge', task.id)
  return json(202, { message: `Approved #${task.pr_number} and enabled squash auto-merge` })
}

async function reReview(_request: Request, _url: URL, match: RegExpMatchArray) {
  const source = storedJob(Number(match[1]))
  if (source?.kind !== 'review') rejectThreadRoute(404, 'Review run not found')
  if (source.status !== 'completed') rejectThreadRoute(409, 'Wait for the current review to complete before starting a fresh review')
  if (source.pr_closed_at) rejectThreadRoute(409, 'The pull request is no longer open')
  const repo = storedRepository(source.repo_id)
  const pr = storedPullRequest(source.repo_id, source.pr_number)
  if (!repo || !pr) rejectThreadRoute(409, 'The pull request is no longer open')
  const selection = rerunSelection(source)
  const result = await launchReviewSelection(repo, pr, selection.agentIds, selection.aggregatorAgentId, {
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    sourceJobId: source.id,
  })
  return json(202, { ...result, mode: selection.agentIds.length > 1 ? 'aggregate' : 'single', source_job_id: source.id })
}

function rerunSelection(source: NonNullable<ReturnType<typeof storedJob>>) {
  const batch = reviewBatch(source)
  const memberAgentIds = batch ? reviewMemberAgents(source.review_batch_id) : []
  return reviewRerunSelection(
    {
      agentId: source.agent_id || agentProvider,
      reviewRole: source.review_role,
      model: source.agent_model,
      reasoningEffort: source.agent_reasoning_effort,
    },
    memberAgentIds,
    batch?.aggregator_agent_id,
  )
}

function reviewBatch(source: NonNullable<ReturnType<typeof storedJob>>) {
  if (source.review_role !== 'aggregate' || !source.review_batch_id) return null
  return db
    .select({ aggregator_agent_id: reviewBatches.aggregatorAgentId })
    .from(reviewBatches)
    .where(eq(reviewBatches.id, source.review_batch_id))
    .get()
}

function reviewMemberAgents(batchId: number | null) {
  return db
    .select({ agent_id: jobs.agentId })
    .from(jobs)
    .where(and(eq(jobs.reviewBatchId, batchId), eq(jobs.reviewRole, 'member')))
    .orderBy(asc(jobs.id))
    .all()
    .map((member) => member.agent_id)
}

async function handoffReview(request: Request, _url: URL, match: RegExpMatchArray) {
  const review = storedJob(Number(match[1]))
  if (!review || review.kind !== 'review') rejectThreadRoute(404, 'Review run not found')
  if (review.status !== 'completed' || !review.result_text) rejectThreadRoute(409, 'Wait for the review findings to complete')
  const repo = storedRepository(review.repo_id)
  const pr = storedPullRequest(review.repo_id, review.pr_number)
  if (!repo || !pr) rejectThreadRoute(404, 'The pull request is no longer open')
  const input = await body(request)
  const instruction = String(input.prompt || '').trim()
  if (!instruction) rejectThreadRoute(400, 'Tell the new Codex how to use the findings')
  const prompt = handoffPrompt(instruction, String(review.result_text).slice(-60_000))
  return json(202, await launchJob(repo, pr, prompt, { kind: 'review_handoff', sourceJobId: review.id }))
}

function handoffPrompt(instruction: string, findings: string) {
  return `You are a new Codex run receiving findings from an independent, private code review of this pull request.

User instruction:
${instruction}

Validate the findings against the current PR before acting. Do exactly what the user instruction requests. The source review itself did not publish anything.

--- RETAINED REVIEW FINDINGS ---
${findings}
--- END RETAINED REVIEW FINDINGS ---`
}

async function getSuggestions(_request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  if (!storedReview(jobId)) rejectThreadRoute(404, 'Review job not found')
  return json(200, { suggestions: selectedSuggestions(jobId, false) })
}

function storedReview(jobId: number) {
  return db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.kind, 'review')))
    .get()
}

function selectedSuggestions(jobId: number, selectedOnly: boolean) {
  const conditions = [eq(reviewSuggestions.jobId, jobId)]
  if (selectedOnly) conditions.push(eq(reviewSuggestions.selected, 1), isNull(reviewSuggestions.postedAt))
  return db
    .select()
    .from(reviewSuggestions)
    .where(and(...conditions))
    .orderBy(asc(reviewSuggestions.position))
    .all()
    .map(reviewSuggestionRecord)
}

async function postSuggestions(request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const job = reviewJobWithRepository(jobId)
  const input = await body(request)
  const edits = Array.isArray(input.suggestions) ? input.suggestions : []
  for (const edit of edits) updateSuggestion(jobId, edit)
  const selected = selectedSuggestions(jobId, true).filter((item) => item.description.trim())
  if (!selected.length) rejectThreadRoute(400, 'Select at least one complete suggestion')
  return publishSuggestions(job, selected)
}

function reviewJobWithRepository(jobId: number) {
  const stored = db
    .select({ job: jobs, fullName: repositories.fullName })
    .from(jobs)
    .innerJoin(repositories, eq(repositories.id, jobs.repoId))
    .where(and(eq(jobs.id, jobId), eq(jobs.kind, 'review')))
    .get()
  if (!stored) rejectThreadRoute(404, 'Review job not found')
  return { ...jobRecord(stored.job), full_name: stored.fullName }
}

function updateSuggestion(jobId: number, edit: any) {
  db.update(reviewSuggestions)
    .set({
      selected: edit.selected === false ? 0 : 1,
      description: limitedText(edit.description, 10_000),
      replacement: String(edit.replacement || '')
        .replace(/\r\n/g, '\n')
        .slice(0, 50_000),
    })
    .where(and(eq(reviewSuggestions.id, Number(edit.id)), eq(reviewSuggestions.jobId, jobId), isNull(reviewSuggestions.postedAt)))
    .run()
}

async function publishSuggestions(job: ReturnType<typeof reviewJobWithRepository>, selected: ReturnType<typeof selectedSuggestions>) {
  const ref = { repository: job.full_name, number: job.pr_number }
  const provider = scmProvider(job.full_name)
  const snapshot = await currentReviewDiff(provider, ref)
  assertSuggestionsCurrent(job, selected, snapshot)
  const comments = selected.map((item) => ({
    path: item.path,
    line: item.line,
    side: item.side,
    body: suggestionMarkdown(item.description, item.replacement),
  }))
  try {
    const review = await provider.postReviewSuggestions(ref, 'Suggested changes from the private agent review.', comments)
    markSuggestionsPosted(selected)
    notifySuggestionsPosted(job, selected.length)
    return json(200, { posted: selected.length, review_url: review.html_url || null })
  } catch (error) {
    return json(409, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function currentReviewDiff(provider: ReturnType<typeof scmProvider>, ref: { repository: string; number: number }) {
  let current: any
  let diff: string
  try {
    const result = await Promise.all([provider.pullRequestDetails(ref, ['headRefOid', 'state']), provider.pullRequestDiff(ref)])
    current = result[0]
    diff = result[1]
  } catch (error) {
    rejectThreadRoute(409, `Could not validate the current pull request: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (String(current.state || '').toUpperCase() !== 'OPEN') rejectThreadRoute(409, 'The pull request is no longer open')
  return { current, diff }
}

function assertSuggestionsCurrent(
  job: ReturnType<typeof reviewJobWithRepository>,
  selected: ReturnType<typeof selectedSuggestions>,
  snapshot: Awaited<ReturnType<typeof currentReviewDiff>>,
) {
  const { current, diff } = snapshot
  if (String(current.headRefOid || '') !== String(job.head_sha || ''))
    rejectThreadRoute(409, 'The pull request changed since this agent review; start a fresh review before posting suggestions')
  const diffLines = createDiffLineIndex(diff)
  const invalid = selected.find((item) => item.side !== 'RIGHT' || indexedDiffLineContent(diffLines, item) === null)
  if (invalid)
    rejectThreadRoute(409, `${invalid.path}:${invalid.line} is no longer a current-file line in this pull request; start a fresh review`)
}

function markSuggestionsPosted(selected: ReturnType<typeof selectedSuggestions>) {
  for (const item of selected)
    db.update(reviewSuggestions)
      .set({ postedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(reviewSuggestions.id, item.id))
      .run()
}

function notifySuggestionsPosted(job: ReturnType<typeof reviewJobWithRepository>, count: number) {
  createNotification(
    'review_posted',
    'Suggestions posted',
    `${count} suggestion${count === 1 ? '' : 's'} posted to ${job.full_name} #${job.pr_number}.`,
    { jobId: job.id },
  )
  notifyClients('review_suggestions_posted', job.id)
}
