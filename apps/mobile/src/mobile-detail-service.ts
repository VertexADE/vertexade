import { createMobilePlatformClient } from './platform-service'
import { mobileAgentHeaders, type MobileAgentOptions } from './mobile-agent-options'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from './mobile-workspace-service'
import { nonNegativeInteger, optionalPositiveInteger, requiredPositiveInteger, requiredRecord } from './mobile-value-parsers'

export type MobilePerson = { login: string; name: string }
export type MobileDiffFile = {
  path: string
  additions: number
  deletions: number
  status: string
  binary: boolean
}
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
export type MobileWorkEvent = {
  id: number
  type: string
  summary: string
  actor: string
  createdAt: string
}
export type MobileWorkRelation = {
  key: string
  title: string
  state: string
  relation: string
}
export type MobileContextTransfer = {
  id: number
  status: string
  instruction: string
  error: string
  createdAt: string
}
export type MobileWorkItemDetails = MobileWorkItem & {
  owner: string
  createdAt: string
  resources: MobileWorkResource[]
  threads: MobileThread[]
  events: MobileWorkEvent[]
  relations: MobileWorkRelation[]
  contextTransfers: MobileContextTransfer[]
}

export type MobileThreadEvent = {
  id: string
  kind: string
  title: string
  text: string
  time: string
  status: string
  event: string
  files?: MobileDiffFile[]
  additions?: number
  deletions?: number
}
export type MobileQueuedFollowUp = {
  id: number
  prompt: string
  model: string
  reasoningEffort: string
  queuedAt: string
}
export type MobileInputQuestion = {
  id: string
  header: string
  question: string
  secret: boolean
  type: 'text' | 'select' | 'checkbox'
  required: boolean
  multiline: boolean
  description: string
  formTitle: string
  formDescription: string
  options: Array<{ label: string; value: string; description: string }>
}
export type MobileThreadDetails = MobileThread & {
  threadId: string
  threadUrl: string
  agentId: string
  canSteer: boolean
  kind: string
  kindLabel: string
  model: string
  reasoningEffort: string
  worktreePath: string
  createdAt: string
  finishedAt: string
  sourceJobId: number | null
  ephemeral: boolean
  reviewPhase: string
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
  suggestions: MobileReviewSuggestion[]
}

export type MobileReviewSuggestion = {
  id: number
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  description: string
  replacement: string
  selected: boolean
  postedAt: string
}

export type MobileThreadTransferTarget = {
  id: number
  status: string
  taskTitle: string
  branchName: string
  workItemKey: string
  workItemTitle: string
  fullName: string
}

export type MobileForkThreadInput = {
  title: string
  prompt: string
  base: 'current' | 'main'
  branchType: string
  options: MobileAgentOptions
}

export type MobileThreadDelivery = 'steer' | 'queue' | 'follow-up'
export type MobilePromptImage = { name: string; url: string }
export type MobileWorkState = MobileWorkItem['state']

const detailResponseLimitBytes = 32 * 1024 * 1024
const threadLogTimeoutMs = 15_000
const threadSupplementTimeoutMs = 8_000

export async function loadMobilePullRequestDetails(serviceUrl: string, pullRequest: MobilePullRequest): Promise<MobilePullRequestDetails> {
  const payload = await createMobilePlatformClient(serviceUrl, pullRequest.backendId).request<unknown>(`/api/pulls/${pullRequest.repoId}/${pullRequest.number}/details`, {
    maxJsonResponseBytes: detailResponseLimitBytes,
  })
  return parsePullRequestDetails(payload)
}

export async function loadMobileWorkItemDetails(serviceUrl: string, item: MobileWorkItem): Promise<MobileWorkItemDetails> {
  const payload = await createMobilePlatformClient(serviceUrl, item.backendId).request<unknown>(`/api/work-items/${encodeURIComponent(String(item.id))}`, {
    maxJsonResponseBytes: detailResponseLimitBytes,
  })
  return parseWorkItemDetails(payload, item)
}

export async function loadMobileThreadDetails(serviceUrl: string, thread: MobileThread): Promise<MobileThreadDetails> {
  const client = createMobilePlatformClient(serviceUrl, thread.backendId)
  const [log, diff] = await Promise.all([
    requestWithTimeout(client, `/api/agent-threads/${thread.id}/log`, threadLogTimeoutMs, 'Thread activity took too long to load'),
    requestWithTimeout(client, `/api/agent-threads/${thread.id}/diff`, threadSupplementTimeoutMs, 'Diff took too long to load')
      .then((value) => ({ value, error: '' }))
      .catch((reason: unknown) => ({
        value: null,
        error: errorMessage(reason),
      })),
  ])
  const details = parseThreadDetails(log, diff.value, diff.error, thread)
  if (details.kind !== 'review') return details
  const suggestions = await requestWithTimeout(client, `/api/agent-threads/${thread.id}/suggestions`, threadSupplementTimeoutMs, 'Suggestions took too long to load')
    .then(parseReviewSuggestions)
    .catch(() => [])
  return { ...details, suggestions }
}

async function requestWithTimeout(client: ReturnType<typeof createMobilePlatformClient>, path: string, timeoutMs: number, timeoutMessage: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await client.request<unknown>(path, {
      maxJsonResponseBytes: detailResponseLimitBytes,
      signal: controller.signal,
    })
  } catch (reason) {
    if (controller.signal.aborted) throw new Error(timeoutMessage)
    throw reason
  } finally {
    clearTimeout(timer)
  }
}

export async function updateMobileWorkState(serviceUrl: string, item: MobileWorkItem, state: MobileWorkState): Promise<void> {
  await jsonRequest(serviceUrl, item.backendId, `/api/work-items/${item.id}`, 'PATCH', {
    state,
    reason: 'Moved from VertexADE mobile Work details',
  })
}

export async function ensureMobilePullRequestWork(serviceUrl: string, pullRequest: MobilePullRequest): Promise<{ id: number; key: string }> {
  const payload = await createMobilePlatformClient(serviceUrl, pullRequest.backendId).request<unknown>(`/api/pulls/${pullRequest.repoId}/${pullRequest.number}/work`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  const record = requiredRecord(payload, 'VertexADE returned an invalid Work item')
  return {
    id: requiredPositiveInteger(record.id, 'Work item ID'),
    key: requiredString(record.key, 'Work item key', 200),
  }
}

export async function deliverMobileThreadMessage(serviceUrl: string, thread: MobileThread, prompt: string, delivery: MobileThreadDelivery, options?: MobileAgentOptions): Promise<void> {
  const value = prompt.trim().slice(0, 20_000)
  if (!value) throw new Error('A message is required')
  await jsonRequest(
    serviceUrl,
    thread.backendId,
    `/api/agent-threads/${thread.id}/${delivery}`,
    'POST',
    { prompt: value },
    delivery === 'follow-up' && options ? mobileAgentHeaders(options) : undefined,
  )
}

export async function uploadMobilePromptImages(serviceUrl: string, backendId: string, files: Array<{ filename: string; mediaType: string; url: string }>): Promise<MobilePromptImage[]> {
  if (!files.length) return []
  const payload = await jsonRequest(serviceUrl, backendId, '/api/prompt-images', 'POST', { files })
  const record = requiredRecord(payload, 'VertexADE returned invalid image attachments')
  return recordArray(record.images).map((image) => ({
    name: requiredString(image.name, 'Attachment name', 500),
    url: requiredString(image.url, 'Attachment URL', 4_000),
  }))
}

export function appendMobilePromptImages(prompt: string, images: MobilePromptImage[]): string {
  if (!images.length) return prompt.trim()
  const markdown = images.map((image) => `![${image.name.replace(/[\[\]\r\n]/g, '-')}](${image.url})`).join('\n')
  const attachmentBlock = prompt.includes('Attached reference images:') ? markdown : `Attached reference images:\n${markdown}`
  return [prompt.trim(), attachmentBlock].filter(Boolean).join('\n\n').slice(0, 20_000)
}

export async function interruptMobileThread(serviceUrl: string, thread: MobileThread): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/interrupt`, 'POST', {})
}

export async function retryMobileThread(serviceUrl: string, thread: MobileThread): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/retry`, 'POST', {})
}

export async function steerMobileQueuedMessage(serviceUrl: string, thread: MobileThread, queuedId: number): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/queue/${queuedId}/steer`, 'POST', {})
}

export async function cancelMobileQueuedMessage(serviceUrl: string, thread: MobileThread, queuedId: number): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/queue/${queuedId}`, 'DELETE')
}

export async function reorderMobileQueuedMessages(serviceUrl: string, thread: MobileThread, ids: number[]): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/queue`, 'PATCH', { ids })
}

export async function saveMobileThreadTasks(serviceUrl: string, thread: MobileThread): Promise<number> {
  const payload = await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/save-stack-tasks`, 'POST', {})
  return nonNegativeInteger(requiredRecord(payload, 'VertexADE returned an invalid saved task count').saved)
}

export async function reReviewMobileThread(serviceUrl: string, thread: MobileThread): Promise<MobileThread[]> {
  const payload = await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/re-review`, 'POST', {})
  const record = requiredRecord(payload, 'VertexADE returned an invalid re-review result')
  return recordArray(record.threads).map((candidate) => mobileThreadFromJob(candidate, thread))
}

export async function forkMobileThread(serviceUrl: string, thread: MobileThread, input: MobileForkThreadInput): Promise<MobileThread> {
  const title = input.title.trim().slice(0, 100)
  const prompt = input.prompt.trim().slice(0, 20_000)
  if (!title || !prompt) throw new Error('A fork title and instruction are required')
  const payload = await jsonRequest(
    serviceUrl,
    thread.backendId,
    `/api/agent-threads/${thread.id}/fork`,
    'POST',
    { title, prompt, base: input.base, branch_type: input.branchType },
    mobileAgentHeaders(input.options),
  )
  return mobileThreadFromJob(requiredRecord(payload, 'VertexADE returned an invalid forked thread'), thread)
}

export async function postMobileReviewSuggestions(serviceUrl: string, thread: MobileThread, suggestions: MobileReviewSuggestion[]): Promise<number> {
  const payload = await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/suggestions`, 'POST', {
    suggestions: suggestions.slice(0, 100).map(({ id, selected, description, replacement }) => ({
      id,
      selected,
      description: description.trim().slice(0, 10_000),
      replacement: replacement.slice(0, 50_000),
    })),
  })
  return nonNegativeInteger(requiredRecord(payload, 'VertexADE returned an invalid review result').posted)
}

export async function loadMobileThreadTransferTargets(serviceUrl: string, thread: MobileThread): Promise<MobileThreadTransferTarget[]> {
  const payload = await createMobilePlatformClient(serviceUrl, thread.backendId).request<unknown>(`/api/work-context-targets?source_job_id=${encodeURIComponent(String(thread.id))}`)
  return recordArray(requiredRecord(payload, 'VertexADE returned invalid transfer targets').targets).map(transferTarget)
}

export async function transferMobileThreadContext(serviceUrl: string, thread: MobileThread, destinationJobId: number, title: string, instruction: string): Promise<void> {
  if (!thread.workItemId) throw new Error('This thread is not attached to Work')
  const preparedTitle = title.trim().slice(0, 200)
  const preparedInstruction = instruction.trim().slice(0, 20_000)
  if (!preparedTitle || !preparedInstruction) throw new Error('A sub-item title and follow-up instruction are required')
  await jsonRequest(serviceUrl, thread.backendId, `/api/work-items/${thread.workItemId}/sub-items`, 'POST', {
    source_job_id: thread.id,
    destination_job_id: destinationJobId,
    title: preparedTitle,
    instruction: preparedInstruction,
  })
}

export async function submitMobileThreadInput(serviceUrl: string, thread: MobileThread, answers: Record<string, string | string[]>): Promise<void> {
  const entries = Object.entries(answers).slice(0, 100)
  if (!entries.length) throw new Error('Answer every question before continuing')
  const payload = Object.fromEntries(
    entries.map(([id, answer]) => {
      const values = (Array.isArray(answer) ? answer : [answer]).map((value) => value.trim().slice(0, 20_000)).filter(Boolean)
      return [id.trim().slice(0, 200), { answers: values }]
    }),
  )
  if (entries.some(([id, answer]) => !id.trim() || (!Array.isArray(answer) && !answer.trim()))) {
    throw new Error('Answer every question before continuing')
  }
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/input`, 'POST', { answers: payload })
}

export async function cancelMobileThreadInput(serviceUrl: string, thread: MobileThread): Promise<void> {
  await jsonRequest(serviceUrl, thread.backendId, `/api/agent-threads/${thread.id}/input`, 'DELETE')
}

async function jsonRequest(
  serviceUrl: string,
  backendId: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> {
  return createMobilePlatformClient(serviceUrl, backendId).request<unknown>(path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
    labels: recordArray(record.labels).map((label) => ({
      name: stringValue(label.name, 200),
      color: stringValue(label.color, 20),
    })),
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
    threadUrl: stringValue(record.thread_url, 4_000),
    agentId: stringValue(record.agent_id, 200),
    canSteer: record.can_steer === true,
    kind: stringValue(record.kind, 100) || 'task',
    kindLabel: stringValue(record.kind_label, 200),
    model: stringValue(record.agent_model, 200),
    reasoningEffort: stringValue(record.agent_reasoning_effort, 100),
    worktreePath: stringValue(record.worktree_path, 4_000),
    createdAt: stringValue(record.created_at, 100),
    finishedAt: stringValue(record.finished_at, 100),
    sourceJobId: optionalPositiveInteger(record.source_job_id),
    ephemeral: record.ephemeral === true || record.ephemeral === 1,
    reviewPhase: stringValue(record.review_phase, 100),
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
    suggestions: [],
  }
}

function parseReviewSuggestions(value: unknown): MobileReviewSuggestion[] {
  const record = requiredRecord(value, 'VertexADE returned invalid review suggestions')
  return recordArray(record.suggestions).map((suggestion) => ({
    id: requiredPositiveInteger(suggestion.id, 'Review suggestion ID'),
    path: requiredString(suggestion.path, 'Review suggestion path', 4_000),
    line: requiredPositiveInteger(suggestion.line, 'Review suggestion line'),
    side: suggestion.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    description: stringValue(suggestion.description, 10_000),
    replacement: untrimmedStringValue(suggestion.replacement, 50_000),
    selected: suggestion.selected === true || suggestion.selected === 1,
    postedAt: stringValue(suggestion.posted_at, 100),
  }))
}

function mobileThreadFromJob(record: Record<string, unknown>, source: MobileThread): MobileThread {
  return {
    id: requiredPositiveInteger(record.id, 'Thread ID'),
    workItemId: optionalPositiveInteger(record.work_item_id) ?? source.workItemId,
    fullName: stringValue(record.full_name, 500) || source.fullName,
    status: requiredString(record.status, 'Thread status', 100),
    ...mobileThreadListFields(record, source.agentName),
    backendId: source.backendId,
    backendName: source.backendName,
    serviceUrl: source.serviceUrl,
  }
}

function transferTarget(record: Record<string, unknown>): MobileThreadTransferTarget {
  return {
    id: requiredPositiveInteger(record.id, 'Transfer target ID'),
    status: stringValue(record.status, 100),
    taskTitle: stringValue(record.task_title, 2_000),
    branchName: stringValue(record.branch_name, 1_000),
    workItemKey: requiredString(record.work_item_key, 'Transfer target Work key', 200),
    workItemTitle: stringValue(record.work_item_title, 2_000),
    fullName: requiredString(record.full_name, 'Transfer target repository', 500),
  }
}

function person(value: unknown): MobilePerson {
  const record = recordValue(value)
  return {
    login: stringValue(record.login, 500),
    name: stringValue(record.name, 500),
  }
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
    ...mobileThreadListFields(record, 'Agent'),
    backendId: item.backendId,
    backendName: item.backendName,
    serviceUrl: item.serviceUrl,
  }
}

function mobileThreadListFields(record: Record<string, unknown>, fallbackAgentName: string) {
  return {
    agentName: stringValue(record.agent_name, 200) || stringValue(record.agent_id, 200) || fallbackAgentName,
    taskTitle: stringValue(record.task_title, 2_000),
    latestActivity: stringValue(record.latest_activity, 4_000),
    activityAt: stringValue(record.activity_at ?? record.created_at, 100),
    branchName: stringValue(record.branch_name, 1_000),
    pullRequestNumber: optionalPositiveInteger(record.linked_pr_number) ?? optionalPositiveInteger(record.pr_number),
    pullRequestUrl: stringValue(record.linked_pr_url, 4_000),
    archived: Boolean(record.archived_at),
  }
}

function threadEvent(record: Record<string, unknown>, index: number): MobileThreadEvent {
  const data = recordValue(record.data)
  const summary = recordValue(data.diff_summary)
  return {
    id: stringValue(record.id, 200) || String(index),
    kind: stringValue(record.kind, 100),
    title: stringValue(record.title, 2_000),
    text: stringValue(record.text, 20_000),
    time: stringValue(record.time, 100),
    status: stringValue(record.status, 100),
    event: stringValue(data.event, 100),
    files: recordArray(summary.files).map(diffFile),
    additions: nonNegativeInteger(summary.additions),
    deletions: nonNegativeInteger(summary.deletions),
  }
}

function queuedFollowUp(record: Record<string, unknown>): MobileQueuedFollowUp {
  return {
    id: requiredPositiveInteger(record.id, 'Queued follow-up ID'),
    prompt: stringValue(record.prompt, 20_000),
    model: stringValue(record.model, 200),
    reasoningEffort: stringValue(record.reasoning_effort, 100),
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
      type: ['select', 'checkbox'].includes(String(record.type)) ? (String(record.type) as 'select' | 'checkbox') : 'text',
      required: record.required !== false,
      multiline: record.multiline !== false,
      description: stringValue(record.description, 1_000),
      formTitle: stringValue(record.formTitle, 200),
      formDescription: stringValue(record.formDescription, 2_000),
      options: recordArray(record.options).map((option) => ({
        label: requiredString(option.label, 'Input option label', 500),
        value: stringValue(option.value, 500) || requiredString(option.label, 'Input option label', 500),
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

function untrimmedStringValue(value: unknown, maximum: number): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, maximum) : ''
}

function stringList(value: unknown, maximumItems: number, maximumLength: number): string[] {
  return Array.isArray(value)
    ? value
        .slice(0, maximumItems)
        .map((item) => stringValue(item, maximumLength))
        .filter(Boolean)
    : []
}
