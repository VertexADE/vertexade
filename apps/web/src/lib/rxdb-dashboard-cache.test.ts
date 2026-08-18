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

  it('batches detail event streams so deferred changes still reach the overview cache', () => {
    expect(dashboardEventSyncLane('action_updated')).toBe('summary')
    expect(dashboardEventSyncLane('thread_context_updated')).toBe('summary')
  })
})
