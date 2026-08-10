import { workStates, type WorkState } from './work-state.ts'

export const workKinds = ['implementation', 'pr_review', 'investigation', 'operational'] as const
export const workPriorities = ['low', 'normal', 'high', 'urgent'] as const

export type WorkKind = (typeof workKinds)[number]
export type WorkPriority = (typeof workPriorities)[number]

export type WorkResourceInput = {
  provider: string
  kind: string
  externalId: string
  role: string
  label: string
  url?: string | null
  repositoryId?: number | null
  state?: string | null
  metadata?: Record<string, unknown>
  primary?: boolean
}

export type CreateWorkItemInput = {
  title: string
  description?: string
  sequentialExecution?: boolean
  kind?: WorkKind
  state?: WorkState
  priority?: WorkPriority
  owner?: string | null
  repositoryId?: number | null
  source?: WorkResourceInput | null
}

export type CreateContextTransferInput = {
  workItemId: number
  sourceWorkItemId: number
  destinationWorkItemId: number
  sourceJobId: number
  destinationJobId: number
  instruction: string
  contextSnapshot: string
}

export type WorkNotifier = (reason: string, workItemId?: number | null) => void

export type WorkProviderResolution = {
  scm(repository: { id: number; full_name: string }): { id: string; repositoryUrl: string }
  deployment(): { id: string }
  runKindWorkKind?(kind: string): WorkKind | null
}

export const defaultProviders: WorkProviderResolution = {
  scm: (repository) => ({ id: 'scm', repositoryUrl: repository.full_name }),
  deployment: () => ({ id: 'deployment' }),
}

export function text(value: unknown, maximum: number, fallback = '') {
  return String(value ?? fallback)
    .trim()
    .slice(0, maximum)
}

function json(value: unknown) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

export function parsedJson<T>(value: unknown, fallback: T): T {
  if (value !== null && value !== undefined && typeof value !== 'string') return value as T
  try {
    return JSON.parse(String(value || '')) as T
  } catch {
    return fallback
  }
}

export function checkChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback
}

export function workKey(id: number) {
  return `W-${String(id).padStart(4, '0')}`
}

export function pullRequestState(pullRequest: any) {
  if (pullRequest.merged_at || pullRequest.mergedAt) return 'merged'
  if (pullRequest.closed_at || pullRequest.closedAt) return 'closed'
  if (pullRequest.review_decision === 'APPROVED' || pullRequest.reviewDecision === 'APPROVED') return 'approved'
  if (pullRequest.review_decision === 'CHANGES_REQUESTED' || pullRequest.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested'
  return pullRequest.draft ? 'draft' : 'open'
}

export function normalizedResource(input: WorkResourceInput) {
  const value = {
    provider: text(input.provider, 80),
    kind: text(input.kind, 80),
    externalId: text(input.externalId, 500),
    role: text(input.role, 80),
    label: text(input.label, 500),
    repositoryId: input.repositoryId || null,
    url: text(input.url, 2000) || null,
    state: text(input.state, 80) || null,
    metadata: input.metadata || {},
    primary: Boolean(input.primary),
  }
  if (!value.provider || !value.kind || !value.externalId || !value.role || !value.label) {
    throw new Error('Work resources require provider, kind, external ID, role, and label')
  }
  return value
}

export function resourceChanged(current: any, value: ReturnType<typeof normalizedResource>) {
  return (
    !current ||
    current.repository_id !== value.repositoryId ||
    current.label !== value.label ||
    current.url !== value.url ||
    current.state !== value.state ||
    json(current.metadata) !== json(value.metadata)
  )
}

export function deploymentState(run: any, productionEnvironment = 'prd') {
  const production = run.stages?.[productionEnvironment]
  if (production?.conclusion === 'success') return 'deployed'
  if (production?.conclusion === 'failure' || run.conclusion === 'failure') return 'failed'
  return production?.status || run.status || 'waiting'
}
