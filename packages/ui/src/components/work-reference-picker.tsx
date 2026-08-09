import { useMemo, useState } from 'react'
import { Link2, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@vertexade/ui/components/ui/collapsible'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'
import type { WorkReferenceCatalog, WorkReferenceSelection, WorkResource } from '@vertexade/ui/lib/dashboard-types'

function identity(reference: Pick<WorkReferenceSelection, 'provider' | 'kind' | 'externalId'>) {
  return `${reference.provider}:${reference.kind}:${reference.externalId}`
}

function displayProvider(reference: WorkReferenceSelection) {
  return reference.providerName ? reference.providerName : reference.provider
}

function optionalText(value: string | null | undefined) {
  return value ? value : ''
}

function catalogReferences(catalog: WorkReferenceCatalog | null) {
  return catalog ? catalog.references : []
}

function matchesQuery(reference: WorkReferenceSelection, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [displayProvider(reference), reference.label, optionalText(reference.summary), optionalText(reference.state)]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function nextSelection(selected: WorkReferenceSelection[], reference: WorkReferenceSelection, checked: boolean) {
  const key = identity(reference)
  if (!checked) return selected.filter((item) => identity(item) !== key)
  if (selected.some((item) => identity(item) === key)) return selected
  if (selected.length >= 24) throw new Error('Choose no more than 24 references')
  return [...selected, reference]
}

function checkedUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Enter a valid http or https URL')
  }
  if (!new Set(['http:', 'https:']).has(parsed.protocol)) throw new Error('Reference URLs must use http or https')
  return parsed.toString()
}

function manualReference(labelValue: string, urlValue: string): WorkReferenceSelection {
  const label = labelValue.trim()
  const url = urlValue.trim()
  if (!label) throw new Error('Enter a label and URL')
  if (!url) throw new Error('Enter a label and URL')
  const checked = checkedUrl(url)
  return {
    provider: 'web',
    providerName: 'Web link',
    kind: 'link',
    externalId: checked,
    label,
    url: checked,
  }
}

export function resourceReference(resource: WorkResource): WorkReferenceSelection {
  return {
    provider: resource.provider,
    kind: resource.kind,
    externalId: resource.external_id,
    label: resource.label,
    url: resource.url,
    state: resource.state,
    summary: String(resource.metadata.summary || ''),
    metadata: resource.metadata,
  }
}

function PickerHeader({ open, count }: { open: boolean; count: number }) {
  return (
    <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 py-2">
      <Link2 className="size-4 shrink-0 text-cyan-400" />
      <div className="min-w-0 flex-1">
        <strong className="block text-xs">Context references</strong>
        <small className="block text-xs leading-relaxed text-muted-foreground">
          Combine items from multiple systems into one shared outcome.
        </small>
      </div>
      <Badge variant="secondary" className="shrink-0">
        {count}
      </Badge>
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="shrink-0">
          {open ? 'Done' : 'Choose'}
        </Button>
      </CollapsibleTrigger>
    </div>
  )
}

function SelectedReferences({
  selected,
  onRemove,
}: {
  selected: WorkReferenceSelection[]
  onRemove(reference: WorkReferenceSelection): void
}) {
  if (!selected.length) return null
  return (
    <div className="flex flex-wrap gap-1 border-t px-3 py-2">
      {selected.map((reference) => (
        <Badge key={identity(reference)} variant="outline" className="max-w-full gap-1">
          <span className="max-w-64 truncate">
            {displayProvider(reference)} · {reference.label}
          </span>
          <button type="button" aria-label={`Remove ${reference.label}`} onClick={() => onRemove(reference)}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  )
}

function ReferenceState({ state }: { state?: string | null }) {
  if (!state) return null
  return (
    <Badge variant="secondary" className="text-xs">
      {state}
    </Badge>
  )
}

function ReferenceSummary({ summary }: { summary?: string | null }) {
  if (!summary) return null
  return (
    <small className="mt-0.5 block min-w-0 max-w-full break-words line-clamp-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
      {summary}
    </small>
  )
}

function ReferenceList({
  references,
  selectedIds,
  loading,
  catalogLoaded,
  onToggle,
}: {
  references: WorkReferenceSelection[]
  selectedIds: Set<string>
  loading: boolean
  catalogLoaded: boolean
  onToggle(reference: WorkReferenceSelection, checked: boolean): void
}) {
  if (loading && !catalogLoaded)
    return (
      <div className="max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border p-1.5">
        <p className="p-5 text-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 inline size-4 animate-spin" />
          Loading connected systems…
        </p>
      </div>
    )
  if (!references.length)
    return (
      <div className="max-h-56 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border p-1.5">
        <p className="p-5 text-center text-xs text-muted-foreground">No connected items match this search.</p>
      </div>
    )
  return (
    <div className="max-h-56 min-w-0 space-y-1 overflow-y-auto overflow-x-hidden rounded-md border p-1.5">
      {references.map((reference) => (
        <Label
          key={identity(reference)}
          className="flex w-full min-w-0 max-w-full cursor-pointer items-start gap-2 overflow-hidden rounded-md p-2 hover:bg-accent"
        >
          <Checkbox
            className="mt-0.5 shrink-0"
            checked={selectedIds.has(identity(reference))}
            onCheckedChange={(value) => onToggle(reference, Boolean(value))}
          />
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <strong className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">{reference.label}</strong>
              <Badge variant="outline" className="shrink-0 text-xs">
                {displayProvider(reference)}
              </Badge>
              <ReferenceState state={reference.state} />
            </span>
            <ReferenceSummary summary={reference.summary} />
          </span>
        </Label>
      ))}
    </div>
  )
}

function UnavailableProviders({ catalog }: { catalog: WorkReferenceCatalog | null }) {
  const unavailable = catalog ? catalog.providers.filter((provider) => !provider.available) : []
  if (!unavailable.length) return null
  return (
    <p className="text-xs text-amber-400">
      Unavailable now: {unavailable.map((provider) => provider.name).join(', ')}. Other systems remain selectable.
    </p>
  )
}

function RefreshIcon({ loading }: { loading: boolean }) {
  if (loading) return <Loader2 className="animate-spin" />
  return <RefreshCw />
}

function PickerContent({
  catalog,
  visible,
  selectedIds,
  loading,
  query,
  manualLabel,
  manualUrl,
  onQuery,
  onRefresh,
  onToggle,
  onManualLabel,
  onManualUrl,
  onAddManual,
}: {
  catalog: WorkReferenceCatalog | null
  visible: WorkReferenceSelection[]
  selectedIds: Set<string>
  loading: boolean
  query: string
  manualLabel: string
  manualUrl: string
  onQuery(value: string): void
  onRefresh(): void
  onToggle(reference: WorkReferenceSelection, checked: boolean): void
  onManualLabel(value: string): void
  onManualUrl(value: string): void
  onAddManual(): void
}) {
  return (
    <CollapsibleContent className="min-w-0 space-y-3 overflow-hidden border-t p-3">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search connected work providers…"
            className="pl-8"
          />
        </div>
        <Button type="button" size="icon-sm" variant="outline" disabled={loading} aria-label="Refresh references" onClick={onRefresh}>
          <RefreshIcon loading={loading} />
        </Button>
      </div>
      <ReferenceList
        references={visible}
        selectedIds={selectedIds}
        loading={loading}
        catalogLoaded={Boolean(catalog)}
        onToggle={onToggle}
      />
      <UnavailableProviders catalog={catalog} />
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2 rounded-md border border-dashed p-2">
        <Input value={manualLabel} onChange={(event) => onManualLabel(event.target.value)} placeholder="Reference label" />
        <Input type="url" value={manualUrl} onChange={(event) => onManualUrl(event.target.value)} placeholder="https://…" />
        <Button type="button" variant="outline" onClick={onAddManual}>
          <Plus />
          Add link
        </Button>
      </div>
    </CollapsibleContent>
  )
}

export function WorkReferencePicker({
  selected,
  onChange,
  backendId,
}: {
  selected: WorkReferenceSelection[]
  onChange: (references: WorkReferenceSelection[]) => void
  backendId?: string
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<WorkReferenceCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [manualLabel, setManualLabel] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const selectedIds = useMemo(() => new Set(selected.map(identity)), [selected])
  const visible = useMemo(() => catalogReferences(catalog).filter((reference) => matchesQuery(reference, query)), [catalog, query])

  async function load(forceRefresh = false) {
    setLoading(true)
    try {
      setCatalog(await backendApi<WorkReferenceCatalog>(backendId, `/api/work-references${forceRefresh ? '?force_refresh=1' : ''}`))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function toggle(reference: WorkReferenceSelection, checked: boolean) {
    try {
      onChange(nextSelection(selected, reference, checked))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  function addManual() {
    try {
      toggle(manualReference(manualLabel, manualUrl), true)
      setManualLabel('')
      setManualUrl('')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  function changeOpen(value: boolean) {
    setOpen(value)
    if (value && !catalog && !loading) void load()
  }

  return (
    <Collapsible open={open} onOpenChange={changeOpen} className="min-w-0 overflow-hidden rounded-lg border">
      <PickerHeader open={open} count={selected.length} />
      <SelectedReferences selected={selected} onRemove={(reference) => toggle(reference, false)} />
      <PickerContent
        catalog={catalog}
        visible={visible}
        selectedIds={selectedIds}
        loading={loading}
        query={query}
        manualLabel={manualLabel}
        manualUrl={manualUrl}
        onQuery={setQuery}
        onRefresh={() => void load(true)}
        onToggle={toggle}
        onManualLabel={setManualLabel}
        onManualUrl={setManualUrl}
        onAddManual={addManual}
      />
    </Collapsible>
  )
}
