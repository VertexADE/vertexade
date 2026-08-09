import { useState, type ReactNode } from 'react'
import type {
  ExtensionBoardPreferences,
  PortableCollectionAction,
  PortableCollectionSurface,
  PortableItemAction,
  PortableSwimlaneConfig,
} from '@vertexade/platform-contracts'
import {
  portableRecords,
  readPortablePath,
  type PortableCollectionItem,
  type PortableField,
  type PortableRelationItem,
  type PortableSwimlane,
} from '@vertexade/platform-contracts/portable'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChevronRight,
  CircleDot,
  Columns3,
  CornerDownRight,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  GitBranch,
  Layers3,
  LayoutList,
  ListTree,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@vertexade/ui/components/ui/avatar'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { cn } from '@vertexade/ui/lib/utils'
import {
  PortableCard,
  portableDisplayTitle,
  portableField,
  portableIdLabel,
  portableTone,
} from '@vertexade/ui/components/portable-extension-detail'
type ViewMode = 'list' | 'kanban'
type SourceData = Record<string, unknown>
type PortableGroup = { name: string; items: PortableCollectionItem[] }
type PortableColumnPreferences = { order: string[]; hidden: string[] }

export function PortableState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <Card>
      <CardContent className="grid min-h-56 place-items-center text-center">
        <div className="max-w-md">
          <strong className="text-sm">{title}</strong>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          {action && <div className="mt-4">{action}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

export function PortableMobileToolbar({
  axis,
  baseGroups,
  collectionActions,
  columnPreferences,
  data,
  facets,
  facetOptions,
  fieldNames,
  filtersOpen,
  items,
  loading,
  nestedSwimlanes,
  onAction,
  onAxisChange,
  onColumnPreferencesChange,
  onFacetsChange,
  onFiltersOpenChange,
  onNestedSwimlanesChange,
  onQueryChange,
  onRefresh,
  onSourceValuesChange,
  onSwimlaneOptionChange,
  onViewChange,
  query,
  sourceValues,
  surface,
  swimlaneConfig,
  swimlaneOption,
  view,
}: {
  axis: string
  baseGroups: PortableGroup[]
  collectionActions: PortableCollectionAction[]
  columnPreferences: PortableColumnPreferences
  data: SourceData
  facets: Record<string, string>
  facetOptions: Record<string, string[]>
  fieldNames: string[]
  filtersOpen: boolean
  items: PortableCollectionItem[]
  loading: boolean
  nestedSwimlanes: boolean
  onAction(action: PortableCollectionAction): void
  onAxisChange(value: string): void
  onColumnPreferencesChange(value: PortableColumnPreferences): void
  onFacetsChange(value: Record<string, string>): void
  onFiltersOpenChange(value: boolean): void
  onNestedSwimlanesChange(value: boolean): void
  onQueryChange(value: string): void
  onRefresh(): void
  onSourceValuesChange(value: Record<string, string>): void
  onSwimlaneOptionChange(value: string): void
  onViewChange(value: ViewMode): void
  query: string
  sourceValues: Record<string, string>
  surface: PortableCollectionSurface
  swimlaneConfig?: PortableSwimlaneConfig
  swimlaneOption: string
  view: ViewMode
}) {
  const primary = collectionActions[0]
  const activeFilters = Object.values(facets).filter(Boolean).length
  const metricField = items.some((item) => item.fields.some((field) => field.name === 'State')) ? 'State' : axis
  const metrics = [
    ...new Set(items.map((item) => item.fields.find((field) => field.name === metricField)?.value).filter(Boolean) as string[]),
  ]
    .map((label) => ({
      label,
      value: items.filter((item) => item.fields.find((field) => field.name === metricField)?.value === label).length,
    }))
    .slice(0, 4)
  return (
    <div className="mb-3 space-y-3 sm:hidden">
      <div className="flex items-center gap-2">
        {primary && (
          <Button className="min-w-0 flex-1" size="sm" onClick={() => onAction(primary)}>
            {primary.label}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="More board actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {collectionActions.slice(primary ? 1 : 0).map((action) => (
              <DropdownMenuItem key={action.id} onSelect={() => onAction(action)}>
                <GitBranch />
                {action.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={onRefresh}>
              <RefreshCw />
              {loading ? 'Refreshing…' : 'Refresh'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(surface.sourceControls || []).map((control) => (
        <Label key={control.id} className="block text-[11px] uppercase tracking-[.12em] text-muted-foreground">
          {control.label}
          <Select
            value={sourceValues[control.id] || ''}
            onValueChange={(value) => onSourceValuesChange({ ...sourceValues, [control.id]: value })}
          >
            <SelectTrigger className="mt-1 h-10 w-full text-xs">
              <SelectValue placeholder={control.label} />
            </SelectTrigger>
            <SelectContent>
              {portableRecords(readPortablePath(data, control.optionsPath)).map((option) => {
                const value = String(readPortablePath(option, control.optionValuePath) || '')
                return (
                  <SelectItem key={value} value={value}>
                    {String(readPortablePath(option, control.optionLabelPath) || value)}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </Label>
      ))}
      {metrics.length > 0 && (
        <section
          aria-label={`${metricField} summary`}
          className="grid divide-x overflow-hidden rounded-lg border bg-card/25"
          style={{ gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))` }}
        >
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 px-1.5 py-2 text-center">
              <strong className="flex items-center justify-center gap-1.5 font-mono text-xs tabular-nums">
                <span className={cn('size-1.5 rounded-full', portableTone(metric.label))} />
                {metric.value}
              </strong>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{metric.label}</span>
            </div>
          ))}
        </section>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2">
        <Input
          aria-label="Search work items"
          placeholder="Search work items…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-11"
        />
        <Button
          className="relative size-11"
          variant={activeFilters ? 'secondary' : 'outline'}
          size="icon-sm"
          aria-label={`Board filters${activeFilters ? `, ${activeFilters} active` : ''}`}
          onClick={() => onFiltersOpenChange(!filtersOpen)}
        >
          <Filter />
          {activeFilters > 0 && (
            <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-blue-500 text-[11px] text-white">
              {activeFilters}
            </span>
          )}
        </Button>
      </div>
      {filtersOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-2">
          {(surface.facets || []).map((facet) => (
            <Select
              key={facet.id}
              value={facets[facet.id] || '__all'}
              onValueChange={(value) => onFacetsChange({ ...facets, [facet.id]: value === '__all' ? '' : value })}
            >
              <SelectTrigger className="h-10 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All {facet.label.toLowerCase()}</SelectItem>
                {facetOptions[facet.id]?.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-y py-1">
        <div className="flex gap-1">
          <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="xs" onClick={() => onViewChange('list')}>
            <LayoutList />
            List
          </Button>
          {surface.views.kanban?.enabled && (
            <Button
              variant={view === 'kanban' ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => {
                onViewChange('kanban')
                onAxisChange(axis || surface.views.kanban?.defaultField || fieldNames[0] || '')
              }}
            >
              <Columns3 />
              Board
            </Button>
          )}
        </div>
      </div>
      {view === 'kanban' && (
        <div className="grid grid-cols-2 gap-2">
          {fieldNames.length > 0 && (
            <PortableAxisControl
              compact
              axis={axis}
              fieldNames={fieldNames}
              groups={baseGroups}
              onAxisChange={onAxisChange}
              onPreferencesChange={onColumnPreferencesChange}
              preferences={columnPreferences}
            />
          )}
          {swimlaneConfig && (
            <PortableSwimlaneControl
              compact
              config={swimlaneConfig}
              nested={nestedSwimlanes}
              onNestedChange={onNestedSwimlanesChange}
              onOptionChange={onSwimlaneOptionChange}
              option={swimlaneOption}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function PortableAxisControl({
  axis,
  compact = false,
  fieldNames,
  groups,
  onAxisChange,
  onPreferencesChange,
  preferences,
}: {
  axis: string
  compact?: boolean
  fieldNames: string[]
  groups: PortableGroup[]
  onAxisChange(value: string): void
  onPreferencesChange(value: PortableColumnPreferences): void
  preferences: PortableColumnPreferences
}) {
  return (
    <div className="flex min-w-0 gap-1">
      <Select value={axis} onValueChange={onAxisChange}>
        <SelectTrigger aria-label="Board axis" className={cn('min-w-0 flex-1', compact && 'h-9 text-[11px]')}>
          <Columns3 className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="Board axis" />
        </SelectTrigger>
        <SelectContent>
          {fieldNames.map((field) => (
            <SelectItem key={field} value={field}>
              Columns: {field}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <PortableColumnManager axis={axis} compact={compact} groups={groups} onChange={onPreferencesChange} preferences={preferences} />
    </div>
  )
}

function PortableColumnManager({
  axis,
  compact,
  groups,
  onChange,
  preferences,
}: {
  axis: string
  compact: boolean
  groups: PortableGroup[]
  onChange(value: PortableColumnPreferences): void
  preferences: PortableColumnPreferences
}) {
  const [open, setOpen] = useState(false)
  const available = groups.map((group) => group.name)
  const availableSet = new Set(available)
  const order = [...new Set([...preferences.order.filter((name) => availableSet.has(name)), ...available])]
  const hidden = new Set(preferences.hidden.filter((name) => availableSet.has(name)))
  const visibleCount = order.filter((name) => !hidden.has(name)).length
  const groupsByName = new Map(groups.map((group) => [group.name, group]))
  const move = (name: string, offset: -1 | 1) => {
    const next = [...order]
    const index = next.indexOf(name)
    const target = index + offset
    if (index < 0 || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange({ ...preferences, order: next })
  }
  const setVisible = (name: string, visible: boolean) => {
    const next = new Set(hidden)
    if (visible) next.delete(name)
    else next.add(name)
    onChange({ ...preferences, hidden: [...next] })
  }
  return (
    <>
      <Button
        aria-label={`Manage ${axis || 'board'} columns`}
        className={cn(compact && 'size-9')}
        disabled={!axis || !groups.length}
        onClick={() => setOpen(true)}
        size="icon-sm"
        title="Order and hide columns"
        type="button"
        variant="outline"
      >
        <SlidersHorizontal />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{axis} columns</DialogTitle>
            <DialogDescription>Choose which columns appear and set their order. List view keeps every record.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {visibleCount} visible · {hidden.size} hidden
            </span>
            <span>Provider order is the default</span>
          </div>
          <div className="max-h-[min(24rem,55vh)] space-y-1 overflow-y-auto pr-1">
            {order.map((name, index) => {
              const isVisible = !hidden.has(name)
              return (
                <div
                  key={name}
                  className={cn('flex items-center gap-2 rounded-lg border px-2 py-2', !isVisible && 'bg-muted/20 text-muted-foreground')}
                >
                  <Checkbox
                    aria-label={`${isVisible ? 'Hide' : 'Show'} ${name}`}
                    checked={isVisible}
                    disabled={isVisible && visibleCount <= 1}
                    onCheckedChange={(checked) => setVisible(name, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
                  <Badge variant="secondary">{groupsByName.get(name)?.items.length || 0}</Badge>
                  {!isVisible && <EyeOff aria-hidden className="size-3.5" />}
                  <Button
                    aria-label={`Move ${name} left`}
                    disabled={index === 0}
                    onClick={() => move(name, -1)}
                    size="icon-sm"
                    title="Move earlier"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowLeft />
                  </Button>
                  <Button
                    aria-label={`Move ${name} right`}
                    disabled={index === order.length - 1}
                    onClick={() => move(name, 1)}
                    size="icon-sm"
                    title="Move later"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowRight />
                  </Button>
                </div>
              )
            })}
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              disabled={!preferences.order.length && !preferences.hidden.length}
              onClick={() => onChange({ order: [], hidden: [] })}
              type="button"
              variant="ghost"
            >
              <RotateCcw />
              Reset
            </Button>
            <Button onClick={() => setOpen(false)} type="button">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PortableSwimlaneControl({
  compact = false,
  config,
  nested,
  onNestedChange,
  onOptionChange,
  option,
}: {
  compact?: boolean
  config: PortableSwimlaneConfig
  nested: boolean
  onNestedChange(value: boolean): void
  onOptionChange(value: string): void
  option: string
}) {
  const selected = config.options.find((candidate) => candidate.id === option) || config.options[0]
  const canNest = selected?.kind === 'hierarchy' && Boolean(selected.nestedAnchorValues?.length || selected.nestedLabel)
  return (
    <div className="flex min-w-0 gap-1">
      <Select value={selected?.id} onValueChange={onOptionChange}>
        <SelectTrigger aria-label="Swimlane grouping" className={cn('min-w-0 flex-1', compact && 'h-9 text-[11px]')}>
          <ListTree className="size-3.5 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="Swimlanes" />
        </SelectTrigger>
        <SelectContent>
          {config.options.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              Swimlanes: {candidate.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canNest && (
        <Button
          aria-label={nested ? 'Disable nested swimlanes' : 'Enable nested swimlanes'}
          aria-pressed={nested}
          className={cn(compact && 'size-9')}
          onClick={() => onNestedChange(!nested)}
          size="icon-sm"
          title={nested ? 'Nested swimlanes on' : 'Nested swimlanes off'}
          type="button"
          variant={nested ? 'secondary' : 'outline'}
        >
          <Layers3 />
        </Button>
      )}
    </div>
  )
}

export function PortableMobileStages({
  groups,
  selected,
  onSelect,
}: {
  groups: Array<{ name: string; items: PortableCollectionItem[] }>
  selected: string
  onSelect(value: string): void
}) {
  return (
    <nav
      aria-label="Board stages"
      className="-mx-4 mb-3 flex overflow-x-auto border-y px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:hidden"
    >
      {groups.map((group) => (
        <button
          key={group.name}
          type="button"
          aria-current={selected === group.name ? 'page' : undefined}
          onClick={() => onSelect(group.name)}
          className={cn(
            'relative flex min-w-20 flex-1 flex-col items-center gap-1 px-2 py-2 text-muted-foreground',
            selected === group.name &&
              'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-500',
          )}
        >
          <span className="font-mono text-[11px]">{group.items.length}</span>
          <strong className="max-w-full truncate text-[11px] font-medium">{group.name}</strong>
        </button>
      ))}
    </nav>
  )
}

export function PortableKanban({
  groups,
  lanes,
  limit,
  selected,
  actionsFor,
  onDetails,
  onAction,
}: {
  groups: Array<{ name: string; items: PortableCollectionItem[] }>
  lanes: PortableSwimlane[]
  limit: number
  selected: string
  actionsFor(item: PortableCollectionItem): PortableItemAction[]
  onDetails(item: PortableCollectionItem): void
  onAction(item: PortableCollectionItem, action: PortableItemAction): void
}) {
  const mobile = groups.find((group) => group.name === selected) || groups[0]
  if (lanes.length)
    return (
      <PortableSwimlaneKanban
        groups={groups}
        lanes={lanes}
        limit={limit}
        mobile={mobile}
        actionsFor={actionsFor}
        onDetails={onDetails}
        onAction={onAction}
      />
    )
  return (
    <>
      {mobile && (
        <section className="overflow-hidden rounded-lg border sm:hidden">
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <CircleDot className="size-3.5 text-blue-400" />
            <strong className="min-w-0 flex-1 truncate text-xs">{mobile.name}</strong>
            <span className="font-mono text-[11px] text-muted-foreground">{mobile.items.length}</span>
          </header>
          {mobile.items.slice(0, limit).map((item) => (
            <PortableCard
              key={item.id}
              compact
              item={item}
              actions={actionsFor(item)}
              onDetails={onDetails}
              onAction={(action) => onAction(item, action)}
            />
          ))}
        </section>
      )}
      <div className="hidden overflow-x-auto pb-3 sm:block">
        <div className="flex min-w-max items-start gap-3">
          {groups.map((group) => (
            <section key={group.name} className="w-[min(18rem,calc(100vw-3rem))] rounded-xl border bg-muted/10">
              <header className="flex items-center justify-between border-b px-3 py-2">
                <strong className="truncate text-sm">{group.name}</strong>
                <Badge variant="secondary">{group.items.length}</Badge>
              </header>
              <div className="space-y-2 p-2">
                {group.items.slice(0, limit).map((item) => (
                  <PortableCard
                    key={item.id}
                    compact
                    item={item}
                    actions={actionsFor(item)}
                    onDetails={onDetails}
                    onAction={(action) => onAction(item, action)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}

function portableLaneTitle(lane: PortableSwimlane) {
  return lane.anchor ? portableDisplayTitle(lane.anchor) : lane.label
}

function portableLaneType(lane: PortableSwimlane) {
  return lane.anchor ? portableField(lane.anchor, 'Type')?.value || 'Work item' : ''
}

function portableLaneId(lane: PortableSwimlane) {
  return lane.anchor ? portableIdLabel(lane.anchor) : ''
}

function PortableLaneSummary({ lane }: { lane: PortableSwimlane }) {
  const type = portableLaneType(lane)
  return (
    <>
      <strong className="min-w-0 flex-1 truncate text-[11px]">{portableLaneTitle(lane)}</strong>
      {type && <Badge variant="outline">{type}</Badge>}
      <Badge variant="secondary">{lane.items.length}</Badge>
    </>
  )
}

function PortableSwimlaneKanban({
  groups,
  lanes,
  limit,
  mobile,
  actionsFor,
  onDetails,
  onAction,
}: {
  groups: Array<{ name: string; items: PortableCollectionItem[] }>
  lanes: PortableSwimlane[]
  limit: number
  mobile?: { name: string; items: PortableCollectionItem[] }
  actionsFor(item: PortableCollectionItem): PortableItemAction[]
  onDetails(item: PortableCollectionItem): void
  onAction(item: PortableCollectionItem, action: PortableItemAction): void
}) {
  const groupByItem = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, group.name] as const)))
  const desktopShown = new Set(groups.flatMap((group) => group.items.slice(0, limit).map((item) => item.id)))
  const desktopLanes = lanes.filter((lane) => lane.items.some((item) => desktopShown.has(item.id)))
  const mobileShown = new Set((mobile?.items || []).slice(0, limit).map((item) => item.id))
  const mobileLanes = lanes.filter((lane) => lane.items.some((item) => mobileShown.has(item.id)))
  return (
    <>
      {mobile && (
        <section className="overflow-hidden rounded-lg border sm:hidden">
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <CircleDot className="size-3.5 text-blue-400" />
            <strong className="min-w-0 flex-1 truncate text-xs">{mobile.name}</strong>
            <span className="font-mono text-[11px] text-muted-foreground">{mobile.items.length}</span>
          </header>
          {mobileLanes.map((lane) => (
            <section key={lane.id} className={cn('border-t first:border-t-0', lane.depth > 0 && 'border-l-2 border-l-violet-400/35')}>
              <header
                className={cn('flex min-w-0 items-center gap-2 bg-blue-500/[.04] px-3 py-2', lane.depth > 0 && 'bg-violet-500/[.045] pl-5')}
              >
                {lane.depth > 0 ? (
                  <CornerDownRight className="size-3.5 shrink-0 text-violet-400" />
                ) : (
                  <BookOpenText className="size-3.5 shrink-0 text-blue-400" />
                )}
                {portableLaneId(lane) && (
                  <span className={cn('font-mono text-[11px] uppercase tracking-wide text-blue-400', lane.depth > 0 && 'text-violet-400')}>
                    {portableLaneId(lane)}
                  </span>
                )}
                <PortableLaneSummary lane={lane} />
              </header>
              {lane.items
                .filter((item) => mobileShown.has(item.id))
                .map((item) => (
                  <PortableCard
                    key={item.id}
                    compact
                    item={item}
                    actions={actionsFor(item)}
                    onDetails={onDetails}
                    onAction={(action) => onAction(item, action)}
                  />
                ))}
            </section>
          ))}
        </section>
      )}
      <div className="hidden overflow-x-auto pb-3 sm:block">
        <div
          className="grid gap-px overflow-hidden rounded-xl border bg-border"
          style={{
            gridTemplateColumns: `repeat(${groups.length}, minmax(16rem, 1fr))`,
            minWidth: `${groups.length * 16}rem`,
            width: '100%',
          }}
        >
          {groups.map((group) => (
            <header key={group.name} className="flex min-w-0 items-center justify-between bg-card px-3 py-2.5">
              <strong className="truncate text-sm">{group.name}</strong>
              <Badge variant="secondary">{group.items.length}</Badge>
            </header>
          ))}
          {desktopLanes.map((lane) => (
            <div key={lane.id} className="contents">
              <header
                className={cn(
                  'flex min-w-0 items-center gap-2 bg-blue-500/[.055] px-3 py-2',
                  lane.depth > 0 && 'border-l-2 border-l-violet-400/50 bg-violet-500/[.055] pl-6',
                )}
                style={{ gridColumn: '1 / -1' }}
              >
                {lane.depth > 0 ? (
                  <CornerDownRight className="size-3.5 shrink-0 text-violet-400" />
                ) : (
                  <BookOpenText className="size-3.5 shrink-0 text-blue-400" />
                )}
                <span className={cn('font-mono text-[11px] uppercase tracking-[.12em] text-blue-400', lane.depth > 0 && 'text-violet-400')}>
                  {lane.depth > 0 ? 'Nested lane' : 'Swimlane'}
                  {portableLaneId(lane) ? ` · ${portableLaneId(lane)}` : ''}
                </span>
                <PortableLaneSummary lane={lane} />
              </header>
              {groups.map((group) => {
                const cellItems = lane.items.filter((item) => desktopShown.has(item.id) && groupByItem.get(item.id) === group.name)
                return (
                  <div key={`${lane.id}:${group.name}`} className="min-h-12 bg-background/95 p-2">
                    {cellItems.length > 0 && (
                      <div className="overflow-hidden rounded-lg border bg-card/30">
                        {cellItems.map((item) => (
                          <PortableCard
                            key={item.id}
                            compact
                            item={item}
                            actions={actionsFor(item)}
                            onDetails={onDetails}
                            onAction={(action) => onAction(item, action)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
