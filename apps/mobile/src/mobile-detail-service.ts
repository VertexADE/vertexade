import { createMobilePlatformClient } from './platform-service'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from './mobile-workspace-service'
import {
  nonNegativeInteger,
  optionalPositiveInteger,
  requiredPositiveInteger,
  requiredRecord,
} from './mobile-value-parsers'

export type MobilePerson = { login: string; name: string }
export type MobileDiffFile = { path: string; additions: number; deletions: number; status: string; binary: boolean }
export type MobilePullRequestComment = {
  id: string
  author: string
  body: string
  createdAt: string
  state: string
}
export type MobilePullRequestCommit = {
  oid: string
  title: string
  body: string
  authoredAt: string
  authors: MobilePerson[]
}
export type MobileCheck = { name: string; status: string; url: string }
export type MobilePullRequestDetails = {
  title: string
  body: string
  url: string
  author: MobilePerson
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
  commits: MobilePullRequestCommit[]
  conversation: MobilePullRequestComment[]
  checks: MobileCheck[]
  assignees: MobilePerson[]
  milestone: string
  mergeable: string
  mergeState: string
  reviewDecision: string
  headRef: string
  baseRef: string
  draft: boolean
  labels: Array<{ name: string; color: string }>
  unresolvedThreads: number
  files: MobileDiffFile[]
  diff: string
  providerName: string
}

export type MobileWorkResource = {
  id: number
  kind: string
  label: string
  url: string
  state: string
  role: string
  primary: boolean
}
export type MobileWorkEvent = { id: number; type: string; summary: string; actor: string; createdAt: string }
export type MobileWorkRelation = { key: string; title: string; state: string; relation: string }
export type MobileContextTransfer = { id: number; status: string; instruction: string; error: string; createdAt: string }
export type MobileWorkItemDetails = MobileWorkItem & {
  owner: string
  createdAt: string
  resources: MobileWorkResource[]
  threads: MobileThread[]
  events: MobileWorkEvent[]
  relations: MobileWorkRelation[]
  contextTransfers: MobileContextTransfer[]
}

export type MobileThreadEvent = { id: string; kind: string; title: string; text: string; time: string; status: string }
export type MobileQueuedFollowUp = { id: number; prompt: string; queuedAt: string }
export type MobileInputQuestion = {
  id: string
  header: string
  question: string
  secret: boolean
  options: Array<{ label: string; description: string }>
}
export type MobileThreadDetails = MobileThread & {
  threadId: string
  canSteer: boolean
  prompt: string
  resultText: string
  reviewDetails: string
  reviewSummary: string
  content: string
  events: MobileThreadEvent[]
  queuedFollowUps: MobileQueuedFollowUp[]
  inputQuestions: MobileInputQuestion[]
  files: MobileDiffFile[]
  additions: number
  deletions: number
  diff: string
  diffError: string
}

export type MobileThreadDelivery = 'steer' | 'queue' | 'follow-up'
export type MobileWorkState = MobileWorkItem['state']

const detailResponseLimitBytes = 32 * 1024 * 1024

export async function loadMobilePullRequestDetails(serviceUrl: string, pullRequest: MobilePullRequest): Promise<MobilePullRequestDetails> {
  const payload = await createMobilePlatformClient(serviceUrl, pullRequest.backendId).request<unknown>(
    `/api/pulls/${pullRequest.repoId}/${pullRequest.number}/details`,
    { maxJsonResponseBytes: detailResponseLimitBytes },
  )
  return parsePullRequestDetails(payload)
}

export async function loadMobileWorkItemDetails(serviceUrl: string, item: MobileWorkItem): Promise<MobileWorkItemDetails> {
  const payload = await createMobilePlatformClient(serviceUrl, item.backendId).request<unknown>(
    `/api/work-items/${encodeURIComponent(String(item.id))}`,
    { maxJsonResponseBytes: detailResponseLimitBytes },
  )
  return parseWorkItemDetails(payload, item)
}

export async function loadMobileThreadDetails(serviceUrl: string, thread: MobileThread): Promise<MobileThreadDetails> {
  const client = createMobilePlatformClient(serviceUrl, thread.backendId)
  const [log, diff] = await Promise.all([
    client.request<unknown>(`/api/agent-threads/${thread.id}/log`, { maxJsonResponseBytes: detailResponseLimitBytes }),
    client.request<unknown>(`/api/agent-threads/${thread.id}/diff`, { maxJsonResponseBytes: detailResponseLimitBytes })
      .then((value) => ({ value, error: '' }))
      .catch((reason: unknown) => ({ value: null, error: errorMessage(reason) })),
  ])
  return parseThreadDetails(log, diff.value, diff.error, thread)
}

export async function updateMobileWorkState(serviceUrl: string, item: MobileWorkItem, state: MobileWorkState): Promise<void> {
  await jsonMutation(serviceUrl, item.backendId, `/api/work-items/${item.id}`, 'PATCH', {
    state,
    reason: 'Moved from VertexADE mobile Work details',
  })
}

export async function ensureMobilePullRequestWork(serviceUrl: string, pullRequest: MobilePullRequest): Promise<{ id: number; key: string }> {
  const payload = await createMobilePlatformClient(serviceUrl, pullRequest.backendId).request<unknown>(
    `/api/pulls/${pullRequest.repoId}/${pullRequest.number}/work`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )
  const record = requiredRecord(payload, 'VertexADE returned an invalid Work item')
  return { id: requiredPositiveInteger(record.id, 'Work item ID'), key: requiredString(record.key, 'Work item key', 200) }
}

export async function deliverMobileThreadMessage(
  serviceUrl: string,
  thread: MobileThread,
  prompt: string,
  delivery: MobileThreadDelivery,
): Promise<void> {
  const value = prompt.trim().slice(0, 20_000)
  if (!value) throw new Error('A message is required')
  await jsonMutation(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/${delivery}`, 'POST', { prompt: value })
}

export async function interruptMobileThread(serviceUrl: string, thread: MobileThread): Promise<void> {
  await jsonMutation(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/interrupt`, 'POST', {})
}

export async function retryMobileThread(serviceUrl: string, thread: MobileThread): Promise<void> {
  await jsonMutation(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/retry`, 'POST', {})
}

export async function submitMobileThreadInput(
  serviceUrl: string,
  thread: MobileThread,
  answers: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(answers).slice(0, 100)
  if (!entries.length) throw new Error('Answer every question before continuing')
  const payload = Object.fromEntries(
    entries.map(([id, answer]) => [id.trim().slice(0, 200), { answers: [answer.trim().slice(0, 20_000)] }]),
  )
  if (Object.entries(payload).some(([id, answer]) => !id || !answer.answers[0])) throw new Error('Answer every question before continuing')
  await jsonMutation(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/input`, 'POST', { answers: payload })
}

async function jsonMutation(
  serviceUrl: string,
  backendId: string,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
): Promise<void> {
  await createMobilePlatformClient(serviceUrl, backendId).request<unknown>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function parsePullRequestDetails(value: unknown): MobilePullRequestDetails {
  const record = requiredRecord(value, 'VertexADE returned invalid pull request details')
  const diffSummary = recordValue(record.diff_summary)
  const comments = [...recordArray(record.comments), ...recordArray(record.reviews), ...reviewThreadComments(record.reviewThreads)]
  return {
    title: requiredString(record.title, 'Pull request title', 2_000),
    body: stringValue(record.body, 100_000),
    url: stringValue(record.url, 4_000),
    author: person(record.author),
    createdAt: stringValue(record.createdAt, 100),
    updatedAt: stringValue(record.updatedAt, 100),
    additions: nonNegativeInteger(record.additions),
    deletions: nonNegativeInteger(record.deletions),
    changedFiles: nonNegativeInteger(record.changedFiles),
    commits: recordArray(record.commits).map(commit),
    conversation: comments.map(comment).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    checks: recordArray(record.statusCheckRollup).map(check),
    assignees: recordArray(record.assignees).map(person),
    milestone: stringValue(recordValue(record.milestone).title, 500),
    mergeable: stringValue(record.mergeable, 100),
    mergeState: stringValue(record.mergeStateStatus, 100),
    reviewDecision: stringValue(record.reviewDecision, 100),
    headRef: stringValue(record.headRefName, 1_000),
    baseRef: stringValue(record.baseRefName, 1_000),
    draft: record.isDraft === true,
    labels: recordArray(record.labels).map((label) => ({ name: stringValue(label.name, 200), color: stringValue(label.color, 20) })),
    unresolvedThreads: recordArray(record.reviewThreads).filter((thread) => thread.isResolved !== true).length,
    files: recordArray(diffSummary.files).map(diffFile),
    diff: stringValue(record.diff, 200_000),
    providerName: stringValue(record.scm_provider_name, 200),
  }
}

function parseWorkItemDetails(value: unknown, item: MobileWorkItem): MobileWorkItemDetails {
  const record = requiredRecord(value, 'VertexADE returned invalid Work details')
  return {
    ...item,
    key: requiredString(record.key, 'Work item key', 200),
    title: requiredString(record.title, 'Work item title', 200),
    description: stringValue(record.description, 20_000),
    state: workState(record.state, item.state),
    priority: workPriority(record.priority, item.priority),
    repositoryNames: stringList(record.repository_names, 100, 500),
    attention: stringValue(record.attention, 2_000) || null,
    owner: stringValue(record.owner, 200),
    createdAt: stringValue(record.created_at, 100),
    updatedAt: stringValue(record.updated_at, 100),
    resources: recordArray(record.resources).map(workResource),
    threads: recordArray(record.threads).map((thread) => nestedThread(thread, item)),
    events: recordArray(record.events).map(workEvent),
    relations: recordArray(record.relations).map(workRelation),
    contextTransfers: recordArray(record.context_transfers).map(contextTransfer),
    threadCount: recordArray(record.threads).length,
  }
}

function parseThreadDetails(value: unknown, diffValue: unknown, diffError: string, thread: MobileThread): MobileThreadDetails {
  const record = requiredRecord(value, 'VertexADE returned invalid thread details')
  const diff = recordValue(diffValue)
  const summary = recordValue(diff.diff_summary || record.diff_summary)
  return {
    ...thread,
    status: requiredString(record.status, 'Thread status', 100),
    taskTitle: stringValue(record.task_title, 2_000),
    latestActivity: stringValue(record.latest_activity, 4_000),
    activityAt: stringValue(record.activity_at, 100),
    branchName: stringValue(record.branch_name, 1_000),
    pullRequestNumber: optionalPositiveInteger(record.linked_pr_number) ?? optionalPositiveInteger(record.pr_number),
    pullRequestUrl: stringValue(record.linked_pr_url, 4_000) || stringValue(record.pr_url, 4_000),
    threadId: stringValue(record.thread_id, 1_000),
    canSteer: record.can_steer === true,
    prompt: stringValue(record.prompt, 20_000),
    resultText: stringValue(record.result_text, 100_000),
    reviewDetails: stringValue(record.review_details, 100_000),
    reviewSummary: stringValue(record.review_summary, 100_000),
    content: stringValue(record.content, 100_000),
    events: recordArray(record.events).map(threadEvent),
    queuedFollowUps: recordArray(record.queued_follow_ups).map(queuedFollowUp),
    inputQuestions: inputQuestions(record.input_questions),
    files: recordArray(summary.files).map(diffFile),
    additions: nonNegativeInteger(summary.additions ?? record.diff_additions),
    deletions: nonNegativeInteger(summary.deletions ?? record.diff_deletions),
    diff: stringValue(diff.diff, 200_000),
    diffError,
  }
}

function person(value: unknown): MobilePerson {
  const record = recordValue(value)
  return { login: stringValue(record.login, 500), name: stringValue(record.name, 500) }
}

function commit(record: Record<string, unknown>): MobilePullRequestCommit {
  return {
    oid: stringValue(record.oid, 100),
    title: stringValue(record.messageHeadline, 2_000),
    body: stringValue(record.messageBody, 20_000),
    authoredAt: stringValue(record.authoredDate, 100),
    authors: recordArray(record.authors).map(person),
  }
}

function comment(record: Record<string, unknown>): MobilePullRequestComment {
  return {
    id: stringValue(record.id ?? record.databaseId, 200) || `${stringValue(record.createdAt, 100)}:${stringValue(record.body, 100)}`,
    author: person(record.author).login || stringValue(record.author, 500) || 'Unknown',
    body: stringValue(record.body, 100_000),
    createdAt: stringValue(record.createdAt ?? record.created_at, 100),
    state: stringValue(record.state, 100),
  }
}

function reviewThreadComments(value: unknown): Record<string, unknown>[] {
  return recordArray(value).flatMap((thread) => recordArray(thread.comments))
}

function check(record: Record<string, unknown>): MobileCheck {
  return {
    name: stringValue(record.name ?? record.context ?? record.workflowName, 1_000) || 'Check',
    status: stringValue(record.conclusion ?? record.state ?? record.status, 100) || 'UNKNOWN',
    url: stringValue(record.detailsUrl ?? record.targetUrl, 4_000),
  }
}

function diffFile(record: Record<string, unknown>): MobileDiffFile {
  return {
    path: stringValue(record.path, 4_000),
    additions: nonNegativeInteger(record.additions),
    deletions: nonNegativeInteger(record.deletions),
    status: stringValue(record.status, 100),
    binary: record.binary === true,
  }
}

function workResource(record: Record<string, unknown>): MobileWorkResource {
  return {
    id: requiredPositiveInteger(record.id, 'Work resource ID'),
    kind: stringValue(record.kind, 100),
    label: stringValue(record.label, 2_000),
    url: stringValue(record.url, 4_000),
    state: stringValue(record.state, 100),
    role: stringValue(record.role, 100),
    primary: record.is_primary === 1 || record.is_primary === true,
  }
}

function workEvent(record: Record<string, unknown>): MobileWorkEvent {
  return {
    id: requiredPositiveInteger(record.id, 'Work event ID'),
    type: stringValue(record.event_type, 100),
    summary: stringValue(record.summary, 4_000),
    actor: stringValue(record.actor, 500),
    createdAt: stringValue(record.created_at, 100),
  }
}

function workRelation(record: Record<string, unknown>): MobileWorkRelation {
  return {
    key: stringValue(record.key, 200),
    title: stringValue(record.title, 2_000),
    state: stringValue(record.state, 100),
    relation: stringValue(record.relation, 100),
  }
}

function contextTransfer(record: Record<string, unknown>): MobileContextTransfer {
  return {
    id: requiredPositiveInteger(record.id, 'Context transfer ID'),
    status: stringValue(record.status, 100),
    instruction: stringValue(record.instruction, 20_000),
    error: stringValue(record.error, 4_000),
    createdAt: stringValue(record.created_at, 100),
  }
}

function nestedThread(record: Record<string, unknown>, item: MobileWorkItem): MobileThread {
  return {
    id: requiredPositiveInteger(record.id, 'Thread ID'),
    workItemId: item.id,
    fullName: requiredString(record.full_name, 'Thread repository', 500),
    status: requiredString(record.status, 'Thread status', 100),
    agentName: stringValue(record.agent_name, 200) || stringValue(record.agent_id, 200) || 'Agent',
    taskTitle: stringValue(record.task_title, 2_000),
    latestActivity: stringValue(record.latest_activity, 4_000),
    activityAt: stringValue(record.activity_at ?? record.created_at, 100),
    branchName: stringValue(record.branch_name, 1_000),
    pullRequestNumber: optionalPositiveInteger(record.linked_pr_number) ?? optionalPositiveInteger(record.pr_number),
    pullRequestUrl: stringValue(record.linked_pr_url, 4_000),
    archived: Boolean(record.archived_at),
    backendId: item.backendId,
    backendName: item.backendName,
  }
}

function threadEvent(record: Record<string, unknown>, index: number): MobileThreadEvent {
  return {
    id: stringValue(record.id, 200) || String(index),
    kind: stringValue(record.kind, 100),
    title: stringValue(record.title, 2_000),
    text: stringValue(record.text, 20_000),
    time: stringValue(record.time, 100),
    status: stringValue(record.status, 100),
  }
}

function queuedFollowUp(record: Record<string, unknown>): MobileQueuedFollowUp {
  return {
    id: requiredPositiveInteger(record.id, 'Queued follow-up ID'),
    prompt: stringValue(record.prompt, 20_000),
    queuedAt: stringValue(record.queued_at, 100),
  }
}

function inputQuestions(value: unknown): MobileInputQuestion[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    return recordArray(JSON.parse(value)).map((record) => ({
      id: requiredString(record.id, 'Input question ID', 200),
      header: stringValue(record.header, 500),
      question: requiredString(record.question, 'Input question', 4_000),
      secret: record.isSecret === true,
      options: recordArray(record.options).map((option) => ({
        label: requiredString(option.label, 'Input option label', 500),
        description: stringValue(option.description, 2_000),
      })),
    }))
  } catch {
    return []
  }
}

function workState(value: unknown, fallback: MobileWorkItem['state']): MobileWorkItem['state'] {
  return ['backlog', 'active', 'review', 'deploy', 'done'].includes(String(value)) ? (value as MobileWorkItem['state']) : fallback
}

function workPriority(value: unknown, fallback: MobileWorkItem['priority']): MobileWorkItem['priority'] {
  return ['low', 'normal', 'high', 'urgent'].includes(String(value)) ? (value as MobileWorkItem['priority']) : fallback
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Request failed'
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, 2_000).map(recordValue) : []
}

function requiredString(value: unknown, label: string, maximum: number): string {
  const result = stringValue(value, maximum)
  if (!result) throw new Error(`${label} is missing`)
  return result
}

function stringValue(value: unknown, maximum: number): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, maximum) : ''
}

function stringList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  return Array.isArray(value) ? value.slice(0, maximumItems).map((item) => stringValue(item, maximumLength)).filter(Boolean) : []
}
