import {
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Info,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, IconButton } from '@vertexade/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vertexade/ui/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import {
  ListItem,
  ListItemAction,
  ListItemContent,
  ListItemDescription,
  ListItemMedia,
  ListItemMeta,
  ListItemTitle,
} from '@vertexade/ui/components/ui/list'
import { Status } from '@vertexade/ui/components/ui/status'
import { age } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import type { InboxItem, InboxState, InboxView } from './inbox-types'

function snoozeDate(period: 'hour' | 'tomorrow' | 'week') {
  const date = new Date()
  if (period === 'hour') date.setHours(date.getHours() + 1)
  if (period === 'tomorrow') {
    date.setDate(date.getDate() + 1)
    date.setHours(9, 0, 0, 0)
  }
  if (period === 'week') date.setDate(date.getDate() + 7)
  return date.toISOString()
}

export function inboxLabel(value: string) {
  return value.replaceAll('-', ' ').replaceAll('_', ' ')
}

export function InboxEmpty({ view, filtered, onClear }: { view: InboxView; filtered: boolean; onClear: () => void }) {
  const message =
    view === 'action'
      ? 'There are no errors or blockers waiting for a decision.'
      : view === 'updates'
        ? 'Routine activity will appear here without competing with blockers.'
        : view === 'saved'
          ? 'Save an Inbox item when you want to keep it close without leaving it in the action queue.'
          : view === 'snoozed'
            ? 'Snoozed items return to the action or update queue at the time you choose.'
            : 'Completed Inbox items remain available here and can be reopened.'
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle2 className="text-emerald-400" />
        </EmptyMedia>
        <EmptyTitle>{filtered ? 'No items match these filters' : 'This queue is clear'}</EmptyTitle>
        <EmptyDescription>{filtered ? 'Broaden the filters or search to bring items back into view.' : message}</EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

export function InboxRow({
  item,
  busy,
  onUpdate,
}: {
  item: InboxItem
  busy: boolean
  onUpdate: (item: InboxItem, state: InboxState, snoozedUntil?: string | null) => Promise<void>
}) {
  const Icon = item.severity === 'error' ? ShieldAlert : item.severity === 'warning' ? AlertTriangle : Info
  const tone = item.severity === 'error' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info'
  return (
    <ListItem
      className={cn(
        'relative grid grid-cols-[auto_minmax(0,1fr)] sm:flex',
        item.unread && item.triageState === 'open' && 'bg-blue-500/[.025]',
      )}
    >
      <ListItemMedia
        className={cn(
          item.severity === 'info' && 'bg-blue-500/10 text-blue-400',
          item.severity === 'warning' && 'bg-amber-500/10 text-amber-400',
          item.severity === 'error' && 'bg-red-500/10 text-red-400',
        )}
      >
        <Icon />
      </ListItemMedia>
      <ListItemContent className="pr-14 sm:pr-0">
        <ListItemTitle>
          {item.href ? (
            <a href={item.href} className="min-w-0 break-words hover:text-primary hover:underline">
              {item.title}
            </a>
          ) : (
            <span className="min-w-0 break-words">{item.title}</span>
          )}
          {item.unread && item.triageState === 'open' && <span className="size-1.5 rounded-full bg-blue-400" title="Unread" />}
          <Status tone={tone} className="hidden sm:inline-flex">
            {item.severity}
          </Status>
          <Badge variant="outline" className="hidden capitalize sm:inline-flex">
            {inboxLabel(item.type)}
          </Badge>
        </ListItemTitle>
        <ListItemDescription className="line-clamp-2 break-words">{item.summary}</ListItemDescription>
        <ListItemMeta>
          <span>{item.source}</span>
          {item.createdAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>{age(item.createdAt)}</span>
            </>
          )}
          {item.triageState === 'snoozed' && item.snoozedUntil && (
            <>
              <span aria-hidden="true">·</span>
              <span>Returns {new Date(item.snoozedUntil).toLocaleString()}</span>
            </>
          )}
        </ListItemMeta>
      </ListItemContent>
      <ListItemAction className="absolute right-2 top-2 gap-1 sm:static sm:ml-auto sm:self-center">
        {item.href && (
          <Button asChild variant="outline" size="xs" className="hidden sm:inline-flex">
            <a href={item.href}>
              {item.actionLabel || 'Open'}
              <ExternalLink />
            </a>
          </Button>
        )}
        {item.triageState !== 'done' && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-success"
            loading={busy}
            loadingText="Saving…"
            aria-label={`Complete ${item.title}`}
            onClick={() => void onUpdate(item, 'done')}
          >
            <Check />
            <span className="hidden sm:inline">Done</span>
          </Button>
        )}
        {item.triageState === 'done' && (
          <Button
            variant="outline"
            size="xs"
            loading={busy}
            loadingText="Restoring…"
            aria-label={`Reopen ${item.title}`}
            onClick={() => void onUpdate(item, 'open')}
          >
            <RotateCcw />
            <span className="hidden sm:inline">Reopen</span>
          </Button>
        )}
        {item.triageState !== 'done' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More triage actions for ${item.title}`} variant="ghost" size="icon-xs" disabled={busy}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Keep for later</DropdownMenuLabel>
              {item.triageState !== 'open' && (
                <DropdownMenuItem onSelect={() => void onUpdate(item, 'open')}>
                  <RotateCcw />
                  Return to Inbox
                </DropdownMenuItem>
              )}
              {item.triageState !== 'saved' && (
                <DropdownMenuItem onSelect={() => void onUpdate(item, 'saved')}>
                  <Bookmark />
                  Save
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void onUpdate(item, 'snoozed', snoozeDate('hour'))}>
                <Clock3 />
                Snooze one hour
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onUpdate(item, 'snoozed', snoozeDate('tomorrow'))}>
                <Clock3 />
                Snooze until tomorrow
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onUpdate(item, 'snoozed', snoozeDate('week'))}>
                <Clock3 />
                Snooze one week
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ListItemAction>
    </ListItem>
  )
}
