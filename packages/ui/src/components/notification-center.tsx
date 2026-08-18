import { useEffect, useState } from 'react'
import type { ModuleCatalog, NotificationContribution } from '@vertexade/platform-contracts'
import { Link } from '@tanstack/react-router'
import { Bell, CheckCircle2, Clock3, ExternalLink, Trash2, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, IconButton } from '@vertexade/ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import {
  api,
  age,
  backendApi,
  federationFailureMessage,
  isModuleCatalogEvent,
  isNotificationEvent,
  type FederatedResult,
} from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry } from '@vertexade/ui/lib/backend-registry'
import type { Notification } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

type NotificationList = { notifications: Notification[]; unread_count: number }
type NotificationPresentation = NotificationContribution & { moduleId: string; moduleName: string }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function notificationCount(count: number) {
  return `${count} notification${count === 1 ? '' : 's'}`
}

function ApprovalNotificationLinks({ jobId }: { jobId: number | null }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      <Link
        to="/automations"
        search={{ tab: 'runs', activity: 'approvals' }}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Review plan <ExternalLink className="size-3" />
      </Link>
      {jobId && (
        <Link to="/threads" search={{ thread: jobId }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Open thread <ExternalLink className="size-3" />
        </Link>
      )}
    </span>
  )
}

function NotificationLinks({ item, presentation }: { item: Notification; presentation?: NotificationPresentation }) {
  if (item.kind === 'automation_approval_required') return <ApprovalNotificationLinks jobId={item.job_id} />
  if (!item.work_item_key && !item.job_id && !presentation?.to) return null
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {item.work_item_key && (
        <Link
          to="/work/$workKey"
          params={{ workKey: item.work_item_key }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open Work <ExternalLink className="size-3" />
        </Link>
      )}
      {!item.work_item_key && item.job_id && (
        <Link
          to="/threads"
          search={{ thread: item.job_id }}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Open thread <ExternalLink className="size-3" />
        </Link>
      )}
      {presentation?.to && (
        <a href={presentation.to} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          {presentation.actionLabel || `Open ${presentation.moduleName}`} <ExternalLink className="size-3" />
        </a>
      )}
    </span>
  )
}

function presentationMap(catalogs: Array<{ backendId: string; isDefault: boolean; catalog: ModuleCatalog }>) {
  return Object.fromEntries(
    catalogs.flatMap(({ backendId, isDefault, catalog }) =>
      catalog.modules
        .filter((module) => module.enabled && module.lifecycle !== 'failed')
        .flatMap((module) =>
          (module.ui?.notifications || []).flatMap((notification) => {
            const presentation = {
              ...notification,
              to:
                notification.to?.startsWith(`/extensions/${module.id}`) && !notification.to.includes('server=')
                  ? `${notification.to}${notification.to.includes('?') ? '&' : '?'}server=${encodeURIComponent(backendId)}`
                  : notification.to,
              moduleId: module.id,
              moduleName: module.name,
            }
            return [[`${backendId}:${notification.kind}`, presentation], ...(isDefault ? [[notification.kind, presentation]] : [])]
          }),
        ),
    ),
  )
}

async function loadNotificationCenter() {
  const [value, registry] = await Promise.all([api<NotificationList>('/api/notifications'), loadBackendRegistry()])
  const outcomes = await Promise.allSettled(
    registry.backends.map(async (backend) => ({
      backendId: backend.id,
      isDefault: backend.isDefault,
      catalog: await backendApi<ModuleCatalog>(backend.id, '/api/modules'),
    })),
  )
  return {
    value,
    catalogs: outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : [])),
  }
}

function notificationAppearance(item: Notification, presentation?: NotificationPresentation) {
  const severity =
    presentation?.severity || (item.kind.endsWith('failed') ? 'error' : item.kind.startsWith('schedule') ? 'info' : 'success')
  if (severity === 'error') return { Icon: TriangleAlert, tone: 'text-red-400' }
  if (severity === 'warning') return { Icon: TriangleAlert, tone: 'text-amber-400' }
  if (severity === 'info') return { Icon: Clock3, tone: 'text-blue-400' }
  return { Icon: CheckCircle2, tone: 'text-emerald-400' }
}

export function NotificationCenter() {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [presentations, setPresentations] = useState<Record<string, NotificationPresentation>>({})
  const [confirmingPrune, setConfirmingPrune] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [dismissingId, setDismissingId] = useState<number | null>(null)
  const notifications = useReactiveApi({
    key: 'notifications-with-presentations',
    load: loadNotificationCenter,
    accepts: (event) => isNotificationEvent(event) || isModuleCatalogEvent(event),
  })

  useEffect(() => {
    if (!notifications.data) return
    const { value, catalogs } = notifications.data
    setItems(value.notifications)
    setUnread(value.unread_count)
    setPresentations(presentationMap(catalogs))
  }, [notifications.data])

  async function markAllRead() {
    setUnread(0)
    try {
      const result = await api<FederatedResult>('/api/notifications/read', { method: 'POST', body: '{}' })
      const warning = federationFailureMessage(result, 'Mark read')
      if (warning) {
        await notifications.refresh()
        toast.warning(warning)
      }
    } catch (error) {
      await notifications.refresh()
      toast.error(errorMessage(error, 'Could not mark notifications as read'))
    }
  }

  function changeOpen(value: boolean) {
    setOpen(value)
    if (!value) setConfirmingPrune(false)
  }

  async function dismiss(item: Notification) {
    if (dismissingId !== null || pruning) return
    setDismissingId(item.id)
    try {
      await api(`/api/notifications/${item.id}`, { method: 'DELETE' })
      setItems((current) => current.filter(({ id }) => id !== item.id))
      setUnread((current) => Math.max(0, current - Number(!item.read_at)))
      void notifications.refresh()
      toast.success('Notification dismissed')
    } catch (error) {
      toast.error(errorMessage(error, 'Could not dismiss notification'))
    } finally {
      setDismissingId(null)
    }
  }

  async function prune() {
    setPruning(true)
    try {
      const result = await api<{ pruned: number } & FederatedResult>('/api/notifications', { method: 'DELETE' })
      setItems([])
      setUnread(0)
      setConfirmingPrune(false)
      const warning = federationFailureMessage(result, 'Pruning')
      if (warning) {
        await notifications.refresh()
        toast.warning(warning)
      } else toast.success(`Pruned ${notificationCount(result.pruned)}`)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not prune notifications'))
    } finally {
      setPruning(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          className="relative shrink-0"
          label={unread ? `${unread} unread notifications` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute right-0 top-0 size-2 rounded-full bg-red-400 ring-2 ring-background" aria-hidden="true" />
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(26rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <strong className="text-sm">Notifications</strong>
            <p className="text-xs text-muted-foreground">Recent Work and automation events</p>
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button type="button" variant="ghost" size="xs" onClick={() => void markAllRead()}>
                Mark read
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!items.length || pruning || dismissingId !== null}
              onClick={() => setConfirmingPrune(true)}
            >
              <Trash2 />
              Clear
            </Button>
          </div>
        </div>
        {confirmingPrune && (
          <div className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-3 py-2" role="alert">
            <p className="text-xs text-muted-foreground">Remove all {items.length} notifications? This cannot be undone.</p>
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="xs" disabled={pruning} onClick={() => setConfirmingPrune(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" size="xs" loading={pruning} loadingText="Pruning…" onClick={() => void prune()}>
                <Trash2 />
                Prune all
              </Button>
            </div>
          </div>
        )}
        <div className="max-h-[min(32rem,70dvh)] overflow-y-auto">
          {items.slice(0, 8).map((item) => {
            const presentation = item.backend_id ? presentations[`${item.backend_id}:${item.kind}`] : presentations[item.kind]
            const { Icon, tone } = notificationAppearance(item, presentation)
            return (
              <article key={item.id} className={cn('group border-b p-3 last:border-0', !item.read_at && 'bg-blue-500/5')}>
                <div className="flex items-start gap-2">
                  <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <strong className="text-xs">{item.title}</strong>
                        {presentation && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{presentation.moduleName}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">{age(item.created_at)}</span>
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="-mr-1 -mt-1 text-muted-foreground hover:text-foreground"
                          disabled={dismissingId !== null || pruning}
                          label={`Dismiss ${item.title}`}
                          loading={dismissingId === item.id}
                          onClick={() => void dismiss(item)}
                        >
                          <X />
                        </IconButton>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                    <NotificationLinks item={item} presentation={presentation} />
                    {item.automation_recipe_id && (
                      <Link
                        to="/automations"
                        search={{ tab: 'recipes', activity: undefined }}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open automation <ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
          {!items.length && <p className="p-10 text-center text-xs text-muted-foreground">No notifications yet.</p>}
        </div>
        <Link
          to="/inbox"
          search={{ queue: undefined, severity: undefined, type: undefined, source: undefined, q: undefined }}
          className="flex min-h-11 items-center justify-center gap-1 border-t text-xs font-medium text-primary hover:bg-accent"
        >
          Open Inbox{items.length > 8 ? ` · ${items.length - 8} more` : ''} <ExternalLink className="size-3" />
        </Link>
      </PopoverContent>
    </Popover>
  )
}
