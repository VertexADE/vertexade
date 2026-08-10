import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, GitFork, Pause, Play, RefreshCw, ShieldCheck, SkipForward, Waves } from 'lucide-react'
import { toast } from 'sonner'
import type { MigrationCampaign, MigrationRecipe } from '@vertexade/platform-contracts'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { backendApiPath, displayBackendId, type BackendAttributed, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { Repository } from '@vertexade/ui/lib/dashboard-types'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

export const Route = createFileRoute('/migrations')({
  ssr: false,
  component: MigrationCampaignsPage,
})

type BackendRecipe = MigrationRecipe & BackendAttributed
type BackendCampaign = MigrationCampaign & BackendAttributed

type BackendData = {
  backend: BackendDescriptor
  recipes: BackendRecipe[]
  campaigns: BackendCampaign[]
  error: string | null
}

const stateVariant = {
  draft: 'secondary',
  preflighting: 'secondary',
  awaiting_approval: 'outline',
  running: 'outline',
  paused: 'destructive',
  awaiting_wave_approval: 'outline',
  completed: 'outline',
  cancelled: 'secondary',
  failed: 'destructive',
} as const

function recipeIdentity(recipe: MigrationRecipe): string {
  return `${recipe.key}@${recipe.version}`
}

function CampaignTargetList({ campaign }: { campaign: BackendCampaign }) {
  return (
    <div className="divide-y rounded-md border">
      {campaign.targets.map((target) => (
        <div key={target.id} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_5rem_9rem] sm:items-center">
          <div className="min-w-0">
            <strong className="block truncate text-sm">{target.repositoryName}</strong>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {target.baseRevision.slice(0, 8)} · {target.applicabilityReason || 'Awaiting preflight'}
            </span>
            {target.predictedChanges.map((change) => (
              <span key={`${target.id}:${change.path}`} className="block text-xs text-muted-foreground">
                {change.summary}: {change.before} → {change.after}
              </span>
            ))}
            {target.outputRevision && (
              <span className="block truncate font-mono text-xs text-muted-foreground">
                output {target.outputRevision.slice(0, 8)} · impact {target.impactAnalysisId || 'unavailable'} ·{' '}
                {target.validationRunIds.length} validation run{target.validationRunIds.length === 1 ? '' : 's'}
                {target.evidenceSnapshotId ? ` · evidence ${target.evidenceSnapshotId}` : ''}
              </span>
            )}
            {target.pullRequestUrl && (
              <a className="block text-xs text-primary hover:underline" href={target.pullRequestUrl} target="_blank" rel="noreferrer">
                Pull request {target.pullRequestNumber || ''}
              </a>
            )}
            {target.error && <span className="block text-xs text-destructive">{target.error}</span>}
          </div>
          <Badge variant="outline">Wave {target.wave === 0 ? 'canary' : target.wave}</Badge>
          <Badge variant={target.state === 'failed' || target.state === 'stale' ? 'destructive' : 'secondary'}>
            {target.state.replaceAll('_', ' ')}
          </Badge>
        </div>
      ))}
    </div>
  )
}

export function CampaignCard({
  campaign,
  busy,
  writeApproved,
  createPullRequests,
  onWriteApprovedChange,
  onCreatePullRequestsChange,
  onControl,
}: {
  campaign: BackendCampaign
  busy: boolean
  writeApproved: boolean
  createPullRequests: boolean
  onWriteApprovedChange(value: boolean): void
  onCreatePullRequestsChange(value: boolean): void
  onControl(action: string, extra?: Record<string, unknown>): void
}) {
  const needsApproval = campaign.state === 'awaiting_approval' || campaign.state === 'awaiting_wave_approval'
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {campaign.recipe.name}
          <Badge variant={stateVariant[campaign.state]}>{campaign.state.replaceAll('_', ' ')}</Badge>
          <Badge variant="outline">{campaign.backend_name || campaign.backend_id || 'Local server'}</Badge>
        </CardTitle>
        <CardDescription>
          Child #{displayBackendId(campaign, campaign.id)} · group {campaign.federationGroupId} · recipe v{campaign.recipe.version} · wave{' '}
          {campaign.currentWave}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {campaign.state === 'draft' && (
            <Button size="sm" disabled={busy} onClick={() => onControl('preflight')}>
              <ShieldCheck data-icon="inline-start" /> Run preflight
            </Button>
          )}
          {campaign.state === 'running' && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onControl('refresh')}>
                <RefreshCw data-icon="inline-start" /> Reconcile
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onControl('pause')}>
                <Pause data-icon="inline-start" /> Pause scheduling
              </Button>
            </>
          )}
          {campaign.state === 'paused' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onControl('resume')}>
              <Play data-icon="inline-start" /> Resume
            </Button>
          )}
          {!['completed', 'cancelled'].includes(campaign.state) && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onControl('cancel')}>
              Cancel
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Applicable', campaign.targets.filter((target) => target.applicability === 'applicable').length],
            ['Running', campaign.counts.running],
            ['Succeeded', campaign.counts.succeeded],
            ['Failed', campaign.counts.failed + campaign.counts.preflight_failed + campaign.counts.stale],
            ['Skipped', campaign.counts.skipped + campaign.counts.not_applicable],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border bg-muted/20 p-2">
              <strong className="block font-mono text-lg">{value}</strong>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
        {needsApproval && (
          <div className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-3">
              <Checkbox checked={writeApproved} onCheckedChange={(checked) => onWriteApprovedChange(checked === true)} />
              <div className="min-w-0 flex-1">
                <strong className="block text-sm">Approve repository writes for this child campaign</strong>
                <span className="text-xs text-muted-foreground">
                  {campaign.state === 'awaiting_approval'
                    ? 'Starts only the canary wave. Pull-request publication remains separately controlled.'
                    : `Starts wave ${campaign.currentWave + 1}. Previous-wave results remain preserved.`}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Label className="flex flex-1 items-center gap-2 text-xs">
                <Checkbox checked={createPullRequests} onCheckedChange={(checked) => onCreatePullRequestsChange(checked === true)} />
                Also authorize draft pull-request creation for launched targets
              </Label>
              <Button
                disabled={busy || !writeApproved}
                onClick={() =>
                  onControl(campaign.state === 'awaiting_approval' ? 'approve' : 'approve_wave', {
                    confirmWrites: true,
                    createPullRequests,
                  })
                }
              >
                <Waves data-icon="inline-start" /> Approve {campaign.state === 'awaiting_approval' ? 'canary' : 'next wave'}
              </Button>
            </div>
          </div>
        )}
        {campaign.state === 'paused' && campaign.targets.some((target) => target.state === 'failed') && (
          <div className="flex flex-wrap gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="text-destructive" />
            <span className="min-w-0 flex-1 text-sm">A target failed. Retry or explicitly skip it before approving later waves.</span>
            {campaign.targets
              .filter((target) => target.state === 'failed' && target.attemptCount < 3)
              .map((target) => (
                <Button
                  key={target.id}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onControl('retry', { targetId: target.id })}
                >
                  Retry {target.repositoryName}
                </Button>
              ))}
          </div>
        )}
        <CampaignTargetList campaign={campaign} />
      </CardContent>
    </Card>
  )
}

function MigrationCampaignsPage() {
  const repositories = useRxDashboardCollection<Repository>('repositories').values
  const [backendData, setBackendData] = useState<BackendData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRepositories, setSelectedRepositories] = useState<Set<number>>(new Set())
  const [selectedRecipe, setSelectedRecipe] = useState('')
  const [canaryCount, setCanaryCount] = useState(1)
  const [waveSize, setWaveSize] = useState(5)
  const [concurrency, setConcurrency] = useState(2)
  const [creating, setCreating] = useState(false)
  const [busyCampaign, setBusyCampaign] = useState<number | null>(null)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  const [approvedCampaigns, setApprovedCampaigns] = useState<Set<number>>(new Set())
  const [publishCampaigns, setPublishCampaigns] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const registry = await api<{ backends: BackendDescriptor[] }>('/api/backends')
      const data = await Promise.all(
        registry.backends.map(async (backend): Promise<BackendData> => {
          if (!backend.connected && !backend.isDefault)
            return { backend, recipes: [], campaigns: [], error: backend.error || 'Server unavailable' }
          try {
            const [recipeResult, campaignResult] = await Promise.all([
              api<{ recipes: BackendRecipe[] }>(backendApiPath('/api/migration-recipes', backend.id)),
              api<{ campaigns: BackendCampaign[] }>(backendApiPath('/api/migration-campaigns', backend.id)),
            ])
            return { backend, recipes: recipeResult.recipes, campaigns: campaignResult.campaigns, error: null }
          } catch (error) {
            return { backend, recipes: [], campaigns: [], error: (error as Error).message }
          }
        }),
      )
      setBackendData(data)
      const firstRecipe = data.flatMap((entry) => entry.recipes)[0]
      if (firstRecipe) setSelectedRecipe((current) => current || recipeIdentity(firstRecipe))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void load(), [load])

  const recipes = useMemo(() => {
    const unique = new Map<string, BackendRecipe>()
    for (const recipe of backendData.flatMap((entry) => entry.recipes))
      if (!unique.has(recipeIdentity(recipe))) unique.set(recipeIdentity(recipe), recipe)
    return [...unique.values()]
  }, [backendData])

  const groupedCampaigns = useMemo(() => {
    const groups = new Map<string, BackendCampaign[]>()
    for (const campaign of backendData.flatMap((entry) => entry.campaigns)) {
      const group = groups.get(campaign.federationGroupId) || []
      group.push(campaign)
      groups.set(campaign.federationGroupId, group)
    }
    return [...groups.entries()].sort((left, right) => (right[1][0]?.createdAt || '').localeCompare(left[1][0]?.createdAt || ''))
  }, [backendData])
  const defaultBackendId = backendData.find((entry) => entry.backend.isDefault)?.backend.id

  const toggleRepository = (repositoryId: number, checked: boolean) =>
    setSelectedRepositories((current) => {
      const next = new Set(current)
      if (checked) next.add(repositoryId)
      else next.delete(repositoryId)
      return next
    })

  const create = useCallback(async () => {
    if (!selectedRepositories.size || !selectedRecipe) return
    setCreating(true)
    const federationGroupId = crypto.randomUUID()
    const groups = new Map<string, number[]>()
    for (const repository of repositories.filter((candidate) => selectedRepositories.has(candidate.id))) {
      const backendId = repository.backend_id || backendData.find((entry) => entry.backend.isDefault)?.backend.id
      if (!backendId) continue
      groups.set(backendId, [...(groups.get(backendId) || []), repository.id])
    }
    const results = await Promise.allSettled(
      [...groups.entries()].map(async ([backendId, repositoryIds]) => {
        const data = backendData.find((entry) => entry.backend.id === backendId)
        const recipe = data?.recipes.find((candidate) => recipeIdentity(candidate) === selectedRecipe)
        if (!recipe) throw new Error(`${data?.backend.label || backendId} does not have ${selectedRecipe}`)
        return api<BackendCampaign>(backendApiPath('/api/migration-campaigns', backendId), {
          method: 'POST',
          body: JSON.stringify({
            federationGroupId,
            recipeId: recipe.id,
            repositoryIds,
            canaryCount,
            waveSize,
            concurrency,
            creator: 'local-user',
          }),
        })
      }),
    )
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length)
      toast.error(
        `${failures.length}/${results.length} server children could not be created; retry remains idempotent with group ${federationGroupId}`,
      )
    else toast.success(`Created ${results.length} durable child campaign${results.length === 1 ? '' : 's'}`)
    setSelectedRepositories(new Set())
    await load()
    setCreating(false)
  }, [backendData, canaryCount, concurrency, load, repositories, selectedRecipe, selectedRepositories, waveSize])

  const control = useCallback(
    async (campaign: BackendCampaign, action: string, extra: Record<string, unknown> = {}) => {
      setBusyCampaign(campaign.id)
      try {
        const backendId = campaign.backend_id
        if (!backendId) throw new Error('Campaign server ownership is unavailable')
        await api(backendApiPath(`/api/migration-campaigns/${displayBackendId(campaign, campaign.id)}/control`, backendId), {
          method: 'POST',
          body: JSON.stringify({ action, ...extra }),
        })
        setApprovedCampaigns((current) => {
          const next = new Set(current)
          next.delete(campaign.id)
          return next
        })
        setPublishCampaigns((current) => {
          const next = new Set(current)
          next.delete(campaign.id)
          return next
        })
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setBusyCampaign(null)
      }
    },
    [load],
  )

  const controlGroup = useCallback(
    async (groupId: string, campaigns: BackendCampaign[], action: string) => {
      setBusyGroup(groupId)
      try {
        const results = await Promise.allSettled(
          campaigns.map((campaign) => {
            if (!campaign.backend_id) return Promise.reject(new Error('Campaign server ownership is unavailable'))
            return api(backendApiPath(`/api/migration-campaigns/${displayBackendId(campaign, campaign.id)}/control`, campaign.backend_id), {
              method: 'POST',
              body: JSON.stringify({ action }),
            })
          }),
        )
        const failures = results.filter((result) => result.status === 'rejected')
        if (failures.length)
          toast.error(`${action} succeeded on ${results.length - failures.length}/${results.length} available server children`)
        else toast.success(`${action} applied to ${results.length} server child${results.length === 1 ? '' : 'ren'}`)
        await load()
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setBusyGroup(null)
      }
    },
    [load],
  )

  return (
    <WorkspacePage>
      <WorkspaceHeader
        eyebrow={
          <>
            <GitFork className="size-3" /> Multi-repository development
          </>
        }
        title="Migration campaigns"
        description="Freeze a versioned recipe, prove applicability without writes, then roll it out through explicit server-local canaries and waves."
        actions={
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            <RefreshCw data-icon="inline-start" /> Refresh servers
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>New federated campaign</CardTitle>
          <CardDescription>One durable child is created on each owning server under a shared federation group ID.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Label className="grid gap-1.5 sm:col-span-1">
              Frozen recipe version
              <Select value={selectedRecipe} onValueChange={(value) => setSelectedRecipe(value || '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a recipe" />
                </SelectTrigger>
                <SelectContent>
                  {recipes.map((recipe) => (
                    <SelectItem key={recipeIdentity(recipe)} value={recipeIdentity(recipe)}>
                      {recipe.name} · v{recipe.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
            <Label className="grid gap-1.5">
              Canary targets
              <Input type="number" min={1} max={20} value={canaryCount} onChange={(event) => setCanaryCount(Number(event.target.value))} />
            </Label>
            <Label className="grid gap-1.5">
              Targets per wave
              <Input type="number" min={1} max={100} value={waveSize} onChange={(event) => setWaveSize(Number(event.target.value))} />
            </Label>
            <Label className="grid gap-1.5">
              Per-server concurrency
              <Input type="number" min={1} max={10} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} />
            </Label>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {backendData.map((entry) => (
              <div key={entry.backend.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong>{entry.backend.label}</strong>
                  <Badge variant={entry.error ? 'destructive' : 'outline'}>{entry.error ? 'unavailable' : 'owner'}</Badge>
                </div>
                {entry.error ? (
                  <p className="text-xs text-muted-foreground">{entry.error}</p>
                ) : (
                  <div className="grid gap-2">
                    {repositories
                      .filter((repository) => (repository.backend_id || defaultBackendId) === entry.backend.id)
                      .map((repository) => (
                        <Label key={repository.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={selectedRepositories.has(repository.id)}
                            onCheckedChange={(checked) => toggleRepository(repository.id, checked === true)}
                          />
                          <span className="truncate">{repository.full_name}</span>
                        </Label>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button disabled={creating || !selectedRepositories.size || !selectedRecipe} onClick={() => void create()}>
              <GitFork data-icon="inline-start" />{' '}
              {creating ? 'Creating children…' : `Create for ${selectedRepositories.size} repositories`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {groupedCampaigns.map(([groupId, campaigns]) => (
          <section key={groupId} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Federation group {groupId}</h2>
              <Badge variant="outline">
                {campaigns.length} server child{campaigns.length === 1 ? '' : 'ren'}
              </Badge>
              {backendData.some((entry) => entry.error) && <Badge variant="destructive">partial server availability</Badge>}
              <div className="ml-auto flex flex-wrap gap-2">
                {campaigns.some((campaign) => campaign.state === 'draft' || campaign.state === 'failed') && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyGroup === groupId}
                    onClick={() => void controlGroup(groupId, campaigns, 'preflight')}
                  >
                    Preflight all
                  </Button>
                )}
                {campaigns.some((campaign) => campaign.state === 'running') && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyGroup === groupId}
                    onClick={() => void controlGroup(groupId, campaigns, 'pause')}
                  >
                    Pause all
                  </Button>
                )}
                {campaigns.some((campaign) => campaign.state === 'paused') && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyGroup === groupId}
                    onClick={() => void controlGroup(groupId, campaigns, 'resume')}
                  >
                    Resume all
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyGroup === groupId}
                  onClick={() => void controlGroup(groupId, campaigns, 'refresh')}
                >
                  Refresh all
                </Button>
                {campaigns.some((campaign) => !['completed', 'cancelled'].includes(campaign.state)) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyGroup === groupId}
                    onClick={() => void controlGroup(groupId, campaigns, 'cancel')}
                  >
                    Cancel all
                  </Button>
                )}
              </div>
            </div>
            {campaigns.map((campaign) => (
              <CampaignCard
                key={campaign.id}
                campaign={campaign}
                busy={busyCampaign === campaign.id || busyGroup === groupId}
                writeApproved={approvedCampaigns.has(campaign.id)}
                createPullRequests={publishCampaigns.has(campaign.id)}
                onWriteApprovedChange={(value) =>
                  setApprovedCampaigns((current) => {
                    const next = new Set(current)
                    if (value) next.add(campaign.id)
                    else next.delete(campaign.id)
                    return next
                  })
                }
                onCreatePullRequestsChange={(value) =>
                  setPublishCampaigns((current) => {
                    const next = new Set(current)
                    if (value) next.add(campaign.id)
                    else next.delete(campaign.id)
                    return next
                  })
                }
                onControl={(action, extra) => void control(campaign, action, extra)}
              />
            ))}
          </section>
        ))}
        {!groupedCampaigns.length && !loading && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SkipForward />
              </EmptyMedia>
              <EmptyTitle>No migration campaigns yet</EmptyTitle>
              <EmptyDescription>Select repositories above to create revision-frozen server-local child campaigns.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </WorkspacePage>
  )
}
