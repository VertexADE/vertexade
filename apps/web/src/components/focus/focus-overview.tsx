import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { agentThreadState } from '@vertexade/ui/lib/agent-thread-state'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Repository, WorkBoardData, WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { displayBackendKey } from '@vertexade/ui/lib/backend-registry'
import { useDashboardCache } from '../../lib/dashboard-cache'
import { useRxDashboardCollection } from '../../lib/rxdb-dashboard-cache'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { FocusOverviewLayout } from './focus-overview-layout'
import { orderFocusTasks } from './focus-task-model'
import { workCompletionBlocker } from '../../lib/work-completion'
import { DeleteWorkDialog } from '../work/work-delete-dialog'

export function FocusOverview() {
  const workItems = useRxDashboardCollection<WorkItem>('workItems')
  const repositories = useRxDashboardCollection<Repository>('repositories')
  const dashboard = useDashboardCache()
  const preferences = useUiPreferences()
  const [createOpen, setCreateOpen] = useState(false)
  const [delegateItem, setDelegateItem] = useState<WorkItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<WorkItem | null>(null)
  const completion = useFocusCompletion(() => void workItems.refresh())
  const inbox = useReactiveApi<{ items: Array<{ id: string; triageState: string }> }>({
    key: 'inbox',
    load: () => api('/api/inbox'),
  })

  const items = useMemo(() => workItems.values.filter((item) => !item.archived_at), [workItems.values])
  const activeItems = useMemo(() => items.filter((item) => item.state !== 'done'), [items])
  const decisions = useMemo(
    () =>
      orderFocusTasks(
        activeItems.filter(
          (item) =>
            Boolean(item.attention) &&
            (inbox.data?.items.find((entry) => entry.id === `work:${item.key}`)?.triageState || 'open') === 'open',
        ),
        preferences.value.focusOrder,
      ),
    [activeItems, inbox.data?.items, preferences.value.focusOrder],
  )
  const queuedItems = useMemo(() => activeItems.filter((item) => !item.attention), [activeItems])
  const activeAgents = useMemo(
    () =>
      dashboard.data.agentThreads.filter((job) => !job.archived_at && ['starting', 'running', 'waiting'].includes(agentThreadState(job)))
        .length,
    [dashboard.data.agentThreads],
  )
  const data = useMemo<WorkBoardData>(
    () => ({
      items,
      repositories: repositories.values,
    }),
    [items, repositories.values],
  )

  function saveOrder(focusOrder: number[]) {
    void preferences.update({ focusOrder }).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
  }

  const loading = !workItems.ready || !repositories.ready || !dashboard.ready

  return (
    <>
      <FocusOverviewLayout
        view={{
          activeCount: activeItems.length,
          activeAgents,
          completingId: completion.completingId,
          decisions,
          agentThreads: dashboard.data.agentThreads,
          loading,
          queuedItems,
          savedOrder: preferences.value.focusOrder,
        }}
        dialogs={{ createOpen, delegateItem, workBoard: data }}
        actions={{
          onAgentChanged: () => void dashboard.refresh(),
          onArchive: (item) => {
            void api(`/api/work-items/${item.id}/archive`, { method: 'POST' })
              .then(() => {
                toast.success(`${displayBackendKey(item, item.key)} archived`)
                void workItems.refresh()
              })
              .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
          },
          onComplete: (item) => void completion.complete(item),
          onCreateOpenChange: setCreateOpen,
          onCreated: () => void workItems.refresh(),
          onDelegate: setDelegateItem,
          onDelete: setDeleteItem,
          onDismiss: (item) => void updateDecisionTriage(item, 'done', null, inbox.refresh),
          onPriority: (item, priority) => {
            void api(`/api/work-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ priority }) })
              .then(() => {
                toast.success(`${displayBackendKey(item, item.key)} priority set to ${priority}`)
                void workItems.refresh()
              })
              .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
          },
          onResolve: (item) => {
            void api(`/api/work-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ resolve_attention: true }) })
              .then(() => {
                toast.success(`${displayBackendKey(item, item.key)} decision resolved`)
                void Promise.all([workItems.refresh(), inbox.refresh()])
              })
              .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
          },
          onSnooze: (item, until) => void updateDecisionTriage(item, 'snoozed', until, inbox.refresh),
          onOrderChange: saveOrder,
          onStarted: () => {
            setDelegateItem(null)
            void Promise.all([workItems.refresh(), dashboard.refresh()])
          },
        }}
      />
      {deleteItem && (
        <DeleteWorkDialog
          item={deleteItem}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteItem(null)
          }}
          onDeleted={() => void workItems.refresh()}
          onRetry={() => void workItems.refresh()}
        />
      )}
    </>
  )
}

async function updateDecisionTriage(
  item: WorkItem,
  state: 'done' | 'snoozed',
  snoozedUntil: string | null,
  refresh: () => Promise<unknown>,
) {
  try {
    await api(`/api/inbox/${encodeURIComponent(`work:${item.key}`)}`, {
      method: 'PATCH',
      body: JSON.stringify({ state, snoozedUntil }),
    })
    toast.success(state === 'done' ? 'Decision dismissed' : `Decision snoozed until ${new Date(snoozedUntil || '').toLocaleString()}`)
    await refresh()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

function useFocusCompletion(onCompleted: () => void) {
  const [completingId, setCompletingId] = useState<number | null>(null)
  async function complete(item: WorkItem) {
    const blocker = workCompletionBlocker(item)
    if (blocker) {
      toast.info(blocker)
      return
    }
    setCompletingId(item.id)
    try {
      await api<WorkItem>(`/api/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'done', reason: 'Completed from the Focus task queue' }),
      })
      toast.success(`${displayBackendKey(item, item.key)} marked complete`)
      onCompleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCompletingId(null)
    }
  }
  return { completingId, complete }
}
