import { describe, expect, it } from 'vite-plus/test'
import { hideThreadId, reconcileHiddenThreadIds, restoreThreadId } from './thread-deletion-state'

describe('optimistic thread deletion state', () => {
  it('hides a run immediately without mutating the previous state', () => {
    const current = new Set([1])
    const next = hideThreadId(current, 2)

    expect([...next]).toEqual([1, 2])
    expect([...current]).toEqual([1])
  })

  it('restores a hidden run after a failed deletion', () => {
    expect([...restoreThreadId(new Set([1, 2]), 2)]).toEqual([1])
  })

  it('drops hidden ids after refreshed API data confirms deletion', () => {
    expect([...reconcileHiddenThreadIds(new Set([1, 2]), [{ id: 1 }, { id: 3 }])]).toEqual([1])
  })
})
