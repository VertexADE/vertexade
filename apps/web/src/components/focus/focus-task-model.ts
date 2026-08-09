import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { dateValue } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { workItemActivityAt } from '@vertexade/ui/lib/work-sort'

export type FocusTaskSection = 'now' | 'ready' | 'blocked'

export type FocusTaskGroup = {
  id: FocusTaskSection
  label: string
  description: string
  items: WorkItem[]
}

const taskSections: Array<Omit<FocusTaskGroup, 'items'>> = [
  { id: 'now', label: 'Active work', description: 'Active outcomes ordered by priority and recent movement' },
  { id: 'ready', label: 'Up next', description: 'Backlog outcomes ready to start when capacity opens' },
  {
    id: 'blocked',
    label: 'Blocked',
    description: 'Waiting for input, recovery, or another outcome',
  },
]

const priorityRank: Record<WorkItem['priority'], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

function timestamp(value: string | null | undefined) {
  return dateValue(value)?.getTime() ?? 0
}

function hasBlockingRelation(item: WorkItem) {
  return item.relations.some((relation) => relation.relation === 'blocked_by' && relation.state !== 'done')
}

function hasBlockedRun(item: WorkItem) {
  return item.threads.some((job) => ['waiting', 'failed'].includes(agentThreadState(job)))
}

export function focusTaskSection(item: WorkItem): FocusTaskSection | null {
  if (item.archived_at || item.state === 'done') return null
  if (hasBlockingRelation(item) || hasBlockedRun(item)) return 'blocked'
  if (item.state === 'backlog') return 'ready'
  return 'now'
}

function compareFocusTasks(left: WorkItem, right: WorkItem) {
  return (
    priorityRank[left.priority] - priorityRank[right.priority] ||
    Number(Boolean(right.attention)) - Number(Boolean(left.attention)) ||
    timestamp(workItemActivityAt(right)) - timestamp(workItemActivityAt(left)) ||
    right.id - left.id
  )
}

export function orderFocusTasks(items: WorkItem[], savedOrder: number[] = []) {
  const positions = new Map(savedOrder.map((id, index) => [id, index]))
  return [...items].sort((left, right) => {
    const leftPosition = positions.get(left.id)
    const rightPosition = positions.get(right.id)
    if (leftPosition !== undefined && rightPosition !== undefined) return leftPosition - rightPosition
    if (leftPosition !== undefined) return -1
    if (rightPosition !== undefined) return 1
    return compareFocusTasks(left, right)
  })
}

export function buildFocusTaskGroups(items: WorkItem[], savedOrder: number[] = []): FocusTaskGroup[] {
  return taskSections.map((section) => ({
    ...section,
    items: orderFocusTasks(
      items.filter((item) => focusTaskSection(item) === section.id),
      savedOrder,
    ),
  }))
}

export function reorderFocusTasks(items: WorkItem[], savedOrder: number[], activeId: number, overId: number) {
  const active = items.find((item) => item.id === activeId)
  const over = items.find((item) => item.id === overId)
  const section = active ? focusTaskSection(active) : null
  if (!active || !over || !section || focusTaskSection(over) !== section) return savedOrder

  const sectionIds = orderFocusTasks(
    items.filter((item) => focusTaskSection(item) === section),
    savedOrder,
  ).map((item) => item.id)
  const from = sectionIds.indexOf(activeId)
  const to = sectionIds.indexOf(overId)
  if (from < 0 || to < 0 || from === to) return savedOrder

  const nextSectionIds = [...sectionIds]
  nextSectionIds.splice(to, 0, nextSectionIds.splice(from, 1)[0])
  const sectionIdSet = new Set(sectionIds)
  return [...savedOrder.filter((id) => !sectionIdSet.has(id)), ...nextSectionIds]
}

export type AcceptanceCheck = {
  label: string
  complete: boolean
}

export function acceptanceChecks(description: string): AcceptanceCheck[] {
  return description
    .split('\n')
    .map((line) => line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ complete: match[1].toLowerCase() === 'x', label: match[2] }))
}

export function workSourceLabels(item: WorkItem) {
  const labels = item.resources
    .filter((resource) => !['git', 'local'].includes(resource.provider))
    .map((resource) => {
      if (resource.provider === 'azure-devops') return 'Azure Boards'
      if (resource.provider === 'github') return resource.kind === 'pull_request' ? 'GitHub PR' : 'GitHub'
      return resource.provider
        .split(/[-_]/)
        .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
        .join(' ')
    })
  return [...new Set(labels)].slice(0, 2)
}

export function focusTaskBlocker(item: WorkItem) {
  if (item.attention) return item.attention
  const waiting = item.threads.find((job) => agentThreadState(job) === 'waiting')
  if (waiting) return 'Agent is waiting for your input'
  const failed = item.threads.find((job) => agentThreadState(job) === 'failed')
  if (failed) return failed.latest_activity || 'Latest agent thread failed'
  const relation = item.relations.find((candidate) => candidate.relation === 'blocked_by' && candidate.state !== 'done')
  return relation ? `Blocked by ${relation.key} · ${relation.title}` : null
}
