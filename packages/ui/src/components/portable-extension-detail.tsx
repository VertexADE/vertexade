import { useEffect, useState } from 'react'
import type {
  PortableActionInput,
  PortableActionValue,
  PortableCollectionSurface,
  PortableDetailSection,
  PortableItemAction,
} from '@vertexade/platform-contracts'
import type { PlatformExtensionClient } from '@vertexade/platform-client'
import {
  readPortablePath,
  type PortableCollectionItem,
  type PortableField,
  type PortableRelationItem,
} from '@vertexade/platform-contracts/portable'
import { ArrowLeft, BookOpenText, ChevronRight, CornerDownRight, ExternalLink, Eye, GitBranch, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { Avatar, AvatarFallback, AvatarImage } from '@vertexade/ui/components/ui/avatar'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { age } from '@vertexade/ui/lib/dashboard-api'
import { extensionBrowserAssetSource } from '@vertexade/ui/lib/extension-presentation'
import { cn } from '@vertexade/ui/lib/utils'
export { PortableActionDialog, type PortableSourceData } from '@vertexade/ui/components/portable-action-dialog'

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

export function portableField(item: PortableCollectionItem, name: string) {
  return item.fields.find((field) => field.name.toLowerCase() === name.toLowerCase())
}

export function portableDisplayTitle(item: PortableCollectionItem) {
  const type = portableField(item, 'Type')?.value
  const prefix = `${type ? `${type} ` : ''}#${item.id}:`
  return item.title.startsWith(prefix) ? item.title.slice(prefix.length).trim() : item.title
}

export function portableIdLabel(item: PortableCollectionItem) {
  if (/^\d+$/.test(item.id)) return `#${item.id}`
  if (/^rec[A-Za-z0-9]+$/.test(item.id)) return 'Record'
  return item.id.length > 14 ? `${item.id.slice(0, 7)}…${item.id.slice(-4)}` : item.id
}

type PortablePerson = Pick<PortableRelationItem, 'id' | 'title' | 'imageUrl'>

function portablePeople(item: PortableCollectionItem): PortablePerson[] {
  const people = item.fields
    .filter((field) => field.placement === 'card')
    .flatMap((field) => {
      if (field.relations.length) return field.relations
      if (field.style === 'person' && field.value) return [{ id: field.value, title: field.value, imageUrl: field.imageUrl }]
      return []
    })
  return [...new Map(people.map((person) => [`${person.id}:${person.title}`, person])).values()]
}

function portableInitials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '·'
  )
}

function PortablePersonAvatar({ person, size = 'sm' }: { person: PortablePerson; size?: 'sm' | 'default' | 'lg' }) {
  return (
    <Avatar size={size} title={person.title}>
      {person.imageUrl && <AvatarImage src={extensionBrowserAssetSource(person.imageUrl)} alt="" />}
      <AvatarFallback className="bg-blue-500/10 font-mono text-[11px] text-blue-300">{portableInitials(person.title)}</AvatarFallback>
    </Avatar>
  )
}

function PortablePeople({ people, label = false, limit = 3 }: { people: PortablePerson[]; label?: boolean; limit?: number }) {
  if (!people.length) return null
  const shown = people.slice(0, limit)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background">
        {shown.map((person) => (
          <PortablePersonAvatar key={`${person.id}:${person.title}`} person={person} />
        ))}
        {people.length > limit && (
          <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] text-muted-foreground ring-2 ring-background">
            +{people.length - limit}
          </span>
        )}
      </span>
      {label && (
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{people.map((person) => person.title).join(', ')}</span>
      )}
    </span>
  )
}

function portableRichText(value: string) {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value
  return value
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li(?:\s[^>]*)?>/gi, '\n- ')
    .replace(/<\/(?:div|p|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function portableTone(value: string) {
  if (/done|closed|resolved|complete|approved/i.test(value)) return 'bg-emerald-400'
  if (/block|fail|reject|critical/i.test(value)) return 'bg-red-400'
  if (/review|ready|committed|pending/i.test(value)) return 'bg-amber-400'
  if (/active|progress|doing|new|open/i.test(value)) return 'bg-blue-400'
  return 'bg-slate-400'
}

export function PortableDetailPage({
  actions,
  data,
  item,
  loading,
  onAction,
  onBack,
  onOpenItem,
  surface,
}: {
  actions: PortableItemAction[]
  data: unknown
  item: PortableCollectionItem
  loading: boolean
  onAction(action: PortableItemAction): void
  onBack(): void
  onOpenItem(itemId: string): void
  surface: PortableCollectionSurface
}) {
  const type = portableField(item, 'Type')?.value || String(readPortablePath(item.raw, 'type') || '')
  const state =
    portableField(item, 'State')?.value ||
    portableField(item, 'Status')?.value ||
    portableField(item, 'Board column')?.value ||
    String(readPortablePath(item.raw, 'state') || '')
  const pointsValue = readPortablePath(item.raw, 'story_points') || readPortablePath(item.raw, 'effort')
  const points = pointsValue === null || pointsValue === undefined || pointsValue === '' ? '' : String(pointsValue)
  const people = portablePeople(item)
  const primary = actions.find((action) => action.intent === 'launch-work') || actions[0]
  const secondary = actions.filter((action) => action !== primary)
  const stateOptions = records(readPortablePath(item.raw, 'state_options'))
    .map((option) => String(option.name || option.id || ''))
    .filter(Boolean)
  const currentIndex = Math.max(0, stateOptions.indexOf(state))
  const sections = surface.detail?.sections || []
  const relations = item.fields.flatMap((field) => field.relations)
  const facts = item.fields.filter(
    (field) =>
      !field.relations.length &&
      !['Type', 'State', 'Board column', 'Assigned', 'Description', 'Acceptance criteria', 'Evidence'].includes(field.name),
  )
  return (
    <article className="pb-20 sm:pb-4">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onBack}>
        <ArrowLeft />
        Board
      </Button>
      <header className="mb-3 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-blue-400">{portableIdLabel(item)}</span>
          {type && <Badge variant="outline">{type}</Badge>}
          {state && (
            <Badge variant="secondary" className="gap-1.5">
              <span className={cn('size-1.5 rounded-full', portableTone(state))} />
              {state}
            </Badge>
          )}
          {points && <Badge variant="outline">{String(points)} points</Badge>}
        </div>
        <h1 className="mt-2 max-w-4xl break-words text-xl font-semibold leading-tight sm:text-2xl">{portableDisplayTitle(item)}</h1>
        {people.length > 0 && (
          <div className="mt-2">
            <PortablePeople people={people} label limit={4} />
          </div>
        )}
      </header>
      <div className="sticky top-13 z-30 -mx-4 mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-y border-border/55 bg-background/95 p-2 backdrop-blur-md sm:static sm:mx-0 sm:flex sm:border-x-0 sm:border-t-0">
        {primary && (
          <Button className="min-w-0 sm:min-w-40" size="sm" onClick={() => onAction(primary)}>
            <GitBranch />
            <span className="truncate">{primary.label}</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="More work item actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {secondary.map((action) => (
              <DropdownMenuItem key={action.id} onSelect={() => onAction(action)}>
                <GitBranch />
                {action.label}
              </DropdownMenuItem>
            ))}
            {relations.map(
              (relation) =>
                relation.url && (
                  <DropdownMenuItem key={relation.id} asChild>
                    <a href={relation.url} target="_blank" rel="noreferrer">
                      <ExternalLink />
                      {relation.title}
                    </a>
                  </DropdownMenuItem>
                ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {stateOptions.length > 1 && (
        <ol
          aria-label={`Workflow state, ${state} is current`}
          className="mb-4 grid overflow-hidden rounded-lg border"
          style={{ gridTemplateColumns: `repeat(${stateOptions.length}, minmax(0, 1fr))` }}
        >
          {stateOptions.map((option, index) => (
            <li
              key={option}
              aria-current={option === state ? 'step' : undefined}
              className={cn(
                'relative flex min-w-0 flex-col items-center gap-1 px-0.5 py-2.5 text-muted-foreground',
                index <= currentIndex && 'text-foreground',
                option === state &&
                  'bg-blue-500/[.06] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-500',
              )}
            >
              <span className={cn('size-2 rounded-full border', index <= currentIndex && 'border-blue-400 bg-blue-400')} />
              <span className="max-w-full truncate text-[11px]">{option}</span>
            </li>
          ))}
        </ol>
      )}
      {loading && <p className="rounded-lg border p-4 text-xs text-muted-foreground">Refreshing complete work-item details…</p>}
      <div className="overflow-hidden rounded-lg border">
        {sections.map((section) => (
          <PortableDetailSectionView key={section.id} section={section} source={data || item.raw} onOpenItem={onOpenItem} />
        ))}
        {facts.length > 0 && (
          <section className="border-t p-3 first:border-t-0">
            <h2 className="mb-2 text-xs font-semibold">Details</h2>
            <div className="grid grid-cols-2 gap-3">
              {facts.map((field) => (
                <PortableFieldValue key={field.name} field={field} />
              ))}
            </div>
          </section>
        )}
        {relations.length > 0 && (
          <section className="border-t p-3">
            <h2 className="mb-2 text-xs font-semibold">Related</h2>
            {relations.map((relation) => (
              <PortableRelationRow key={`${relation.id}:${relation.title}`} relation={relation} />
            ))}
          </section>
        )}
      </div>
    </article>
  )
}

function PortableDetailSectionView({
  section,
  source,
  onOpenItem,
}: {
  section: PortableDetailSection
  source: unknown
  onOpenItem(itemId: string): void
}) {
  const value = readPortablePath(source, section.path)
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  if (section.kind === 'markdown')
    return (
      <section className="border-t p-3 first:border-t-0">
        <h2 className="mb-2 text-xs font-semibold">{section.title}</h2>
        {empty ? (
          <p className="text-xs text-muted-foreground">No {section.title.toLowerCase()} provided.</p>
        ) : (
          <MarkdownContent
            content={portableRichText(String(value))}
            className="min-w-0 max-w-full text-xs [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto"
          />
        )}
      </section>
    )
  if (section.kind === 'list') {
    const items = records(value)
    return (
      <section className="border-t p-3 first:border-t-0">
        <h2 className="mb-2 text-xs font-semibold">
          {section.title} <span className="ml-1 font-mono text-[11px] text-muted-foreground">{items.length}</span>
        </h2>
        {items.map((entry) => {
          const id = String(entry.id || '')
          const state = String(entry.state || '')
          return (
            <button
              key={id || String(entry.title)}
              type="button"
              disabled={!id}
              onClick={() => id && onOpenItem(id)}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-t py-2.5 text-left first:border-t-0"
            >
              <span className={cn('size-2 rounded-full', portableTone(state))} />
              <span className="min-w-0">
                <strong className="block truncate text-[11px]">
                  {id ? `#${id} · ` : ''}
                  {String(entry.title || entry.name || 'Untitled')}
                </strong>
                <small className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {[entry.type, state, readPortablePath(entry, 'assigned_to.display_name')].filter(Boolean).join(' · ')}
                </small>
              </span>
              <ChevronRight className="size-3 text-muted-foreground" />
            </button>
          )
        })}
        {empty && <p className="text-xs text-muted-foreground">No linked child work.</p>}
      </section>
    )
  }
  if (section.kind === 'timeline') {
    const entries = records(value)
    return (
      <section className="border-t p-3 first:border-t-0">
        <h2 className="mb-2 text-xs font-semibold">{section.title}</h2>
        {entries.map((entry, index) => {
          const at = String(entry.at || '')
          return (
            <div key={`${at}:${index}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 border-t py-2.5 first:border-t-0">
              <span className="mt-1 size-2 rounded-full bg-blue-400" />
              <span className="min-w-0">
                <strong className="block truncate text-[11px]">{String(entry.title || entry.summary || 'Updated')}</strong>
                <small className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {String(entry.detail || entry.actor || '')}
                </small>
              </span>
              {at && <time className="text-[11px] text-muted-foreground">{age(at)}</time>}
            </div>
          )
        })}
        {empty && <p className="text-xs text-muted-foreground">No activity available.</p>}
      </section>
    )
  }
  if (empty) return null
  return (
    <section className="border-t p-3 first:border-t-0">
      <h2 className="mb-2 text-xs font-semibold">{section.title}</h2>
      <PortableDetailValue value={value} />
    </section>
  )
}

export function PortableCard({
  item,
  actions,
  compact = false,
  onDetails,
  onAction,
}: {
  item: PortableCollectionItem
  actions: PortableItemAction[]
  compact?: boolean
  onDetails: (item: PortableCollectionItem) => void
  onAction: (action: PortableItemAction) => void
}) {
  const cardFields = item.fields.filter((field) => field.placement === 'card').slice(0, compact ? 4 : undefined)
  const type = portableField(item, 'Type')?.value
  const state = portableField(item, 'State')?.value || portableField(item, 'Status')?.value || ''
  const column = portableField(item, 'Board column')?.value
  const assigned = portableField(item, 'Assigned')?.value
  const people = portablePeople(item)
  const story = type === 'User Story' || type === 'Product Backlog Item'
  const subtask = type === 'Task' && Boolean(item.parentId)
  const displayType = subtask ? 'Subtask' : type
  const typeLabel = displayType && (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1 truncate', story && 'font-medium text-blue-300', subtask && 'text-violet-300')}
    >
      {story ? <BookOpenText className="size-3 shrink-0" /> : subtask ? <CornerDownRight className="size-3 shrink-0" /> : null}
      {displayType}
    </span>
  )
  return (
    <Card
      className={cn(
        compact && 'group gap-0 rounded-none border-b py-0 ring-0 last:border-b-0',
        story && 'border-l-2 border-l-blue-500/60 bg-blue-500/[.025]',
        subtask && 'border-l-2 border-l-violet-500/40 bg-violet-500/[.02]',
      )}
      style={item.depth ? { marginLeft: `${Math.min(item.depth, 4) * 1.25}rem` } : undefined}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center sm:hidden">
        <button type="button" className="min-w-0 p-3 text-left" onClick={() => onDetails(item)}>
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            <span className="shrink-0 font-mono text-blue-400">{portableIdLabel(item)}</span>
            {typeLabel}
            {subtask && <span className="truncate text-[11px] text-muted-foreground">of #{item.parentId}</span>}
            <span className="ml-auto">
              {people.length ? (
                <PortablePeople people={people} />
              ) : (
                assigned && <span className="max-w-32 truncate text-muted-foreground">{assigned}</span>
              )}
            </span>
          </div>
          <strong className="mt-1 block line-clamp-2 text-[13px] font-medium leading-[1.15rem]">{portableDisplayTitle(item)}</strong>
          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={cn('size-2 shrink-0 rounded-full', portableTone(state || column || ''))} />
            <span className="truncate font-medium text-foreground">{state || column || 'No status'}</span>
            {column && column !== state && (
              <>
                <span>·</span>
                <span className="truncate">{column}</span>
              </>
            )}
            <ChevronRight className="ml-auto size-3 shrink-0 transition group-hover:translate-x-0.5" />
          </span>
        </button>
        {actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="mr-2" size="icon-sm" variant="ghost" aria-label={`More actions for ${item.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <DropdownMenuItem key={action.id} onSelect={() => onAction(action)}>
                  <GitBranch />
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="hidden sm:block">
        {compact ? (
          <div className="p-3">
            <div className="flex min-w-0 items-center gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-blue-400">{portableIdLabel(item)}</span>
              {typeLabel}
              {subtask && <span className="truncate text-[11px] text-muted-foreground">of #{item.parentId}</span>}
              {actions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="ml-auto -mr-1" size="icon-xs" variant="ghost" aria-label={`More actions for ${item.title}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {actions.map((action) => (
                      <DropdownMenuItem key={action.id} onSelect={() => onAction(action)}>
                        <GitBranch />
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <button type="button" className="mt-1 block w-full text-left" onClick={() => onDetails(item)}>
              <strong className="block line-clamp-2 text-xs font-medium leading-4">{portableDisplayTitle(item)}</strong>
            </button>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn('size-1.5 shrink-0 rounded-full', portableTone(state || column || ''))} />
              <span className="truncate font-medium text-foreground">{state || column || 'No status'}</span>
              <span className="ml-auto">
                {people.length ? <PortablePeople people={people} /> : assigned && <span className="max-w-32 truncate">{assigned}</span>}
              </span>
            </div>
          </div>
        ) : (
          <>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 text-left" onClick={() => onDetails(item)}>
                  <CardTitle>{item.title}</CardTitle>
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" aria-label={`Open details for ${item.title}`} onClick={() => onDetails(item)}>
                    <Eye />
                    Details
                  </Button>
                  {actions.map((action) => (
                    <Button key={action.id} size="sm" aria-label={`${action.label} for ${item.title}`} onClick={() => onAction(action)}>
                      <GitBranch />
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {cardFields.map((field) => (
                <PortableFieldValue key={field.name} field={field} />
              ))}
            </CardContent>
          </>
        )}
      </div>
    </Card>
  )
}

function PortableDetailValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return <p className="whitespace-pre-wrap break-words text-sm">{String(value)}</p>
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border p-3">
            <PortableDetailValue value={item} />
          </div>
        ))}
      </div>
    )
  if (typeof value === 'object')
    return (
      <dl className="grid gap-3">
        {Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== null && item !== undefined && item !== '')
          .map(([key, item]) => (
            <div key={key} className="min-w-0">
              <dt className="font-mono text-xs uppercase text-muted-foreground">{key.replaceAll('_', ' ')}</dt>
              <dd className="mt-1 min-w-0">
                <PortableDetailValue value={item} />
              </dd>
            </div>
          ))}
      </dl>
    )
  return null
}

function PortableFieldValue({ field }: { field: PortableField }) {
  const date = field.style === 'date' && !Number.isNaN(Date.parse(field.value)) ? new Date(field.value).toLocaleDateString() : field.value
  return (
    <div>
      <p className="font-mono text-xs uppercase text-muted-foreground">{field.name}</p>
      {field.style === 'badge' ? (
        <Badge className="mt-1" variant="secondary">
          {field.value}
        </Badge>
      ) : field.style === 'person' ? (
        <div className="mt-1">
          <PortablePeople people={[{ id: field.value, title: field.value, imageUrl: field.imageUrl }]} label />
        </div>
      ) : field.style === 'links' && field.relations.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {field.relations.map((relation) => (
            <PortableRelationChip key={`${relation.id}:${relation.title}`} relation={relation} />
          ))}
        </div>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{date}</p>
      )}
    </div>
  )
}

function PortableRelationChip({ relation }: { relation: PortableRelationItem }) {
  const lead =
    relation.imageUrl || !relation.url ? (
      <PortablePersonAvatar person={relation} />
    ) : (
      <span className="grid size-6 place-items-center rounded-full bg-blue-500/10 text-blue-400">
        <ExternalLink className="size-3" />
      </span>
    )
  const content = (
    <>
      {lead}
      <span className="max-w-40 truncate">{relation.title}</span>
    </>
  )
  const className = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card/50 py-1 pl-1 pr-2 text-[11px] text-foreground'
  return relation.url ? (
    <a href={relation.url} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  )
}

function PortableRelationRow({ relation }: { relation: PortableRelationItem }) {
  const lead =
    relation.imageUrl || !relation.url ? (
      <PortablePersonAvatar person={relation} />
    ) : (
      <span className="grid size-6 place-items-center rounded-full bg-blue-500/10 text-blue-400">
        <ExternalLink className="size-3" />
      </span>
    )
  const content = (
    <>
      {lead}
      <span className="min-w-0 flex-1 truncate">{relation.title}</span>
      {relation.url && <ChevronRight className="size-3 text-muted-foreground" />}
    </>
  )
  const className = 'flex min-h-11 items-center gap-2 border-t py-2 text-xs first:border-t-0'
  return relation.url ? (
    <a href={relation.url} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  )
}
