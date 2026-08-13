import type { AutomationThreadAction, TriggerEvent } from '@vertexade/platform-contracts'
import { and, desc, eq, inArray, isNotNull, notInArray, sql, type SQL } from 'drizzle-orm'
import { automaticReviewLaunchAllowed } from '../automatic-review-queue.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, pullRequests, repositories, workItemResources, workItems, workResources } from '../database/schema/tables.ts'
import { generalWorkspaceRepository } from '../work/general-workspace.ts'

type Repository = { id: number; full_name: string; clone_url: string; local_path: string }
type PullRequest = Record<string, unknown> & { repo_id: number; number: number; title: string }
type WorkTarget = { repository: Repository; repositories?: Repository[]; title: string; workItemId: number | null }
export type AutomationThreadLaunchResult = { jobId: number } | { skippedReason: string }

export type AutomationThreadLaunchOptions = {
  branchType?: string
  agentId?: string | null
  model?: string | null
  reasoningEffort?: string | null
  serviceTier?: string | null
  allowSubagents?: boolean
  workKind?: 'implementation' | 'pr_review' | 'investigation' | 'operational'
  source?: Record<string, unknown>
  repositoryIds?: number[]
}

export type AutomationThreadLaunchDependencies = {
  launchWork(target: WorkTarget, prompt: string, options: AutomationThreadLaunchOptions): Promise<unknown>
  launchPullRequestWork(
    repository: Repository,
    pullRequest: PullRequest,
    prompt: string,
    options: AutomationThreadLaunchOptions,
  ): Promise<unknown>
  resumeWork(jobId: number, prompt: string): Promise<unknown>
  launchPullRequestReview(
    repository: Repository,
    pullRequest: PullRequest,
    prompt: string,
    options: AutomationThreadLaunchOptions,
  ): Promise<unknown>
  launchWorktreeReview(sourceJobId: number, workItemId: number, prompt: string, options: AutomationThreadLaunchOptions): Promise<unknown>
}

type TriggerTarget = { entityType: string; entityId: number; entity: Record<string, unknown> }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function triggerTarget(trigger?: TriggerEvent): TriggerTarget {
  const data = record(trigger?.data)
  const entityId = Number(data.entityId)
  const entityType = String(data.entityType || '')
  if (!entityType || !Number.isInteger(entityId) || entityId <= 0) {
    throw new Error('The automation event does not identify a thread target')
  }
  return { entityType, entityId, entity: record(data.entity) }
}

function triggerLaunchOptions(trigger?: TriggerEvent): AutomationThreadLaunchOptions {
  const input = record(record(trigger?.data).launch)
  return {
    branchType: String(input.branchType || '').trim() || undefined,
    agentId: String(input.agentId || '').trim() || null,
    model: String(input.model || '').trim() || null,
    reasoningEffort: String(input.reasoningEffort || '').trim() || null,
    serviceTier: String(input.serviceTier || '').trim() || null,
    allowSubagents: Boolean(input.allowSubagents),
    workKind: ['implementation', 'pr_review', 'investigation', 'operational'].includes(String(input.workKind))
      ? (String(input.workKind) as AutomationThreadLaunchOptions['workKind'])
      : undefined,
    source: Object.keys(record(input.source)).length ? record(input.source) : undefined,
    repositoryIds: Array.isArray(input.repositoryIds) ? input.repositoryIds.map(Number).filter(Number.isInteger) : undefined,
  }
}

function requireRow<T>(value: T | undefined, message: string): T {
  if (!value) throw new Error(message)
  return value
}

function repositoryById(database: DrizzleDashboardDatabase, id: number) {
  return database
    .select({
      id: repositories.id,
      full_name: repositories.fullName,
      clone_url: repositories.cloneUrl,
      local_path: repositories.localPath,
    })
    .from(repositories)
    .where(eq(repositories.id, id))
    .get()
}

function workTarget(database: DrizzleDashboardDatabase, target: TriggerTarget): WorkTarget {
  if (target.entityType === 'work-item') {
    const item = requireRow(
      database
        .select({ id: workItems.id, title: workItems.title, repositoryId: workItems.primaryRepositoryId })
        .from(workItems)
        .where(eq(workItems.id, target.entityId))
        .get(),
      'The triggered Work item is no longer available',
    )
    const linkedIds = database
      .select({ repositoryId: workResources.repositoryId })
      .from(workItemResources)
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(and(eq(workItemResources.workItemId, item.id), eq(workResources.kind, 'repository')))
      .all()
      .map((row) => Number(row.repositoryId))
      .filter(Number.isInteger)
    const repositoryIds = [...new Set([...(item.repositoryId ? [item.repositoryId] : []), ...linkedIds])]
    const linkedRepositories = repositoryIds
      .map((id) => repositoryById(database, id))
      .filter((value): value is Repository => Boolean(value))
    const workspace = linkedRepositories.length ? linkedRepositories : [generalWorkspaceRepository(database)]
    return {
      repository: workspace[0],
      repositories: workspace,
      title: item.title,
      workItemId: item.id,
    }
  }
  if (target.entityType === 'agent-thread') {
    const row = requireRow(
      database
        .select({
          repository: {
            id: repositories.id,
            full_name: repositories.fullName,
            clone_url: repositories.cloneUrl,
            local_path: repositories.localPath,
          },
          workItemId: jobs.workItemId,
          workTitle: jobs.taskTitle,
        })
        .from(jobs)
        .innerJoin(repositories, eq(repositories.id, jobs.repoId))
        .where(eq(jobs.id, target.entityId))
        .get(),
      'The triggered agent run is no longer available',
    )
    return {
      repository: row.repository,
      title: row.workTitle || `Continue run #${target.entityId}`,
      workItemId: row.workItemId,
    }
  }
  if (target.entityType === 'pull-request') {
    const repositoryId = Number(target.entity.repo_id)
    const row = requireRow(
      database
        .select({
          repository: {
            id: repositories.id,
            full_name: repositories.fullName,
            clone_url: repositories.cloneUrl,
            local_path: repositories.localPath,
          },
          workTitle: pullRequests.title,
        })
        .from(pullRequests)
        .innerJoin(repositories, eq(repositories.id, pullRequests.repoId))
        .where(and(eq(pullRequests.repoId, repositoryId), eq(pullRequests.number, target.entityId)))
        .get(),
      'The triggered pull request is no longer available',
    )
    return {
      repository: row.repository,
      title: `Follow up PR #${target.entityId}: ${row.workTitle}`.slice(0, 200),
      workItemId: null,
    }
  }
  if (target.entityType === 'repository') {
    const repository = requireRow(repositoryById(database, target.entityId), 'The triggered repository is no longer available')
    return {
      repository,
      title: String(target.entity.title || '').trim() || `Automated work for ${repository.full_name}`,
      workItemId: null,
    }
  }
  throw new Error(`A Work thread cannot target ${target.entityType} events`)
}

function pullRequest(database: DrizzleDashboardDatabase, repoId: number, number: number) {
  const repository = repositoryById(database, repoId)
  const pullRequest = database
    .select({
      repo_id: pullRequests.repoId,
      number: pullRequests.number,
      title: pullRequests.title,
      author: pullRequests.author,
      url: pullRequests.url,
      head_ref: pullRequests.headRef,
      head_sha: pullRequests.headSha,
      base_ref: pullRequests.baseRef,
      draft: pullRequests.draft,
      updated_at: pullRequests.updatedAt,
      labels: pullRequests.labels,
      reviewers: pullRequests.reviewers,
      review_decision: pullRequests.reviewDecision,
      auto_review_watch: pullRequests.autoReviewWatch,
      auto_reviewed_head_sha: pullRequests.autoReviewedHeadSha,
    })
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, number)))
    .get()
  if (!repository || !pullRequest) throw new Error('The triggered pull request is no longer available')
  return { repository, pullRequest }
}

function pullRequestReviewSkipReason(database: DrizzleDashboardDatabase, pullRequest: PullRequest): string | null {
  const headSha = String(pullRequest.head_sha || '')
  if (!headSha) return 'The pull request has no head commit to review'

  const eligibleReview = and(
    eq(jobs.repoId, pullRequest.repo_id),
    eq(jobs.prNumber, pullRequest.number),
    eq(jobs.kind, 'review'),
    inArray(jobs.status, ['starting', 'running', 'completed']),
    sql`coalesce(${jobs.reviewRole}, 'single') <> 'member'`,
  )
  const currentHeadReview = database
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eligibleReview, eq(jobs.headSha, headSha)))
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  if (currentHeadReview) return 'The current pull request head already has a review'

  const latestReview = database.select({ headSha: jobs.headSha }).from(jobs).where(eligibleReview).orderBy(desc(jobs.id)).limit(1).get()
  if (
    automaticReviewLaunchAllowed({
      headSha,
      reviewedHeadSha: String(pullRequest.auto_reviewed_head_sha || '') || null,
      latestAutomaticHeadSha: latestReview?.headSha,
      watched: Boolean(pullRequest.auto_review_watch),
    })
  )
    return null

  return 'Watch for updates is off for this pull request'
}

function workItemPullRequest(database: DrizzleDashboardDatabase, workItemId: number) {
  return database
    .select({
      repo_id: workResources.repositoryId,
      number: sql<number>`CAST(json_extract(${workResources.metadata}, '$.number') AS INTEGER)`,
    })
    .from(workItemResources)
    .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
    .where(
      and(
        eq(workItemResources.workItemId, workItemId),
        eq(workResources.kind, 'pull_request'),
        eq(workItemResources.role, 'review_subject'),
      ),
    )
    .orderBy(desc(workItemResources.isPrimary), desc(workResources.id))
    .limit(1)
    .get()
}

const nonImplementationKinds = ['review', 'work_review', 'stack_analysis', 'planning']

function reviewWorktree(database: DrizzleDashboardDatabase, workItemId: number, jobId?: number) {
  const row = database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        jobId ? eq(jobs.id, jobId) : undefined,
        eq(jobs.workItemId, workItemId),
        isNotNull(jobs.worktreePath),
        sql`${jobs.worktreeRemovedAt} IS NULL`,
        notInArray(jobs.status, ['starting', 'running']),
        notInArray(jobs.kind, nonImplementationKinds),
      ),
    )
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
  if (!row) throw new Error('The automation target has no stopped implementation worktree to review')
  return { sourceJobId: Number(row.id), workItemId }
}

function reviewTarget(database: DrizzleDashboardDatabase, target: TriggerTarget) {
  if (target.entityType === 'pull-request')
    return {
      kind: 'pull-request' as const,
      ...pullRequest(database, Number(target.entity.repo_id), target.entityId),
    }
  if (target.entityType === 'work-item') {
    const linked = workItemPullRequest(database, target.entityId)
    if (linked)
      return {
        kind: 'pull-request' as const,
        ...pullRequest(database, Number(linked.repo_id), Number(linked.number)),
      }
    return { kind: 'worktree' as const, ...reviewWorktree(database, target.entityId) }
  }
  if (target.entityType === 'agent-thread') {
    const job = requireRow(
      database
        .select({
          id: jobs.id,
          repoId: jobs.repoId,
          prNumber: jobs.prNumber,
          workItemId: jobs.workItemId,
          kind: jobs.kind,
        })
        .from(jobs)
        .where(eq(jobs.id, target.entityId))
        .get(),
      'The triggered agent run is no longer available',
    )
    if (job.workItemId && !['review', 'work_review'].includes(job.kind))
      return {
        kind: 'worktree' as const,
        ...reviewWorktree(database, job.workItemId, target.entityId),
      }
    if (job.prNumber > 0)
      return {
        kind: 'pull-request' as const,
        ...pullRequest(database, job.repoId, job.prNumber),
      }
    throw new Error('The triggered agent run has no reviewable worktree or pull request')
  }
  throw new Error(`A Review thread cannot target ${target.entityType} events`)
}

function resumableWorkJob(database: DrizzleDashboardDatabase, condition: SQL) {
  return database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        condition,
        isNotNull(jobs.threadId),
        notInArray(jobs.status, ['starting', 'running']),
        notInArray(jobs.kind, nonImplementationKinds),
      ),
    )
    .orderBy(desc(jobs.id))
    .limit(1)
    .get()
}

function improveTarget(database: DrizzleDashboardDatabase, target: TriggerTarget) {
  if (target.entityType === 'pull-request') {
    return {
      kind: 'pull-request' as const,
      ...pullRequest(database, Number(target.entity.repo_id), target.entityId),
    }
  }
  if (target.entityType === 'work-item') {
    const existing = resumableWorkJob(database, eq(jobs.workItemId, target.entityId))
    if (existing) return { kind: 'existing-thread' as const, jobId: Number(existing.id) }
    const linked = workItemPullRequest(database, target.entityId)
    if (linked)
      return {
        kind: 'pull-request' as const,
        ...pullRequest(database, Number(linked.repo_id), Number(linked.number)),
      }
    return { kind: 'work' as const, target: workTarget(database, target) }
  }
  if (target.entityType === 'agent-thread') {
    const existing = resumableWorkJob(database, eq(jobs.id, target.entityId))
    if (existing) return { kind: 'existing-thread' as const, jobId: Number(existing.id) }
    const job = requireRow(
      database.select({ repoId: jobs.repoId, prNumber: jobs.prNumber }).from(jobs).where(eq(jobs.id, target.entityId)).get(),
      'The triggered agent run is no longer available',
    )
    if (job.prNumber > 0)
      return {
        kind: 'pull-request' as const,
        ...pullRequest(database, job.repoId, job.prNumber),
      }
    return { kind: 'work' as const, target: workTarget(database, target) }
  }
  return { kind: 'work' as const, target: workTarget(database, target) }
}

function launchedJobId(value: unknown) {
  const result = record(value)
  const direct = Number(result.id)
  if (Number.isInteger(direct) && direct > 0) return direct
  const threads = Array.isArray(result.threads) ? result.threads : []
  const nested = Number(record(threads[0]).id)
  if (Number.isInteger(nested) && nested > 0) return nested
  throw new Error('The automation thread launcher did not return a job')
}

export function createAutomationThreadLauncher(database: DrizzleDashboardDatabase, dependencies: AutomationThreadLaunchDependencies) {
  return async (
    action: Exclude<AutomationThreadAction, 'none'>,
    prompt: string,
    trigger?: TriggerEvent,
    configured: AutomationThreadLaunchOptions = {},
  ) => {
    const target = triggerTarget(trigger)
    const launchOptions = {
      ...triggerLaunchOptions(trigger),
      ...Object.fromEntries(Object.entries(configured).filter(([, value]) => value != null && value !== '')),
    }
    if (action === 'work')
      return {
        jobId: launchedJobId(await dependencies.launchWork(workTarget(database, target), prompt, launchOptions)),
      }
    if (action === 'improve') {
      const improvement = improveTarget(database, target)
      if (improvement.kind === 'existing-thread') return { jobId: launchedJobId(await dependencies.resumeWork(improvement.jobId, prompt)) }
      if (improvement.kind === 'pull-request') {
        return {
          jobId: launchedJobId(
            await dependencies.launchPullRequestWork(improvement.repository, improvement.pullRequest, prompt, launchOptions),
          ),
        }
      }
      return { jobId: launchedJobId(await dependencies.launchWork(improvement.target, prompt, launchOptions)) }
    }
    const review = reviewTarget(database, target)
    if (review.kind === 'pull-request') {
      const skippedReason = pullRequestReviewSkipReason(database, review.pullRequest)
      if (skippedReason) return { skippedReason }
    }
    const launched =
      review.kind === 'pull-request'
        ? dependencies.launchPullRequestReview(review.repository, review.pullRequest, prompt, launchOptions)
        : dependencies.launchWorktreeReview(review.sourceJobId, review.workItemId, prompt, launchOptions)
    return { jobId: launchedJobId(await launched) }
  }
}
