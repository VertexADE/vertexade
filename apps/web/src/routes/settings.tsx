import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  Braces,
  ChevronsUpDown,
  Container,
  FolderCog,
  Gauge,
  Network,
  Palette,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { GlobalHighlights } from '@vertexade/ui/components/global-highlights'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { AgentResourceSettings } from '@vertexade/ui/components/agent-resource-settings'
import {
  emptySystemConfiguration,
  PromptPolicySettings,
  RuntimeSettings,
  type SystemConfigurationValue,
} from '@vertexade/ui/components/system-configuration-settings'
import { WorkspaceHeader, WorkspacePage } from '@vertexade/ui/components/workspace-layout'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@vertexade/ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { SearchInput } from '@vertexade/ui/components/ui/search-input'
import {
  StatusPanel,
  StatusPanelActions,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from '@vertexade/ui/components/ui/status'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { age, api, isNotificationEvent, subscribeToDashboardEvents, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { HighlightRule, Repository } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import {
  ContentGenerationDefaults,
  Highlights,
  Presets,
  Repositories,
  SectionIntro,
  WorktreePreviewSettings,
} from '../components/settings/settings-panels'
import type { ContentGenerationSettings, PreviewSettings, ThreadRuntimeDefaults } from '../components/settings/settings-types'
import { AppearanceSettings } from '../components/settings/appearance-settings'
import { ThreadRuntimeDefaultSettings } from '../components/settings/settings-thread-runtime-defaults'
import { useDashboardMeta } from '../lib/dashboard-cache'
import { useRxDashboardCollection } from '../lib/rxdb-dashboard-cache'

type SettingsSection = 'general' | 'servers' | 'prompts' | 'runtime' | 'capabilities' | 'appearance'
const settingsSectionIds = new Set<SettingsSection>(['general', 'servers', 'prompts', 'runtime', 'capabilities', 'appearance'])
type SettingsSearch = { section?: SettingsSection; q?: string }

export const Route = createFileRoute('/settings')({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SettingsSearch => ({
    section: settingsSectionIds.has(search.section as SettingsSection) ? (search.section as SettingsSection) : undefined,
    q: typeof search.q === 'string' && search.q ? search.q.slice(0, 100) : undefined,
  }),
  component: SettingsPage,
})

const settingsSections: Array<{
  id: SettingsSection
  group: 'workspace' | 'agents'
  label: string
  description: string
  icon: LucideIcon
  keywords: string
}> = [
  {
    id: 'servers',
    group: 'workspace',
    label: 'Servers',
    description: 'Linked VertexADE backends',
    icon: Network,
    keywords: 'servers backends federation linked instances connections',
  },
  {
    id: 'general',
    group: 'workspace',
    label: 'Workspace',
    description: 'Repositories & previews',
    icon: FolderCog,
    keywords: 'repository worktree preview gateway',
  },
  {
    id: 'runtime',
    group: 'agents',
    label: 'Agent execution',
    description: 'Models, limits & execution',
    icon: Gauge,
    keywords: 'runtime concurrency execution limits generation titles summaries provider model read-only',
  },
  {
    id: 'prompts',
    group: 'agents',
    label: 'Instructions',
    description: 'Prompt policies & presets',
    icon: Braces,
    keywords: 'prompts policies presets instructions',
  },
  {
    id: 'capabilities',
    group: 'agents',
    label: 'AI capabilities',
    description: 'Skills & MCP servers',
    icon: Bot,
    keywords: 'ai skills mcp servers agents',
  },
  {
    id: 'appearance',
    group: 'workspace',
    label: 'Appearance',
    description: 'Themes, fonts & highlights',
    icon: Palette,
    keywords: 'appearance highlights colors theme font typography dark light',
  },
]

const settingsGroups = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'agents', label: 'Agents' },
] as const

const settingsSectionClass =
  'space-y-3 [&_[data-slot=card]]:border-border/65 [&_[data-slot=card]]:bg-card/60 [&_[data-slot=card]]:shadow-[0_10px_32px_rgba(0,0,0,.07)] [&_[data-slot=card-description]]:hidden [&_[data-slot=card-header]]:border-border/45 [&_[data-slot=card-header]]:bg-gradient-to-r [&_[data-slot=card-header]]:from-muted/28 [&_[data-slot=card-header]]:to-transparent [&_[data-slot=card-header]]:p-3 sm:[&_[data-slot=card-description]]:block sm:[&_[data-slot=card-header]]:p-4'

type LinkedServer = { id: string; label: string; url: string; namespace: number; enabled: boolean }

function LinkedServersSettings() {
  const [servers, setServers] = useState<LinkedServer[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await api<{ servers: LinkedServer[] }>('/api/settings/linked-servers')
      setServers(result.servers)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => void load(), [load])

  async function addServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    try {
      await api('/api/settings/linked-servers', {
        method: 'POST',
        body: JSON.stringify({ id: values.get('id'), label: values.get('label'), url: values.get('url') }),
      })
      form.reset()
      await load()
      toast.success('Server linked')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function updateServer(server: LinkedServer, patch: Partial<LinkedServer>) {
    try {
      await api(`/api/settings/linked-servers/${encodeURIComponent(server.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function removeServer(server: LinkedServer) {
    try {
      await api(`/api/settings/linked-servers/${encodeURIComponent(server.id)}`, { method: 'DELETE' })
      await load()
      toast.success(`${server.label} unlinked`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server federation</CardTitle>
        <CardDescription>Add operator-approved VertexADE API origins to the unified workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusPanel tone="info">
          <Network />
          <StatusPanelContent>
            <StatusPanelTitle>Public VertexADE servers only</StatusPanelTitle>
            <StatusPanelDescription>
              The API verifies the server identity and blocks loopback, private, link-local, metadata, and DNS-rebinding destinations.
            </StatusPanelDescription>
          </StatusPanelContent>
        </StatusPanel>
        <form className="grid gap-3 md:grid-cols-[minmax(8rem,.7fr)_minmax(10rem,1fr)_minmax(14rem,1.5fr)_auto]" onSubmit={addServer}>
          <Label className="grid gap-1.5 text-xs">
            Stable id
            <Input name="id" required placeholder="team" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,47}" />
          </Label>
          <Label className="grid gap-1.5 text-xs">
            Label
            <Input name="label" required placeholder="Team server" maxLength={80} />
          </Label>
          <Label className="grid gap-1.5 text-xs">
            API origin
            <Input name="url" type="url" required placeholder="https://vertexade.example.com" />
          </Label>
          <Button className="self-end" type="submit">
            <Plus />
            Link
          </Button>
        </form>
        <div className="grid gap-2">
          {servers.map((server) => (
            <div key={server.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/55 p-3">
              <span className={`size-2 rounded-full ${server.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{server.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {server.url} · {server.id}
                </span>
              </span>
              <Label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={server.enabled}
                  onCheckedChange={(checked) => void updateServer(server, { enabled: checked === true })}
                />
                Enabled
              </Label>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Unlink ${server.label}`}
                onClick={() => void removeServer(server)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!servers.length && !loading && <p className="py-3 text-sm text-muted-foreground">No additional servers are linked.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function SettingsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const repositories = useRxDashboardCollection<Repository>('repositories')
  const meta = useDashboardMeta()
  const data = useMemo(
    () => ({
      ...meta.value,
      repositories: repositories.values,
      prs: [],
      agentThreads: [],
    }),
    [meta.value, repositories.values],
  )
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
    workItem: { agentId: '', model: '', reasoningEffort: '', serviceTier: '', allowSubagents: false },
    review: { agentId: '', model: '', reasoningEffort: '', serviceTier: '', allowSubagents: false },
  })
  const [systemConfiguration, setSystemConfiguration] = useState<SystemConfigurationValue>(emptySystemConfiguration)
  const [loadError, setLoadError] = useState('')
  const section = search.section || 'general'
  const settingsQuery = search.q || ''
  const updateSearch = useCallback(
    (patch: Partial<SettingsSearch>) =>
      void navigate({
        search: (current) => ({ ...current, ...patch }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  )
  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [previews, generation, system, threads] = await Promise.all([
        api<PreviewSettings>('/api/settings/worktree-previews'),
        api<ContentGenerationSettings>('/api/settings/content-generation'),
        api<SystemConfigurationValue>('/api/settings/system-configuration'),
        api<ThreadRuntimeDefaults>('/api/settings/thread-runtime-defaults'),
      ])
      setPreviewSettings(previews)
      setContentGeneration(generation)
      setSystemConfiguration(system)
      setThreadDefaults(threads)
    } catch (error) {
      const message = (error as Error).message
      setLoadError(message)
      toast.error(message)
    }
  }, [])
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

  async function addRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = event.currentTarget
    const form = new FormData(target)
    try {
      const result = await api<{ repo: Repository; open_prs: number }>('/api/repositories', {
        method: 'POST',
        body: JSON.stringify({ repository: form.get('repository') }),
      })
      target.reset()
      toast.success(`Added ${result.repo.full_name} · ${result.open_prs} open PRs`)
    } catch (error) {
      toast.error((error as Error).message)
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
      <GlobalHighlights rules={data.highlights} />
      <WorkspacePage className="max-w-[90rem] xl:px-5 xl:py-3">
        <WorkspaceHeader
          icon={Settings2}
          className="mb-3 items-center pb-0 [&_[data-slot=page-header-content]]:xl:flex [&_[data-slot=page-header-content]]:xl:items-baseline [&_[data-slot=page-header-content]]:xl:gap-3 [&_[data-slot=page-title]]:text-xl [&_[data-slot=page-description]]:xl:mt-0"
          title="Settings"
          description="Workspace, agent, automation, and display defaults."
        />
        {loadError && (
          <StatusPanel tone="danger" className="mb-4">
            <Settings2 />
            <StatusPanelContent>
              <StatusPanelTitle>Some settings could not be loaded</StatusPanelTitle>
              <StatusPanelDescription>{loadError}</StatusPanelDescription>
            </StatusPanelContent>
            <StatusPanelActions>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw />
                Retry
              </Button>
            </StatusPanelActions>
          </StatusPanel>
        )}
        <Tabs
          value={section}
          onValueChange={(value) => updateSearch({ section: value as SettingsSection })}
          className="gap-3 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-5"
        >
          <aside className="min-w-0 border-b border-border/45 pb-2 lg:sticky lg:top-16 lg:rounded-xl lg:border lg:border-border/60 lg:bg-card/48 lg:p-2 lg:shadow-[0_12px_32px_rgba(0,0,0,.06)]">
            <div className="hidden p-1 lg:block">
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
                    <Icon className="size-3.5" />
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
                          {items.map(({ id, label, icon: Icon }) => (
                            <TabsTrigger
                              key={id}
                              value={id}
                              className="relative h-10 w-full justify-start gap-2 rounded-lg border border-transparent px-2.5 text-muted-foreground data-active:border-primary/15 data-active:bg-primary/[.08] data-active:text-foreground data-active:shadow-[inset_3px_0_0_var(--primary)]"
                            >
                              <Icon />
                              <span className="truncate text-xs">{label}</span>
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
          {visibleSections.length ? (
            <>
              <TabsContent value="general">
                <section data-slot="settings-section" aria-labelledby="general-settings" className={settingsSectionClass}>
                  <SectionIntro id="general-settings" title="Workspace" icon={FolderCog}>
                    Repositories and isolated preview infrastructure available to pull-request and task workflows.
                  </SectionIntro>
                  <WorktreePreviewSettings settings={previewSettings} onSaved={setPreviewSettings} />
                  <Repositories repositories={data.repositories} onAdd={addRepository} />
                </section>
              </TabsContent>
              <TabsContent value="prompts">
                <section data-slot="settings-section" aria-labelledby="prompt-settings" className={settingsSectionClass}>
                  <SectionIntro id="prompt-settings" title="Instructions" icon={Braces}>
                    Workspace-level policies and reusable instructions for consistent work.
                  </SectionIntro>
                  <PromptPolicySettings value={systemConfiguration} onSaved={setSystemConfiguration} />
                  <Presets data={data} />
                </section>
              </TabsContent>
              <TabsContent value="servers">
                <section data-slot="settings-section" aria-labelledby="server-settings" className={settingsSectionClass}>
                  <SectionIntro id="server-settings" title="Linked servers" icon={Network}>
                    Combine approved VertexADE backends in this frontend and route actions to the server that owns each item.
                  </SectionIntro>
                  <LinkedServersSettings />
                </section>
              </TabsContent>
              <TabsContent value="runtime">
                <section data-slot="settings-section" aria-labelledby="runtime-settings" className={settingsSectionClass}>
                  <SectionIntro id="runtime-settings" title="Agent execution" icon={Gauge}>
                    Extension execution defaults and automation bounds. Extensions register their provider aspects directly.
                  </SectionIntro>
                  <ContentGenerationDefaults
                    key={`${contentGeneration.agentId}:${contentGeneration.model}:${contentGeneration.reasoningEffort}`}
                    value={contentGeneration}
                    onSaved={setContentGeneration}
                  />
                  <ThreadRuntimeDefaultSettings
                    key={`${threadDefaults.workItem.agentId}:${threadDefaults.review.agentId}`}
                    value={threadDefaults}
                    onSaved={setThreadDefaults}
                  />
                  <RuntimeSettings value={systemConfiguration} onSaved={setSystemConfiguration} />
                </section>
              </TabsContent>
              <TabsContent value="capabilities">
                <section data-slot="settings-section" aria-labelledby="capability-settings" className={settingsSectionClass}>
                  <SectionIntro id="capability-settings" title="AI capabilities" icon={Bot}>
                    Manage skills and MCP servers once, then tailor the active set for each Work item.
                  </SectionIntro>
                  <AgentResourceSettings />
                </section>
              </TabsContent>
              <TabsContent value="appearance">
                <section data-slot="settings-section" aria-labelledby="appearance-settings" className={settingsSectionClass}>
                  <SectionIntro id="appearance-settings" title="Appearance" icon={Palette}>
                    Personalize color, typography, and global visual rules in this browser.
                  </SectionIntro>
                  <AppearanceSettings />
                  <Highlights rules={data.highlights} />
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
