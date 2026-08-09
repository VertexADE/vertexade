import type { CapabilitySchema, CapabilityValue, TriggerEvent } from '@vertexade/platform-contracts'
import { desc, eq, getTableColumns } from 'drizzle-orm'
import { jobRecord, pullRequestRecord, repositoryRecord } from '../database/contract-records.ts'
import type { DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { jobs, pullRequests, repositories, workItems } from '../database/schema/tables.ts'
import type { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { workItemRecord } from '../work/records.ts'

type TriggerDefinition = {
  id: string
  name: string
  description: string
  reasons: string[]
  entityTypes: string[]
  matches(reason: string): boolean
}

const exact =
  (...reasons: string[]) =>
  (reason: string) =>
    reasons.includes(reason)
const prefixed =
  (...prefixes: string[]) =>
  (reason: string) =>
    prefixes.some((prefix) => reason.startsWith(prefix))

const workReasons = [
  'work_item_created',
  'work_item_updated',
  'work_item_archived',
  'work_item_restored',
  'work_item_attention',
  'work_item_delete_failed',
  'work_item_deleted',
  'work_resource_linked',
  'work_resource_updated',
  'work_resource_unlinked',
  'work_relation_linked',
  'work_context_transfer_created',
  'work_context_transfer_started',
  'work_context_transfer_completed',
  'work_context_transfer_failed',
  'work_thread_linked',
  'work_thread_batch_started',
  'work_upfront_review_started',
  'work_upfront_review_batch_started',
  'work_memory_updated',
  'work_sequential_execution_requested',
]
const startedReasons = ['job_running', 'thread_started', 'job_follow_up_started']
const completedReasons = ['job_finished', 'job_reconciled_completed', 'job_follow_up_completed']
const failedReasons = ['job_failed', 'job_auto_resume_failed', 'job_follow_up_failed']
const pullRequestLifecycleReasons = [
  'pr_opened',
  'pr_head_changed',
  'pr_title_changed',
  'pr_labels_changed',
  'pr_reviewers_changed',
  'pr_status_changed',
]
const pullRequestReasons = [
  ...pullRequestLifecycleReasons,
  'pr_approved',
  'pr_auto_merge_enabled',
  'pr_ready_for_review',
  'pr_readiness',
  'pr_tasks_saved',
  'pr_task_updated',
  'pr_task_auto_merge',
  'pr_task_approved',
  'review_watch_updated',
  'automatic_review_queued',
  'automatic_review_queue_updated',
]
const reviewReasons = ['review_batch_completed', 'review_suggestions_ready', 'review_delivery_succeeded', 'review_summary_reconciled']
const repositoryReasons = ['repository', 'repository_environment_profiles_updated']

const definitions: TriggerDefinition[] = [
  {
    id: 'core.scheduled',
    name: 'Recurring schedule',
    description: 'Runs this automation on its configured cadence for each selected repository.',
    reasons: ['automation_schedule_due'],
    entityTypes: ['repository'],
    matches: () => false,
  },
  {
    id: 'core.work-item-created',
    name: 'Work item created',
    description: 'When a new Work item is created. Provides its title, state, priority, and repository.',
    reasons: ['work_item_created'],
    entityTypes: ['work-item'],
    matches: exact('work_item_created'),
  },
  {
    id: 'core.work-item-changed',
    name: 'Work item changed',
    description: 'When a Work item or its linked resources, context, relations, or threads change.',
    reasons: workReasons,
    entityTypes: ['work-item'],
    matches: prefixed('work_'),
  },
  {
    id: 'core.agent-thread-started',
    name: 'Agent run started',
    description: 'When an agent thread or queued follow-up starts running.',
    reasons: startedReasons,
    entityTypes: ['agent-thread'],
    matches: exact(...startedReasons),
  },
  {
    id: 'core.agent-thread-completed',
    name: 'Agent run completed',
    description: 'When an agent thread or follow-up completes. Can start another Work or Review thread.',
    reasons: completedReasons,
    entityTypes: ['agent-thread'],
    matches: exact(...completedReasons),
  },
  {
    id: 'core.agent-thread-failed',
    name: 'Agent run failed',
    description: 'When an agent thread or follow-up fails.',
    reasons: failedReasons,
    entityTypes: ['agent-thread'],
    matches: exact(...failedReasons),
  },
  {
    id: 'core.agent-input-required',
    name: 'Agent needs input',
    description: 'When an active agent asks for user input.',
    reasons: ['input_required'],
    entityTypes: ['agent-thread'],
    matches: exact('input_required'),
  },
  {
    id: 'core.pull-request-opened',
    name: 'Pull request opened',
    description: 'When a newly opened pull request is first discovered.',
    reasons: ['pr_opened'],
    entityTypes: ['pull-request'],
    matches: exact('pr_opened'),
  },
  {
    id: 'core.pull-request-reviewers-changed',
    name: 'Pull request reviewers changed',
    description: 'When GitHub reviewer assignments change. Filter by reviewer username to automate assigned PRs.',
    reasons: ['pr_reviewers_changed'],
    entityTypes: ['pull-request'],
    matches: exact('pr_reviewers_changed'),
  },
  {
    id: 'core.pull-request-commits-changed',
    name: 'Pull request commits changed',
    description: 'When a pull request receives a new head commit.',
    reasons: ['pr_head_changed'],
    entityTypes: ['pull-request'],
    matches: exact('pr_head_changed'),
  },
  {
    id: 'core.pull-request-metadata-changed',
    name: 'Pull request metadata changed',
    description: 'When a pull request title, labels, readiness, checks, merge state, or review decision changes.',
    reasons: ['pr_title_changed', 'pr_labels_changed', 'pr_status_changed'],
    entityTypes: ['pull-request'],
    matches: exact('pr_title_changed', 'pr_labels_changed', 'pr_status_changed'),
  },
  {
    id: 'core.pull-request-changed',
    name: 'Pull request changed',
    description: 'When readiness, approval, tasks, merge state, or review-watch state changes.',
    reasons: pullRequestReasons,
    entityTypes: ['pull-request'],
    matches: prefixed('pr_', 'review_watch_', 'automatic_review_'),
  },
  {
    id: 'core.review-completed',
    name: 'Review completed',
    description: 'When review details, aggregation, summary, or GitHub posting completes.',
    reasons: reviewReasons,
    entityTypes: ['agent-thread'],
    matches: exact(...reviewReasons),
  },
  {
    id: 'core.repository-changed',
    name: 'Repository changed',
    description: 'When a repository or its worktree environment configuration changes.',
    reasons: repositoryReasons,
    entityTypes: ['repository'],
    matches: prefixed('repository'),
  },
  {
    id: 'core.platform-event',
    name: 'Any platform event',
    description: 'Runs for supported Work, agent, pull request, review, and repository events. Use conditions to narrow it.',
    reasons: [
      ...workReasons,
      ...startedReasons,
      ...completedReasons,
      ...failedReasons,
      'input_required',
      ...pullRequestReasons,
      ...reviewReasons,
      ...repositoryReasons,
    ],
    entityTypes: ['work-item', 'agent-thread', 'pull-request', 'repository', 'platform'],
    matches: (reason) =>
      ['work_', 'job_', 'thread_', 'input_', 'pr_', 'review_', 'automatic_review_', 'repository'].some((prefix) =>
        reason.startsWith(prefix),
      ),
  },
]

function eventDataSchema(definition: TriggerDefinition): CapabilitySchema {
  return {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        title: 'Specific event',
        description: 'The exact platform event that occurred.',
        enum: definition.reasons,
      },
      entityId: {
        type: 'number',
        title: 'Target ID',
        description: 'The local ID of the affected target.',
      },
      entityType: {
        type: 'string',
        title: 'Target type',
        description: 'The kind of target affected by the event.',
        enum: definition.entityTypes,
      },
      entity: {
        type: 'object',
        title: 'Target',
        description: 'The current snapshot of the affected target.',
        additionalProperties: true,
        properties: {
          id: { type: 'number', title: 'ID' },
          title: { type: 'string', title: 'Title' },
          task_title: { type: 'string', title: 'Run title' },
          status: {
            type: 'string',
            title: 'Status',
            enum: ['starting', 'running', 'completed', 'failed', 'resumable', 'interrupted'],
          },
          state: {
            type: 'string',
            title: 'State',
            enum: ['backlog', 'active', 'review', 'deploy', 'done', 'open', 'closed', 'merged'],
          },
          kind: {
            type: 'string',
            title: 'Work type',
            enum: ['implementation', 'pr_review', 'investigation', 'operational', 'task', 'review', 'work_review', 'pre_pr'],
          },
          priority: {
            type: 'string',
            title: 'Priority',
            enum: ['low', 'normal', 'high', 'urgent'],
          },
          repository: { type: 'string', title: 'Repository' },
          repo_id: { type: 'number', title: 'Repository ID' },
          work_item_id: { type: 'number', title: 'Work item ID' },
          pr_number: { type: 'number', title: 'Pull request number' },
          review_decision: { type: 'string', title: 'Review decision' },
          reviewer_logins: {
            type: 'string',
            title: 'Reviewer usernames',
            description: 'Comma-separated GitHub usernames currently requested for review.',
          },
          label_names: {
            type: 'string',
            title: 'Labels',
            description: 'Comma-separated pull-request label names.',
          },
          head_sha: { type: 'string', title: 'Head commit' },
          agent_id: { type: 'string', title: 'Agent' },
          agent_model: { type: 'string', title: 'Model' },
          agent_reasoning_effort: { type: 'string', title: 'Reasoning level' },
          last_status: {
            type: 'string',
            title: 'Last run status',
            enum: ['running', 'succeeded', 'failed', 'timed_out'],
          },
        },
      },
    },
    required: ['reason', 'entityType'],
    additionalProperties: true,
  }
}

function capabilityValue(value: unknown): CapabilityValue | undefined {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as CapabilityValue
  } catch {
    return undefined
  }
}

function entityType(reason: string) {
  if (reason.startsWith('work_')) return 'work-item'
  if (['pr_', 'review_watch_', 'automatic_review_'].some((prefix) => reason.startsWith(prefix))) return 'pull-request'
  if (['job_', 'thread_', 'input_', 'review_'].some((prefix) => reason.startsWith(prefix))) return 'agent-thread'
  if (reason.startsWith('repository')) return 'repository'
  return 'platform'
}

function safeGet<T extends Record<string, unknown>>(query: () => T | undefined): T | undefined {
  try {
    const row = query()
    return row ? row : undefined
  } catch {
    return undefined
  }
}

function pullRequestSnapshot(database: DrizzleDashboardDatabase, id: number) {
  const row = safeGet(() =>
    database
      .select({ ...getTableColumns(pullRequests), repository: repositories.fullName })
      .from(pullRequests)
      .innerJoin(repositories, eq(repositories.id, pullRequests.repoId))
      .where(eq(pullRequests.number, id))
      .orderBy(desc(pullRequests.updatedAt))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const values = (value: unknown, field: string) => {
    try {
      const parsed = JSON.parse(String(value || '[]')) as Array<Record<string, unknown>>
      return parsed
        .map((item) => String(item[field] || '').trim())
        .filter(Boolean)
        .join(', ')
    } catch {
      return ''
    }
  }
  return {
    ...pullRequestRecord(row),
    repository: row.repository,
    reviewer_logins: values(row.reviewers, 'login'),
    label_names: values(row.labels, 'name'),
  }
}

function entitySnapshot(database: DrizzleDashboardDatabase, type: string, id: number | null) {
  if (id === null) return undefined
  if (type === 'work-item') {
    const row = safeGet(() =>
      database
        .select({ ...getTableColumns(workItems), repository: repositories.fullName })
        .from(workItems)
        .leftJoin(repositories, eq(repositories.id, workItems.primaryRepositoryId))
        .where(eq(workItems.id, id))
        .get(),
    )
    return row ? { ...workItemRecord(row), repository: row.repository } : undefined
  }
  if (type === 'agent-thread') {
    const row = safeGet(() =>
      database
        .select({ ...getTableColumns(jobs), repository: repositories.fullName })
        .from(jobs)
        .innerJoin(repositories, eq(repositories.id, jobs.repoId))
        .where(eq(jobs.id, id))
        .get(),
    )
    return row ? { ...jobRecord(row), repository: row.repository } : undefined
  }
  if (type === 'pull-request') return pullRequestSnapshot(database, id)
  if (type === 'repository') {
    const row = safeGet(() => database.select().from(repositories).where(eq(repositories.id, id)).get())
    return row ? repositoryRecord(row) : undefined
  }
  return undefined
}

export class CoreAutomationTriggers {
  readonly #listeners = new Map<string, Set<(event: TriggerEvent) => void>>()
  #sequence = 0

  constructor(
    private readonly database: DrizzleDashboardDatabase,
    private readonly registries: PlatformCapabilityRegistries,
  ) {}

  register() {
    const triggers = this.registries.forModule('core').triggers
    for (const definition of definitions) {
      triggers.register({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        outputSchema: eventDataSchema(definition),
        subscribe: (listener) => {
          const listeners = this.#listeners.get(definition.id) || new Set()
          listeners.add(listener)
          this.#listeners.set(definition.id, listeners)
          return () => listeners.delete(listener)
        },
      })
    }
  }

  emit(reason: string, id: number | null = null) {
    const type = entityType(reason)
    const snapshot = entitySnapshot(this.database, type, id)
    const data = capabilityValue({
      reason,
      entityType: type,
      ...(id === null ? {} : { entityId: id }),
      ...(snapshot ? { entity: snapshot } : {}),
    })
    const event: TriggerEvent = {
      id: `platform:${Date.now()}:${++this.#sequence}`,
      occurredAt: new Date().toISOString(),
      ...(id === null ? {} : { subject: `${type}:${id}` }),
      ...(data === undefined ? {} : { data }),
    }
    for (const definition of definitions) {
      if (!definition.matches(reason)) continue
      for (const listener of this.#listeners.get(definition.id) || []) listener(event)
    }
  }
}
