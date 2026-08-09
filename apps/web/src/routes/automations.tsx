import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Activity, ClipboardCheck, History, Sparkles } from 'lucide-react'
import { ExtensionAutomations, type AutomationView } from '@vertexade/ui/components/automation-recipes'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { automationView } from '../lib/automation-navigation'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

type ActivityView = 'all' | 'approvals' | 'history'

export const Route = createFileRoute('/automations')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: automationView(search.tab),
    activity:
      search.activity === 'history'
        ? ('history' as const)
        : search.activity === 'approvals'
          ? ('approvals' as const)
          : search.activity === 'all'
            ? ('all' as const)
            : undefined,
  }),
  component: AutomationsPage,
})

function AutomationRunFilters({ value, onChange }: { value: ActivityView; onChange(value: ActivityView): void }) {
  return (
    <SegmentedControl className="mb-3" aria-label="Automation run filters">
      <SegmentedControlItem active={value === 'all'} size="sm" onClick={() => onChange('all')}>
        <Activity />
        All runs
      </SegmentedControlItem>
      <SegmentedControlItem active={value === 'approvals'} size="sm" onClick={() => onChange('approvals')}>
        <ClipboardCheck />
        Needs approval
      </SegmentedControlItem>
      <SegmentedControlItem active={value === 'history'} size="sm" onClick={() => onChange('history')}>
        <History />
        History
      </SegmentedControlItem>
    </SegmentedControl>
  )
}

function AutomationsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/automations' })
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const activeView = search.tab || 'builder'
  const activityView: ActivityView = search.activity || 'all'
  const changeView = (tab: AutomationView) =>
    void navigate({
      search: { tab, activity: tab === 'runs' ? search.activity : undefined },
      replace: true,
      resetScroll: false,
    })
  const changeActivity = (activity: ActivityView) =>
    void navigate({
      search: { tab: 'runs', activity: activity === 'all' ? undefined : activity },
      replace: true,
      resetScroll: false,
    })
  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={
          <>
            <Sparkles className="size-3" />
            Repeatable workflows
          </>
        }
        title="Automations"
        description="Build workflows that run manually, on a schedule, or from an event—then monitor every run in one place."
      />

      {activeView === 'runs' && <AutomationRunFilters value={activityView} onChange={changeActivity} />}
      <ExtensionAutomations
        view={activeView}
        onViewChange={changeView}
        embedded
        repositories={repositories}
        runFilter={activityView === 'approvals' ? 'approval' : activityView === 'history' ? 'history' : undefined}
      />
    </WorkspacePage>
  )
}
