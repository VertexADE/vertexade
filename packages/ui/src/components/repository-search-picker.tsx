import { useEffect, useState } from 'react'
import { Building2, Check, ChevronsUpDown, Globe2, LoaderCircle, LockKeyhole, Search } from 'lucide-react'
import type { ScmRepositorySearchPage, ScmRepositorySearchResult } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@vertexade/ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'

function useRepositorySearch(backendId: string | undefined, open: boolean) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<ScmRepositorySearchPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        setError('')
        const params = new URLSearchParams({ q: query.trim(), limit: '30' })
        void backendApi<ScmRepositorySearchPage>(backendId, `/api/scm/repositories?${params}`, { signal: controller.signal })
          .then(setPage)
          .catch((cause: unknown) => {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Repositories could not be searched')
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
      },
      query ? 250 : 0,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [backendId, open, query])
  return { query, setQuery, page, loading, error }
}

function RepositoryResult({ repository, added, onSelect }: { repository: ScmRepositorySearchResult; added: boolean; onSelect(): void }) {
  const Icon = repository.private ? LockKeyhole : repository.ownerType === 'organization' ? Building2 : Globe2
  return (
    <CommandItem value={repository.id} disabled={added} onSelect={onSelect}>
      <Icon />
      <span className="min-w-0 flex-1">
        <strong className="block truncate font-medium">{repository.name}</strong>
        {repository.description && <small className="block truncate text-muted-foreground">{repository.description}</small>}
      </span>
      {repository.source === 'public' && <Badge variant="outline">Public fallback</Badge>}
      {added && <Check />}
    </CommandItem>
  )
}

// fallow-ignore-next-line complexity -- explicit loading, error, empty, and result states keep async search feedback mutually exclusive.
function RepositorySearchResults({
  page,
  loading,
  error,
  addedNames,
  onSelect,
}: {
  page: ScmRepositorySearchPage | null
  loading: boolean
  error: string
  addedNames: Set<string>
  onSelect(repository: ScmRepositorySearchResult): void
}) {
  if (loading && !page)
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
        <LoaderCircle className="animate-spin" />
        Loading repositories…
      </div>
    )
  if (error) return <CommandEmpty>{error}</CommandEmpty>
  if (!page) return loading ? null : <CommandEmpty>No repositories found.</CommandEmpty>
  if (!page.repositories.length) return <CommandEmpty>No repositories found.</CommandEmpty>
  return <RepositoryResultGroup page={page} addedNames={addedNames} onSelect={onSelect} />
}

function RepositoryResultGroup({
  page,
  addedNames,
  onSelect,
}: {
  page: ScmRepositorySearchPage
  addedNames: Set<string>
  onSelect(repository: ScmRepositorySearchResult): void
}) {
  const heading = page.source === 'public' ? 'Public GitHub results' : 'Accessible repositories'
  return (
    <CommandGroup heading={heading}>
      {page.repositories.map((repository) => (
        <RepositoryResult
          key={repository.id}
          repository={repository}
          added={addedNames.has(repository.id.toLowerCase())}
          onSelect={() => onSelect(repository)}
        />
      ))}
    </CommandGroup>
  )
}

export function RepositorySearchPicker({
  backendId,
  added = [],
  disabled,
  onSelect,
}: {
  backendId?: string
  added?: string[]
  disabled?: boolean
  onSelect(repository: ScmRepositorySearchResult): void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { query, setQuery, page, loading, error } = useRepositorySearch(backendId, open)
  const addedNames = new Set(added.map((name) => name.toLowerCase()))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between" disabled={disabled}>
          <span className="flex min-w-0 items-center gap-2">
            <Search data-icon="inline-start" />
            Search accessible repositories
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-1rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search private and organization repositories…" />
          <CommandList className="max-h-80">
            <RepositorySearchResults
              page={page}
              loading={loading}
              error={error}
              addedNames={addedNames}
              onSelect={(repository) => {
                void onSelect(repository)
                setOpen(false)
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
