import { useMemo, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileSearch,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Rocket,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { WorkViewPreferences } from '@vertexade/platform-contracts'
import { WorkSortSelect } from '@vertexade/ui/components/work-sort-select'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { FilterBar, FilterBarControls, FilterBarToggle } from '@vertexade/ui/components/ui/toolbar'
import type { Repository, WorkBoardData, WorkItem, WorkState } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { sortWorkItems, type WorkItemSort } from '@vertexade/ui/lib/work-sort'
import {
  matchesWorkAttention,
  matchesWorkKind,
  matchesWorkQuery,
  matchesWorkRepository,
  NewWorkDialog,
  WorkColumn,
  WorkList,
  type WorkStatePresentation,
} from '../components/work/work-board-components'
import { useWorkStageMoves } from '../components/work/use-work-stage-moves'
import { BatchDeleteWorkDialog } from '../components/work/work-batch-delete-dialog'
import { DeleteWorkDialog } from '../components/work/work-delete-dialog'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'
import { optionalBoolean, optionalEnum, optionalOne, optionalString } from '../lib/route-search'

type WorkSearch = {
  create?: 1
  start?: 1
  q?: string
  repo?: string
  kind?: string
  sort?: WorkItemSort
  attention?: boolean
  state?: WorkState
  view?: 'board' | 'list' | 'completed'
}

const workSorts: WorkItemSort[] = [
  'recent',
  'oldest',
  'priority-high',
  'priority-low',
  'created-newest',
  'created-oldest',
  'title-asc',
  'title-desc',
  'status',
]
const workStates: WorkState[] = ['backlog', 'active', 'review', 'deploy', 'done']

export const Route = createFileRoute('/work/')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): WorkSearch => ({
    create: optionalOne(search.create),
    start: optionalOne(search.start),
    q: optionalString(search.q),
    repo: optionalString(search.repo),
    kind: optionalString(search.kind),
    sort: optionalEnum(search.sort, workSorts),
    attention: optionalBoolean(search.attention),
    state: optionalEnum(search.state, workStates),
    view: optionalEnum(search.view, ['board', 'list', 'completed']),
  }),
  component: WorkBoard,
})

const states: WorkStatePresentation[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    description: 'Ready to pick up',
    icon: Clock3,
    tone: 'text-slate-400',
  },
  {
    id: 'active',
    label: 'Active',
    description: 'Threads and branches in motion',
    icon: CircleDot,
    tone: 'text-blue-400',
  },
  {
    id: 'review',
    label: 'Review',
    description: 'PR or review action needed',
    icon: FileSearch,
    tone: 'text-violet-400',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    description: 'Merged and moving through environments',
    icon: Rocket,
    tone: 'text-amber-400',
  },
  {
    id: 'done',
    label: 'Done',
    description: 'Outcome delivered',
    icon: CheckCircle2,
    tone: 'text-emerald-400',
  },
]

// fallow-ignore-next-line complexity -- Route orchestration intentionally keeps board state and responsive view coordination together.
function WorkBoard() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const preferences = useUiPreferences()
  const workItems = useRxDashboardCollection<WorkItem>('workItems')
  const repositories = useRxDashboardCollection<Repository>('repositories')
  const data = useMemo<WorkBoardData>(
    () => ({
      items: workItems.values.filter((item) => !item.archived_at),
      repositories: repositories.values,
    }),
    [repositories.values, workItems.values],
  )
  const loading = !workItems.ready || !repositories.ready
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<WorkItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set())
  const stageMoves = useWorkStageMoves(data.items, workItems.refresh)
  const saved = preferences.value.work
  const query = search.q || ''
  const repository = search.repo || saved.repository || 'all'
  const kind = search.kind || saved.kind || 'all'
  const sort = search.sort || saved.sort || 'recent'
  const attentionOnly = search.attention ?? Boolean(saved.attentionOnly)
  const savedState = saved.mobileState === 'done' ? 'active' : saved.mobileState
  const mobileState = search.state === 'done' ? 'active' : search.state || savedState || 'active'
  const view = search.view || saved.view || 'board'
  const createOpen = search.create === 1

  const refresh = () => void workItems.refresh()
  const archiveItem = (item: WorkItem) => {
    void api(`/api/work-items/${item.id}/archive`, { method: 'POST' })
      .then(() => {
        toast.success(`${item.key} archived`)
        refresh()
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  const toggleSelected = (item: WorkItem, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(item.id)
      else next.delete(item.id)
      return next
    })
  }
  const updateSearch = (patch: Partial<WorkSearch>) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace: true,
      resetScroll: false,
    })
  const saveDefaults = (work: WorkViewPreferences) => {
    void preferences.update({ work }).catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  const setQuery = (value: string) => updateSearch({ q: value || undefined })
  const setRepository = (value: string) => {
    updateSearch({ repo: value })
    saveDefaults({ repository: value })
  }
  const setKind = (value: string) => {
    updateSearch({ kind: value })
    saveDefaults({ kind: value })
  }
  const setSort = (value: WorkItemSort) => {
    updateSearch({ sort: value })
    saveDefaults({ sort: value })
  }
  const setAttentionOnly = (value: boolean) => {
    updateSearch({ attention: value || undefined })
    saveDefaults({ attentionOnly: value })
  }
  const setMobileState = (value: WorkState) => {
    updateSearch({ state: value })
    saveDefaults({ mobileState: value })
  }
  const setView = (value: 'board' | 'list' | 'completed') => {
    updateSearch({ view: value })
    saveDefaults({ view: value })
  }
  function changeCreateOpen(next: boolean) {
    updateSearch({ create: next ? 1 : undefined, start: next ? search.start : undefined })
  }

  const filtered = useMemo(
    () =>
      stageMoves.presentedItems.filter(
        (item) =>
          matchesWorkQuery(item, query) &&
          matchesWorkRepository(item, repository) &&
          matchesWorkKind(item, kind) &&
          matchesWorkAttention(item, attentionOnly),
      ),
    [attentionOnly, kind, query, repository, stageMoves.presentedItems],
  )

  const visibleStates = states.filter((state) => state.id !== 'done')
  const visibleItems = filtered.filter((item) => (view === 'completed' ? item.state === 'done' : item.state !== 'done'))
  const sortedVisibleItems = sortWorkItems(visibleItems, sort)
  const selectedItems = sortedVisibleItems.filter((item) => selectedIds.has(item.id))
  const attention = data.items.filter((item) => item.attention && item.state !== 'done').length
  const done = filtered.filter((item) => item.state === 'done').length
  const activeFilters = Number(repository !== 'all') + Number(kind !== 'all') + Number(attentionOnly)
  return (
    <WorkspacePage data-work-board className="xl:px-5 xl:py-3">
      <WorkspaceHeader
        className="mb-2 items-center pb-0 [&_[data-slot=page-actions]]:w-auto [&_[data-slot=page-header-content]]:xl:flex [&_[data-slot=page-header-content]]:xl:items-baseline [&_[data-slot=page-header-content]]:xl:gap-3 [&_[data-slot=page-title]]:text-lg [&_[data-slot=page-description]]:xl:mt-0"
        title="Work"
        description={`${visibleItems.length} outcome${visibleItems.length === 1 ? '' : 's'} in view${attention ? ` · ${attention} need you` : ''}`}
        actions={
          <div className="flex gap-2">
            {view === 'completed' && visibleItems.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="px-2 sm:px-3"
                aria-label="Delete multiple completed Work items"
                onClick={() => setBatchDeleteOpen(true)}
              >
                <Trash2 />
                <span className="sm:hidden">Delete</span>
                <span className="sr-only sm:not-sr-only">Delete multiple</span>
              </Button>
            )}
            <Button className="shrink-0" size="sm" onClick={() => changeCreateOpen(true)}>
              <Plus />
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New work</span>
            </Button>
          </div>
        }
      />
      <SegmentedControl className="mb-2 grid w-full grid-cols-3 sm:flex sm:w-fit" aria-label="Work views">
        <SegmentedControlItem active={view === 'board'} size="sm" onClick={() => setView('board')}>
          <LayoutGrid />
          Board
        </SegmentedControlItem>
        <SegmentedControlItem active={view === 'list'} size="sm" onClick={() => setView('list')}>
          <List />
          List
        </SegmentedControlItem>
        <SegmentedControlItem active={view === 'completed'} size="sm" onClick={() => setView('completed')}>
          <CheckCircle2 />
          Completed
          <span className="text-xs tabular-nums text-muted-foreground">{done}</span>
        </SegmentedControlItem>
      </SegmentedControl>

      <FilterBar>
        <SearchInput
          containerClassName="flex-1 sm:min-w-52"
          density="compact"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search work, PRs, sources…"
        />
        <FilterBarToggle
          label={`Work filters${activeFilters ? `, ${activeFilters} active` : ''}`}
          count={activeFilters}
          active={activeFilters > 0}
          aria-expanded={mobileFiltersOpen}
          aria-controls="mobile-work-filters"
          onClick={() => setMobileFiltersOpen((value) => !value)}
        >
          <SlidersHorizontal />
        </FilterBarToggle>
        <FilterBarControls id="mobile-work-filters" open={mobileFiltersOpen}>
          <Select value={repository} onValueChange={setRepository}>
            <SelectTrigger className="col-span-2 w-full sm:col-span-1 sm:w-56">
              <SelectValue placeholder="All repositories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All repositories</SelectItem>
              {data.repositories.map((repo) => (
                <SelectItem key={repo.id} value={String(repo.id)}>
                  {repo.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All work types</SelectItem>
              <SelectItem value="implementation">Implementation</SelectItem>
              <SelectItem value="pr_review">PR reviews</SelectItem>
              <SelectItem value="investigation">Investigations</SelectItem>
              <SelectItem value="operational">Operational</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={attentionOnly ? 'secondary' : 'outline'} onClick={() => setAttentionOnly(!attentionOnly)}>
            <AlertTriangle />
            Attention{attention ? ` · ${attention}` : ''}
          </Button>
          <WorkSortSelect value={sort} onChange={setSort} />
        </FilterBarControls>
      </FilterBar>

      {view !== 'board' && (
        <WorkListBulkActions
          items={sortedVisibleItems}
          selectedItems={selectedItems}
          onToggle={toggleSelected}
          onClear={() => setSelectedIds(new Set())}
          onMove={(state) => {
            void Promise.all(selectedItems.map((item) => stageMoves.moveWorkItem(item, state))).then(() => setSelectedIds(new Set()))
          }}
          onArchive={() => {
            void Promise.all(selectedItems.map((item) => api(`/api/work-items/${item.id}/archive`, { method: 'POST' })))
              .then(() => {
                toast.success(`${selectedItems.length} Work item${selectedItems.length === 1 ? '' : 's'} archived`)
                setSelectedIds(new Set())
                refresh()
              })
              .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
          }}
          onDelete={() => setBatchDeleteOpen(true)}
        />
      )}

      {!loading && view === 'board' && (
        <nav
          aria-label="Work states"
          className="work-board-state-tabs -mx-3 mb-3 grid grid-cols-4 border-y border-border/45 px-3 [scrollbar-width:none] sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
        >
          {visibleStates.map((state) => {
            const Icon = state.icon
            const count = filtered.filter((item) => item.state === state.id).length
            return (
              <button
                key={state.id}
                type="button"
                aria-current={mobileState === state.id ? 'page' : undefined}
                onClick={() => setMobileState(state.id)}
                className={cn(
                  'relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-muted-foreground',
                  mobileState === state.id &&
                    'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary',
                )}
              >
                <span className="relative">
                  <Icon className={cn('size-3.5', state.tone)} />
                  {count > 0 && <span className="absolute -right-2.5 -top-1 text-[11px] tabular-nums text-muted-foreground">{count}</span>}
                </span>
                <strong className="truncate text-[11px] font-medium">{state.label}</strong>
              </button>
            )
          })}
        </nav>
      )}

      {loading ? (
        <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
          <span>
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Loading work…
          </span>
        </div>
      ) : view === 'board' ? (
        <DndContext
          sensors={stageMoves.sensors}
          onDragStart={stageMoves.startDrag}
          onDragCancel={stageMoves.cancelDrag}
          onDragEnd={stageMoves.finishDrag}
        >
          <section className="work-board-grid grid items-start gap-3">
            {visibleStates.map((state) => {
              const items = sortWorkItems(
                filtered.filter((item) => item.state === state.id),
                sort,
              )
              return (
                <WorkColumn
                  key={state.id}
                  state={state}
                  items={items}
                  hiddenOnMobile={mobileState !== state.id}
                  movingIds={stageMoves.movingIds}
                  onMove={stageMoves.moveWorkItem}
                  onArchive={archiveItem}
                  onDelete={setDeleteItem}
                />
              )
            })}
          </section>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
            {stageMoves.draggedItem && (
              <div className="work-board-drag-overlay">
                <strong>{stageMoves.draggedItem.key}</strong>
                <span>{stageMoves.draggedItem.title}</span>
                <small>Drop in a stage to move</small>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <WorkList items={sortedVisibleItems} completed={view === 'completed'} selectedIds={selectedIds} onSelect={toggleSelected} />
      )}
      <NewWorkDialog
        open={createOpen}
        onOpenChange={changeCreateOpen}
        data={data}
        onCreated={refresh}
        initialStartThread={search.start === 1 ? true : undefined}
      />
      {batchDeleteOpen && (
        <BatchDeleteWorkDialog
          items={selectedItems.length ? selectedItems : sortedVisibleItems}
          initialSelectedIds={selectedItems.map((item) => item.id)}
          open
          onOpenChange={setBatchDeleteOpen}
          onDeleted={() => {
            setSelectedIds(new Set())
            refresh()
          }}
        />
      )}
      {deleteItem && (
        <DeleteWorkDialog
          item={deleteItem}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteItem(null)
          }}
          onDeleted={refresh}
          onRetry={refresh}
        />
      )}
    </WorkspacePage>
  )
}

function WorkListBulkActions({
  items,
  selectedItems,
  onToggle,
  onClear,
  onMove,
  onArchive,
  onDelete,
}: {
  items: WorkItem[]
  selectedItems: WorkItem[]
  onToggle(item: WorkItem, selected: boolean): void
  onClear(): void
  onMove(state: WorkState): void
  onArchive(): void
  onDelete(): void
}) {
  const allSelected = items.length > 0 && selectedItems.length === items.length
  return (
    <div className="mb-2 flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-border/65 bg-card/70 px-2 py-1.5">
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={allSelected ? true : selectedItems.length ? 'indeterminate' : false}
          onCheckedChange={(checked) => items.forEach((item) => onToggle(item, Boolean(checked)))}
          aria-label="Select all Work items in view"
        />
        {selectedItems.length ? `${selectedItems.length} selected` : 'Select all'}
      </label>
      {selectedItems.length > 0 && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs">
                <ArrowRightLeft /> Move
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>Move selected to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {workStates.map((state) => (
                <DropdownMenuItem key={state} onSelect={() => onMove(state)}>
                  {selectedItems.every((item) => item.state === state) ? <Check /> : <span className="size-4" />}
                  {states.find((option) => option.id === state)?.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="xs" onClick={onArchive}>
            <Archive /> Archive
          </Button>
          <Button variant="destructive" size="xs" onClick={onDelete}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Clear selection" onClick={onClear}>
            <X />
          </Button>
        </>
      )}
    </div>
  )
}
