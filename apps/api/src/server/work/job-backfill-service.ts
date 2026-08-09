import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, pullRequests, repositories, workItems } from '../database/schema/tables.ts'
import { pullRequestRecord } from '../database/contract-records.ts'
import type { WorkProviderResolution } from './work-model.ts'

type Repository = { id: number; full_name: string }
type WorkItem = { id: number }

export class WorkJobBackfillService {
  constructor(
    private readonly db: DrizzleDashboardDatabase,
    private readonly providers: WorkProviderResolution,
    private readonly create: (input: Record<string, unknown>) => WorkItem,
    private readonly ensureReview: (repository: Repository, pullRequest: any) => WorkItem,
    private readonly ensureDelivery: (workItemId: number, repository: Repository, pullRequest: any) => unknown,
  ) {}

  private relatedItem(job: any) {
    const sourceRow = job.source_job_id
      ? this.db
          .select({ item: workItems })
          .from(jobs)
          .innerJoin(workItems, eq(workItems.id, jobs.workItemId))
          .where(eq(jobs.id, job.source_job_id))
          .get()
      : undefined
    const source = sourceRow ? (sourceRow.item as WorkItem) : null
    if (source || !job.worktree_path) return source
    const sibling = this.db
      .select({ item: workItems })
      .from(jobs)
      .innerJoin(workItems, eq(workItems.id, jobs.workItemId))
      .where(and(eq(jobs.worktreePath, job.worktree_path), isNotNull(jobs.workItemId)))
      .orderBy(asc(jobs.id))
      .limit(1)
      .get()
    return sibling ? (sibling.item as WorkItem) : undefined
  }

  private pullRequest(job: any) {
    const number = Number(job.linked_pr_number || job.pr_number)
    if (number <= 0) return null
    const row = this.db
      .select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, job.repo_id), eq(pullRequests.number, number)))
      .get()
    return row ? pullRequestRecord(row) : null
  }

  private createItem(job: any, repository: Repository, pullRequest: any) {
    if (job.kind === 'review' && pullRequest) return this.ensureReview(repository, pullRequest)
    const pullRequestTitle = pullRequest
      ? `${job.kind === 'review' ? 'Review' : 'Work on'} PR #${pullRequest.number}: ${pullRequest.title}`
      : null
    return this.create({
      title: job.task_title || pullRequestTitle || `Agent work #${job.id}`,
      kind:
        job.kind === 'review'
          ? 'pr_review'
          : this.providers.runKindWorkKind?.(job.kind) || (job.kind === 'stack_analysis' ? 'investigation' : 'implementation'),
      repositoryId: job.repo_id,
    })
  }

  run() {
    const unlinkedJobs = this.db
      .select({
        id: jobs.id,
        source_job_id: jobs.sourceJobId,
        worktree_path: jobs.worktreePath,
        kind: jobs.kind,
        task_title: jobs.taskTitle,
        repo_id: jobs.repoId,
        linked_pr_number: jobs.linkedPrNumber,
        pr_number: jobs.prNumber,
        full_name: repositories.fullName,
      })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(isNull(jobs.workItemId))
      .orderBy(asc(jobs.id))
      .all()
    for (const job of unlinkedJobs) {
      const pullRequest = this.pullRequest(job)
      const repository = { id: job.repo_id, full_name: job.full_name }
      const item = this.relatedItem(job) || this.createItem(job, repository, pullRequest)
      this.db.update(jobs).set({ workItemId: item.id }).where(eq(jobs.id, job.id)).run()
      if (pullRequest && job.kind !== 'review') this.ensureDelivery(item.id, repository, pullRequest)
    }
  }
}
