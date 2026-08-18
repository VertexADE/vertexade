import { describe, expect, it } from 'vite-plus/test'
import { dashboardEventSyncLane } from './rxdb-dashboard-cache'

describe('dashboard event synchronization', () => {
  it('refreshes lifecycle changes immediately', () => {
    expect(dashboardEventSyncLane('job_running')).toBe('immediate')
    expect(dashboardEventSyncLane('job_finished')).toBe('immediate')
    expect(dashboardEventSyncLane('thread_settled')).toBe('immediate')
  })

  it('batches summary changes without dropping them', () => {
    expect(dashboardEventSyncLane('agent_message')).toBe('summary')
    expect(dashboardEventSyncLane('diff')).toBe('summary')
  })

  it('ignores detail-only event streams in the overview cache', () => {
    expect(dashboardEventSyncLane('action_updated')).toBeNull()
    expect(dashboardEventSyncLane('thread_context_updated')).toBeNull()
  })
})
