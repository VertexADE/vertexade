import { dateValue } from './dashboard-api'
import type { WorkItem } from './dashboard-types'

export type WorkItemSort =
  | 'recent'
  | 'oldest'
  | 'priority-high'
  | 'priority-low'
  | 'created-newest'
  | 'created-oldest'
  | 'title-asc'
  | 'title-desc'
  | 'status'

type SortableWorkItem = Pick<
  WorkItem,
  'id' | 'title' | 'priority' | 'state' | 'created_at' | 'updated_at' | 'threads' | 'events' | 'context_transfers'
>

const priorityRank: Record<WorkItem['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const stateRank: Record<WorkItem['state'], number> = {
  backlog: 0,
  active: 1,
  review: 2,
  deploy: 3,
  done: 4,
}
const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function validTime(value: string | null | undefined) {
  return dateValue(value)?.getTime() ?? 0
}

export function workItemActivityAt(item: SortableWorkItem) {
  const candidates = [
    item.created_at,
    item.updated_at,
    ...item.threads.flatMap((job) => [job.created_at, job.activity_at, job.finished_at]),
    ...item.events.map((event) => event.created_at),
    ...item.context_transfers.flatMap((transfer) => [transfer.created_at, transfer.started_at, transfer.finished_at]),
  ]

  return candidates.reduce<string>(
    (latest, candidate) => (validTime(candidate) > validTime(latest) ? candidate || latest : latest),
    item.created_at,
  )
}

function compareRecent(left: SortableWorkItem, right: SortableWorkItem) {
  return validTime(workItemActivityAt(right)) - validTime(workItemActivityAt(left)) || right.id - left.id
}

function compareWorkItems(left: SortableWorkItem, right: SortableWorkItem, sort: WorkItemSort) {
  if (sort === 'recent') return compareRecent(left, right)
  if (sort === 'oldest') return -compareRecent(left, right)
  if (sort === 'priority-high') return priorityRank[left.priority] - priorityRank[right.priority] || compareRecent(left, right)
  if (sort === 'priority-low') return priorityRank[right.priority] - priorityRank[left.priority] || compareRecent(left, right)
  if (sort === 'created-newest') return validTime(right.created_at) - validTime(left.created_at) || right.id - left.id
  if (sort === 'created-oldest') return validTime(left.created_at) - validTime(right.created_at) || left.id - right.id
  if (sort === 'title-asc') return titleCollator.compare(left.title, right.title) || left.id - right.id
  if (sort === 'title-desc') return titleCollator.compare(right.title, left.title) || right.id - left.id
  return stateRank[left.state] - stateRank[right.state] || compareRecent(left, right)
}

export function sortWorkItems<T extends SortableWorkItem>(items: T[], sort: WorkItemSort) {
  return [...items].sort((left, right) => compareWorkItems(left, right, sort))
}
