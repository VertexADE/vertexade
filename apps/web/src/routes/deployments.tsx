import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import {
  StatusPanel,
  StatusPanelActions,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from '@vertexade/ui/components/ui/status'
import { FilterBar, FilterBarControls, FilterBarToggle, FilterChip, ToolbarGroup } from '@vertexade/ui/components/ui/toolbar'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { age, api } from '@vertexade/ui/lib/dashboard-api'
import type { DeploymentOverview, DeploymentService } from '@vertexade/ui/lib/dashboard-types'
import { ServiceCard } from '../components/deployments/deployment-components'

export const Route = createFileRoute('/deployments')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    status: ['all', 'attention', 'active', 'current'].includes(String(search.status))
      ? (String(search.status) as 'all' | 'attention' | 'active' | 'current')
      : undefined,
    q: typeof search.q === 'string' ? search.q.slice(0, 100) : undefined,
  }),
  component: DeploymentsPage,
})

type RoutedDeploymentOverview = DeploymentOverview & {
  provider: { id: string; name: string }
}

type DeliveryStatus = 'all' | 'attention' | 'active' | 'current'
const deliveryStates: Record<DeliveryStatus, Set<DeploymentService['state']>> = {
  all: new Set(['deployed', 'deploying', 'waiting', 'failed', 'pending', 'outdated', 'unknown']),
  attention: new Set(['failed', 'outdated', 'unknown']),
  active: new Set(['deploying', 'waiting', 'pending']),
  current: new Set(['deployed']),
}

function serviceMatches(service: DeploymentService, status: DeliveryStatus, query: string) {
  const haystack = [service.name, service.latest?.title, service.latest?.sha].join(' ').toLowerCase()
  return deliveryStates[status].has(service.state) && haystack.includes(query)
}

function DeliveryLoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  if (!message) return null
  return (
    <StatusPanel tone="danger" className="mb-4">
      <AlertTriangle />
      <StatusPanelContent>
        <StatusPanelTitle>Delivery data could not be refreshed</StatusPanelTitle>
        <StatusPanelDescription>{message}</StatusPanelDescription>
      </StatusPanelContent>
      <StatusPanelActions>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      </StatusPanelActions>
    </StatusPanel>
  )
}

function DeliveryFilterBar({
  query,
  status,
  counts,
  filtersOpen,
  onFiltersOpenChange,
  onChange,
}: {
  query: string
  status: DeliveryStatus
  counts: Record<DeliveryStatus, number>
  filtersOpen: boolean
  onFiltersOpenChange(open: boolean): void
  onChange(patch: { status?: DeliveryStatus; q?: string }): void
}) {
  return (
    <FilterBar className="mb-3">
      <SearchInput
        containerClassName="flex-1"
        density="compact"
        value={query}
        onChange={(event) => onChange({ q: event.target.value || undefined })}
        onClear={() => onChange({ q: undefined })}
        placeholder="Filter services or commits"
        clearLabel="Clear delivery search"
      />
      <FilterBarToggle
        label="Delivery filters"
        count={status === 'all' ? 0 : 1}
        active={status !== 'all'}
        aria-expanded={filtersOpen}
        aria-controls="delivery-status-filters"
        onClick={() => onFiltersOpenChange(!filtersOpen)}
      >
        <SlidersHorizontal />
      </FilterBarToggle>
      <FilterBarControls id="delivery-status-filters" open={filtersOpen}>
        <ToolbarGroup className="col-span-2" aria-label="Delivery status filters">
          {(['all', 'attention', 'active', 'current'] as const).map((value) => (
            <FilterChip
              key={value}
              type="button"
              active={status === value}
              count={counts[value]}
              className="shrink-0 capitalize"
              onClick={() => onChange({ status: value === 'all' ? undefined : value })}
            >
              {value}
            </FilterChip>
          ))}
        </ToolbarGroup>
      </FilterBarControls>
    </FilterBar>
  )
}

function DeliveryOverview({
  data,
  query,
  status,
  rerunning,
  onFilter,
  onRerun,
}: {
  data: RoutedDeploymentOverview
  query: string
  status: DeliveryStatus
  rerunning: number | null
  onFilter(patch: { status?: DeliveryStatus; q?: string }): void
  onRerun(service: DeploymentService): void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const visibleServices = data.services.filter((service) => serviceMatches(service, status, query.trim().toLowerCase()))
  const counts = Object.fromEntries(
    (['all', 'attention', 'active', 'current'] as const).map((filter) => [
      filter,
      data.services.filter((service) => deliveryStates[filter].has(service.state)).length,
    ]),
  ) as Record<DeliveryStatus, number>
  return (
    <>
      <DeliveryFilterBar
        query={query}
        status={status}
        counts={counts}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        onChange={onFilter}
      />
      <div className="grid gap-3 min-[2100px]:grid-cols-2 min-[2100px]:items-start">
        {visibleServices.map((service) => (
          <ServiceCard
            key={service.name}
            service={service}
            rerunning={rerunning === service.latest?.run_id}
            onRerun={() => onRerun(service)}
          />
        ))}
      </div>
      {!visibleServices.length && (
        <Empty className="min-h-52">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No services match</EmptyTitle>
            <EmptyDescription>Adjust the search or status filter to bring services back into view.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <p className="mt-4 text-right text-xs text-muted-foreground">
        Live from {data.provider.name} · refreshed {age(data.refreshed_at)}
      </p>
    </>
  )
}

function deliveryFilters(search: { status?: DeliveryStatus; q?: string }) {
  return {
    status: search.status ?? 'all',
    query: search.q ?? '',
  }
}

function deliveryEyebrow(data: RoutedDeploymentOverview | null) {
  return data ? `${data.repository} · ${data.workflow}` : 'Service deployments'
}

function DeliveryContent({
  data,
  loading,
  query,
  status,
  rerunning,
  onFilter,
  onRerun,
}: {
  data: RoutedDeploymentOverview | null
  loading: boolean
  query: string
  status: DeliveryStatus
  rerunning: number | null
  onFilter(patch: { status?: DeliveryStatus; q?: string }): void
  onRerun(service: DeploymentService): void
}) {
  if (data)
    return <DeliveryOverview data={data} query={query} status={status} rerunning={rerunning} onFilter={onFilter} onRerun={onRerun} />
  if (loading)
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>Loading deployment history</EmptyTitle>
          <EmptyDescription>Collecting service and environment state.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return null
}

function DeploymentsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const confirmAction = useConfirm()
  const [data, setData] = useState<RoutedDeploymentOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rerunning, setRerunning] = useState<number | null>(null)
  const load = useCallback(async (force = false) => {
    setLoading(true)
    setLoadError('')
    try {
      const overview = await api<RoutedDeploymentOverview>(`/api/deployments${force ? '?refresh=1' : ''}`)
      setData(overview)
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const { status, query } = deliveryFilters(search)
  const updateSearch = (patch: { status?: DeliveryStatus; q?: string }) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace: true,
      resetScroll: false,
    })

  async function rerun(service: DeploymentService) {
    if (!service.latest) return
    const failedOnly = service.latest.conclusion === 'failure'
    const confirmed = await confirmAction({
      title: failedOnly ? `Retry failed jobs for ${service.name}?` : `Rerun ${service.name}?`,
      description: `This requests a new workflow run for commit ${service.latest.sha.slice(0, 7)}. Existing deployment history is retained.`,
      confirmLabel: failedOnly ? 'Retry failed jobs' : 'Rerun workflow',
    })
    if (!confirmed) return
    setRerunning(service.latest.run_id)
    try {
      await api(`/api/deployments/runs/${service.latest.run_id}/rerun`, {
        method: 'POST',
        body: JSON.stringify({ mode: failedOnly ? 'failed' : 'all', provider: data?.provider.id }),
      })
      toast.success(`Deployment rerun requested for ${service.name}`)
      await load(true)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRerunning(null)
    }
  }

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={deliveryEyebrow(data)}
        title="Delivery"
        description="Affected services move through dev, acceptance, and production in sequence."
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={loading}
            loadingText="Refreshing…"
            aria-label="Force refresh deployments"
            onClick={() => void load(true)}
          >
            <RefreshCw />
            <span className="hidden sm:inline">Force refresh</span>
          </Button>
        }
      />
      <DeliveryLoadError message={loadError} onRetry={() => void load(true)} />
      <DeliveryContent
        data={data}
        loading={loading}
        query={query}
        status={status}
        rerunning={rerunning}
        onFilter={updateSearch}
        onRerun={(service) => void rerun(service)}
      />
    </WorkspacePage>
  )
}
