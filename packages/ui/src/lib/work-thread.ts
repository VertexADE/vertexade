import type { WorkItem } from './dashboard-types'

export type WorkThread = WorkItem['threads'][number]
export type WorkThreadCategory = 'work' | 'review'

const reviewKinds = new Set<WorkThread['kind']>(['review', 'work_review'])

export function workThreadCategory(thread: Pick<WorkThread, 'kind'>): WorkThreadCategory {
  return reviewKinds.has(thread.kind) ? 'review' : 'work'
}

export function splitWorkThreads(threads: WorkThread[]) {
  return threads.reduce<{ work: WorkThread[]; review: WorkThread[] }>(
    (groups, thread) => {
      groups[workThreadCategory(thread)].push(thread)
      return groups
    },
    { work: [], review: [] },
  )
}

export function workThreadAction(thread: Pick<WorkThread, 'kind' | 'status' | 'thread_id'>) {
  if (workThreadCategory(thread) === 'review') return 'Open review'
  if (thread.thread_id && !['starting', 'running'].includes(thread.status)) return 'Open & continue'
  return 'Open thread'
}
