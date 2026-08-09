import { useMemo } from 'react'
import type { DashboardData, Job, PullRequest, Repository } from '@vertexade/ui/lib/dashboard-types'
import { useRxDashboardCollection } from './rxdb-dashboard-cache'

type DashboardMeta = Omit<DashboardData, 'repositories' | 'prs' | 'agentThreads'>

const emptyDashboardMeta: DashboardMeta = {
  presets: [],
  highlights: [],
  service_colors: [],
  pr_tasks: [],
  cleanup_worktrees: [],
  modules: [],
  presentation: {
    defaultAgent: { id: '', name: 'Agent' },
    scm: {
      id: '',
      name: 'Source control',
      changeRequestLabel: 'change request',
      changeRequestLabelPlural: 'change requests',
    },
  },
}

export function useDashboardMeta() {
  const result = useRxDashboardCollection<DashboardMeta>('dashboardMeta', [emptyDashboardMeta])
  return { ...result, value: result.values[0] || emptyDashboardMeta }
}

export function useDashboardCache() {
  const repositories = useRxDashboardCollection<Repository>('repositories')
  const pullRequests = useRxDashboardCollection<PullRequest>('pullRequests')
  const agentThreads = useRxDashboardCollection<Job>('agentThreads')
  const meta = useDashboardMeta()
  const data = useMemo<DashboardData>(
    () => ({
      ...meta.value,
      repositories: repositories.values,
      prs: pullRequests.values,
      agentThreads: agentThreads.values,
    }),
    [agentThreads.values, meta.value, pullRequests.values, repositories.values],
  )
  return {
    data,
    ready: repositories.ready && pullRequests.ready && agentThreads.ready && meta.ready,
    connected: repositories.connected && pullRequests.connected && agentThreads.connected && meta.connected,
    refresh: repositories.refresh,
  }
}
