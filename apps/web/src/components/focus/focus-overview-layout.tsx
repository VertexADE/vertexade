import { ListChecks, Plus } from 'lucide-react'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import type { Job, WorkBoardData, WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { NewWorkDialog } from '../work/work-board-components'
import { StartThreadDialog } from '../work/work-detail-panels'
import { FocusAgentDock } from './focus-agent-dock'
import { FocusDecisionList } from './focus-decision-list'
import { buildFocusTaskGroups } from './focus-task-model'
import { FocusTaskQueue } from './focus-task-queue'
import { FocusUpNext } from './focus-up-next'

export type FocusOverviewView = {
  activeCount: number
  activeAgents: number
  completingId: number | null
  decisions: WorkItem[]
  agentThreads: Job[]
  loading: boolean
  queuedItems: WorkItem[]
  savedOrder: number[]
}

export type FocusOverviewDialogs = {
  createOpen: boolean
  delegateItem: WorkItem | null
  workBoard: WorkBoardData
}

export type FocusOverviewActions = {
  onAgentChanged: () => void
  onArchive: (item: WorkItem) => void
  onComplete: (item: WorkItem) => void
  onCreateOpenChange: (open: boolean) => void
  onCreated: () => void
  onDelegate: (item: WorkItem | null) => void
  onDelete: (item: WorkItem) => void
  onDismiss: (item: WorkItem) => void
  onPriority: (item: WorkItem, priority: WorkItem['priority']) => void
  onResolve: (item: WorkItem) => void
  onSnooze: (item: WorkItem, until: string) => void
  onOrderChange: (order: number[]) => void
  onStarted: () => void
}

export function FocusOverviewLayout({
  view,
  dialogs,
  actions,
}: {
  view: FocusOverviewView
  dialogs: FocusOverviewDialogs
  actions: FocusOverviewActions
}) {
  return (
    <WorkspacePage className="min-h-[calc(100svh-3.25rem)] xl:px-5 xl:py-3">
      <div className="w-full">
        <FocusHeader
          activeCount={view.activeCount}
          activeAgents={view.activeAgents}
          decisions={view.decisions.length}
          onCreate={() => actions.onCreateOpenChange(true)}
        />
        <FocusDashboard view={view} actions={actions} />
      </div>
      <NewWorkDialog
        open={dialogs.createOpen}
        onOpenChange={actions.onCreateOpenChange}
        data={dialogs.workBoard}
        onCreated={actions.onCreated}
      />
      {dialogs.delegateItem && (
        <StartThreadDialog
          item={dialogs.delegateItem}
          open
          onOpenChange={(open) => {
            if (!open) actions.onDelegate(null)
          }}
          onStarted={actions.onStarted}
        />
      )}
    </WorkspacePage>
  )
}

function FocusHeader({
  activeCount,
  activeAgents,
  decisions,
  onCreate,
}: {
  activeCount: number
  activeAgents: number
  decisions: number
  onCreate: () => void
}) {
  return (
    <WorkspaceHeader
      className="mb-2 items-center pb-0 [&_[data-slot=page-actions]]:w-auto [&_[data-slot=page-header-content]]:xl:flex [&_[data-slot=page-header-content]]:xl:items-baseline [&_[data-slot=page-header-content]]:xl:gap-3 [&_[data-slot=page-title]]:text-lg [&_[data-slot=page-description]]:xl:mt-0"
      title="Focus"
      description={`${decisions} ${decisions === 1 ? 'decision' : 'decisions'} · ${activeAgents} agents working · ${activeCount} active outcomes`}
      actions={
        <Button size="sm" className="px-2 sm:h-7 sm:px-2.5 lg:hidden" aria-label="Create new work" onClick={onCreate}>
          <Plus />
          <span className="sm:hidden">New</span>
          <span className="hidden sm:inline">New work</span>
        </Button>
      }
    />
  )
}

function FocusDashboard({ view, actions }: { view: FocusOverviewView; actions: FocusOverviewActions }) {
  const readyItems = focusReadyItems(view.queuedItems, view.savedOrder)
  const showDesktopRail = shouldShowDesktopRail(readyItems, view.activeAgents)
  return (
    <div className={focusDashboardTopClass(showDesktopRail)}>
      <FocusPriorityQueue view={view} actions={actions} readyItems={readyItems} />
      <FocusDesktopRail
        show={showDesktopRail}
        items={readyItems}
        view={view}
        onDelegate={actions.onDelegate}
        onAgentChanged={actions.onAgentChanged}
      />
      <FocusAgentMobileArea view={view} onChanged={actions.onAgentChanged} />
    </div>
  )
}

function FocusPriorityQueue({
  view,
  actions,
  readyItems,
}: {
  view: FocusOverviewView
  actions: FocusOverviewActions
  readyItems: WorkItem[]
}) {
  const queueCount = view.decisions.length + view.queuedItems.length - readyItems.length
  return (
    <section
      aria-labelledby="focus-priority-queue"
      className="min-w-0 space-y-3 sm:space-y-0 sm:overflow-hidden sm:rounded-lg sm:border sm:border-border/55 sm:bg-card/68"
    >
      <header className="hidden items-center gap-2 border-b border-border/55 px-3 py-2 sm:flex">
        <ListChecks className="size-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 id="focus-priority-queue" className="text-sm font-semibold">
              Now
            </h2>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{queueCount}</span>
          </div>
          <p className="sr-only">Decisions first, followed by active and blocked outcomes.</p>
        </div>
      </header>
      <FocusDecisionList
        items={view.decisions}
        onDelegate={actions.onDelegate}
        onArchive={actions.onArchive}
        onDelete={actions.onDelete}
        onDismiss={actions.onDismiss}
        onPriority={actions.onPriority}
        onResolve={actions.onResolve}
        onSnooze={actions.onSnooze}
        embedded
      />
      <section aria-label="Daily task queue" className="min-h-0">
        <FocusTaskQueue
          items={view.queuedItems}
          savedOrder={view.savedOrder}
          readyInDesktopRail={readyItems.length > 0}
          embedded
          loading={view.loading}
          completingId={view.completingId}
          onOrderChange={actions.onOrderChange}
          onComplete={actions.onComplete}
          onDelegate={actions.onDelegate}
          onArchive={actions.onArchive}
          onDelete={actions.onDelete}
        />
      </section>
    </section>
  )
}

function FocusDesktopRail({
  show,
  items,
  view,
  onDelegate,
  onAgentChanged,
}: {
  show: boolean
  items: WorkItem[]
  view: FocusOverviewView
  onDelegate: (item: WorkItem | null) => void
  onAgentChanged: () => void
}) {
  if (!show) return null
  return (
    <aside className="hidden min-w-0 space-y-3 border-l border-border/65 pl-4 xl:block 2xl:pl-5">
      <FocusAgentArea view={view} onChanged={onAgentChanged} embedded />
      <FocusUpNext items={items} onDelegate={onDelegate} embedded />
    </aside>
  )
}

function FocusAgentArea({ view, onChanged, embedded = false }: { view: FocusOverviewView; onChanged: () => void; embedded?: boolean }) {
  if (!view.activeAgents) return null
  return (
    <section id="focus-agent-dock" aria-label="Agent steering" className="min-h-0 scroll-mt-20">
      <FocusAgentDock threads={view.agentThreads} loading={view.loading} onChanged={onChanged} embedded={embedded} />
    </section>
  )
}

function FocusAgentMobileArea({ view, onChanged }: { view: FocusOverviewView; onChanged: () => void }) {
  if (!view.activeAgents) return null
  return (
    <div className="xl:hidden">
      <FocusAgentArea view={view} onChanged={onChanged} />
    </div>
  )
}

function focusReadyItems(items: WorkItem[], savedOrder: number[]) {
  return buildFocusTaskGroups(items, savedOrder).find((group) => group.id === 'ready')?.items ?? []
}

function shouldShowDesktopRail(readyItems: WorkItem[], activeAgents: number) {
  return readyItems.length > 0 || activeAgents > 0
}

function focusDashboardTopClass(showDesktopRail: boolean) {
  if (!showDesktopRail) return 'grid min-w-0 gap-4'
  return 'grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] 2xl:gap-6'
}
