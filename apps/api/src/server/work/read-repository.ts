import { asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, repositories, workItemResources, workItems, workResources } from '../database/schema/tables.ts'
import { projectedWorkState } from './work-state.ts'
import { workItemRecord, workJobRecord, workResourceRecord } from './records.ts'

function parsedJson<T>(value: unknown, fallback: T): T {
  if (value !== null && value !== undefined && typeof value !== 'string') return value as T
  try {
    return JSON.parse(String(value || '')) as T
  } catch {
    return fallback
  }
}

function activitySummary(value: unknown) {
  const summary = String(value || '')
    .replace(/```[\s\S]*?```/g, ' Code change ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[\*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^Review summary\s*/i, '')
    .trim()
  return summary.length > 360 ? `${summary.slice(0, 357).trimEnd()}...` : summary
}

export class WorkReadRepository {
  constructor(private readonly database: DrizzleDashboardDatabase) {}

  resources(workItemId: number) {
    return this.database
      .select({ resource: workResources, role: workItemResources.role, isPrimary: workItemResources.isPrimary })
      .from(workItemResources)
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(eq(workItemResources.workItemId, workItemId))
      .orderBy(desc(workItemResources.isPrimary), asc(workResources.kind), asc(workResources.label))
      .all()
      .map(({ resource, role, isPrimary }) => ({
        ...workResourceRecord(resource),
        role,
        is_primary: isPrimary,
        metadata: parsedJson(resource.metadata, {}),
      })) as any[]
  }

  jobs(workItemId: number) {
    return this.database
      .select({
        id: jobs.id,
        status: jobs.status,
        kind: jobs.kind,
        threadId: jobs.threadId,
        agentId: jobs.agentId,
        taskTitle: jobs.taskTitle,
        prNumber: jobs.prNumber,
        branchName: jobs.branchName,
        latestActivity: jobs.latestActivity,
        activityAt: jobs.activityAt,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
        inputQuestions: jobs.inputQuestions,
        linkedPrNumber: jobs.linkedPrNumber,
        headSha: jobs.headSha,
        diffFiles: jobs.diffFiles,
        diffAdditions: jobs.diffAdditions,
        diffDeletions: jobs.diffDeletions,
        worktreePath: jobs.worktreePath,
        sessionCwd: jobs.sessionCwd,
        workspaceMode: jobs.workspaceMode,
        worktreeRemovedAt: jobs.worktreeRemovedAt,
        fullName: repositories.fullName,
      })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(eq(jobs.workItemId, workItemId))
      .orderBy(desc(jobs.id))
      .all()
      .map(workJobRecord)
  }

  listSummaries(archive: string) {
    const items = this.database
      .select({ item: workItems, primaryRepositoryName: repositories.fullName })
      .from(workItems)
      .leftJoin(repositories, eq(repositories.id, workItems.primaryRepositoryId))
      .where(archive === 'all' ? undefined : archive === 'archived' ? isNotNull(workItems.archivedAt) : isNull(workItems.archivedAt))
      .orderBy(desc(workItems.updatedAt), desc(workItems.id))
      .all()
      .map(({ item, primaryRepositoryName }) => ({
        ...workItemRecord(item),
        primary_repository_name: primaryRepositoryName,
      })) as any[]
    if (!items.length) return []
    const itemIds = new Set(items.map((item) => Number(item.id)))
    const resourcesByItem = this.resourcesByItem(itemIds)
    const jobsByItem = this.jobsByItem(itemIds)
    return items.map((item) => this.summary(item, resourcesByItem.get(Number(item.id)) || [], jobsByItem.get(Number(item.id)) || []))
  }

  private resourcesByItem(itemIds: Set<number>) {
    const grouped = new Map<number, any[]>()
    const rows = this.database
      .select({
        workItemId: workItemResources.workItemId,
        resource: workResources,
        role: workItemResources.role,
        isPrimary: workItemResources.isPrimary,
      })
      .from(workItemResources)
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .orderBy(workItemResources.workItemId, desc(workItemResources.isPrimary), workResources.kind, workResources.label)
      .all()
    for (const { workItemId, resource, role, isPrimary } of rows) {
      if (!itemIds.has(workItemId)) continue
      const values = grouped.get(workItemId) || []
      values.push({ ...workResourceRecord(resource), role, is_primary: isPrimary, metadata: parsedJson(resource.metadata, {}) })
      grouped.set(workItemId, values)
    }
    return grouped
  }

  private jobsByItem(itemIds: Set<number>) {
    const grouped = new Map<number, any[]>()
    const rows = this.database
      .select({
        id: jobs.id,
        workItemId: jobs.workItemId,
        status: jobs.status,
        kind: jobs.kind,
        threadId: jobs.threadId,
        agentId: jobs.agentId,
        taskTitle: jobs.taskTitle,
        prNumber: jobs.prNumber,
        branchName: jobs.branchName,
        latestActivity: jobs.latestActivity,
        activityAt: jobs.activityAt,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
        inputQuestions: jobs.inputQuestions,
        linkedPrNumber: jobs.linkedPrNumber,
        headSha: jobs.headSha,
        diffAdditions: jobs.diffAdditions,
        diffDeletions: jobs.diffDeletions,
        worktreePath: jobs.worktreePath,
        sessionCwd: jobs.sessionCwd,
        workspaceMode: jobs.workspaceMode,
        worktreeRemovedAt: jobs.worktreeRemovedAt,
        fullName: repositories.fullName,
      })
      .from(jobs)
      .innerJoin(repositories, eq(repositories.id, jobs.repoId))
      .where(isNotNull(jobs.workItemId))
      .orderBy(jobs.workItemId, desc(jobs.id))
      .all()
    for (const stored of rows) {
      const row = workJobRecord(stored)
      const workItemId = Number(row.work_item_id)
      if (!itemIds.has(workItemId)) continue
      const values = grouped.get(workItemId) || []
      values.push({ ...row, latest_activity: activitySummary(row.latest_activity) || null })
      grouped.set(workItemId, values)
    }
    return grouped
  }

  private summary(item: any, resources: any[], jobsForItem: any[]) {
    const state = projectedWorkState(item, jobsForItem, resources)
    const pullRequest = resources.find((resource) => resource.kind === 'pull_request')
    const completedReview = jobsForItem.find((job) => job.kind === 'review' && job.status === 'completed')
    const needsRereview =
      item.kind === 'pr_review' &&
      completedReview?.head_sha &&
      pullRequest?.metadata?.headSha &&
      completedReview.head_sha !== pullRequest.metadata.headSha
    const attention = needsRereview
      ? 'New commits need re-review'
      : jobsForItem.some((job) => job.input_questions)
        ? 'Waiting for your input'
        : jobsForItem.some((job) => job.status === 'failed')
          ? 'A thread failed'
          : item.attention
    const repositoryNames = [
      ...new Set(
        [
          item.primary_repository_name,
          ...resources.filter((resource) => resource.kind === 'repository').map((resource) => resource.label),
          ...jobsForItem.map((job) => job.full_name),
        ].filter(Boolean),
      ),
    ]
    return {
      ...item,
      sequential_execution: Boolean(item.sequential_execution),
      state,
      attention,
      repository_names: repositoryNames,
      resources,
      threads: jobsForItem,
      events: [],
      relations: [],
      context_transfers: [],
    }
  }
}
