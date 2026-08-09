import { lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ModuleAccent, ModuleCatalog, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import {
  Blocks,
  BriefcaseBusiness,
  GitPullRequest,
  Inbox,
  MessagesSquare,
  Moon,
  Plus,
  Rocket,
  Search,
  Settings,
  Sun,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { readAppearancePreferences, saveAppearancePreferences } from '@vertexade/ui/lib/appearance-preferences'
import { MobileActionDock, MobileMenuButton } from '@vertexade/ui/components/app-mobile-navigation'
import { NotificationCenter } from '@vertexade/ui/components/notification-center'
import { LazyBoundary } from '@vertexade/ui/components/lazy-boundary'
import { Button } from '@vertexade/ui/components/ui/button'
import { Kbd } from '@vertexade/ui/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@vertexade/ui/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@vertexade/ui/components/ui/tooltip'
import { useReactiveApi } from '@vertexade/ui/hooks/use-reactive-api'
import { api, isModuleCatalogEvent, platformBackendState, platformConnectionState } from '@vertexade/ui/lib/dashboard-api'
import type { BackendDescriptor } from '@vertexade/ui/lib/backend-registry'
import { extensionAccent, extensionIcon } from '@vertexade/ui/lib/extension-presentation'
import { extensionWorkspaceRoute } from '@vertexade/ui/lib/extension-workspace'
import { desktopSidebarOpen, WIDE_DESKTOP_BREAKPOINT } from '@vertexade/ui/lib/responsive-layout'
import { cn } from '@vertexade/ui/lib/utils'
import { useUiPreferences } from '@vertexade/ui/lib/ui-preferences'

export type NavItem = {
  to: string
  label: string
  compactLabel?: string
  description: string
  icon: LucideIcon
  group: 'Workspace' | 'Operations' | 'System'
  moduleId?: string
  accent?: ModuleAccent
  lifecycle?: ModuleCatalogEntry['lifecycle']
}

export type WorkspaceSearchResult = {
  id: string
  type: string
  title: string
  subtitle: string
  to: string
}

const loadAppCommandPalette = () => import('@vertexade/ui/components/app-command-palette')
const LazyAppCommandPalette = lazy(() => loadAppCommandPalette().then(({ AppCommandPalette }) => ({ default: AppCommandPalette })))
const sidebarPreferenceCookie = 'sidebar_state'

function storedSidebarPreference() {
  const value = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${sidebarPreferenceCookie}=`))
    ?.split('=')[1]
  return value === 'true' ? true : value === 'false' ? false : undefined
}

const coreItems = [
  {
    to: '/',
    label: 'Focus',
    description: 'Decide what needs your attention next',
    icon: Inbox,
    group: 'Workspace',
  },
  {
    to: '/work',
    label: 'Work',
    description: 'Plan and manage durable outcomes',
    icon: BriefcaseBusiness,
    group: 'Workspace',
  },
  {
    to: '/threads',
    label: 'Agents',
    description: 'Follow active runs, decisions, and results',
    icon: MessagesSquare,
    group: 'Workspace',
  },
  {
    to: '/pull-requests',
    label: 'Pull requests',
    compactLabel: 'PRs',
    description: 'Review code and move it toward merge',
    icon: GitPullRequest,
    group: 'Operations',
  },
  {
    to: '/deployments',
    label: 'Delivery',
    description: 'Follow releases, services, and environments',
    icon: Rocket,
    group: 'Operations',
  },
  {
    to: '/automations',
    label: 'Automations',
    description: 'Build and monitor repeatable flows',
    icon: Workflow,
    group: 'Operations',
  },
  {
    to: '/extensions',
    label: 'Extensions',
    description: 'Connect tools and manage integrations',
    icon: Blocks,
    group: 'System',
  },
  {
    to: '/setup',
    label: 'System health',
    description: 'Check prerequisites, connections, and services',
    icon: Wrench,
    group: 'System',
  },
  {
    to: '/settings',
    label: 'Settings',
    description: 'Workspace defaults, repositories, agents, and appearance',
    icon: Settings,
    group: 'System',
  },
] as const satisfies readonly NavItem[]

const recentDestinationsStorageKey = 'vertexade.recent-destinations'

type CorePath = (typeof coreItems)[number]['to']

function remoteLabel(module: ModuleCatalogEntry) {
  return [module.navigation?.label, module.name].find(Boolean) as string
}

function remoteDescription(module: ModuleCatalogEntry) {
  return [module.navigation?.description, module.description, `Open the ${module.name} module`].find(Boolean) as string
}

function remoteNavigationItem(module: ModuleCatalogEntry, existingPaths: Set<string>): NavItem | null {
  const routeBase = extensionWorkspaceRoute(module)
  if (!module.enabled || !routeBase || existingPaths.has(routeBase)) return null
  return {
    to: routeBase,
    label: remoteLabel(module),
    description: remoteDescription(module),
    icon: extensionIcon(module.catalog?.icon, module.id),
    group: 'Operations',
    moduleId: module.id,
    accent: module.catalog?.accent,
    lifecycle: module.lifecycle,
  }
}

function navigationItems(modules: ModuleCatalogEntry[], pinned?: ReadonlySet<string>): NavItem[] {
  const core = [...coreItems]
  const existingPaths = new Set<string>(core.map((item) => item.to))
  const eligible = pinned ? modules.filter((module) => pinned.has(module.id)) : modules
  const remote = eligible.map((module) => remoteNavigationItem(module, existingPaths)).filter((item): item is NavItem => item !== null)
  return [...core, ...remote]
}

function isActiveNavigationItem(item: NavItem, pathname: string) {
  if (!item.moduleId) return item.to === '/' ? pathname === '/' : item.to === pathname || pathname.startsWith(`${item.to}/`)
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function navigationStatus(item: NavItem) {
  if (!item.moduleId) return item.description
  if (item.lifecycle === 'ready') return 'Ready'
  if (item.lifecycle === 'degraded') return 'Needs attention'
  if (item.lifecycle === 'setup-required') return 'Setup required'
  return 'Enabled extension'
}

const navigationShortcuts: Partial<Record<CorePath, string>> = {
  '/': 'G F',
  '/work': 'G W',
  '/threads': 'G A',
  '/pull-requests': 'G P',
}

function lifecycleIndicator(item: NavItem) {
  if (!item.moduleId) return ''
  if (item.lifecycle === 'ready') return 'bg-emerald-500'
  if (item.lifecycle === 'degraded') return 'bg-rose-500'
  return 'bg-amber-500'
}

function navigationIconTone(item: NavItem, emphasized: boolean) {
  if (emphasized) return 'text-primary'
  if (item.moduleId) return extensionAccent(item.accent).icon
  return 'text-sidebar-foreground/50 group-data-[active=true]:text-primary'
}

function NavigationLifecycleDot({ item }: { item: NavItem }) {
  if (!item.moduleId) return null
  return (
    <span aria-hidden="true" className={cn('absolute right-0 top-0 size-1.5 rounded-full ring-2 ring-sidebar', lifecycleIndicator(item))} />
  )
}

function NavigationIcon({ item, compact = false, emphasized = false }: { item: NavItem; compact?: boolean; emphasized?: boolean }) {
  const Icon = item.icon
  const tone = navigationIconTone(item, emphasized)
  return (
    <span className={cn('relative grid shrink-0 place-items-center transition-colors duration-150', compact ? 'size-6' : 'size-7', tone)}>
      <Icon className={compact ? 'size-3.5' : 'size-4'} />
      <NavigationLifecycleDot item={item} />
    </span>
  )
}

function NavigationTooltip({ item }: { item: NavItem }) {
  const shortcut = item.moduleId ? null : navigationShortcuts[item.to as CorePath]
  return (
    <span className="grid min-w-52 gap-1 py-0.5 text-left">
      <span className="flex items-center gap-2">
        <strong className="text-xs font-semibold">{item.label}</strong>
        {shortcut && <Kbd className="ml-auto border-background/20 bg-background/10 text-[10px] text-background">{shortcut}</Kbd>}
      </span>
      <span className="text-[11px] leading-4 text-background/70">{item.description}</span>
      {item.moduleId && (
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium text-background/70">
          <span className={cn('size-1.5 rounded-full', lifecycleIndicator(item))} />
          {navigationStatus(item)}
        </span>
      )}
    </span>
  )
}

function SidebarNavigationItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const closeMobileMenu = () => {
    if (isMobile) setOpenMobile(false)
  }
  const content = (
    <>
      <NavigationIcon item={item} />
      <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <span className="block truncate text-[13px] font-medium">{item.label}</span>
        <span className="mt-0.5 block truncate text-[11px] font-normal text-sidebar-foreground/45 md:hidden">
          {item.moduleId ? navigationStatus(item) : item.description}
        </span>
      </span>
      {item.moduleId && <span className="sr-only">{navigationStatus(item)}</span>}
    </>
  )
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActiveNavigationItem(item, pathname)}
        tooltip={{
          children: <NavigationTooltip item={item} />,
          className: 'items-stretch px-3 py-2',
          sideOffset: 8,
        }}
        size="lg"
        className="relative h-auto min-h-11 items-start gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground/62 transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 hover:bg-sidebar-accent/65 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent/70 data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground data-[active=true]:before:opacity-100 md:h-8 md:min-h-0 md:items-center md:gap-2 md:rounded-md md:px-2 md:py-0 group-data-[collapsible=icon]:justify-center"
        onClick={() => {
          if (isMobile) setOpenMobile(false)
        }}
      >
        {item.moduleId ? (
          <a href={item.to} onClick={closeMobileMenu}>
            {content}
          </a>
        ) : (
          <Link to={item.to as CorePath} activeOptions={{ exact: item.to === '/' }} onClick={closeMobileMenu}>
            {content}
          </Link>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarNavigationGroup({ group, items, pathname }: { group: NavItem['group']; items: NavItem[]; pathname: string }) {
  const groupItems = items.filter((item) => item.group === group)
  const extensionCount = groupItems.filter((item) => item.moduleId).length
  const separated = group !== 'Workspace'
  const showExtensionCount = group === 'Operations' && extensionCount > 0

  return (
    <SidebarGroup
      className={cn(
        'px-0.5 py-1.5',
        separated &&
          'group-data-[collapsible=icon]:mt-1 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-sidebar-border/70 group-data-[collapsible=icon]:pt-2',
      )}
    >
      <SidebarGroupLabel className="mb-1 flex h-5 items-center px-2 text-[10px] font-semibold uppercase tracking-[.12em] text-sidebar-foreground/42">
        <span>{group}</span>
        {showExtensionCount && (
          <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-xs tracking-normal text-sidebar-foreground/65">
            {extensionCount}
          </span>
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {groupItems.map((item) => (
            <SidebarNavigationItem key={item.to} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function MobileSidebarRouteCloser({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const previousPathname = useRef(pathname)
  useEffect(() => {
    const routeChanged = previousPathname.current !== pathname
    previousPathname.current = pathname
    if (isMobile && routeChanged) setOpenMobile(false)
  }, [isMobile, pathname, setOpenMobile])
  return null
}

export function AppNav({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([])
  const moduleCatalog = useReactiveApi<ModuleCatalog>({
    key: 'module-catalog',
    load: () => api<ModuleCatalog>('/api/modules'),
    accepts: isModuleCatalogEvent,
  })
  const modules = moduleCatalog.data?.modules ?? []
  const uiPreferences = useUiPreferences()
  const pinnedExtensionIds = uiPreferences.value.extensionPins
  const [connected, setConnected] = useState(false)
  const [backends, setBackends] = useState<BackendDescriptor[]>([])
  const [themeMounted, setThemeMounted] = useState(false)
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [wideDesktopNavigation, setWideDesktopNavigation] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${WIDE_DESKTOP_BREAKPOINT}px)`)
    const syncNavigation = () => setWideDesktopNavigation(desktopSidebarOpen(window.innerWidth, storedSidebarPreference()))
    media.addEventListener('change', syncNavigation)
    syncNavigation()
    return () => media.removeEventListener('change', syncNavigation)
  }, [])

  useEffect(() => {
    setThemeMounted(true)
    try {
      const stored = JSON.parse(localStorage.getItem(recentDestinationsStorageKey) || '[]')
      setRecentPaths(Array.isArray(stored) ? stored.filter((path): path is string => typeof path === 'string').slice(0, 4) : [])
    } catch {}
  }, [])

  useEffect(() => {
    const query = commandQuery.trim()
    if (!commandOpen || query.length < 2) {
      setSearchResults([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void api<{ results: WorkspaceSearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((result) => setSearchResults(result.results))
        .catch(() => {})
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [commandOpen, commandQuery])

  useEffect(() => {
    const connection = platformConnectionState().subscribe((state) => setConnected(state.connected))
    const backendConnection = platformBackendState().subscribe(setBackends)
    return () => {
      connection.unsubscribe()
      backendConnection.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let pendingGo = false
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '')
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((open) => !open)
        return
      }
      if (editing || event.metaKey || event.ctrlKey || event.altKey || commandOpen) return
      const key = event.key.toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        void navigate({ to: '/work', search: { create: 1, start: 1 } })
        return
      }
      if (key === '?') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }
      const destinations: Partial<Record<string, CorePath>> = {
        f: '/',
        i: '/',
        w: '/work',
        a: '/threads',
        p: '/pull-requests',
      }
      if (pendingGo && destinations[key]) {
        event.preventDefault()
        pendingGo = false
        if (pendingTimer) clearTimeout(pendingTimer)
        void navigate({ to: destinations[key] })
        return
      }
      pendingGo = key === 'g'
      if (pendingTimer) clearTimeout(pendingTimer)
      if (pendingGo)
        pendingTimer = setTimeout(() => {
          pendingGo = false
        }, 900)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (pendingTimer) clearTimeout(pendingTimer)
    }
  }, [commandOpen, navigate])

  const extensionDestinations = useMemo(() => navigationItems(modules).filter((item) => item.moduleId), [modules])
  const visibleItems = useMemo(() => navigationItems(modules, new Set(pinnedExtensionIds)), [modules, pinnedExtensionIds])
  const extensionCommands = useMemo(
    () =>
      modules.flatMap((module) =>
        module.enabled
          ? (module.ui?.commands || []).map((command) => ({
              ...command,
              moduleId: module.id,
              moduleName: module.name,
              icon: extensionIcon(module.catalog?.icon, module.id),
            }))
          : [],
      ),
    [modules],
  )
  const active = [...visibleItems, ...extensionDestinations].find((item) => isActiveNavigationItem(item, pathname)) || visibleItems[0]
  const recentItems = recentPaths
    .map((path) => [...visibleItems, ...extensionDestinations].find((item) => item.to === path))
    .filter((item): item is NavItem => Boolean(item))
  const groups = ['Workspace', 'Operations', 'System'] as const
  useEffect(() => {
    const destination = [...visibleItems, ...extensionDestinations].find((item) => isActiveNavigationItem(item, pathname))
    if (!destination) return
    setRecentPaths((current) => {
      const next = [destination.to, ...current.filter((path) => path !== destination.to)].slice(0, 4)
      if (next.length === current.length && next.every((path, index) => path === current[index])) return current
      try {
        localStorage.setItem(recentDestinationsStorageKey, JSON.stringify(next))
      } catch {}
      return next
    })
  }, [extensionDestinations, pathname, visibleItems])
  const goTo = (item: NavItem) => {
    setCommandOpen(false)
    const nextRecent = [item.to, ...recentPaths.filter((path) => path !== item.to)].slice(0, 4)
    setRecentPaths(nextRecent)
    try {
      localStorage.setItem(recentDestinationsStorageKey, JSON.stringify(nextRecent))
    } catch {}
    if (item.moduleId) window.location.assign(item.to)
    else void navigate({ to: item.to as CorePath })
  }

  return (
    <SidebarProvider open={wideDesktopNavigation} onOpenChange={setWideDesktopNavigation}>
      <MobileSidebarRouteCloser pathname={pathname} />
      <Sidebar
        variant="sidebar"
        collapsible="icon"
        className="border-r border-sidebar-border/50"
        data-audit-shell={wideDesktopNavigation ? 'labeled-navigation' : 'compact-navigation'}
      >
        <SidebarHeader className="px-2.5 py-2 pr-12 md:py-1.5 md:pr-2.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                tooltip={{
                  children: (
                    <span className="grid min-w-44 gap-0.5 py-0.5 text-left">
                      <strong className="text-xs font-semibold">VertexADE</strong>
                      <span className="text-[11px] text-background/70">Engineering workspace</span>
                    </span>
                  ),
                  className: 'items-stretch px-3 py-2',
                  sideOffset: 8,
                }}
                className="h-9 rounded-md hover:bg-transparent data-[active=true]:bg-transparent"
              >
                <Link to="/" className="h-9">
                  <img src="/vertexade-mark.svg" alt="" className="size-6 shrink-0 rounded-md" />
                  <span className="min-w-0 group-data-[collapsible=icon]:hidden">
                    <strong className="block truncate text-[13px] font-semibold tracking-[-.01em]">VertexADE</strong>
                    <span className="block truncate text-[11px] text-sidebar-foreground/45">Workspace navigation</span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="px-2 py-1.5 md:py-2">
          <SidebarGroup className="px-1 pb-1 pt-0">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={{
                      children: (
                        <span className="flex min-w-44 items-center gap-2">
                          <span className="grid gap-0.5 text-left">
                            <strong className="text-xs font-semibold">New work</strong>
                            <span className="text-[11px] text-background/70">Start a focused work item</span>
                          </span>
                          <Kbd className="ml-auto border-background/20 bg-background/10 text-[10px] text-background">N</Kbd>
                        </span>
                      ),
                      className: 'items-stretch px-3 py-2',
                      sideOffset: 8,
                    }}
                    size="lg"
                    className="h-10 rounded-lg bg-primary/10 text-sidebar-primary hover:bg-primary/15 md:h-8 md:rounded-md group-data-[collapsible=icon]:justify-center"
                    onClick={() => void navigate({ to: '/work', search: { create: 1, start: 1 } })}
                  >
                    <span className="grid size-7 shrink-0 place-items-center">
                      <Plus className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold group-data-[collapsible=icon]:hidden">New work</span>
                    <Kbd className="h-5 border-white/20 bg-white/10 text-[11px] text-white/80 group-data-[collapsible=icon]:hidden">N</Kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {groups.map((group) => (
            <SidebarNavigationGroup key={group} group={group} items={visibleItems} pathname={pathname} />
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border/50 p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={{
                  children: (
                    <span className="grid min-w-44 gap-0.5 py-0.5 text-left">
                      <strong className="flex items-center gap-2 text-xs font-semibold">
                        <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')} />
                        {backends.length > 1
                          ? `${backends.filter((backend) => backend.connected).length}/${backends.length} servers live`
                          : connected
                            ? 'Workspace live'
                            : 'Reconnecting'}
                      </strong>
                      {backends.length > 1 ? (
                        <span className="mt-1 grid gap-1 text-[11px] text-background/70">
                          {backends.map((backend) => (
                            <span key={backend.id} className="flex items-center gap-1.5">
                              <span className={cn('size-1.5 rounded-full', backend.connected ? 'bg-emerald-500' : 'bg-amber-500')} />
                              <span className="truncate">{backend.label}</span>
                              <span className="ml-auto">{backend.connected ? 'Live' : 'Offline'}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-[11px] text-background/70">
                          {connected ? 'Realtime updates are connected' : 'Trying to restore realtime updates'}
                        </span>
                      )}
                    </span>
                  ),
                  className: 'items-stretch px-3 py-2',
                  sideOffset: 8,
                }}
                className={cn(
                  'rounded-md px-2 text-[11px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center',
                  backends.length > 1 ? 'h-auto min-h-8 py-1.5' : 'h-8',
                )}
              >
                <div role="status">
                  <span className="grid size-7 shrink-0 place-items-center">
                    <span className={cn('size-2 rounded-full ring-4 ring-sidebar-accent', connected ? 'bg-emerald-500' : 'bg-amber-500')} />
                  </span>
                  <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    {backends.length > 1 ? (
                      <span className="grid gap-0.5">
                        {backends.map((backend) => (
                          <span key={backend.id} className="flex min-w-0 items-center gap-1.5">
                            <span className={cn('size-1.5 shrink-0 rounded-full', backend.connected ? 'bg-emerald-500' : 'bg-amber-500')} />
                            <span className="truncate">{backend.label}</span>
                          </span>
                        ))}
                      </span>
                    ) : connected ? (
                      'Workspace live'
                    ) : (
                      'Reconnecting…'
                    )}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-hidden">
        <div className="sticky top-0 z-40 border-b border-border/50 bg-background/88 backdrop-blur-xl">
          <header className="relative flex h-12 shrink-0 items-center gap-3 px-3 md:h-11 md:px-4" data-audit-shell="native-titlebar">
            <MobileMenuButton className="md:hidden" />
            <Link to="/" className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 md:hidden">
              <img src="/vertexade-mark.svg" alt="" className="size-5 rounded-md" />
              <strong className="text-xs font-semibold">VertexADE</strong>
            </Link>
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger
                    className="mr-0.5 text-muted-foreground"
                    aria-label={wideDesktopNavigation ? 'Collapse workspace navigation' : 'Expand workspace navigation'}
                  />
                </TooltipTrigger>
                <TooltipContent>{wideDesktopNavigation ? 'Collapse navigation' : 'Expand navigation'} · Ctrl/⌘ B</TooltipContent>
              </Tooltip>
              <span className="grid size-7 shrink-0 place-items-center">
                <NavigationIcon item={active} compact emphasized />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-xs font-semibold tracking-[-.01em]">{active.label}</strong>
                <span className="hidden max-w-52 truncate text-[10px] text-muted-foreground/80 2xl:block">{active.description}</span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="absolute left-1/2 hidden h-8 w-[min(32rem,36vw)] -translate-x-1/2 justify-start border-border/55 bg-muted/24 text-muted-foreground shadow-none md:flex"
              onPointerEnter={() => void loadAppCommandPalette()}
              onFocus={() => void loadAppCommandPalette()}
              onClick={() => setCommandOpen(true)}
            >
              <Search className="size-3.5" />
              <span>Jump to anything…</span>
              <Kbd className="ml-auto">⌘ K</Kbd>
            </Button>
            <div className="ml-auto flex items-center gap-1">
              {!coreScreenOwnsPrimaryAction(pathname) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="md:hidden"
                      onClick={() => void navigate({ to: '/work', search: { create: 1, start: 1 } })}
                      aria-label="Start new work"
                    >
                      <Plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Start new work</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto md:hidden"
                    onPointerEnter={() => void loadAppCommandPalette()}
                    onFocus={() => void loadAppCommandPalette()}
                    onClick={() => setCommandOpen(true)}
                    aria-label="Open command palette"
                  >
                    <Search />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Quick navigation</TooltipContent>
              </Tooltip>
              <NotificationCenter />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hidden md:inline-flex"
                    onClick={() => {
                      const colorMode = resolvedTheme === 'dark' ? 'light' : 'dark'
                      setTheme(colorMode)
                      saveAppearancePreferences({ ...readAppearancePreferences(), colorMode })
                    }}
                    aria-label="Toggle color theme"
                  >
                    {themeMounted && resolvedTheme === 'dark' ? <Sun /> : <Moon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Switch appearance</TooltipContent>
              </Tooltip>
            </div>
          </header>
        </div>
        <div className="min-h-[calc(100svh-3rem)] min-w-0 pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:min-h-[calc(100svh-2.75rem)] md:pb-0">
          {children}
        </div>
        <MobileActionDock pathname={pathname} items={visibleItems} />
      </SidebarInset>

      {commandOpen && (
        <LazyBoundary label="command palette" resetKey={String(commandOpen)}>
          <LazyAppCommandPalette
            open={commandOpen}
            query={commandQuery}
            recentItems={recentItems}
            visibleItems={visibleItems}
            extensionDestinations={extensionDestinations}
            pinnedExtensionIds={pinnedExtensionIds}
            extensionCommands={extensionCommands}
            searchResults={searchResults}
            activeTo={active.to}
            renderNavigationIcon={(item, compact) => <NavigationIcon item={item} compact={compact} />}
            onOpenChange={(open) => {
              setCommandOpen(open)
              if (!open) setCommandQuery('')
            }}
            onQueryChange={setCommandQuery}
            onGoTo={goTo}
            onCreateWork={() => {
              setCommandOpen(false)
              void navigate({ to: '/work', search: { create: 1, start: 1 } })
            }}
            onOpenExtensionCommand={(to) => {
              setCommandOpen(false)
              window.location.assign(to)
            }}
          />
        </LazyBoundary>
      )}
    </SidebarProvider>
  )
}

function coreScreenOwnsPrimaryAction(pathname: string) {
  return pathname === '/' || ['/work', '/threads', '/pull-requests'].some((path) => pathname === path || pathname.startsWith(`${path}/`))
}
