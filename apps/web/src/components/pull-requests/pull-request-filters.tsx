import type { Dispatch, SetStateAction } from 'react'
import { ChevronsUpDown, SlidersHorizontal, X } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@vertexade/ui/components/ui/collapsible'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@vertexade/ui/components/ui/sheet'
import { FilterBar, FilterBarToggle } from '@vertexade/ui/components/ui/toolbar'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'

export type PullRequestFiltersValue = {
  query: string
  repositories: string[]
  status: 'all' | 'ready' | 'draft'
  author: string
  reviewer: string
  checks: 'all' | 'clear' | 'pending' | 'failed'
  age: 'all' | 'day' | 'week' | 'month'
  label: string
  branch: 'all' | 'current' | 'behind'
  conventionalType: string
  service: string
}

type PullRequestFilterOptions = {
  authors: string[]
  reviewers: string[]
  labels: string[]
  types: string[]
  services: string[]
}

type FilterProps = {
  filters: PullRequestFiltersValue
  setFilters: Dispatch<SetStateAction<PullRequestFiltersValue>>
  repositories: Repository[]
  options: PullRequestFilterOptions
  activeCount: number
  advancedCount: number
  changeRequestLabelPlural: string
  onOpenMobile(): void
  onReset(): void
}

function FilterSelect({
  value,
  label,
  options,
  onChange,
}: {
  value: string
  label: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={`${label}:${optionValue}`} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RepositoryFilter({
  repositories,
  selected,
  onChange,
}: {
  repositories: Repository[]
  selected: string[]
  onChange: (repositories: string[]) => void
}) {
  const label = selected.length === 0 ? 'All repositories' : selected.length === 1 ? selected[0] : `${selected.length} repositories`
  function toggle(fullName: string, checked: boolean) {
    onChange(checked ? Array.from(new Set([...selected, fullName])) : selected.filter((item) => item !== fullName))
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between overflow-hidden font-normal">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-1rem))] p-1.5">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Repositories</span>
          {selected.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => onChange([])}>
              Show all
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {repositories.map((repo) => {
            const checked = selected.includes(repo.full_name)
            return (
              <Label
                key={repo.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 font-mono text-xs hover:bg-accent"
              >
                <Checkbox checked={checked} onCheckedChange={(value) => toggle(repo.full_name, Boolean(value))} />
                <span className="min-w-0 truncate">{repo.full_name}</span>
              </Label>
            )
          })}
        </div>
        {!repositories.length && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No repositories added.</p>}
      </PopoverContent>
    </Popover>
  )
}

type SelectFilterKey = Exclude<keyof PullRequestFiltersValue, 'query' | 'repositories'>

type SelectFilterDefinition = {
  key: SelectFilterKey
  label: string
  sheetLabel?: string
  options: [string, string][]
}

function selectFilterDefinitions(options: PullRequestFilterOptions): SelectFilterDefinition[] {
  return [
    {
      key: 'status',
      label: 'Status',
      options: [
        ['all', 'All PRs'],
        ['ready', 'Ready'],
        ['draft', 'Drafts'],
      ],
    },
    {
      key: 'author',
      label: 'Author',
      options: [['all', 'Any author'], ...options.authors.map((value) => [value, value] as [string, string])],
    },
    {
      key: 'reviewer',
      label: 'Reviewer',
      options: [
        ['all', 'Any reviewer'],
        ['mine', 'Assigned to me'],
        ['unassigned', 'Unassigned'],
        ...options.reviewers.map((value) => [value, value] as [string, string]),
      ],
    },
    {
      key: 'checks',
      label: 'Checks',
      options: [
        ['all', 'Any checks'],
        ['clear', 'Checks clear'],
        ['pending', 'Checks pending'],
        ['failed', 'Checks failed'],
      ],
    },
    {
      key: 'age',
      label: 'Age',
      options: [
        ['all', 'Any age'],
        ['day', 'Older than 1 day'],
        ['week', 'Older than 1 week'],
        ['month', 'Older than 1 month'],
      ],
    },
    {
      key: 'label',
      label: 'Label',
      options: [['all', 'Any label'], ...options.labels.map((value) => [value, value] as [string, string])],
    },
    {
      key: 'branch',
      label: 'Branch',
      sheetLabel: 'Branch state',
      options: [
        ['all', 'Any branch state'],
        ['current', 'Up to date'],
        ['behind', 'Behind base'],
      ],
    },
    {
      key: 'conventionalType',
      label: 'Type',
      sheetLabel: 'Change type',
      options: [['all', 'Any commit type'], ...options.types.map((value) => [value, value] as [string, string])],
    },
    {
      key: 'service',
      label: 'Service',
      options: [['all', 'Any service'], ...options.services.map((value) => [value, value] as [string, string])],
    },
  ]
}

function PullRequestSearch({
  filters,
  setFilters,
  changeRequestLabelPlural,
}: Pick<FilterProps, 'filters' | 'setFilters' | 'changeRequestLabelPlural'>) {
  return (
    <SearchInput
      value={filters.query}
      onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
      onClear={() => setFilters((current) => ({ ...current, query: '' }))}
      placeholder={`Search ${changeRequestLabelPlural}`}
      density="compact"
    />
  )
}

function PullRequestFilterSelect({
  definition,
  filters,
  setFilters,
}: {
  definition: SelectFilterDefinition
} & Pick<FilterProps, 'filters' | 'setFilters'>) {
  return (
    <FilterSelect
      value={filters[definition.key]}
      label={definition.label}
      options={definition.options}
      onChange={(value) => setFilters((current) => ({ ...current, [definition.key]: value }))}
    />
  )
}

function ActiveFilterChips({
  filters,
  setFilters,
  definitions,
  className,
}: Pick<FilterProps, 'filters' | 'setFilters'> & { definitions: SelectFilterDefinition[]; className?: string }) {
  const selected = definitions
    .filter((definition) => filters[definition.key] !== 'all')
    .map((definition) => ({
      key: definition.key,
      label: definition.options.find(([value]) => value === filters[definition.key])?.[1] || filters[definition.key],
    }))
  const repositoryLabel = filters.repositories.length === 1 ? filters.repositories[0] : `${filters.repositories.length} repositories`
  if (!filters.repositories.length && !selected.length) return null
  return (
    <div className={className} aria-label="Active pull request filters">
      {filters.repositories.length > 0 && (
        <Button
          variant="secondary"
          size="xs"
          className="h-6 max-w-52 gap-1 rounded-full px-2 text-[11px] font-normal"
          onClick={() => setFilters((current) => ({ ...current, repositories: [] }))}
        >
          <span className="truncate">{repositoryLabel}</span>
          <X className="size-3" />
          <span className="sr-only">Remove repository filter</span>
        </Button>
      )}
      {selected.map((item) => (
        <Button
          key={item.key}
          variant="secondary"
          size="xs"
          className="h-6 gap-1 rounded-full px-2 text-[11px] font-normal"
          onClick={() => setFilters((current) => ({ ...current, [item.key]: 'all' }))}
        >
          {item.label}
          <X className="size-3" />
          <span className="sr-only">Remove {item.label} filter</span>
        </Button>
      ))}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function PullRequestFilters({
  filters,
  setFilters,
  repositories,
  options,
  activeCount,
  advancedCount,
  changeRequestLabelPlural,
  onOpenMobile,
  onReset,
}: FilterProps) {
  const definitions = selectFilterDefinitions(options)
  const statusDefinition = definitions[0]
  const advancedDefinitions = definitions.slice(1)
  return (
    <>
      <FilterBar className="mb-1.5 border-0 bg-transparent p-1.5 lg:hidden">
        <PullRequestSearch filters={filters} setFilters={setFilters} changeRequestLabelPlural={changeRequestLabelPlural} />
        <FilterBarToggle label="Filter pull requests" count={activeCount} active={activeCount > 0} onClick={onOpenMobile}>
          <SlidersHorizontal />
        </FilterBarToggle>
      </FilterBar>
      <ActiveFilterChips
        filters={filters}
        setFilters={setFilters}
        definitions={definitions}
        className="mb-1.5 flex min-w-0 flex-nowrap gap-1 overflow-x-auto px-1.5 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
      />
      <Collapsible defaultOpen={false} className="hidden border-b lg:block">
        <div className="space-y-1.5 p-2">
          <div className="grid grid-cols-[minmax(0,1fr)_190px_125px_auto_auto] gap-1.5">
            <PullRequestSearch filters={filters} setFilters={setFilters} changeRequestLabelPlural={changeRequestLabelPlural} />
            <RepositoryFilter
              repositories={repositories}
              selected={filters.repositories}
              onChange={(next) => setFilters((current) => ({ ...current, repositories: next }))}
            />
            <PullRequestFilterSelect definition={statusDefinition} filters={filters} setFilters={setFilters} />
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                <SlidersHorizontal />
                More filters
                {advancedCount ? (
                  <Badge variant="secondary" className="ml-1 px-1.5">
                    {advancedCount}
                  </Badge>
                ) : null}
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" disabled={!activeCount} onClick={onReset}>
              Clear{activeCount ? ` (${activeCount})` : ''}
            </Button>
          </div>
          <ActiveFilterChips
            filters={filters}
            setFilters={setFilters}
            definitions={definitions}
            className="flex min-w-0 flex-wrap gap-1.5"
          />
          <CollapsibleContent>
            <div className="grid gap-2 lg:grid-cols-4 xl:grid-cols-8">
              {advancedDefinitions.map((definition) => (
                <PullRequestFilterSelect key={definition.key} definition={definition} filters={filters} setFilters={setFilters} />
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </>
  )
}

export function MobilePullRequestFilters({
  open,
  onOpenChange,
  filters,
  setFilters,
  repositories,
  options,
  activeCount,
  resultCount,
  onReset,
}: Omit<FilterProps, 'advancedCount' | 'changeRequestLabelPlural' | 'onOpenMobile'> & {
  open: boolean
  onOpenChange(open: boolean): void
  resultCount: number
}) {
  const definitions = selectFilterDefinitions(options)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[min(90dvh,48rem)] rounded-t-2xl p-0">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle>Filter pull requests</SheetTitle>
          <SheetDescription>Focus the inbox without losing your place.</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
          <FilterField label="Repositories">
            <RepositoryFilter
              repositories={repositories}
              selected={filters.repositories}
              onChange={(next) => setFilters((current) => ({ ...current, repositories: next }))}
            />
          </FilterField>
          {definitions.map((definition) => (
            <FilterField key={definition.key} label={definition.sheetLabel || definition.label}>
              <PullRequestFilterSelect definition={definition} filters={filters} setFilters={setFilters} />
            </FilterField>
          ))}
        </div>
        <SheetFooter className="grid grid-cols-2 border-t bg-background p-4">
          <Button variant="outline" disabled={!activeCount} onClick={onReset}>
            Clear all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Show {resultCount} PRs</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
