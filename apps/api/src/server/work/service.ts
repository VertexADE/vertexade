import { projectedWorkState, workStates } from './work-state.ts'
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { WorkReadRepository } from './read-repository.ts'
import { WorkContextTransferService } from './context-transfer-service.ts'
import { WorkJobBackfillService } from './job-backfill-service.ts'
import {
  checkChoice,
  defaultProviders,
  deploymentState,
  normalizedResource,
  parsedJson,
  pullRequestState,
  resourceChanged,
  text,
  workKey,
  workKinds,
  workPriorities,
  type CreateContextTransferInput,
  type CreateWorkItemInput,
  type WorkKind,
  type WorkNotifier,
  type WorkProviderResolution,
  type WorkResourceInput,
} from './work-model.ts'
import {
  jobs,
  repositories,
  workEvents,
  workItemRelations,
  workItemResources,
  workItems,
  workResources,
} from '../database/schema/tables.ts'
import { workEventRecord, workItemRecord, workRelationRecord, workResourceRecord } from './records.ts'

export { projectedWorkState } from './work-state.ts'
export type { CreateContextTransferInput, CreateWorkItemInput, WorkKind, WorkProviderResolution, WorkResourceInput } from './work-model.ts'

const mergedWorkTransitions = {
  deploy: {
    event: 'Advanced to delivery after every pull request merged',
    notification: 'work_item_ready_for_delivery',
  },
  done: {
    event: 'Completed automatically after every delivery pull request merged',
    notification: 'work_item_completed_after_merge',
  },
} as const

function mergedWorkTransition(state: string) {
  return mergedWorkTransitions[state as keyof typeof mergedWorkTransitions] || null
}

export class WorkService {
  private readonly reads: WorkReadRepository
  private readonly transfers: WorkContextTransferService
  private readonly backfill: WorkJobBackfillService

  constructor(
    private readonly db: DrizzleDashboardDatabase,
    private readonly notify: WorkNotifier = () => undefined,
    private readonly providers: WorkProviderResolution = defaultProviders,
  ) {
    this.reads = new WorkReadRepository(db)
    this.transfers = new WorkContextTransferService(
      db,
      (workItemId) => Boolean(this.raw(workItemId)),
      (...args) => this.event(...args),
      notify,
    )
    this.backfill = new WorkJobBackfillService(
      db,
      providers,
      (input) => this.create(input as CreateWorkItemInput),
      (repository, pullRequest) => this.ensurePullRequestReview(repository, pullRequest),
      (workItemId, repository, pullRequest) => this.ensurePullRequestDelivery(workItemId, repository, pullRequest),
    )
  }

  initialize() {
    this.backfillJobs()
  }

  create(input: CreateWorkItemInput) {
    const title = text(input.title, 200)
    if (!title) throw new Error('Work item title is required')
    const kind = checkChoice(input.kind, workKinds, 'implementation')
    const state = checkChoice(input.state, workStates, 'backlog')
    const priority = checkChoice(input.priority, workPriorities, 'normal')
    const result = this.db
      .insert(workItems)
      .values({
        title,
        description: text(input.description, 20_000),
        sequentialExecution: input.sequentialExecution ? 1 : 0,
        kind,
        state,
        priority,
        owner: text(input.owner, 200) || null,
        primaryRepositoryId: input.repositoryId || null,
      })
      .run()
    const id = Number(result.lastInsertRowid)
    this.db
      .update(workItems)
      .set({ key: workKey(id) })
      .where(eq(workItems.id, id))
      .run()
    this.event(id, 'created', `Created ${kind.replace('_', ' ')} work item`)
    if (input.source) this.linkResource(id, input.source)
    this.notify('work_item_created', id)
    return this.get(id)
  }

  update(id: number, input: Record<string, unknown>) {
    const current = this.raw(id)
    if (!current) return null
    const title = input.title === undefined ? current.title : text(input.title, 200)
    if (!title) throw new Error('Work item title is required')
    const description = input.description === undefined ? current.description : text(input.description, 20_000)
    const priority = input.priority === undefined ? current.priority : checkChoice(input.priority, workPriorities, current.priority)
    const owner = input.owner === undefined ? current.owner : text(input.owner, 200) || null
    let stateOverride = current.state_override
    let overrideReason = current.state_override_reason
    if (input.state !== undefined) {
      stateOverride = checkChoice(input.state, workStates, current.state)
      overrideReason = text(input.reason, 1000) || 'Manually moved'
    }
    if (input.clear_state_override === true) {
      stateOverride = null
      overrideReason = null
    }
    this.db
      .update(workItems)
      .set({
        title,
        description,
        priority,
        owner,
        attention: input.resolve_attention === true ? null : current.attention,
        stateOverride,
        stateOverrideReason: overrideReason,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(workItems.id, id))
      .run()
    this.event(id, 'updated', stateOverride ? `Moved to ${stateOverride}` : 'Updated work item', 'user', input)
    this.notify('work_item_updated', id)
    return this.get(id)
  }

  archive(id: number, archived: boolean) {
    const result = this.db
      .update(workItems)
      .set({ archivedAt: archived ? sql`CURRENT_TIMESTAMP` : null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, id))
      .run()
    if (!Number(result.changes)) return null
    this.event(id, archived ? 'archived' : 'restored', archived ? 'Archived work item' : 'Restored work item', 'user')
    this.notify(archived ? 'work_item_archived' : 'work_item_restored', id)
    return this.get(id)
  }

  deletionFailed(id: number, errors: { target: string; error: string }[]) {
    const attention =
      errors
        .map((entry) => `${entry.target}: ${entry.error}`)
        .join('\n')
        .slice(0, 2000) || 'Work cleanup is incomplete'
    this.db
      .update(workItems)
      .set({ attention, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, id))
      .run()
    this.event(id, 'delete_failed', 'Permanent deletion needs attention', 'system', { errors })
    this.notify('work_item_delete_failed', id)
  }

  permanentlyDelete(id: number) {
    const item = this.raw(id)
    if (!item) return false
    const linkedJobs = Number(this.db.select({ count: count() }).from(jobs).where(eq(jobs.workItemId, id)).get()?.count || 0)
    if (linkedJobs) throw new Error('Remove every linked thread before deleting the Work item')
    const result = this.db.delete(workItems).where(eq(workItems.id, id)).run()
    if (Number(result.changes)) this.notify('work_item_deleted', id)
    return Number(result.changes) > 0
  }

  raw(id: number) {
    const row = this.db.select().from(workItems).where(eq(workItems.id, id)).get()
    return row ? workItemRecord(row) : null
  }

  findByKey(key: string) {
    const row = this.db
      .select()
      .from(workItems)
      .where(sql`${workItems.key} = ${key} COLLATE NOCASE`)
      .get()
    return row ? workItemRecord(row) : null
  }

  linkResource(workItemId: number, input: WorkResourceInput) {
    const value = normalizedResource(input)
    const identity = and(
      eq(workResources.provider, value.provider),
      eq(workResources.kind, value.kind),
      eq(workResources.externalId, value.externalId),
    )
    const storedCurrent = this.db.select().from(workResources).where(identity).get()
    const current = storedCurrent ? workResourceRecord(storedCurrent) : undefined
    this.db
      .insert(workResources)
      .values({
        provider: value.provider,
        kind: value.kind,
        externalId: value.externalId,
        repositoryId: value.repositoryId,
        label: value.label,
        url: value.url,
        state: value.state,
        metadata: value.metadata,
      })
      .onConflictDoUpdate({
        target: [workResources.provider, workResources.kind, workResources.externalId],
        set: {
          repositoryId: sql`coalesce(excluded.repository_id, ${workResources.repositoryId})`,
          label: value.label,
          url: sql`coalesce(excluded.url, ${workResources.url})`,
          state: sql`coalesce(excluded.state, ${workResources.state})`,
          metadata: value.metadata,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run()
    const storedResource = this.db.select().from(workResources).where(identity).get()!
    const resource = workResourceRecord(storedResource)
    const linked = this.db
      .select({ is_primary: workItemResources.isPrimary })
      .from(workItemResources)
      .where(
        and(
          eq(workItemResources.workItemId, workItemId),
          eq(workItemResources.resourceId, resource.id),
          eq(workItemResources.role, value.role),
        ),
      )
      .get()
    this.db
      .insert(workItemResources)
      .values({ workItemId, resourceId: resource.id, role: value.role, isPrimary: value.primary ? 1 : 0 })
      .onConflictDoUpdate({
        target: [workItemResources.workItemId, workItemResources.resourceId, workItemResources.role],
        set: { isPrimary: sql`max(${workItemResources.isPrimary}, excluded.is_primary)` },
      })
      .run()
    if (!linked || resourceChanged(current, value) || (value.primary && !linked.is_primary)) {
      this.touch(workItemId)
      this.event(workItemId, linked ? 'resource_updated' : 'resource_linked', `${linked ? 'Updated' : 'Linked'} ${value.label}`, 'system', {
        provider: value.provider,
        kind: value.kind,
        externalId: value.externalId,
        role: value.role,
      })
      this.notify(linked ? 'work_resource_updated' : 'work_resource_linked', workItemId)
    }
    return resource
  }

  unlinkResource(workItemId: number, resourceId: number, role: string) {
    const result = this.db
      .delete(workItemResources)
      .where(
        and(eq(workItemResources.workItemId, workItemId), eq(workItemResources.resourceId, resourceId), eq(workItemResources.role, role)),
      )
      .run()
    if (Number(result.changes)) {
      this.event(workItemId, 'resource_unlinked', 'Removed a linked resource', 'user', {
        resourceId,
        role,
      })
      this.notify('work_resource_unlinked', workItemId)
    }
    return Number(result.changes) > 0
  }

  relate(fromId: number, toId: number, relation: string) {
    const allowed = ['parent', 'child', 'blocks', 'blocked_by', 'related', 'duplicate']
    if (!allowed.includes(relation)) throw new Error('Choose a valid work relationship')
    if (!this.raw(fromId) || !this.raw(toId)) throw new Error('Both work items must exist')
    this.db.insert(workItemRelations).values({ fromWorkItemId: fromId, toWorkItemId: toId, relation }).onConflictDoNothing().run()
    this.event(fromId, 'relation_linked', `Linked ${relation.replace('_', ' ')} work`, 'user', {
      toId,
    })
    this.notify('work_relation_linked', fromId)
  }

  event(workItemId: number, eventType: string, summary: string, actor = 'system', payload: unknown = {}) {
    this.db
      .insert(workEvents)
      .values({
        workItemId,
        eventType: text(eventType, 80),
        summary: text(summary, 1000),
        actor: text(actor, 100),
        payload: (payload ?? {}) as Record<string, unknown>,
      })
      .run()
  }

  touch(workItemId: number) {
    this.db
      .update(workItems)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, workItemId))
      .run()
  }

  createContextTransfer(input: CreateContextTransferInput) {
    return this.transfers.create(input)
  }

  startContextTransfer(id: number) {
    return this.transfers.start(id)
  }

  failContextTransfer(id: number, error: unknown) {
    return this.transfers.fail(id, error)
  }

  finishContextTransfers(destinationJobId: number, successful: boolean, output: unknown, error?: unknown) {
    return this.transfers.finishForJob(destinationJobId, successful, output, error)
  }

  contextTransfer(id: number) {
    return this.transfers.get(id)
  }

  private contextTransfers(workItemId: number) {
    return this.transfers.list(workItemId)
  }

  attachJob(workItemId: number, jobId: number, summary = 'Started agent thread') {
    this.db.update(jobs).set({ workItemId }).where(eq(jobs.id, jobId)).run()
    this.db
      .update(workItems)
      .set({ state: 'active', attention: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, workItemId))
      .run()
    this.event(workItemId, 'thread_started', summary, 'system', { jobId })
    this.notify('work_thread_linked', workItemId)
    return this.get(workItemId)
  }

  attachUpfrontReviewJob(workItemId: number, jobId: number, repository: string) {
    this.db.update(jobs).set({ workItemId }).where(eq(jobs.id, jobId)).run()
    this.db
      .update(workItems)
      .set({ attention: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, workItemId))
      .run()
    this.event(workItemId, 'upfront_review_started', `Started upfront review for ${repository}`, 'system', {
      jobId,
      repository,
    })
    this.notify('work_upfront_review_started', workItemId)
    return this.get(workItemId)
  }

  launchFailed(workItemId: number, error: unknown) {
    const message = text(error instanceof Error ? error.message : error, 2000, 'Thread launch failed')
    this.db
      .update(workItems)
      .set({ attention: message, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workItems.id, workItemId))
      .run()
    this.event(workItemId, 'thread_launch_failed', message)
    this.notify('work_item_attention', workItemId)
  }

  private batchFinished(
    workItemId: number,
    started: number,
    errors: { repository: string; error: string }[],
    labels: {
      singular: string
      plural: string
      event: string
      notification: string
    },
  ) {
    const total = started + errors.length
    const summary = errors.length
      ? `Started ${started} of ${total} ${labels.plural}`
      : `Started ${started} ${started === 1 ? labels.singular : labels.plural}`
    const attention = errors.length
      ? errors
          .map((entry) => `${entry.repository}: ${entry.error}`)
          .join('\n')
          .slice(0, 2000)
      : null
    if (attention) {
      this.db
        .update(workItems)
        .set({ attention, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(workItems.id, workItemId))
        .run()
    }
    this.event(workItemId, errors.length ? `${labels.event}_partial` : `${labels.event}_started`, summary, 'system', {
      started,
      errors,
    })
    this.notify(errors.length ? 'work_item_attention' : labels.notification, workItemId)
  }

  launchBatchFinished(workItemId: number, started: number, errors: { repository: string; error: string }[]) {
    this.batchFinished(workItemId, started, errors, {
      singular: 'independent repository thread',
      plural: 'independent repository threads',
      event: 'thread_batch',
      notification: 'work_thread_batch_started',
    })
  }

  upfrontReviewBatchFinished(workItemId: number, started: number, errors: { repository: string; error: string }[]) {
    this.batchFinished(workItemId, started, errors, {
      singular: 'upfront repository review',
      plural: 'upfront repository reviews',
      event: 'upfront_review_batch',
      notification: 'work_upfront_review_batch_started',
    })
  }

  recordSequentialLaunch(workItemId: number, repositoryCount: number) {
    const count = Math.max(1, Math.floor(repositoryCount))
    this.event(
      workItemId,
      'sequential_execution_requested',
      `Requested an approval-gated sub-work-item plan in ${count} agent thread${count === 1 ? '' : 's'}`,
      'user',
      { repositoryCount: count, approvalRequired: true },
    )
    this.notify('work_sequential_execution_requested', workItemId)
  }

  linkRepository(workItemId: number, repository: { id: number; full_name: string }, primary = false) {
    const item = this.raw(workItemId)
    if (!item) throw new Error('Work item not found')
    const isPrimary = primary || !item.primary_repository_id
    if (!item.primary_repository_id) {
      this.db
        .update(workItems)
        .set({ primaryRepositoryId: repository.id, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(workItems.id, workItemId))
        .run()
    }
    const scm = this.providers.scm(repository)
    return this.linkResource(workItemId, {
      provider: scm.id,
      kind: 'repository',
      externalId: repository.full_name.toLowerCase(),
      role: 'scope',
      label: repository.full_name,
      url: scm.repositoryUrl,
      repositoryId: repository.id,
      state: 'selected',
      primary: isPrimary,
      metadata: { repository: repository.full_name },
    })
  }

  ensureRepositoryTask(
    repository: any,
    title: string,
    options: {
      workItemId?: number | null
      kind?: WorkKind
      source?: WorkResourceInput | null
    } = {},
  ) {
    let item
    if (options.workItemId) {
      const existing = this.raw(options.workItemId)
      if (!existing) throw new Error('Work item not found')
      if (options.source) this.linkResource(existing.id, options.source)
      item = existing
    } else {
      item = this.create({
        title,
        kind: options.kind || 'implementation',
        repositoryId: repository.id,
        source: options.source,
      })
    }
    this.linkRepository(item.id, repository)
    return this.get(item.id)
  }

  ensurePullRequestReview(repository: any, pullRequest: any) {
    const externalId = `${repository.full_name}#${pullRequest.number}`.toLowerCase()
    const provider = this.providers.scm(repository).id
    const storedExisting = this.db
      .select({ item: workItems })
      .from(workItems)
      .innerJoin(workItemResources, eq(workItemResources.workItemId, workItems.id))
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(
        and(
          eq(workItems.kind, 'pr_review'),
          sql`${workItems.archivedAt} IS NULL`,
          eq(workResources.provider, provider),
          eq(workResources.kind, 'pull_request'),
          eq(workResources.externalId, externalId),
          eq(workItemResources.role, 'review_subject'),
        ),
      )
      .orderBy(desc(workItems.id))
      .limit(1)
      .get()
    const existing = storedExisting ? workItemRecord(storedExisting.item) : undefined
    const state = pullRequestState(pullRequest)
    const source: WorkResourceInput = {
      provider,
      kind: 'pull_request',
      externalId,
      role: 'review_subject',
      label: `PR #${pullRequest.number} · ${pullRequest.title}`,
      url: pullRequest.url,
      repositoryId: repository.id,
      state,
      primary: true,
      metadata: {
        number: pullRequest.number,
        headSha: pullRequest.head_sha || pullRequest.head?.sha,
        mergeSha: pullRequest.merge_sha || pullRequest.mergeCommit?.oid,
        author: pullRequest.author || pullRequest.user?.login,
      },
    }
    if (existing) {
      this.linkResource(existing.id, source)
      return this.get(existing.id)
    }
    return this.create({
      title: `Review PR #${pullRequest.number}: ${pullRequest.title}`.slice(0, 200),
      kind: 'pr_review',
      repositoryId: repository.id,
      source,
    })
  }

  ensurePullRequestDelivery(workItemId: number, repository: any, pullRequest: any) {
    const provider = this.providers.scm(repository).id
    return this.linkResource(workItemId, {
      provider,
      kind: 'pull_request',
      externalId: `${repository.full_name}#${pullRequest.number}`.toLowerCase(),
      role: 'delivery',
      label: `PR #${pullRequest.number} · ${pullRequest.title}`,
      url: pullRequest.url,
      repositoryId: repository.id,
      state: pullRequestState(pullRequest),
      metadata: {
        number: pullRequest.number,
        headSha: pullRequest.head_sha || pullRequest.head?.sha,
        mergeSha: pullRequest.merge_sha || pullRequest.mergeCommit?.oid,
        author: pullRequest.author || pullRequest.user?.login,
      },
    })
  }

  private completeMergedWorkItem(workItemId: number) {
    const item = this.raw(workItemId)
    if (!item) return false
    const resources = this.resources(workItemId)
    const pullRequests = resources.filter((resource) => resource.kind === 'pull_request' && resource.role !== 'context')
    if (!pullRequests.length || pullRequests.some((resource) => resource.state !== 'merged')) return false
    const scopedRepositoryIds = new Set(
      resources.filter((resource) => resource.kind === 'repository' && resource.repository_id).map((resource) => resource.repository_id),
    )
    const mergedRepositoryIds = new Set(pullRequests.filter((resource) => resource.repository_id).map((resource) => resource.repository_id))
    if ([...scopedRepositoryIds].some((repositoryId) => !mergedRepositoryIds.has(repositoryId))) return false
    const state = projectedWorkState({ ...item, state_override: null }, this.jobs(workItemId), resources)
    const transition = mergedWorkTransition(state)
    if (!transition) return false
    if (item.state === state && item.state_override === null) return false
    this.db
      .update(workItems)
      .set({
        state,
        stateOverride: null,
        stateOverrideReason: null,
        attention: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(workItems.id, workItemId))
      .run()
    this.event(workItemId, 'pull_requests_merged', transition.event)
    this.notify(transition.notification, workItemId)
    return true
  }

  syncPullRequest(repository: any, pullRequest: any, requestedForCurrentUser = false) {
    const externalId = `${repository.full_name}#${pullRequest.number}`.toLowerCase()
    const provider = this.providers.scm(repository).id
    const state = pullRequestState(pullRequest)
    const linkedRows = this.db
      .select({ workItemId: workItemResources.workItemId, role: workItemResources.role })
      .from(workItemResources)
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(and(eq(workResources.provider, provider), eq(workResources.kind, 'pull_request'), eq(workResources.externalId, externalId)))
      .all()
    const linked = [...new Map(linkedRows.map((row) => [row.workItemId, row])).values()]
    for (const row of linked)
      this.linkResource(row.workItemId, {
        provider,
        kind: 'pull_request',
        externalId,
        role: row.role || 'related',
        label: `PR #${pullRequest.number} · ${pullRequest.title}`,
        url: pullRequest.url,
        repositoryId: repository.id,
        state,
        metadata: {
          number: pullRequest.number,
          headSha: pullRequest.head_sha,
          mergeSha: pullRequest.merge_sha || pullRequest.mergeCommit?.oid,
          author: pullRequest.author,
        },
      })
    for (const row of linked) {
      this.completeMergedWorkItem(row.workItemId)
      this.get(row.workItemId)
    }
    if (requestedForCurrentUser) this.ensurePullRequestReview(repository, pullRequest)
  }

  syncDeploymentOverview(repositoryName: string, services: any[]) {
    const repository = this.db
      .select({ id: repositories.id })
      .from(repositories)
      .where(sql`${repositories.fullName} = ${repositoryName} COLLATE NOCASE`)
      .get()
    if (!repository) return
    const scmProvider = this.providers.scm({ id: repository.id, full_name: repositoryName }).id
    const deploymentProvider = this.providers.deployment().id
    const pullRequests = this.db
      .select({ work_item_id: workItemResources.workItemId, metadata: workResources.metadata })
      .from(workItemResources)
      .innerJoin(workResources, eq(workResources.id, workItemResources.resourceId))
      .where(
        and(
          eq(workResources.provider, scmProvider),
          eq(workResources.kind, 'pull_request'),
          eq(workResources.repositoryId, repository.id),
          eq(workResources.state, 'merged'),
        ),
      )
      .all()
    for (const linked of pullRequests) {
      const metadata = parsedJson<Record<string, any>>(linked.metadata, {})
      const mergeSha = String(metadata.mergeSha || '')
      if (!mergeSha) continue
      for (const service of services) {
        const run = (service.runs || []).find((candidate: any) => candidate.sha === mergeSha)
        if (!run) continue
        const productionEnvironment = String(service.target?.production_environment || 'prd')
        const production = run.stages?.[productionEnvironment]
        const targetId = String(service.target?.id || 'default')
        this.linkResource(linked.work_item_id, {
          provider: deploymentProvider,
          kind: 'deployment',
          externalId: `${repositoryName}:${targetId}:${service.name}:${mergeSha}`.toLowerCase(),
          role: 'delivery',
          label: `${service.name} deployment`,
          url: production?.url || run.url,
          repositoryId: repository.id,
          state: deploymentState(run, productionEnvironment),
          metadata: {
            service: service.name,
            deploymentTargetId: targetId,
            sha: mergeSha,
            runId: run.run_id,
            productionEnvironment,
            environments: run.stages,
          },
        })
      }
    }
  }

  linkRepositoryTaskPullRequest(jobId: number, repository: any, pullRequest: any) {
    const job = this.db.select({ workItemId: jobs.workItemId }).from(jobs).where(eq(jobs.id, jobId)).get()
    if (job?.workItemId) this.ensurePullRequestDelivery(job.workItemId, repository, pullRequest)
  }

  private resources(workItemId: number) {
    return this.reads.resources(workItemId)
  }

  private jobs(workItemId: number) {
    return this.reads.jobs(workItemId)
  }

  get(id: number) {
    const item = this.raw(id)
    if (!item) return null
    const repository = item.primary_repository_id
      ? this.db.select({ full_name: repositories.fullName }).from(repositories).where(eq(repositories.id, item.primary_repository_id)).get()
      : null
    const resources = this.resources(id)
    const jobs = this.jobs(id)
    const state = projectedWorkState(item, jobs, resources)
    if (state !== item.state && !item.state_override) {
      this.db
        .update(workItems)
        .set({ state, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(workItems.id, id))
        .run()
    }
    const pullRequest = resources.find((resource) => resource.kind === 'pull_request')
    const completedReview = jobs.find((job) => job.kind === 'review' && job.status === 'completed')
    const needsRereview =
      item.kind === 'pr_review' &&
      completedReview?.head_sha &&
      pullRequest?.metadata?.headSha &&
      completedReview.head_sha !== pullRequest.metadata.headSha
    const attention = needsRereview
      ? 'New commits need re-review'
      : jobs.some((job) => job.input_questions)
        ? 'Waiting for your input'
        : jobs.some((job) => job.status === 'failed')
          ? 'A thread failed'
          : item.attention
    const events = this.db
      .select()
      .from(workEvents)
      .where(eq(workEvents.workItemId, id))
      .orderBy(desc(workEvents.createdAt), desc(workEvents.id))
      .limit(200)
      .all()
      .map((event) => ({ ...workEventRecord(event), payload: parsedJson(event.payload, {}) }))
    const relations = this.db
      .select({
        relation: workItemRelations,
        key: workItems.key,
        title: workItems.title,
        state: workItems.state,
      })
      .from(workItemRelations)
      .innerJoin(workItems, eq(workItems.id, workItemRelations.toWorkItemId))
      .where(eq(workItemRelations.fromWorkItemId, id))
      .orderBy(desc(workItems.updatedAt))
      .all()
      .map(({ relation, ...target }) => ({ ...workRelationRecord(relation), ...target }))
    const repositoryNames = [
      ...new Set(
        [
          repository?.full_name,
          ...resources.filter((resource) => resource.kind === 'repository').map((resource) => resource.label),
          ...jobs.map((job) => job.full_name),
        ].filter(Boolean),
      ),
    ]
    const contextTransfers = this.contextTransfers(id)
    return {
      ...item,
      sequential_execution: Boolean(item.sequential_execution),
      primary_repository_name: repository?.full_name || null,
      repository_names: repositoryNames,
      state,
      attention,
      resources,
      threads: jobs,
      events,
      relations,
      context_transfers: contextTransfers,
    }
  }

  list({ archive = 'open' }: { archive?: string } = {}) {
    return this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(archive === 'all' ? undefined : archive === 'archived' ? isNotNull(workItems.archivedAt) : isNull(workItems.archivedAt))
      .orderBy(desc(workItems.updatedAt), desc(workItems.id))
      .all()
      .map((row) => this.get(row.id))
  }

  listSummaries({ archive = 'open' }: { archive?: string } = {}) {
    return this.reads.listSummaries(archive)
  }

  backfillJobs() {
    this.backfill.run()
  }
}
