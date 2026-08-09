import { agentIsWorking, agentThreadState } from './agent-thread-state'
import type { Job } from './dashboard-types'
import { sortThreadsByRecency } from './thread-recency'

export type ThreadSort = 'priority' | 'recent' | 'oldest'
export type ThreadPriority = 'input' | 'action' | 'active' | 'queued' | 'history'
export type ThreadSectionId = ThreadPriority | 'all'

export type ThreadSection<T extends Job = Job> = {
  id: ThreadSectionId
  label: string
  description: string
  threads: T[]
}

export type ThreadPriorityStats = Record<ThreadPriority, number> & {
  attention: number
  completed: number
}

const priorityOrder: ThreadPriority[] = ['input', 'action', 'active', 'queued', 'history']

const prioritySections: Record<ThreadPriority, Omit<ThreadSection, 'threads'>> = {
  input: {
    id: 'input',
    label: 'Needs your input',
    description: 'Answer these threads to unblock the next step.',
  },
  action: {
    id: 'action',
    label: 'Action required',
    description: 'Recover failed or interrupted work.',
  },
  active: {
    id: 'active',
    label: 'In progress',
    description: 'Agents working right now.',
  },
  queued: {
    id: 'queued',
    label: 'Queued next',
    description: 'Instructions waiting for their turn.',
  },
  history: {
    id: 'history',
    label: 'Recent history',
    description: 'Completed and inactive threads.',
  },
}

export function threadPriority(thread: Job): ThreadPriority {
  const state = agentThreadState(thread)
  if (state === 'waiting') return 'input'
  if (['failed', 'resumable', 'interrupted'].includes(state)) return 'action'
  if (agentIsWorking(state)) return 'active'
  if (thread.status === 'queued' || Number(thread.queued_follow_up_count) > 0) return 'queued'
  return 'history'
}

export function sortThreads<T extends Job>(threads: T[], sort: ThreadSort): T[] {
  if (sort !== 'priority') return sortThreadsByRecency(threads, sort)
  return sortThreadsByRecency(threads, 'recent').sort(
    (left, right) => priorityOrder.indexOf(threadPriority(left)) - priorityOrder.indexOf(threadPriority(right)),
  )
}

export function buildThreadSections<T extends Job>(threads: T[], sort: ThreadSort): ThreadSection<T>[] {
  if (sort !== 'priority') {
    return [
      {
        id: 'all',
        label: sort === 'recent' ? 'Most recent' : 'Oldest first',
        description: sort === 'recent' ? 'All matching threads by latest activity.' : 'All matching threads by earliest activity.',
        threads: sortThreads(threads, sort),
      },
    ]
  }

  const sorted = sortThreads(threads, sort)
  return priorityOrder
    .map((priority) => ({
      ...prioritySections[priority],
      threads: sorted.filter((thread) => threadPriority(thread) === priority),
    }))
    .filter((section) => section.threads.length > 0)
}

export function shouldCollapseThreadHistory(threads: Job[], completedView: boolean) {
  return !completedView && threads.some((thread) => threadPriority(thread) !== 'history')
}

export function threadPriorityStats(threads: Job[]): ThreadPriorityStats {
  const stats: ThreadPriorityStats = {
    input: 0,
    action: 0,
    active: 0,
    queued: 0,
    history: 0,
    attention: 0,
    completed: 0,
  }

  for (const thread of threads) {
    const priority = threadPriority(thread)
    stats[priority] += 1
    if (priority === 'history' && thread.status === 'completed') stats.completed += 1
  }
  stats.attention = stats.input + stats.action
  return stats
}
