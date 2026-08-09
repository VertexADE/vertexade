import type { Job } from '@vertexade/ui/lib/dashboard-types'

export function hideThreadId(current: Set<number>, id: number) {
  if (current.has(id)) return current
  return new Set(current).add(id)
}

export function restoreThreadId(current: Set<number>, id: number) {
  if (!current.has(id)) return current
  const next = new Set(current)
  next.delete(id)
  return next
}

export function reconcileHiddenThreadIds(current: Set<number>, threads: Pick<Job, 'id'>[]) {
  const availableIds = new Set(threads.map((thread) => thread.id))
  const next = new Set([...current].filter((id) => availableIds.has(id)))
  return next.size === current.size ? current : next
}
