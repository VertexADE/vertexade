import { dateValue } from './dashboard-api'
import type { Job } from './dashboard-types'

export type ThreadRecencySort = 'recent' | 'oldest'

type ThreadRecency = Pick<Job, 'id' | 'activity_at' | 'created_at'>

function threadActivityTime(thread: ThreadRecency) {
  return dateValue(thread.activity_at)?.getTime() ?? dateValue(thread.created_at)?.getTime() ?? 0
}

export function sortThreadsByRecency<T extends ThreadRecency>(threads: T[], sort: ThreadRecencySort) {
  const direction = sort === 'recent' ? -1 : 1
  return [...threads].sort((left, right) => {
    const timeDifference = threadActivityTime(left) - threadActivityTime(right)
    return direction * (timeDifference || left.id - right.id)
  })
}
