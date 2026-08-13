import type { WorkService } from './service.ts'
import type {
  MergedWorktreeCleanupResult,
  WorkBatchDeletionPreview,
  WorkBatchDeletionResult,
  WorkDeletionPreview,
  WorkDeletionResult,
} from '@vertexade/platform-contracts'
import type { WorkMemoryService } from './memory.ts'
import type { WorkReferenceProvider } from '@vertexade/platform-contracts'
import { sequentialWorkItemPrompt, workReferenceContext } from './prompts.ts'
import type { AgentResourceService } from '../agents/resources.ts'
import { workItemLaunchWorkspaceMode } from './workspace-layout.ts'
import { runApiEffect, timeoutApiPromise } from '@vertexade/platform-server/effect'
import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs as jobsTable, pullRequests as pullRequestsTable, repositories as repositoriesTable } from '../database/schema/tables.ts'
import { pullRequestRecord } from '../database/contract-records.ts'
import { workDeletionRoute } from './deletion-route.ts'
import { generalWorkspaceRepository } from './general-workspace.ts'

type RepositoryRow = {
  id: number
  full_name: string
  clone_url: string
  local_path: string
  created_at: string
  synced_at: string | null
  source_kind: 'git' | 'directory' | 'workspace'
  workspace_strategy: 'worktree' | 'direct' | 'copy' | 'move'
}

type Dependencies = {
  work: WorkService
  memory: WorkMemoryService
  db: DrizzleDashboardDatabase
  body(request: Request, maxBytes?: number): Promise<any>
  json(status: number, value: unknown): Response
  agentContext(): { agentId?: string; model?: string; reasoningEffort?: string }
  defaultAgentId: string
  previewWorkDeletion(workItemId: number): WorkDeletionPreview | null
  deleteWorkItem(workItemId: number): Promise<WorkDeletionResult>
  detachCleanupArtifact?(artifactId: number, workItemKey: string): unknown
  removeMergedWorktrees(): Promise<MergedWorktreeCleanupResult>
  launchReview(
    repository: any,
    pullRequest: any,
    agents: unknown[],
    aggregator: unknown,
    options: Record<string, unknown>,
  ): Promise<unknown>
  launchWorktreeReview(sourceJobId: number, options: Record<string, unknown>): Promise<unknown>
  launchRepositoryTask(
    repository: any,
    title: string,
    prompt: string,
    createPullRequest: boolean,
    branchType: string,
    base: null,
    options: Record<string, unknown>,
  ): Promise<unknown>
  contextTransferTargets(sourceJobId: number): Promise<unknown[]>
  followUpInWorktree(input: Record<string, unknown>, expectedSourceWorkItemId?: number | null): Promise<unknown>
  referenceProviders?(): Array<WorkReferenceProvider & { moduleId?: string }>
  agentResources: AgentResourceService
}

function updateAgentResources(workItemId: number, input: any, dependencies: Dependencies) {
  if (Object.hasOwn(input, 'resource_selection')) dependencies.agentResources.setSelection(workItemId, input.resource_selection)
}

function itemRow(work: WorkService, identifier: string) {
  return /^\d+$/.test(identifier) ? work.raw(Number(identifier)) : work.findByKey(identifier)
}

function item(work: WorkService, identifier: string) {
  const row = itemRow(work, identifier)
  return row ? work.get(row.id) : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const maximumBatchDeletionSize = 100

function batchDeletionRows(input: any, dependencies: Dependencies) {
  if (!Array.isArray(input.work_item_ids) || !input.work_item_ids.length) throw new Error('Choose at least one Work item to delete')
  if (input.work_item_ids.length > maximumBatchDeletionSize)
    throw new Error(`Choose no more than ${maximumBatchDeletionSize} Work items per deletion`)
  const ids = input.work_item_ids.map(Number)
  if (ids.some((id: number) => !Number.isInteger(id) || id < 1)) throw new Error('Work item IDs must be positive integers')
  if (new Set(ids).size !== ids.length) throw new Error('Choose each Work item only once')
  return ids.map((id: number) => {
    const row = dependencies.work.raw(id)
    if (!row) throw new Error(`Work item #${id} was not found`)
    return row
  })
}

function failedBatchDeletion(row: { key: string }, error: unknown): WorkDeletionResult {
  return {
    deleted: false,
    work_item_key: row.key,
    threads_deleted: 0,
    worktrees_removed: 0,
    local_branches_deleted: 0,
    logs_deleted: 0,
    logs_retained: 0,
    provider_threads_retained: 0,
    memory_deleted: false,
    shared_worktrees_retained: 0,
    shared_branches_retained: 0,
    preserved_pull_requests: [],
    errors: [{ target: row.key, error: errorMessage(error) }],
  }
}

function repositoryIds(input: any, fallback: number[] = []) {
  const values = Array.isArray(input.repository_ids) ? input.repository_ids : input.repository_id ? [input.repository_id] : fallback
  const ids = [...new Set<number>((values as unknown[]).map(Number).filter((value) => Number.isInteger(value) && value > 0))]
  if (ids.length > 8) throw new Error('Choose no more than 8 repositories per launch')
  return ids
}

function repositories(db: DrizzleDashboardDatabase, ids: number[]) {
  if (!ids.length) return []
  const byId = new Map(
    db
      .select({
        id: repositoriesTable.id,
        full_name: repositoriesTable.fullName,
        clone_url: repositoriesTable.cloneUrl,
        local_path: repositoriesTable.localPath,
        created_at: repositoriesTable.createdAt,
        synced_at: repositoriesTable.syncedAt,
        source_kind: repositoriesTable.sourceKind,
        workspace_strategy: repositoriesTable.workspaceStrategy,
      })
      .from(repositoriesTable)
      .where(inArray(repositoriesTable.id, ids))
      .all()
      .map((row) => [row.id, row]),
  )
  const values = ids.map((id) => byId.get(id)).filter((value): value is RepositoryRow => Boolean(value))
  if (values.length !== ids.length) throw new Error('One or more selected repositories were not found')
  return values
}

function repositoryCatalog(db: DrizzleDashboardDatabase) {
  return db
    .select({ id: repositoriesTable.id, full_name: repositoriesTable.fullName })
    .from(repositoriesTable)
    .where(sql`${repositoriesTable.sourceKind}<>'workspace'`)
    .orderBy(asc(sql`lower(${repositoriesTable.fullName})`))
    .all()
}

function pullRequestTarget(db: DrizzleDashboardDatabase, repositoryId: number, number: number) {
  const repository = db
    .select({
      id: repositoriesTable.id,
      full_name: repositoriesTable.fullName,
      clone_url: repositoriesTable.cloneUrl,
      local_path: repositoriesTable.localPath,
    })
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, repositoryId))
    .get()
  const pullRequest = db
    .select()
    .from(pullRequestsTable)
    .where(and(eq(pullRequestsTable.repoId, repositoryId), eq(pullRequestsTable.number, number)))
    .get()
  return {
    repository: repository ? repository : undefined,
    pullRequest: pullRequest ? pullRequestRecord(pullRequest) : undefined,
  }
}

function optionalText(value: unknown) {
  const text = String(value ?? '').trim()
  return text.length ? text : null
}

function requiredText(value: unknown) {
  return optionalText(value) ?? ''
}

function externalReferenceId(reference: any) {
  return requiredText(reference.externalId ?? reference.external_id)
}

function metadataObject(value: unknown) {
  if (!value) return {}
  if (typeof value !== 'object') return {}
  if (Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function metadataContent(reference: any) {
  const source = metadataObject(reference.metadata)
  if (Object.keys(source).length) return source
  return reference.summary ? { summary: String(reference.summary).slice(0, 4_000) } : {}
}

function compactMetadata(metadata: Record<string, unknown>) {
  const serialized = JSON.stringify(metadata)
  return serialized.length > 20_000 ? { context: serialized.slice(0, 18_000), truncated: true } : metadata
}

function referenceMetadata(reference: any) {
  return compactMetadata(metadataContent(reference))
}

function requestedReference(reference: any) {
  return {
    provider: requiredText(reference.provider),
    kind: requiredText(reference.kind),
    externalId: externalReferenceId(reference),
    role: 'context',
    label: requiredText(reference.label),
    url: optionalText(reference.url),
    state: optionalText(reference.state),
    metadata: referenceMetadata(reference),
  }
}

function requestedReferences(input: any) {
  if (!Array.isArray(input.references)) return []
  if (input.references.length > 24) throw new Error('Choose no more than 24 references per Work item')
  return input.references.map(requestedReference)
}

function referenceIdentity(reference: { provider: string; kind: string; externalId?: string; external_id?: string }) {
  return `${reference.provider}:${reference.kind}:${reference.externalId || reference.external_id || ''}`
}

function synchronizeContextReferences(work: WorkService, workItem: any, input: any) {
  const references = requestedReferences(input)
  if (input.replace_context_references === true) {
    const requested = new Set(references.map(referenceIdentity))
    for (const resource of workItem.resources.filter((resource: any) => resource.role === 'context')) {
      if (!requested.has(referenceIdentity(resource))) work.unlinkResource(workItem.id, resource.id, 'context')
    }
  }
  for (const reference of references) work.linkResource(workItem.id, reference)
  return work.get(workItem.id) || workItem
}

function batchLaunchStatus(jobCount: number, errorCount: number) {
  if (!errorCount) return 'started'
  return jobCount ? 'partial' : 'failed'
}

function requestedSourceJobIds(input: any) {
  if (!Array.isArray(input.source_job_ids)) return null
  const ids = [...new Set<number>(input.source_job_ids.map(Number).filter((value: number) => Number.isInteger(value) && value > 0))]
  if (ids.length > 8) throw new Error('Choose no more than 8 worktrees per review')
  return ids
}

function reviewableWorktrees(db: DrizzleDashboardDatabase, workItemId: number, requestedIds: number[] | null) {
  const rows = db
    .select({
      id: jobsTable.id,
      repo_id: jobsTable.repoId,
      branch_name: jobsTable.branchName,
      status: jobsTable.status,
      full_name: repositoriesTable.fullName,
    })
    .from(jobsTable)
    .innerJoin(repositoriesTable, eq(repositoriesTable.id, jobsTable.repoId))
    .where(
      and(
        eq(jobsTable.workItemId, workItemId),
        isNotNull(jobsTable.worktreePath),
        sql`${jobsTable.worktreeRemovedAt} IS NULL`,
        notInArray(jobsTable.status, ['starting', 'running']),
        notInArray(jobsTable.kind, ['review', 'work_review', 'stack_analysis', 'planning']),
      ),
    )
    .orderBy(desc(jobsTable.id))
    .all()
  if (requestedIds === null) return rows.slice(0, 8)
  if (!requestedIds.length) throw new Error('Choose at least one Work item worktree to review')
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const selected = requestedIds.map((id) => byId.get(id)).filter(Boolean)
  if (selected.length !== requestedIds.length) throw new Error('One or more selected worktrees are not reviewable Work item worktrees')
  return selected
}

async function handleCollection(request: Request, url: URL, dependencies: Dependencies) {
  const { work, db, body, json } = dependencies
  if (request.method === 'GET') {
    return json(200, {
      items: work.listSummaries({ archive: url.searchParams.get('archive') || 'open' }),
      repositories: repositoryCatalog(db),
    })
  }
  try {
    const input = await body(request)
    const selectedRepositories = repositories(db, repositoryIds(input))
    const item = work.create({
      title: input.title,
      description: input.description,
      kind: input.kind,
      state: input.state,
      priority: input.priority,
      owner: input.owner,
      repositoryId: selectedRepositories[0]?.id || null,
      sequentialExecution: input.split_work_item === true,
    })
    updateAgentResources(item.id, input, dependencies)
    for (const [index, repository] of selectedRepositories.entries()) work.linkRepository(item.id, repository, index === 0)
    for (const reference of requestedReferences(input)) work.linkResource(item.id, reference)
    return json(201, work.get(item.id))
  } catch (error) {
    return json(400, { error: errorMessage(error) })
  }
}

async function handleItem(request: Request, identifier: string, dependencies: Dependencies) {
  const { work, body, json } = dependencies
  const row = itemRow(work, identifier)
  if (!row) return json(404, { error: 'Work item not found' })
  if (request.method === 'GET') return json(200, work.get(row.id))
  try {
    return json(200, work.update(row.id, await body(request)))
  } catch (error) {
    return json(400, { error: errorMessage(error) })
  }
}

async function confirmedDeletion(request: Request, row: any, dependencies: Dependencies) {
  try {
    const input = await dependencies.body(request)
    if (input.confirmed !== true) {
      return dependencies.json(400, { error: 'Confirm permanent Work deletion before continuing' })
    }
    return dependencies.json(200, await dependencies.deleteWorkItem(row.id))
  } catch (error) {
    return dependencies.json(409, { error: errorMessage(error) })
  }
}

async function batchDeletionPreview(request: Request, dependencies: Dependencies) {
  try {
    const rows = batchDeletionRows(await dependencies.body(request), dependencies)
    const items = rows.map((row) => dependencies.previewWorkDeletion(row.id))
    if (items.some((item) => !item)) throw new Error('One or more Work items could not be previewed')
    return dependencies.json(200, { items } satisfies WorkBatchDeletionPreview)
  } catch (error) {
    return dependencies.json(400, { error: errorMessage(error) })
  }
}

async function confirmedBatchDeletion(request: Request, dependencies: Dependencies) {
  try {
    const input = await dependencies.body(request)
    if (input.confirmed !== true) {
      return dependencies.json(400, { error: 'Confirm permanent batch deletion before continuing' })
    }
    const rows = batchDeletionRows(input, dependencies)
    const results: WorkDeletionResult[] = []
    for (const row of rows) {
      try {
        results.push(await dependencies.deleteWorkItem(row.id))
      } catch (error) {
        const result = failedBatchDeletion(row, error)
        dependencies.work.deletionFailed(row.id, result.errors)
        results.push(result)
      }
    }
    const deleted = results.filter((result) => result.deleted).length
    return dependencies.json(200, {
      requested: rows.length,
      deleted,
      failed: rows.length - deleted,
      results,
    } satisfies WorkBatchDeletionResult)
  } catch (error) {
    return dependencies.json(409, { error: errorMessage(error) })
  }
}

async function detachCleanupArtifact(request: Request, artifactId: number, dependencies: Dependencies) {
  const input = await dependencies.body(request)
  const workItemKey = String(input.work_item_key || '').trim()
  if (!workItemKey) return dependencies.json(400, { error: 'Confirm the Work key before detaching cleanup ownership' })
  const detached = dependencies.detachCleanupArtifact?.(artifactId, workItemKey)
  return detached
    ? dependencies.json(200, { detached: true, artifact: detached })
    : dependencies.json(404, { error: 'Blocked cleanup artifact not found or Work key did not match' })
}

async function handleDeletionApi(request: Request, url: URL, dependencies: Dependencies) {
  const detachMatch = request.method === 'DELETE' ? url.pathname.match(/^\/api\/work-cleanup\/artifacts\/(\d+)$/) : null
  if (detachMatch) return detachCleanupArtifact(request, Number(detachMatch[1]), dependencies)
  if (request.method === 'POST' && url.pathname === '/api/work-items/delete-preview') {
    return batchDeletionPreview(request, dependencies)
  }
  if (request.method === 'DELETE' && url.pathname === '/api/work-items') {
    return confirmedBatchDeletion(request, dependencies)
  }
  const route = workDeletionRoute(request, url.pathname)
  if (!route) return null
  const row = itemRow(dependencies.work, routeParameter(route.match, 1))
  if (!row) return dependencies.json(404, { error: 'Work item not found' })
  if (route.preview) return dependencies.json(200, dependencies.previewWorkDeletion(row.id))
  return confirmedDeletion(request, row, dependencies)
}

async function handleThread(request: Request, identifier: string, dependencies: Dependencies) {
  const { work, db, body, json } = dependencies
  const workItem = item(work, identifier)
  if (!workItem) return json(404, { error: 'Work item not found' })
  const input = await body(request)
  updateAgentResources(workItem.id, input, dependencies)
  if (workItem.kind === 'pr_review') return launchReviewThread(workItem, input, dependencies)
  try {
    if (Object.hasOwn(input, 'workspace_mode'))
      throw new Error('workspace_mode has been removed; Work threads always use the Work item folder')
    const currentWorkItem = synchronizeContextReferences(work, workItem, input)
    const scopedIds = currentWorkItem.resources
      .filter((resource: any) => resource.kind === 'repository')
      .map((resource: any) => resource.repository_id)
    const ids = repositoryIds(input, scopedIds.length ? scopedIds : [currentWorkItem.primary_repository_id].filter(Boolean))
    const selectedRepositories = ids.length ? repositories(db, ids) : [generalWorkspaceRepository(db)]
    const requestedPrompt = String(input.prompt || currentWorkItem.description || '').trim()
    if (!requestedPrompt) return json(400, { error: 'A task prompt is required to start a thread' })
    const sequential = input.split_work_item === undefined ? Boolean(currentWorkItem.sequential_execution) : input.split_work_item === true
    const contextualPrompt = `${requestedPrompt}${workReferenceContext(currentWorkItem.resources)}`
    const prompt = sequential ? sequentialWorkItemPrompt(contextualPrompt) : contextualPrompt
    const agent = dependencies.agentContext()
    const workspaceMode = workItemLaunchWorkspaceMode(undefined)
    for (const repository of selectedRepositories) work.linkRepository(workItem.id, repository)
    if (sequential) work.recordSequentialLaunch(workItem.id, selectedRepositories.length)
    const primaryRepository = selectedRepositories[0]
    let threads: any[] = []
    let errors: Array<{ repository: string; error: string }> = []
    try {
      const thread = await dependencies.launchRepositoryTask(
        primaryRepository,
        workItem.title,
        prompt,
        input.create_pr !== false,
        String(input.branch_type || 'feature'),
        null,
        {
          workItemId: workItem.id,
          workKind: workItem.kind,
          agentId: input.agent_id || agent.agentId || null,
          model: input.model || agent.model || null,
          reasoningEffort: input.reasoning_effort || agent.reasoningEffort || null,
          approvalGated: sequential,
          workspaceMode,
          workItemKey: currentWorkItem.key,
          repositories: selectedRepositories,
          displayPrompt: requestedPrompt,
          contextReferences: currentWorkItem.resources
            .filter((resource: any) => resource.kind !== 'repository')
            .map((resource: any) => ({ provider: resource.provider, kind: resource.kind, label: resource.label })),
        },
      )
      threads = [{ ...(thread as any), full_name: primaryRepository.full_name }]
    } catch (error) {
      errors = [{ repository: selectedRepositories.map((repository) => repository.full_name).join(', '), error: errorMessage(error) }]
    }
    work.launchBatchFinished(workItem.id, threads.length, errors)
    return json(202, {
      status: batchLaunchStatus(threads.length, errors.length),
      threads,
      errors,
      execution_mode: sequential ? 'sequential' : 'direct',
      workspace_mode: workspaceMode,
    })
  } catch (error) {
    return json(400, { error: errorMessage(error) })
  }
}

async function handleReferenceCatalog(url: URL, dependencies: Dependencies) {
  const providers = dependencies.referenceProviders?.() || []
  const query = String(url.searchParams.get('query') || '')
    .trim()
    .slice(0, 200)
  const forceRefresh = url.searchParams.get('force_refresh') === '1'
  const outcomes = await Promise.all(
    providers.map(async (provider) => {
      try {
        const values = await runApiEffect(
          timeoutApiPromise(
            (signal) =>
              provider.references(query, {
                moduleId: provider.moduleId || provider.id,
                signal,
                forceRefresh,
              }),
            15_000,
            {
              kind: 'upstream',
              message: `${provider.name} reference lookup failed`,
              status: 502,
              code: 'REFERENCE_PROVIDER_FAILED',
              causeMessage: 'replace',
            },
            {
              kind: 'upstream',
              message: `${provider.name} reference lookup timed out`,
              status: 504,
              code: 'REFERENCE_PROVIDER_TIMEOUT',
            },
          ),
        )
        const references = values.slice(0, 100).map((reference) => ({
          ...reference,
          provider: provider.id,
          providerName: provider.name,
        }))
        return { provider, references, available: true as const }
      } catch (error) {
        return { provider, references: [], available: false as const, error: errorMessage(error) }
      }
    }),
  )
  return dependencies.json(200, {
    references: outcomes.flatMap((outcome) => outcome.references),
    providers: outcomes.map((outcome) => ({
      id: outcome.provider.id,
      name: outcome.provider.name,
      available: outcome.available,
      ...(!outcome.available ? { error: outcome.error } : {}),
    })),
  })
}

async function launchReviewThread(workItem: any, input: any, dependencies: Dependencies) {
  const { db, json } = dependencies
  const resource = workItem.resources.find((entry: any) => entry.kind === 'pull_request' && entry.role === 'review_subject')
  const number = Number(resource?.metadata?.number)
  const repositoryId = Number(resource?.repository_id || workItem.primary_repository_id)
  const { repository, pullRequest } = pullRequestTarget(db, repositoryId, number)
  if (!repository || !pullRequest) return json(409, { error: 'The linked pull request is not currently available' })
  const context = dependencies.agentContext()
  const agents = Array.isArray(input.agent_ids) ? input.agent_ids : [input.agent_id || context.agentId || dependencies.defaultAgentId]
  return json(
    202,
    await dependencies.launchReview(repository, pullRequest, agents, input.aggregator_agent_id, {
      workItemId: workItem.id,
    }),
  )
}

async function handleUpfrontReview(request: Request, identifier: string, dependencies: Dependencies) {
  const workItem = item(dependencies.work, identifier)
  if (!workItem) return dependencies.json(404, { error: 'Work item not found' })
  try {
    const input = await dependencies.body(request)
    updateAgentResources(workItem.id, input, dependencies)
    return dependencies.json(202, await launchUpfrontReviewBatch(workItem, input, dependencies))
  } catch (error) {
    return dependencies.json(400, { error: errorMessage(error) })
  }
}

async function launchUpfrontReviewBatch(workItem: any, input: any, dependencies: Dependencies) {
  if (workItem.kind === 'pr_review') throw new Error('Use the pull-request review action for contributor review Work items')
  const selectedWorktrees = reviewableWorktrees(dependencies.db, workItem.id, requestedSourceJobIds(input))
  if (!selectedWorktrees.length) throw new Error('This Work item has no stopped implementation worktrees to review')
  const context = dependencies.agentContext()
  const focus = String(input.focus || '')
    .trim()
    .slice(0, 10_000)
  const launches = await Promise.allSettled(
    selectedWorktrees.map((source) =>
      dependencies.launchWorktreeReview(source.id, {
        workItemId: workItem.id,
        focus,
        agentId: input.agent_id || context.agentId || dependencies.defaultAgentId,
        model: input.model || context.model || null,
        reasoningEffort: input.reasoning_effort || context.reasoningEffort || null,
        ephemeral: input.ephemeral,
      }),
    ),
  )
  const threads = launches.flatMap((result, index) =>
    result.status === 'fulfilled'
      ? [
          {
            ...(result.value as any),
            full_name: selectedWorktrees[index].full_name,
            source_job_id: selectedWorktrees[index].id,
          },
        ]
      : [],
  )
  const errors = launches.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            repository: `${selectedWorktrees[index].full_name} · thread #${selectedWorktrees[index].id}`,
            error: errorMessage(result.reason),
          },
        ]
      : [],
  )
  dependencies.work.upfrontReviewBatchFinished(workItem.id, threads.length, errors)
  return { status: batchLaunchStatus(threads.length, errors.length), threads, errors }
}

async function handleResource(request: Request, identifier: string, dependencies: Dependencies) {
  const { work, body, json } = dependencies
  const row = itemRow(work, identifier)
  if (!row) return json(404, { error: 'Work item not found' })
  try {
    const input = await body(request)
    if (request.method === 'DELETE') {
      const removed = work.unlinkResource(row.id, Number(input.resource_id), String(input.role || 'related'))
      return json(removed ? 200 : 404, removed ? work.get(row.id) : { error: 'Linked resource not found' })
    }
    work.linkResource(row.id, input)
    return json(201, work.get(row.id))
  } catch (error) {
    return json(400, { error: errorMessage(error) })
  }
}

async function handleRelation(request: Request, identifier: string, dependencies: Dependencies) {
  const { work, body, json } = dependencies
  const row = itemRow(work, identifier)
  if (!row) return json(404, { error: 'Work item not found' })
  try {
    const input = await body(request)
    work.relate(row.id, Number(input.to_work_item_id), String(input.relation || 'related'))
    return json(201, work.get(row.id))
  } catch (error) {
    return json(400, { error: errorMessage(error) })
  }
}

async function handleSubItem(request: Request, identifier: string, dependencies: Dependencies) {
  const row = itemRow(dependencies.work, identifier)
  if (!row) return dependencies.json(404, { error: 'Work item not found' })
  try {
    const input = await dependencies.body(request)
    const result = await dependencies.followUpInWorktree(
      {
        sourceJobId: Number(input.source_job_id),
        destinationJobId: Number(input.destination_job_id),
        title: input.title,
        instruction: input.instruction,
      },
      row.id,
    )
    return dependencies.json(202, result)
  } catch (error) {
    return dependencies.json(409, { error: errorMessage(error) })
  }
}

async function handleMemory(request: Request, identifier: string, dependencies: Dependencies) {
  const row = itemRow(dependencies.work, identifier)
  if (!row) return dependencies.json(404, { error: 'Work item not found' })
  try {
    if (request.method === 'GET') return dependencies.json(200, await dependencies.memory.read(row.id))
    const input = await dependencies.body(request, 1_300_000)
    return dependencies.json(200, await dependencies.memory.write(row.id, input.content, 'user'))
  } catch (error) {
    return dependencies.json(400, { error: errorMessage(error) })
  }
}

function handlePullRequestWork(repositoryId: number, number: number, dependencies: Dependencies) {
  const { repository, pullRequest } = pullRequestTarget(dependencies.db, repositoryId, number)
  if (!repository || !pullRequest) return dependencies.json(404, { error: 'Pull request not found' })
  return dependencies.json(201, dependencies.work.ensurePullRequestReview(repository, pullRequest))
}

function exactRoute(request: Request, url: URL, method: string, pathname: string) {
  return request.method === method && url.pathname === pathname
}

function pathRoute(request: Request, url: URL, methods: string[], pattern: RegExp) {
  return methods.includes(request.method) ? url.pathname.match(pattern) : null
}

function routeParameter(match: RegExpMatchArray, index: number) {
  const value = match[index]
  if (!value) throw new Error('Matched Work route is missing a required path parameter')
  return decodeURIComponent(value)
}

async function handleWorkRootRoutes(request: Request, url: URL, dependencies: Dependencies) {
  if (exactRoute(request, url, 'POST', '/api/worktrees/cleanup-merged')) {
    return dependencies.json(200, await dependencies.removeMergedWorktrees())
  }
  if (exactRoute(request, url, 'GET', '/api/work-references')) return handleReferenceCatalog(url, dependencies)
  if (exactRoute(request, url, 'GET', '/api/work-repositories')) {
    return dependencies.json(200, {
      repositories: repositoryCatalog(dependencies.db),
    })
  }
  if (exactRoute(request, url, 'GET', '/api/work-context-targets')) {
    try {
      const sourceJobId = Number(url.searchParams.get('source_job_id'))
      return dependencies.json(200, {
        targets: await dependencies.contextTransferTargets(sourceJobId),
      })
    } catch (error) {
      return dependencies.json(400, { error: errorMessage(error) })
    }
  }
  if (pathRoute(request, url, ['GET', 'POST'], /^\/api\/work-items$/)) {
    return handleCollection(request, url, dependencies)
  }
  return null
}

async function handleWorkActionRoutes(request: Request, url: URL, dependencies: Dependencies) {
  const direct = pathRoute(request, url, ['GET', 'PATCH'], /^\/api\/work-items\/([^/]+)$/)
  if (direct) {
    return handleItem(request, routeParameter(direct, 1), dependencies)
  }
  const archive = pathRoute(request, url, ['POST'], /^\/api\/work-items\/([^/]+)\/(archive|restore)$/)
  if (archive) {
    const row = itemRow(dependencies.work, routeParameter(archive, 1))
    return dependencies.json(
      row ? 200 : 404,
      row ? dependencies.work.archive(row.id, archive[2] === 'archive') : { error: 'Work item not found' },
    )
  }
  const thread = pathRoute(request, url, ['POST'], /^\/api\/work-items\/([^/]+)\/threads$/)
  if (thread) {
    return handleThread(request, routeParameter(thread, 1), dependencies)
  }
  return null
}

async function handleWorkReviewAndContextRoutes(request: Request, url: URL, dependencies: Dependencies) {
  const review = pathRoute(request, url, ['POST'], /^\/api\/work-items\/([^/]+)\/reviews$/)
  if (review) {
    return handleUpfrontReview(request, routeParameter(review, 1), dependencies)
  }
  const memory = pathRoute(request, url, ['GET', 'PATCH'], /^\/api\/work-items\/([^/]+)\/memory$/)
  if (memory) {
    return handleMemory(request, routeParameter(memory, 1), dependencies)
  }
  const subItem = pathRoute(request, url, ['POST'], /^\/api\/work-items\/([^/]+)\/sub-items$/)
  if (subItem) {
    return handleSubItem(request, routeParameter(subItem, 1), dependencies)
  }
  return null
}

async function handleWorkLinkRoutes(request: Request, url: URL, dependencies: Dependencies) {
  const resource = pathRoute(request, url, ['POST', 'DELETE'], /^\/api\/work-items\/([^/]+)\/resources$/)
  if (resource) {
    return handleResource(request, routeParameter(resource, 1), dependencies)
  }
  const relation = pathRoute(request, url, ['POST'], /^\/api\/work-items\/([^/]+)\/relations$/)
  if (relation) {
    return handleRelation(request, routeParameter(relation, 1), dependencies)
  }
  const pullRequest = pathRoute(request, url, ['POST'], /^\/api\/pulls\/(\d+)\/(\d+)\/work$/)
  if (pullRequest) {
    return handlePullRequestWork(Number(routeParameter(pullRequest, 1)), Number(routeParameter(pullRequest, 2)), dependencies)
  }
  return null
}

async function handleWorkItemRoutes(request: Request, url: URL, dependencies: Dependencies) {
  const rootResponse = await handleWorkRootRoutes(request, url, dependencies)
  if (rootResponse) return rootResponse
  return handleWorkActionRoutes(request, url, dependencies)
}

async function handleWorkSupportingRoutes(request: Request, url: URL, dependencies: Dependencies) {
  const contextResponse = await handleWorkReviewAndContextRoutes(request, url, dependencies)
  if (contextResponse) return contextResponse
  return handleWorkLinkRoutes(request, url, dependencies)
}

async function handleKnownWorkRoute(request: Request, url: URL, dependencies: Dependencies) {
  const itemResponse = await handleWorkItemRoutes(request, url, dependencies)
  if (itemResponse) return itemResponse
  return handleWorkSupportingRoutes(request, url, dependencies)
}

export async function handleWorkApi(request: Request, url: URL, dependencies: Dependencies) {
  const deletionResponse = await handleDeletionApi(request, url, dependencies)
  if (deletionResponse) return deletionResponse
  return handleKnownWorkRoute(request, url, dependencies)
}
