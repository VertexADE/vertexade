import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Bot,
  ArrowRight,
  BookOpen,
  Container,
  FolderCog,
  Gauge,
  Home,
  Network,
  Palette,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { GlobalHighlights } from '@vertexade/ui/components/global-highlights'
import { emptySystemConfiguration, type SystemConfigurationValue } from '@vertexade/ui/components/system-configuration-settings'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { StatusPanel, StatusPanelContent, StatusPanelDescription, StatusPanelTitle } from '@vertexade/ui/components/ui/status'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { backendApi, isNotificationEvent, isPlatformApiError, subscribeToDashboardEvents } from '@vertexade/ui/lib/dashboard-api'
import { loadBackendRegistry, resolveBackend, type BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import type { DashboardData, Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { Highlights, Repositories, WorktreePreviewSettings } from '../components/settings/settings-panels'
import { SettingsGroup, SettingsPageHeader, SettingsSectionDivider } from '../components/settings/settings-shared'
import type { ContentGenerationSettings, PreviewSettings, ThreadRuntimeDefaults } from '../components/settings/settings-types'
import { AppearanceSettings } from '../components/settings/appearance-settings'
import { ServerRuntimeSettings } from '../components/settings/server-runtime-settings'
import { TestTargetSettings } from '../components/settings/test-target-settings'
import { EvidencePolicySettings } from '../components/settings/evidence-policy-settings'
import { DesktopOnboardingSettings } from '../components/onboarding/desktop-onboarding-settings'
import { MobilePairingSettings } from '../components/settings/mobile-pairing-settings'
import { BrowserPairingSettings } from '../components/settings/browser-pairing-settings'
import { SoftwareUpdateSettings } from '../components/settings/software-update-settings'
import { SettingsAgentSection } from '../components/settings/settings-agent-section'

type SettingsSection = 'overview' | 'connectivity' | 'workspace' | 'agents' | 'appearance'
const settingsSectionIds = new Set<SettingsSection>(['overview', 'connectivity', 'workspace', 'agents', 'appearance'])
const legacySettingsSections: Record<string, SettingsSection> = {
  general: 'workspace',
  servers: 'connectivity',
  prompts: 'agents',
  runtime: 'agents',
}
type WorkspaceSettingsOverview = Pick<DashboardData, 'repositories' | 'presets' | 'highlights'>
type SettingsSearch = { section?: SettingsSection; q?: string; server?: string }

function settingsSection(value: unknown): SettingsSection | undefined {
  const candidate = String(value || '')
  if (settingsSectionIds.has(candidate as SettingsSection)) return candidate as SettingsSection
  return legacySettingsSections[candidate]
}

function settingsQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, 100) : undefined
}

function settingsServer(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, 100) : undefined
}

export const Route = createFileRoute('/settings')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    section: settingsSection(search.section),
    q: settingsQuery(search.q),
    server: settingsServer(search.server),
  }),
  component: SettingsPage,
})

const settingsSections: Array<{
  id: SettingsSection
  group: 'start' | 'workspace' | 'agents' | 'personal'
  label: string
  description: string
  icon: LucideIcon
  keywords: string
}> = [
  {
    id: 'overview',
    group: 'start',
    label: 'Overview',
    description: 'Setup and status at a glance',
    icon: Home,
    keywords: 'overview setup status desktop onboarding',
  },
  {
    id: 'connectivity',
    group: 'start',
    label: 'Connectivity',
    description: 'Phones, network & servers',
    icon: Network,
    keywords: 'iphone mobile pairing pair link servers backends federation linked instances connections network listener host port',
  },
  {
    id: 'workspace',
    group: 'workspace',
    label: 'Workspace',
    description: 'Repositories & previews',
    icon: FolderCog,
    keywords: 'repository worktree preview gateway',
  },
  {
    id: 'agents',
    group: 'agents',
    label: 'Agents & instructions',
    description: 'Models, prompts & runtime',
    icon: Gauge,
    keywords:
      'runtime concurrency execution limits generation titles summaries provider model read-only prompts policies presets instructions',
  },
  {
    id: 'appearance',
    group: 'personal',
    label: 'Appearance',
    description: 'Themes, fonts & highlights',
    icon: Palette,
    keywords: 'appearance highlights colors theme font typography dark light',
  },
]

const settingsGroups = [
  { id: 'start', label: 'VertexADE' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'agents', label: 'Agents' },
  { id: 'personal', label: 'Personal' },
] as const

const settingsSectionClass = 'flex min-w-0 flex-col gap-5 [&_[data-slot=card]]:min-w-0'

async function workspaceSettingsOverview(backendId: string): Promise<WorkspaceSettingsOverview> {
  try {
    return await backendApi<WorkspaceSettingsOverview>(backendId, '/api/settings/workspace-overview')
  } catch (error) {
    if (!isPlatformApiError(error) || error.status !== 404) throw error
    const dashboard = await backendApi<DashboardData>(backendId, '/api/dashboard')
    return {
      repositories: dashboard.repositories,
      presets: dashboard.presets,
      highlights: dashboard.highlights,
    }
  }
}

function SettingsLoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <StatusPanel tone="danger" className="mb-4">
      <Settings2 />
      <StatusPanelContent>
        <StatusPanelTitle>Some settings could not be loaded</StatusPanelTitle>
        <StatusPanelDescription>{message}</StatusPanelDescription>
      </StatusPanelContent>
      <Button type="button" variant="outline" size="sm" className="col-span-2 sm:col-span-1" onClick={onRetry}>
        <RefreshCw data-icon="inline-start" />
        Try again
      </Button>
    </StatusPanel>
  )
}

function SettingsServerSelect({
  backends,
  selected,
  onChange,
}: {
  backends: BackendDescriptor[]
  selected: BackendDescriptor | null
  onChange(backendId: string): void
}) {
  return (
    <Select value={selected?.id || ''} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label="Settings server">
        <Server data-icon="inline-start" />
        <SelectValue placeholder="Choose server" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {backends.map((backend) => (
            <SelectItem key={backend.id} value={backend.id}>
              {backend.label}
              {backend.connected ? '' : ' · offline'}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function SettingsShortcut({
  icon: Icon,
  title,
  description,
  detail,
  onOpen,
}: {
  icon: LucideIcon
  title: string
  description: string
  detail: string
  onOpen(): void
}) {
  return (
    <Card size="sm" variant="subtle">
      <CardHeader>
        <span className="mb-2 grid size-8 place-items-center rounded-lg border border-primary/15 bg-primary/[.07] text-primary">
          <Icon className="size-3.5" />
        </span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Open ${title}`} onClick={onOpen}>
            <ArrowRight />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Badge variant="outline">{detail}</Badge>
      </CardContent>
    </Card>
  )
}

function SettingsOverview({
  workspace,
  backendId,
  onNavigate,
}: {
  workspace: WorkspaceSettingsOverview
  backendId: string
  onNavigate(section: SettingsSection): void
}) {
  return (
    <section data-slot="settings-section" aria-labelledby="overview-settings" className={settingsSectionClass}>
      <SettingsPageHeader
        id="overview-settings"
        eyebrow="VertexADE"
        title="Settings overview"
        description="Configure device access, workspace infrastructure, agent behavior, and personal presentation from one predictable place."
        icon={Home}
        badge="Local desktop"
        summary={[
          {
            label: 'Repositories',
            value: String(workspace.repositories.length),
            detail: 'Workspace sources',
          },
          {
            label: 'Prompt presets',
            value: String(workspace.presets.length),
            detail: 'Reusable instructions',
          },
          {
            label: 'Highlights',
            value: String(workspace.highlights.length),
            detail: 'Browser rules',
          },
        ]}
      />
      <SettingsGroup
        id="overview-common-tasks"
        title="Common tasks"
        description="Jump directly to the settings most often needed when preparing a desktop or a new workspace."
        icon={Sparkles}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SettingsShortcut
            icon={Smartphone}
            title="Connect a phone"
            description="Generate a one-time full pair link for VertexADE Mobile."
            detail="Connectivity"
            onOpen={() => onNavigate('connectivity')}
          />
          <SettingsShortcut
            icon={FolderCog}
            title="Configure workspace"
            description="Manage repositories, previews, validation, and evidence policies."
            detail={`${workspace.repositories.length} repositories`}
            onOpen={() => onNavigate('workspace')}
          />
          <SettingsShortcut
            icon={Bot}
            title="Tune agents"
            description="Choose models, instructions, tool paths, limits, skills, and MCP servers."
            detail="Agent defaults"
            onOpen={() => onNavigate('agents')}
          />
        </div>
      </SettingsGroup>
      <SettingsSectionDivider />
      <SettingsGroup
        id="overview-updates"
        title="Software updates"
        description="Update the signed desktop app or view safe, installation-specific server upgrade instructions."
        icon={RefreshCw}
      >
        <SoftwareUpdateSettings backendId={backendId} />
      </SettingsGroup>
      <SettingsSectionDivider />
      <SettingsGroup
        id="overview-onboarding"
        title="Product guide"
        description="Revisit the complete desktop walkthrough whenever you need a refresher."
        icon={BookOpen}
      >
        <DesktopOnboardingSettings />
      </SettingsGroup>
    </section>
  )
}

function SettingsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [workspace, setWorkspace] = useState<WorkspaceSettingsOverview>({
    repositories: [],
    presets: [],
    highlights: [],
  })
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>({
    domain: '',
    gatewayPort: 4180,
  })
  const [contentGeneration, setContentGeneration] = useState<ContentGenerationSettings>({
    agentId: '',
    model: '',
    reasoningEffort: '',
    serviceTier: '',
    allowSubagents: false,
    permissionMode: 'read-only',
  })
  const [threadDefaults, setThreadDefaults] = useState<ThreadRuntimeDefaults>({
    workItem: {
      agentId: '',
      model: '',
      reasoningEffort: '',
      serviceTier: '',
      allowSubagents: false,
    },
    review: {
      agentId: '',
      model: '',
      reasoningEffort: '',
      serviceTier: '',
      allowSubagents: false,
    },
  })
  const [systemConfiguration, setSystemConfiguration] = useState<SystemConfigurationValue>(emptySystemConfiguration)
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [loadError, setLoadError] = useState('')
  const [loadedBackendId, setLoadedBackendId] = useState('')
  const loadGeneration = useRef(0)
  const section = search.section || 'overview'
  const settingsQuery = search.q || ''
  const selectedBackend = resolveBackend(backends, search.server)
  const backendId = selectedBackend?.id || ''
  const updateSearch = useCallback(
    (patch: Partial<SettingsSearch>) =>
      void navigate({
        search: (current) => ({ ...current, ...patch }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  )
  useEffect(() => {
    const refreshBackends = () => {
      void loadBackendRegistry()
        .then(({ backends: available }) => setBackends(available))
        .catch((error) => {
          const message = (error as Error).message
          setLoadError(message)
          toast.error(message)
        })
    }
    refreshBackends()
    window.addEventListener('vertexade:paired-servers', refreshBackends)
    return () => window.removeEventListener('vertexade:paired-servers', refreshBackends)
  }, [])
  const load = useCallback(async () => {
    if (!backendId) return
    const requestGeneration = ++loadGeneration.current
    setLoadError('')
    try {
      const [previews, generatedContent, system, threads, overview] = await Promise.all([
        backendApi<PreviewSettings>(backendId, '/api/settings/worktree-previews'),
        backendApi<ContentGenerationSettings>(backendId, '/api/settings/content-generation'),
        backendApi<SystemConfigurationValue>(backendId, '/api/settings/system-configuration'),
        backendApi<ThreadRuntimeDefaults>(backendId, '/api/settings/thread-runtime-defaults'),
        workspaceSettingsOverview(backendId),
      ])
      if (requestGeneration !== loadGeneration.current) return
      setPreviewSettings(previews)
      setContentGeneration(generatedContent)
      setSystemConfiguration(system)
      setThreadDefaults(threads)
      setWorkspace(overview)
      setLoadedBackendId(backendId)
    } catch (error) {
      if (requestGeneration !== loadGeneration.current) return
      const message = (error as Error).message
      setLoadError(message)
      toast.error(message)
    }
  }, [backendId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(
    () =>
      subscribeToDashboardEvents(
        () => {
          void load()
        },
        (event) => !isNotificationEvent(event),
      ),
    [load],
  )

  async function addRepository(
    input: { repository: string } | { local_path: string; name?: string; workspace_strategy?: string },
    targetBackendId = backendId,
  ) {
    try {
      const result = await backendApi<{ repo: Repository; open_prs: number }>(targetBackendId, '/api/repositories', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      await load()
      toast.success(`Added ${result.repo.full_name} · ${result.open_prs} open PRs`)
    } catch (error) {
      toast.error((error as Error).message)
      throw error
    }
  }

  const sectionNeedle = settingsQuery.trim().toLowerCase()
  const visibleSections = useMemo(
    () =>
      settingsSections.filter(
        (item) => !sectionNeedle || `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(sectionNeedle),
      ),
    [sectionNeedle],
  )
  useEffect(() => {
    if (visibleSections.length && !visibleSections.some((item) => item.id === section)) updateSearch({ section: visibleSections[0].id })
  }, [section, updateSearch, visibleSections])
  return (
    <>
      <GlobalHighlights rules={workspace.highlights} />
      <WorkspacePage className="max-w-[90rem] xl:px-5 xl:py-3">
        <WorkspaceHeader
          icon={Settings2}
          className="mb-3 items-center pb-0 [&_[data-slot=page-header-content]]:xl:flex [&_[data-slot=page-header-content]]:xl:items-baseline [&_[data-slot=page-header-content]]:xl:gap-3 [&_[data-slot=page-title]]:text-xl [&_[data-slot=page-description]]:xl:mt-0"
          title="Settings"
          description="Workspace, agent, automation, and display defaults."
          actions={
            backends.length > 1 ? (
              <SettingsServerSelect backends={backends} selected={selectedBackend} onChange={(server) => updateSearch({ server })} />
            ) : undefined
          }
        />
        {loadError && <SettingsLoadError message={loadError} onRetry={() => void load()} />}
        <Tabs
          value={section}
          onValueChange={(value) => updateSearch({ section: value as SettingsSection })}
          className="gap-3 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start lg:gap-6"
        >
          <aside className="min-w-0 border-b border-border/45 pb-2 lg:sticky lg:top-16 lg:rounded-xl lg:border lg:border-border/60 lg:bg-card/65 lg:p-2.5 lg:shadow-sm">
            <div className="hidden pb-2 lg:block">
              <SearchInput
                density="compact"
                value={settingsQuery}
                onChange={(event) => updateSearch({ q: event.target.value || undefined })}
                onClear={() => updateSearch({ q: undefined })}
                placeholder="Find a section"
                clearLabel="Clear settings search"
              />
            </div>
            <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
              <TabsList
                className="h-11 w-max min-w-full justify-start gap-1 rounded-xl border border-border/50 bg-muted/28 p-1"
                aria-label="Settings sections"
              >
                {settingsSections.map(({ id, label, icon: Icon }) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className="h-8 shrink-0 gap-1.5 rounded-lg border border-transparent px-2.5 text-xs data-active:border-border/60 data-active:bg-background data-active:shadow-sm"
                  >
                    <Icon />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="mt-1 hidden lg:block">
              <div>
                <TabsList
                  variant="line"
                  className="h-auto! w-full min-w-0 flex-col items-stretch justify-start gap-3 bg-transparent p-0"
                  aria-label="Settings sections"
                >
                  {settingsGroups.map((group) => {
                    const items = visibleSections.filter((item) => item.group === group.id)
                    if (!items.length) return null
                    return (
                      <Fragment key={group.id}>
                        <span className="px-2 pt-1 text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">
                          {group.label}
                        </span>
                        <span className="grid gap-0.5">
                          {items.map(({ id, label, description, icon: Icon }) => (
                            <TabsTrigger
                              key={id}
                              value={id}
                              className="relative h-auto min-h-12 w-full justify-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-muted-foreground data-active:border-primary/15 data-active:bg-primary/[.08] data-active:text-foreground data-active:shadow-[inset_3px_0_0_var(--primary)]"
                            >
                              <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/50 bg-background/55">
                                <Icon />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-medium">{label}</span>
                                <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">{description}</span>
                              </span>
                            </TabsTrigger>
                          ))}
                        </span>
                      </Fragment>
                    )
                  })}
                </TabsList>
              </div>
            </div>
            {sectionNeedle && (
              <p className="px-2 pt-2 text-[11px] text-muted-foreground">
                {visibleSections.length} matching {visibleSections.length === 1 ? 'section' : 'sections'}
              </p>
            )}
          </aside>
          {!selectedBackend ? (
            <StatusPanel className="min-h-24">
              <Server />
              <StatusPanelContent>
                <StatusPanelTitle>Connecting to settings</StatusPanelTitle>
                <StatusPanelDescription>Reading the paired server registry…</StatusPanelDescription>
              </StatusPanelContent>
            </StatusPanel>
          ) : loadedBackendId !== backendId ? (
            <StatusPanel tone={loadError ? 'danger' : 'info'} className="min-h-24">
              {loadError ? <Settings2 /> : <RefreshCw className="animate-spin" />}
              <StatusPanelContent>
                <StatusPanelTitle>
                  {loadError ? `${selectedBackend.label} settings are unavailable` : `Loading ${selectedBackend.label}`}
                </StatusPanelTitle>
                <StatusPanelDescription>
                  {loadError ? 'Retry after checking the server connection.' : 'Reading this server’s workspace and agent configuration…'}
                </StatusPanelDescription>
              </StatusPanelContent>
            </StatusPanel>
          ) : visibleSections.length ? (
            <>
              <TabsContent value="overview">
                <SettingsOverview workspace={workspace} backendId={backendId} onNavigate={(next) => updateSearch({ section: next })} />
              </TabsContent>
              <TabsContent value="workspace">
                <section key={backendId} data-slot="settings-section" aria-labelledby="workspace-settings" className={settingsSectionClass}>
                  <SettingsPageHeader
                    id="workspace-settings"
                    eyebrow="Workspace"
                    title="Projects & automation"
                    description="Define where VertexADE works, how isolated previews are exposed, and which validation evidence a change must produce."
                    icon={FolderCog}
                    badge="Server-owned"
                    summary={[
                      {
                        label: 'Repositories',
                        value: String(workspace.repositories.length),
                        detail: 'Available sources',
                      },
                      {
                        label: 'Preview gateway',
                        value: previewSettings.domain || 'Disabled',
                        detail: `Port ${previewSettings.gatewayPort}`,
                      },
                      {
                        label: 'Policies',
                        value: 'Per repository',
                        detail: 'Validation + readiness',
                      },
                    ]}
                  />
                  <SettingsGroup
                    id="workspace-previews"
                    title="Preview environments"
                    description="Expose isolated Work-item and pull-request worktrees behind a predictable wildcard domain."
                    icon={Container}
                  >
                    <WorktreePreviewSettings settings={previewSettings} onSaved={setPreviewSettings} backendId={backendId} />
                  </SettingsGroup>
                  <SettingsSectionDivider />
                  <SettingsGroup
                    id="workspace-repositories"
                    title="Source repositories"
                    description="Add GitHub repositories, synchronize pull requests, and configure repository-specific environments."
                    icon={FolderCog}
                  >
                    {selectedBackend && (
                      <Repositories repositories={workspace.repositories} backend={selectedBackend} onAdd={addRepository} />
                    )}
                  </SettingsGroup>
                  <SettingsSectionDivider />
                  <SettingsGroup
                    id="workspace-validation"
                    title="Validation guardrails"
                    description="Control executable test targets and the evidence required before a pull request is considered ready."
                    icon={ShieldCheck}
                  >
                    <TestTargetSettings repositories={workspace.repositories} />
                    <EvidencePolicySettings repositories={workspace.repositories} />
                  </SettingsGroup>
                </section>
              </TabsContent>
              <TabsContent value="connectivity">
                <section
                  key={backendId}
                  data-slot="settings-section"
                  aria-labelledby="connectivity-settings"
                  className={settingsSectionClass}
                >
                  <SettingsPageHeader
                    id="connectivity-settings"
                    eyebrow="Connectivity"
                    title="Devices & servers"
                    description="Pair each device and server independently while keeping the raw API private."
                    icon={Network}
                    badge="Security-sensitive"
                    summary={[
                      {
                        label: 'Phone access',
                        value: 'Pair links',
                        detail: 'One-time invitations',
                      },
                      {
                        label: 'Shared surface',
                        value: 'Web gateway',
                        detail: 'Authenticated',
                      },
                      {
                        label: 'Backend API',
                        value: 'Loopback',
                        detail: 'Desktop enforced',
                      },
                    ]}
                  />
                  <SettingsGroup
                    id="connectivity-browser-servers"
                    title="VertexADE servers"
                    description="See this server and every paired remote server as one live workspace."
                    icon={Network}
                  >
                    <BrowserPairingSettings />
                  </SettingsGroup>
                  <SettingsSectionDivider />
                  <SettingsGroup
                    id="connectivity-devices"
                    title="Mobile devices"
                    description="Create short-lived invitations and revoke each phone independently."
                    icon={Smartphone}
                  >
                    <MobilePairingSettings backendId={backendId} />
                  </SettingsGroup>
                  <SettingsSectionDivider />
                  <SettingsGroup
                    id="connectivity-network"
                    title="Network reachability"
                    description="Expose the authenticated web listener to trusted LAN or Tailscale devices while keeping the backend API on loopback."
                    icon={Wifi}
                  >
                    <ServerRuntimeSettings backendId={backendId} />
                  </SettingsGroup>
                </section>
              </TabsContent>
              <TabsContent value="agents">
                <SettingsAgentSection
                  key={backendId}
                  backendId={backendId}
                  contentGeneration={contentGeneration}
                  onContentGenerationSaved={setContentGeneration}
                  presets={workspace.presets}
                  systemConfiguration={systemConfiguration}
                  onSystemConfigurationSaved={setSystemConfiguration}
                  threadDefaults={threadDefaults}
                  onThreadDefaultsSaved={setThreadDefaults}
                />
              </TabsContent>
              <TabsContent value="appearance">
                <section
                  key={backendId}
                  data-slot="settings-section"
                  aria-labelledby="appearance-settings"
                  className={settingsSectionClass}
                >
                  <SettingsPageHeader
                    id="appearance-settings"
                    eyebrow="Personal"
                    title="Appearance"
                    description="Personalize color, typography, and global text highlights for this browser without changing the shared workspace."
                    icon={Palette}
                    badge="Browser-local"
                    summary={[
                      {
                        label: 'Theme',
                        value: 'Live preview',
                        detail: 'Light + dark',
                      },
                      {
                        label: 'Typography',
                        value: 'Interface + code',
                        detail: 'Independent',
                      },
                      {
                        label: 'Highlights',
                        value: String(workspace.highlights.length),
                        detail: 'Global rules',
                      },
                    ]}
                  />
                  <SettingsGroup
                    id="appearance-interface"
                    title="Interface"
                    description="Select the display mode, accent palette, and font stacks used in this browser."
                    icon={Palette}
                  >
                    <AppearanceSettings />
                  </SettingsGroup>
                  <SettingsSectionDivider />
                  <SettingsGroup
                    id="appearance-highlights"
                    title="Global highlights"
                    description="Make important words, owners, or statuses visually distinct throughout manager screens."
                    icon={Sparkles}
                  >
                    <Highlights rules={workspace.highlights} backendId={backendId} />
                  </SettingsGroup>
                </section>
              </TabsContent>
            </>
          ) : (
            <Empty className="min-h-64">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No settings found</EmptyTitle>
                <EmptyDescription>Try a provider name, capability, or workflow term.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => updateSearch({ q: undefined })}>
                  <X />
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </Tabs>
      </WorkspacePage>
    </>
  )
}
