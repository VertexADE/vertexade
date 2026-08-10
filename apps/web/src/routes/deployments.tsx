import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, RefreshCw, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Spinner } from '@vertexade/ui/components/ui/spinner'
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
import type { DeploymentService } from '@vertexade/ui/lib/dashboard-types'
import { ServiceCard } from '../components/deployments/deployment-components'
import { normalizeDeploymentOverview, type RoutedDeploymentOverview, type RoutedDeploymentPayload } from '../lib/deployment-overview'

export const Route = createFileRoute('/deployments')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    status: ['all', 'attention', 'active', 'current'].includes(String(search.status))
      ? (String(search.status) as 'all' | 'attention' | 'active' | 'current')
      : undefined,
    q: typeof search.q === 'string' ? search.q.slice(0, 100) : undefined,
    target: typeof search.target === 'string' ? search.target.slice(0, 48) : undefined,
  }),
  component: DeploymentsPage,
})

type DeliveryStatus = 'all' | 'attention' | 'active' | 'current'
const deliveryStates: Record<DeliveryStatus, Set<DeploymentService['state']>> = {
  all: new Set(['deployed', 'deploying', 'waiting', 'failed', 'pending', 'outdated', 'unknown']),
  attention: new Set(['failed', 'outdated', 'unknown']),
  active: new Set(['deploying', 'waiting', 'pending']),
  current: new Set(['deployed']),
}

function matchesTarget(service: DeploymentService, target: string) {
  return target.length === 0 || service.target.id === target
}

function serviceSearchText(service: DeploymentService) {
  const latest = service.latest
  return [service.name, service.target.label, service.target.repository, latest ? latest.title : '', latest ? latest.sha : '']
    .join(' ')
    .toLowerCase()
}

function serviceMatches(service: DeploymentService, status: DeliveryStatus, query: string, target: string) {
  if (!matchesTarget(service, target)) return false
  if (!deliveryStates[status].has(service.state)) return false
  return serviceSearchText(service).includes(query)
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
  targets,
  target,
  onFiltersOpenChange,
  onChange,
}: {
  query: string
  status: DeliveryStatus
  counts: Record<DeliveryStatus, number>
  filtersOpen: boolean
  targets: RoutedDeploymentOverview['targets']
  target: string
  onFiltersOpenChange(open: boolean): void
  onChange(patch: { status?: DeliveryStatus; q?: string; target?: string }): void
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
      {targets.length > 1 && (
        <Select value={target || 'all'} onValueChange={(value) => onChange({ target: value === 'all' ? undefined : value })}>
          <SelectTrigger size="sm" className="max-w-48" aria-label="Deployment target">
            <SelectValue placeholder="All targets" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All targets</SelectItem>
              {targets.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
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
  target,
  rerunning,
  onFilter,
  onRerun,
}: {
  data: RoutedDeploymentOverview
  query: string
  status: DeliveryStatus
  target: string
  rerunning: string | null
  onFilter(patch: { status?: DeliveryStatus; q?: string; target?: string }): void
  onRerun(service: DeploymentService): void
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const selectedTarget = data.targets.some((item) => item.id === target) ? target : ''
  const targetServices = data.services.filter((service) => !selectedTarget || service.target.id === selectedTarget)
  const visibleServices = data.services.filter((service) => serviceMatches(service, status, query.trim().toLowerCase(), selectedTarget))
  const counts = Object.fromEntries(
    (['all', 'attention', 'active', 'current'] as const).map((filter) => [
      filter,
      targetServices.filter((service) => deliveryStates[filter].has(service.state)).length,
    ]),
  ) as Record<DeliveryStatus, number>
  return (
    <>
      <DeliveryFilterBar
        query={query}
        status={status}
        counts={counts}
        filtersOpen={filtersOpen}
        targets={data.targets}
        target={selectedTarget}
        onFiltersOpenChange={setFiltersOpen}
        onChange={onFilter}
      />
      <div className="grid gap-3 min-[2100px]:grid-cols-2 min-[2100px]:items-start">
        {visibleServices.map((service) => (
          <ServiceCard key={service.key} service={service} rerunning={rerunning === service.key} onRerun={() => onRerun(service)} />
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

function deliveryFilters(search: { status?: DeliveryStatus; q?: string; target?: string }) {
  return {
    status: search.status ?? 'all',
    query: search.q ?? '',
    target: search.target ?? '',
  }
}

function deliveryEyebrow(data: RoutedDeploymentOverview | null) {
  if (!data) return 'Service deployments'
  if (!data.targets.length) return 'No enabled deployment targets'
  return data.targets.length === 1 ? `${data.repository} · ${data.workflow}` : `${data.targets.length} deployment targets`
}

function NoDeploymentTargets() {
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Settings2 />
        </EmptyMedia>
        <EmptyTitle>No deployment targets enabled</EmptyTitle>
        <EmptyDescription>Configure one or more GitHub Actions targets on this server to populate Delivery.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <a href="/extensions/github">Configure GitHub deployments</a>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function DeliveryLoading({ loading }: { loading: boolean }) {
  if (!loading) return null
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>Loading deployment history</EmptyTitle>
        <EmptyDescription>Collecting service and environment state.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function DeliveryContent({
  data,
  loading,
  query,
  status,
  target,
  rerunning,
  onFilter,
  onRerun,
}: {
  data: RoutedDeploymentOverview | null
  loading: boolean
  query: string
  status: DeliveryStatus
  target: string
  rerunning: string | null
  onFilter(patch: { status?: DeliveryStatus; q?: string; target?: string }): void
  onRerun(service: DeploymentService): void
}) {
  if (!data) return <DeliveryLoading loading={loading} />
  if (!data.targets.length) return <NoDeploymentTargets />
  return (
    <DeliveryOverview
      data={data}
      query={query}
      status={status}
      target={target}
      rerunning={rerunning}
      onFilter={onFilter}
      onRerun={onRerun}
    />
  )
}

function DeploymentsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const confirmAction = useConfirm()
  const [data, setData] = useState<RoutedDeploymentOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rerunning, setRerunning] = useState<string | null>(null)
  const load = useCallback(async (force = false) => {
    setLoading(true)
    setLoadError('')
    try {
      const overview = await api<RoutedDeploymentPayload>(`/api/deployments${force ? '?refresh=1' : ''}`)
      setData(normalizeDeploymentOverview(overview))
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const { status, query, target } = deliveryFilters(search)
  const updateSearch = (patch: { status?: DeliveryStatus; q?: string; target?: string }) =>
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
    setRerunning(service.key)
    try {
      await api(`/api/deployments/runs/${service.latest.run_id}/rerun`, {
        method: 'POST',
        body: JSON.stringify({ mode: failedOnly ? 'failed' : 'all', provider: data?.provider.id, target_id: service.target.id }),
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
        description="Track independently configured workflows, services, and promotion environments on this server."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="/extensions/github">
                <Settings2 />
                <span className="hidden sm:inline">Configure</span>
              </a>
            </Button>
            <Button variant="outline" size="sm" disabled={loading} aria-label="Force refresh deployments" onClick={() => void load(true)}>
              {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              <span className="hidden sm:inline">{loading ? 'Refreshing…' : 'Force refresh'}</span>
            </Button>
          </div>
        }
      />
      <DeliveryLoadError message={loadError} onRetry={() => void load(true)} />
      <DeliveryContent
        data={data}
        loading={loading}
        query={query}
        status={status}
        target={target}
        rerunning={rerunning}
        onFilter={updateSearch}
        onRerun={(service) => void rerun(service)}
      />
    </WorkspacePage>
  )
}
