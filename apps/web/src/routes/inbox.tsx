import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Inbox,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, IconButton } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import {
  List,
  ListItem,
  ListItemAction,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemMeta,
  ListItemTitle,
} from '@vertexade/ui/components/ui/list'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import {
  StateNav,
  StateNavContent,
  StateNavDescription,
  StateNavIcon,
  StateNavItem,
  StateNavTitle,
} from '@vertexade/ui/components/ui/state-nav'
import {
  Status,
  StatusPanel,
  StatusPanelActions,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from '@vertexade/ui/components/ui/status'
import { FilterBar, FilterBarControls, FilterBarToggle, FilterChip, ToolbarGroup, ToolbarLabel } from '@vertexade/ui/components/ui/toolbar'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { age, api, dateValue, eventReason } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import { groupInboxItems } from '../components/inbox/inbox-grouping'
import { InboxEmpty, inboxLabel as label, InboxRow } from '../components/inbox/inbox-items'
import type { InboxItem, InboxResult, InboxSearch, InboxSeverity, InboxState, InboxView } from '../components/inbox/inbox-types'

const empty: InboxResult = { items: [], summary: { total: 0, errors: 0, warnings: 0, unread: 0 } }
const views = new Set<InboxView>(['action', 'updates', 'saved', 'snoozed', 'done'])
const severities = new Set<InboxSeverity>(['info', 'warning', 'error'])

export const Route = createFileRoute('/inbox')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    queue: views.has(String(search.queue) as InboxView) ? (String(search.queue) as InboxView) : undefined,
    severity: severities.has(String(search.severity) as InboxSeverity) ? (String(search.severity) as InboxSeverity) : undefined,
    type: typeof search.type === 'string' ? search.type.slice(0, 64) : undefined,
    source: typeof search.source === 'string' ? search.source.slice(0, 100) : undefined,
    q: typeof search.q === 'string' ? search.q.slice(0, 100) : undefined,
  }),
  component: InboxPage,
})

const viewMeta = [
  {
    id: 'action',
    label: 'Needs action',
    description: 'Errors and blockers',
    icon: ShieldAlert,
    tone: 'text-red-400',
  },
  {
    id: 'updates',
    label: 'Updates',
    description: 'Completed and changed',
    icon: Info,
    tone: 'text-blue-400',
  },
  {
    id: 'saved',
    label: 'Saved',
    description: 'Keep close',
    icon: Bookmark,
    tone: 'text-violet-400',
  },
  {
    id: 'snoozed',
    label: 'Snoozed',
    description: 'Returns later',
    icon: Clock3,
    tone: 'text-amber-400',
  },
  {
    id: 'done',
    label: 'Done',
    description: 'Completed triage',
    icon: CheckCircle2,
    tone: 'text-emerald-400',
  },
] as const

const severityOrder: Record<InboxSeverity, number> = { error: 0, warning: 1, info: 2 }

function isInboxEvent(event: Event) {
  const reason = eventReason(event)
  return Boolean(reason) && !['connected', 'agent_message', 'diff_updated', 'thread_context_updated'].includes(reason)
}

function belongsToView(item: InboxItem, view: InboxView) {
  if (view === 'action') return item.triageState === 'open' && item.severity !== 'info'
  if (view === 'updates') return item.triageState === 'open' && item.severity === 'info'
  return item.triageState === view
}

function InboxPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const confirmAction = useConfirm()
  const [data, setData] = useState(empty)
  const inboxQuery = useReactiveApi<InboxResult>({
    key: 'inbox',
    load: () => api<InboxResult>('/api/inbox'),
    accepts: isInboxEvent,
  })
  const loading = inboxQuery.loading
  const loadError = inboxQuery.error?.message || ''
  const [updating, setUpdating] = useState<string[]>([])
  const [limit, setLimit] = useState(12)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const view = search.queue || 'action'
  const severity = search.severity
  const type = search.type || 'all'
  const source = search.source || 'all'
  const query = search.q?.trim().toLowerCase() || ''

  useEffect(() => {
    if (inboxQuery.data) setData(inboxQuery.data)
  }, [inboxQuery.data])

  const counts = useMemo(
    () =>
      Object.fromEntries(viewMeta.map(({ id }) => [id, data.items.filter((item) => belongsToView(item, id)).length])) as Record<
        InboxView,
        number
      >,
    [data.items],
  )

  const queueItems = useMemo(() => data.items.filter((item) => belongsToView(item, view)), [data.items, view])
  const types = useMemo(() => [...new Set(queueItems.map((item) => item.type))].sort(), [queueItems])
  const sources = useMemo(() => [...new Set(queueItems.map((item) => item.source))].sort(), [queueItems])
  const severityCounts = useMemo(
    () => ({
      error: queueItems.filter((item) => item.severity === 'error').length,
      warning: queueItems.filter((item) => item.severity === 'warning').length,
      info: queueItems.filter((item) => item.severity === 'info').length,
    }),
    [queueItems],
  )
  const visible = useMemo(
    () =>
      queueItems
        .filter((item) => !severity || item.severity === severity)
        .filter((item) => type === 'all' || item.type === type)
        .filter((item) => source === 'all' || item.source === source)
        .filter((item) => !query || [item.title, item.summary, item.source, item.type].some((value) => value.toLowerCase().includes(query)))
        .sort((left, right) => {
          if (view === 'action' && severityOrder[left.severity] !== severityOrder[right.severity])
            return severityOrder[left.severity] - severityOrder[right.severity]
          if (left.unread !== right.unread) return left.unread ? -1 : 1
          return (dateValue(right.createdAt)?.getTime() || 0) - (dateValue(left.createdAt)?.getTime() || 0)
        }),
    [query, queueItems, severity, source, type, view],
  )
  const grouped = useMemo(() => groupInboxItems(visible), [visible])
  const displayed = grouped.slice(0, limit)
  const filtersActive = Boolean(severity || search.type || search.source || query)

  useEffect(() => setLimit(12), [query, severity, source, type, view])

  function updateSearch(next: Partial<InboxSearch>) {
    void navigate({
      search: (current) => ({ ...current, ...next }),
      replace: true,
      resetScroll: false,
    })
  }

  function clearFilters() {
    updateSearch({ severity: undefined, type: undefined, source: undefined, q: undefined })
  }

  async function updateItem(item: InboxItem, state: InboxState, snoozedUntil: string | null = null) {
    if (updating.includes(item.id)) return
    setUpdating((current) => [...current, item.id])
    setData((current) => ({
      ...current,
      items: current.items.map((candidate) => (candidate.id === item.id ? { ...candidate, triageState: state, snoozedUntil } : candidate)),
    }))
    try {
      await api(`/api/inbox/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ state, snoozedUntil }),
      })
      toast.success(
        state === 'done'
          ? 'Inbox item completed'
          : state === 'saved'
            ? 'Inbox item saved'
            : state === 'snoozed'
              ? 'Inbox item snoozed'
              : 'Item returned to the Inbox',
      )
    } catch (error) {
      setData((current) => ({
        ...current,
        items: current.items.map((candidate) => (candidate.id === item.id ? item : candidate)),
      }))
      toast.error((error as Error).message)
    } finally {
      setUpdating((current) => current.filter((id) => id !== item.id))
    }
  }

  async function completeVisible() {
    const candidates = visible.filter((item) => item.triageState === 'open')
    if (!candidates.length) return
    const confirmed = await confirmAction({
      title: `Clear ${candidates.length} filtered item${candidates.length === 1 ? '' : 's'} from the Inbox?`,
      description:
        view === 'action'
          ? 'This only clears the items from the Inbox; it does not resolve their underlying failures. They remain in Done and can be reopened.'
          : 'These routine updates will move to Done and can be returned to the Inbox later. Errors, blockers, saved items, and snoozed items are not affected.',
      confirmLabel: view === 'action' ? 'Clear from Inbox' : 'Clear updates',
    })
    if (!confirmed) return
    const ids = new Set(candidates.map((item) => item.id))
    setUpdating((current) => [...new Set([...current, ...ids])])
    setData((current) => ({
      ...current,
      items: current.items.map((item) => (ids.has(item.id) ? { ...item, triageState: 'done', snoozedUntil: null } : item)),
    }))
    const results = await Promise.allSettled(
      candidates.map((item) =>
        api(`/api/inbox/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'done', snoozedUntil: null }),
        }),
      ),
    )
    const failed = new Set(results.flatMap((result, index) => (result.status === 'rejected' ? [candidates[index].id] : [])))
    if (failed.size > 0) {
      setData((current) => ({
        ...current,
        items: current.items.map((item) => (failed.has(item.id) ? { ...item, triageState: 'open' } : item)),
      }))
      toast.error(`${failed.size} update${failed.size === 1 ? '' : 's'} could not be completed`)
    }
    if (failed.size < candidates.length)
      toast.success(`${candidates.length - failed.size} Inbox item${candidates.length - failed.size === 1 ? '' : 's'} completed`)
    setUpdating((current) => current.filter((id) => !ids.has(id)))
  }

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow="Triage workspace"
        title="Inbox"
        description={`${counts.action} item${counts.action === 1 ? ' needs' : 's need'} a decision. Review blockers first, keep useful context, and clear routine updates without losing history.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={loading}
            loadingText="Refreshing…"
            aria-label="Refresh Inbox"
            onClick={() => void inboxQuery.refresh()}
          >
            <RefreshCw />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {loadError && (
        <StatusPanel tone="danger" className="mb-4">
          <AlertTriangle />
          <StatusPanelContent>
            <StatusPanelTitle>Inbox could not be refreshed</StatusPanelTitle>
            <StatusPanelDescription>{loadError}</StatusPanelDescription>
          </StatusPanelContent>
          <StatusPanelActions>
            <Button variant="outline" size="xs" onClick={() => void inboxQuery.refresh()}>
              Try again
            </Button>
          </StatusPanelActions>
        </StatusPanel>
      )}

      <StateNav aria-label="Inbox queues" className="mb-3">
        {viewMeta.map((item) => (
          <StateNavItem
            key={item.id}
            active={view === item.id}
            onClick={() =>
              updateSearch({
                queue: item.id === 'action' ? undefined : item.id,
                severity: undefined,
                type: undefined,
                source: undefined,
              })
            }
          >
            <StateNavIcon className={item.tone}>
              <item.icon />
            </StateNavIcon>
            <StateNavContent>
              <StateNavTitle>
                {item.label} <span className="font-mono text-muted-foreground">{counts[item.id]}</span>
              </StateNavTitle>
              <StateNavDescription>{item.description}</StateNavDescription>
            </StateNavContent>
          </StateNavItem>
        ))}
      </StateNav>

      <FilterBar className="mb-3">
        <SearchInput
          density="compact"
          containerClassName="min-w-0 flex-1 sm:min-w-64"
          value={search.q || ''}
          onChange={(event) => updateSearch({ q: event.target.value || undefined })}
          onClear={() => updateSearch({ q: undefined })}
          placeholder="Search title, source, or details"
        />
        <FilterBarToggle
          label="Toggle Inbox filters"
          count={[severity, search.type, search.source].filter(Boolean).length}
          active={filtersActive}
          aria-expanded={mobileFiltersOpen}
          onClick={() => setMobileFiltersOpen((current) => !current)}
        >
          <SlidersHorizontal />
        </FilterBarToggle>
        <FilterBarControls open={mobileFiltersOpen}>
          <ToolbarGroup>
            <ToolbarLabel>Severity</ToolbarLabel>
            <FilterChip active={!severity} count={queueItems.length} onClick={() => updateSearch({ severity: undefined })}>
              All
            </FilterChip>
            <FilterChip
              active={severity === 'error'}
              count={severityCounts.error}
              onClick={() => updateSearch({ severity: severity === 'error' ? undefined : 'error' })}
            >
              Errors
            </FilterChip>
            <FilterChip
              active={severity === 'warning'}
              count={severityCounts.warning}
              onClick={() => updateSearch({ severity: severity === 'warning' ? undefined : 'warning' })}
            >
              Warnings
            </FilterChip>
            <FilterChip
              active={severity === 'info'}
              count={severityCounts.info}
              onClick={() => updateSearch({ severity: severity === 'info' ? undefined : 'info' })}
            >
              Info
            </FilterChip>
          </ToolbarGroup>
          <Select value={type} onValueChange={(value) => updateSearch({ type: value === 'all' ? undefined : value })}>
            <SelectTrigger aria-label="Filter by item type" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All item types</SelectItem>
              {types.map((item) => (
                <SelectItem key={item} value={item}>
                  {label(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(value) => updateSearch({ source: value === 'all' ? undefined : value })}>
            <SelectTrigger aria-label="Filter by source" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBarControls>
      </FilterBar>

      <Card className="gap-0 py-0">
        <CardHeader className="gap-3 border-b p-3 sm:p-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-blue-400" />
              {viewMeta.find((item) => item.id === view)?.label}
              <Badge variant="secondary">{visible.length}</Badge>
            </CardTitle>
            {filtersActive && (
              <p className="mt-1 text-xs text-muted-foreground">
                {visible.length} of {queueItems.length} items match the current filters.
              </p>
            )}
          </div>
          <CardAction className="flex shrink-0 gap-1">
            {filtersActive && (
              <Button variant="ghost" size="xs" className="hidden sm:inline-flex" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            {['action', 'updates'].includes(view) && visible.length > 0 && (
              <Button
                variant="outline"
                size="xs"
                aria-label={view === 'updates' ? 'Clear updates' : filtersActive ? 'Clear filtered items from Inbox' : 'Clear Inbox queue'}
                loading={visible.some((item) => updating.includes(item.id))}
                loadingText="Completing…"
                onClick={() => void completeVisible()}
              >
                <Check />
                <span className="hidden sm:inline">
                  {view === 'updates' ? 'Clear updates' : filtersActive ? 'Clear filtered' : 'Clear from Inbox'}
                </span>
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !data.items.length ? (
            <Empty className="min-h-64">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Loader2 className="animate-spin" />
                </EmptyMedia>
                <EmptyTitle>Loading Inbox</EmptyTitle>
                <EmptyDescription>Collecting Work, review, automation, and extension signals.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : visible.length ? (
            <>
              <List>
                {displayed.map((group) => (
                  <div key={group.key}>
                    <InboxRow item={group.items[0]} busy={updating.includes(group.items[0].id)} onUpdate={updateItem} />
                    {group.items.length > 1 && (
                      <details className="group/inbox-related border-t border-border/35 bg-muted/[.035]">
                        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 pl-12 text-[11px] text-muted-foreground hover:bg-muted/20 hover:text-foreground">
                          <span>
                            {group.items.length - 1} related event{group.items.length === 2 ? '' : 's'}
                          </span>
                          <span className="group-open/inbox-related:hidden">Show</span>
                          <span className="hidden group-open/inbox-related:inline">Hide</span>
                        </summary>
                        <div className="border-t border-border/35 bg-background/35 [&>[data-slot=list-item]+[data-slot=list-item]]:border-t [&>[data-slot=list-item]]:pl-6">
                          {group.items.slice(1).map((item) => (
                            <InboxRow key={item.id} item={item} busy={updating.includes(item.id)} onUpdate={updateItem} />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </List>
              {displayed.length < grouped.length && (
                <div className="flex items-center justify-between gap-3 border-t p-3">
                  <p className="text-xs text-muted-foreground">
                    Showing {displayed.length} of {grouped.length} event groups ({visible.length} events).
                  </p>
                  <Button variant="outline" size="xs" onClick={() => setLimit((current) => current + 12)}>
                    Show more
                  </Button>
                </div>
              )}
            </>
          ) : (
            <InboxEmpty view={view} filtered={filtersActive} onClear={clearFilters} />
          )}
        </CardContent>
      </Card>
    </WorkspacePage>
  )
}
