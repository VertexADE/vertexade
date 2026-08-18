import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BriefcaseBusiness, Inbox, MessagesSquare, Plus, Search, Settings, Sparkles, Wrench } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@vertexade/ui/components/ui/command'
import type { NavItem, WorkspaceSearchResult } from '@vertexade/ui/components/app-nav'

type ExtensionCommand = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  to: string
  moduleId: string
  moduleName: string
  icon: LucideIcon
}

export function AppCommandPalette({
  open,
  query,
  recentItems,
  visibleItems,
  extensionDestinations,
  pinnedExtensionIds,
  extensionCommands,
  searchResults,
  activeTo,
  renderNavigationIcon,
  onOpenChange,
  onQueryChange,
  onGoTo,
  onCreateWork,
  onOpenExtensionCommand,
}: {
  open: boolean
  query: string
  recentItems: NavItem[]
  visibleItems: NavItem[]
  extensionDestinations: NavItem[]
  pinnedExtensionIds: string[]
  extensionCommands: ExtensionCommand[]
  searchResults: WorkspaceSearchResult[]
  activeTo: string
  renderNavigationIcon(item: NavItem, compact?: boolean): ReactNode
  onOpenChange(open: boolean): void
  onQueryChange(query: string): void
  onGoTo(item: NavItem): void
  onCreateWork(): void
  onOpenExtensionCommand(to: string): void
}) {
  const groups = ['Workspace', 'Operations'] as const
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Navigate VertexADE" description="Jump to any engineering workspace">
      <CommandInput value={query} onValueChange={onQueryChange} placeholder="Search Work, PRs, runs, repositories, and extensions…" />
      <CommandList>
        <CommandEmpty>No matching workspace found.</CommandEmpty>
        <CommandGroup heading="Create">
          <CommandItem value="Create new Work outcome task" onSelect={onCreateWork}>
            <Plus className="text-primary" />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-medium">Create Work</strong>
              <span className="block text-xs text-muted-foreground">Describe an outcome and start when ready</span>
            </span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        {!query && recentItems.length > 0 && (
          <CommandGroup heading="Recent">
            {recentItems.map((item) => (
              <CommandItem
                key={`recent:${item.to}`}
                value={`Recent ${item.label} ${item.description}`}
                className="[&>span:first-child]:size-4"
                onSelect={() => onGoTo(item)}
              >
                {renderNavigationIcon(item, true)}
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium">{item.label}</strong>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {visibleItems
              .filter((item) => item.group === group)
              .map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.description}`}
                  className="[&>span:first-child]:size-4"
                  onSelect={() => onGoTo(item)}
                >
                  {renderNavigationIcon(item, true)}
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium">{item.label}</strong>
                    <span className="block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  {activeTo === item.to && <Sparkles className="ml-auto size-3.5 text-primary" />}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        {extensionDestinations.some((item) => !pinnedExtensionIds.includes(item.moduleId || '')) && (
          <CommandGroup heading="Extension workspaces">
            {extensionDestinations
              .filter((item) => !pinnedExtensionIds.includes(item.moduleId || ''))
              .map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.description}`}
                  className="[&>span:first-child]:size-4"
                  onSelect={() => onGoTo(item)}
                >
                  {renderNavigationIcon(item, true)}
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium">{item.label}</strong>
                    <span className="block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  {activeTo === item.to && <Sparkles className="ml-auto size-3.5 text-primary" />}
                </CommandItem>
              ))}
          </CommandGroup>
        )}
        {extensionCommands.length > 0 && (
          <CommandGroup heading="Extension actions">
            {extensionCommands.map((command) => {
              const Icon = command.icon
              return (
                <CommandItem
                  key={`${command.moduleId}:${command.id}`}
                  value={`${command.label} ${command.description || ''} ${(command.keywords || []).join(' ')}`}
                  onSelect={() => onOpenExtensionCommand(command.to)}
                >
                  <Icon className="text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium">{command.label}</strong>
                    <span className="block text-xs text-muted-foreground">{command.description || command.moduleName}</span>
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {searchResults.length > 0 && (
          <CommandGroup heading="Workspace results">
            {searchResults
              .filter((result, index, all) => all.findIndex((candidate) => candidate.to === result.to) === index)
              .map((result) => (
                <CommandItem
                  key={result.id}
                  value={`${result.title} ${result.subtitle} ${result.type}`}
                  onSelect={() => onOpenExtensionCommand(result.to)}
                >
                  <Search className="text-muted-foreground" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-medium">{result.title}</strong>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.type} · {result.subtitle}
                    </span>
                  </span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}
        {!query && (
          <CommandGroup heading="Keyboard shortcuts">
            <CommandItem value="Shortcut go to focus g f" onSelect={() => onGoTo(visibleItems.find((item) => item.to === '/')!)}>
              <Inbox className="text-muted-foreground" />
              <span className="min-w-0 flex-1">Go to Focus</span>
              <CommandShortcut>G then F</CommandShortcut>
            </CommandItem>
            <CommandItem value="Shortcut go to work g w" onSelect={() => onGoTo(visibleItems.find((item) => item.to === '/work')!)}>
              <BriefcaseBusiness className="text-muted-foreground" />
              <span className="min-w-0 flex-1">Go to Work</span>
              <CommandShortcut>G then W</CommandShortcut>
            </CommandItem>
            <CommandItem value="Shortcut go to agents g a" onSelect={() => onGoTo(visibleItems.find((item) => item.to === '/threads')!)}>
              <MessagesSquare className="text-muted-foreground" />
              <span className="min-w-0 flex-1">Go to Agent activity</span>
              <CommandShortcut>G then A</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="System">
          <CommandItem
            value="System health setup install prerequisites onboarding"
            onSelect={() =>
              onGoTo({
                to: '/setup',
                label: 'System health',
                description: 'Check prerequisites, connections, and services',
                icon: Wrench,
                group: 'System',
              })
            }
          >
            <Wrench className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-medium">System health</strong>
              <span className="block text-xs text-muted-foreground">Prerequisites, connections, and runtime status</span>
            </span>
          </CommandItem>
          <CommandItem
            value="Settings repositories prompts agents appearance"
            onSelect={() =>
              onGoTo({
                to: '/settings',
                label: 'Settings',
                description: 'Workspace defaults, repositories, agents, and appearance',
                icon: Settings,
                group: 'System',
              })
            }
          >
            <Settings className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-medium">Settings</strong>
              <span className="block text-xs text-muted-foreground">Workspace defaults, repositories, agents, and appearance</span>
            </span>
            <CommandShortcut>S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
