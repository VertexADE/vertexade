import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

export type FocusItemDisplay = {
  title: string
  reference: string | null
  repository: string | null
}

export function focusItemDisplay(item: WorkItem): FocusItemDisplay {
  const pullRequest = pullRequestTitle(item.title) ?? { title: item.title, reference: null }
  const repository = item.primary_repository_name ?? item.repository_names[0]
  return {
    title: pullRequest.title,
    reference: pullRequest.reference,
    repository: shortRepository(repository),
  }
}

export function focusItemPullRequest(item: WorkItem) {
  const resource = item.resources.find((candidate) => candidate.kind === 'pull_request' && candidate.role !== 'context')
  const number = resource?.metadata.number
  if (!resource?.repository_id || typeof number !== 'number') return null
  return { repositoryId: resource.repository_id, number }
}

export function focusItemActiveJob(item: WorkItem) {
  const latest = [...item.threads].sort(
    (left, right) => Date.parse(right.activity_at || right.created_at) - Date.parse(left.activity_at || left.created_at),
  )[0]
  return latest && ['starting', 'running', 'waiting'].includes(latest.status) ? latest : null
}

function pullRequestTitle(title: string) {
  const match = title.match(/^(?:Review|Work on) PR #(\d+):\s*(.+)$/i)
  return match ? { title: match[2], reference: `PR #${match[1]}` } : null
}

function shortRepository(repository: string | null | undefined) {
  return repository?.split('/').at(-1) || null
}

export const focusStateLabel: Record<WorkItem['state'], string> = {
  backlog: 'Up next',
  active: 'In progress',
  review: 'In review',
  deploy: 'Ready to deploy',
  done: 'Done',
}

export const focusPriorityTone: Record<WorkItem['priority'], string> = {
  urgent: 'border-red-500/35 bg-red-500/10 text-red-300',
  high: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  normal: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  low: 'border-emerald-500/25 bg-emerald-500/[.07] text-emerald-300',
}

export const focusPriorityLabel: Record<WorkItem['priority'], string> = {
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
}
