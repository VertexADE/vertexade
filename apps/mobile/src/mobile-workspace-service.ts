import { createMobilePlatformClient, type MobileBackend } from './platform-service'
import {
  nonNegativeInteger,
  optionalPositiveInteger,
  requiredPositiveInteger,
  requiredRecord,
} from './mobile-value-parsers'
import { mobileAgentHeaders, type MobileAgentOptions } from './mobile-agent-options'

type MobileSource = {
  backendId: string
  backendName: string
  serviceUrl?: string
}

export type MobileRepository = MobileSource & {
  id: number
  fullName: string
}

export type MobilePullRequest = MobileSource & {
  id: number
  workItemId: number | null
  repoId: number
  number: number
  title: string
  fullName: string
  author: string
  url: string
  baseRef: string
  headRef: string
  draft: boolean
  checksPending: number
  checksFailed: number
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  updatedAt: string
}

export type MobileWorkItem = MobileSource & {
  id: number
  key: string
  title: string
  description: string
  kind: 'implementation' | 'pr_review' | 'investigation' | 'operational'
  state: 'backlog' | 'active' | 'review' | 'deploy' | 'done'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  primaryRepositoryId: number | null
  repositoryNames: string[]
  threadCount: number
  attention: string | null
  archived: boolean
  updatedAt: string
}

export type MobileThread = MobileSource & {
  id: number
  workItemId: number | null
  fullName: string
  status: string
  agentName: string
  taskTitle: string
  latestActivity: string
  activityAt: string
  branchName: string
  pullRequestNumber: number | null
  pullRequestUrl: string
  archived: boolean
  repositorySourceKind?: 'git' | 'directory' | 'workspace'
}

export type MobileWorkspace = {
  repositories: MobileRepository[]
  pullRequests: MobilePullRequest[]
  workItems: MobileWorkItem[]
  threads: MobileThread[]
}

export type CreateMobileWorkItemInput = {
  backendId: string
  title: string
  description: string
  repositoryId?: number
}

export type StartMobileThreadInput = {
  backendId: string
  workItemId: number
  repositoryId?: number
  prompt: string
  createPullRequest: boolean
  agentOptions?: MobileAgentOptions
}

export type CreatedMobileWorkItem = MobileSource & {
  id: number
  key: string
  title: string
}

type ReadModelCollection = 'repositories' | 'pullRequests' | 'workItems' | 'agentThreads'
type ReadModelEntry = { value: unknown }

const workKinds = ['implementation', 'pr_review', 'investigation', 'operational'] as const
const workStates = ['backlog', 'active', 'review', 'deploy', 'done'] as const
const workPriorities = ['low', 'normal', 'high', 'urgent'] as const
const reviewDecisions = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const
const mobileReadModelLimitBytes = 64 * 1024 * 1024

export async function loadMobileWorkspace(serviceUrl: string, backends: MobileBackend[]): Promise<MobileWorkspace> {
  const payload = await createMobilePlatformClient(serviceUrl).request<unknown>('/api/read-model?since=0', {
    maxJsonResponseBytes: mobileReadModelLimitBytes,
  })
  const defaultBackend = backends.find((backend) => backend.isDefault) || backends[0]
  if (!defaultBackend) throw new Error('VertexADE service has no configured servers')
  const belongsToPrimaryServer = (value: unknown) => {
    const record = requiredRecord(value, 'VertexADE returned an invalid workspace entry')
    const backendId = optionalString(record.backend_id, 48)
    return !backendId || backendId === defaultBackend.id
  }
  return {
    repositories: collectionValues(payload, 'repositories').filter(belongsToPrimaryServer).map((value) => parseRepository(value, backends, defaultBackend)),
    pullRequests: collectionValues(payload, 'pullRequests')
      .filter(belongsToPrimaryServer)
      .map((value) => parsePullRequest(value, backends, defaultBackend))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    workItems: collectionValues(payload, 'workItems')
      .filter(belongsToPrimaryServer)
      .map((value) => parseWorkItem(value, backends, defaultBackend))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    threads: collectionValues(payload, 'agentThreads')
      .filter(belongsToPrimaryServer)
      .map((value) => parseThread(value, backends, defaultBackend))
      .sort((left, right) => right.activityAt.localeCompare(left.activityAt)),
  }
}

export async function createMobileWorkItem(serviceUrl: string, input: CreateMobileWorkItemInput): Promise<CreatedMobileWorkItem> {
  const title = input.title.trim().slice(0, 200)
  if (!title) throw new Error('A Work title is required')
  const payload = await createMobilePlatformClient(serviceUrl, input.backendId).request<unknown>('/api/work-items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      description: input.description.trim().slice(0, 20_000),
      kind: 'implementation',
      priority: 'normal',
      repository_ids: input.repositoryId === undefined ? [] : [input.repositoryId],
    }),
  })
  const record = requiredRecord(payload, 'VertexADE returned an invalid Work item')
  return {
    ...source(record, [{ id: input.backendId, label: input.backendId, isDefault: true, serviceUrl }], {
      id: input.backendId,
      label: input.backendId,
      isDefault: true,
      serviceUrl,
    }),
    id: requiredPositiveInteger(record.id, 'Work item ID'),
    key: requiredString(record.key, 'Work item key'),
    title: requiredString(record.title, 'Work item title'),
  }
}

export async function startMobileThread(serviceUrl: string, input: StartMobileThreadInput): Promise<void> {
  const prompt = input.prompt.trim().slice(0, 20_000)
  if (!prompt) throw new Error('A task prompt is required')
  await createMobilePlatformClient(serviceUrl, input.backendId).request<unknown>(
    `/api/work-items/${encodeURIComponent(String(input.workItemId))}/threads`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(input.agentOptions ? mobileAgentHeaders(input.agentOptions) : {}) },
      body: JSON.stringify({
        repository_ids: input.repositoryId === undefined ? [] : [input.repositoryId],
        prompt,
        create_pr: input.createPullRequest,
        ...(input.agentOptions?.agentId ? { agent_id: input.agentOptions.agentId } : {}),
        ...(input.agentOptions?.model ? { model: input.agentOptions.model } : {}),
        ...(input.agentOptions?.reasoningEffort ? { reasoning_effort: input.agentOptions.reasoningEffort } : {}),
      }),
    },
  )
}

function collectionValues(payload: unknown, collection: ReadModelCollection): unknown[] {
  const root = requiredRecord(payload, 'VertexADE returned an invalid workspace response')
  const updates = requiredRecord(root.updates, 'VertexADE returned an invalid workspace response')
  const update = requiredRecord(updates[collection], `VertexADE did not return ${collection}`)
  const entries = Array.isArray(update.entries) ? update.entries : Array.isArray(update.upserts) ? update.upserts : null
  if (!entries) throw new Error(`VertexADE returned an invalid ${collection} collection`)
  return entries.map((entry) => requiredRecord(entry, `VertexADE returned an invalid ${collection} entry`) as ReadModelEntry).map((entry) => entry.value)
}

function parseRepository(value: unknown, backends: MobileBackend[], defaultBackend: MobileBackend): MobileRepository {
  const record = requiredRecord(value, 'VertexADE returned an invalid repository')
  return {
    ...source(record, backends, defaultBackend),
    id: requiredPositiveInteger(record.id, 'Repository ID'),
    fullName: requiredString(record.full_name, 'Repository name', 500),
  }
}

function parsePullRequest(value: unknown, backends: MobileBackend[], defaultBackend: MobileBackend): MobilePullRequest {
  const record = requiredRecord(value, 'VertexADE returned an invalid pull request')
  return {
    ...source(record, backends, defaultBackend),
    id: requiredPositiveInteger(record.id, 'Pull request ID'),
    workItemId: optionalPositiveInteger(record.work_item_id),
    repoId: requiredPositiveInteger(record.repo_id, 'Pull request repository ID'),
    number: requiredPositiveInteger(record.number, 'Pull request number'),
    title: requiredString(record.title, 'Pull request title', 2_000),
    fullName: requiredString(record.full_name, 'Pull request repository', 500),
    author: optionalString(record.author, 500),
    url: optionalString(record.url, 4_000),
    baseRef: optionalString(record.base_ref, 1_000),
    headRef: optionalString(record.head_ref, 1_000),
    draft: record.draft === true || record.draft === 1,
    checksPending: nonNegativeInteger(record.checks_pending),
    checksFailed: nonNegativeInteger(record.checks_failed),
    reviewDecision: optionalChoice(record.review_decision, reviewDecisions),
    updatedAt: optionalString(record.updated_at, 100),
  }
}

function parseWorkItem(value: unknown, backends: MobileBackend[], defaultBackend: MobileBackend): MobileWorkItem {
  const record = requiredRecord(value, 'VertexADE returned an invalid Work item')
  return {
    ...source(record, backends, defaultBackend),
    id: requiredPositiveInteger(record.id, 'Work item ID'),
    key: requiredString(record.key, 'Work item key', 200),
    title: requiredString(record.title, 'Work item title', 200),
    description: optionalString(record.description, 20_000),
    kind: choice(record.kind, workKinds, 'implementation'),
    state: choice(record.state, workStates, 'backlog'),
    priority: choice(record.priority, workPriorities, 'normal'),
    primaryRepositoryId: optionalPositiveInteger(record.primary_repository_id),
    repositoryNames: stringArray(record.repository_names),
    threadCount: Array.isArray(record.threads) ? record.threads.length : 0,
    attention: optionalString(record.attention, 2_000) || null,
    archived: Boolean(record.archived_at),
    updatedAt: optionalString(record.updated_at, 100),
  }
}

function parseThread(value: unknown, backends: MobileBackend[], defaultBackend: MobileBackend): MobileThread {
  const record = requiredRecord(value, 'VertexADE returned an invalid thread')
  return {
    ...source(record, backends, defaultBackend),
    id: requiredPositiveInteger(record.id, 'Thread ID'),
    workItemId: optionalPositiveInteger(record.work_item_id),
    fullName: requiredString(record.full_name, 'Thread repository', 500),
    status: requiredString(record.status, 'Thread status', 100),
    agentName: optionalString(record.agent_name, 200) || optionalString(record.agent_id, 200) || 'Agent',
    taskTitle: optionalString(record.task_title, 2_000),
    latestActivity: optionalString(record.latest_activity, 4_000),
    activityAt: optionalString(record.activity_at, 100) || optionalString(record.created_at, 100),
    branchName: optionalString(record.branch_name, 1_000),
    pullRequestNumber: optionalPositiveInteger(record.linked_pr_number) ?? optionalPositiveInteger(record.pr_number),
    pullRequestUrl: optionalString(record.linked_pr_url, 4_000),
    archived: Boolean(record.archived_at),
    repositorySourceKind: choice(record.repository_source_kind, ['git', 'directory', 'workspace'] as const, 'git'),
  }
}

function source(record: Record<string, unknown>, backends: MobileBackend[], defaultBackend: MobileBackend): MobileSource {
  const backendId = optionalString(record.backend_id, 48) || defaultBackend.id
  const backend = backends.find((candidate) => candidate.id === backendId)
  if (!backend) throw new Error(`VertexADE returned unknown backend "${backendId}"`)
  return { backendId, backendName: optionalString(record.backend_name, 200) || backend.label, serviceUrl: backend.serviceUrl }
}

function requiredString(value: unknown, label: string, maximum = 20_000): string {
  const result = optionalString(value, maximum)
  if (!result) throw new Error(`${label} is missing`)
  return result
}

function optionalString(value: unknown, maximum = 20_000): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.slice(0, 100).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 500))
    : []
}

function choice<const Values extends readonly string[]>(value: unknown, choices: Values, fallback: Values[number]): Values[number] {
  return choices.includes(value as Values[number]) ? (value as Values[number]) : fallback
}

function optionalChoice<const Values extends readonly string[]>(value: unknown, choices: Values): Values[number] | null {
  return choices.includes(value as Values[number]) ? (value as Values[number]) : null
}
