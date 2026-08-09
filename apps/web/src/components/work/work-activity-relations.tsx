import { Link } from '@tanstack/react-router'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { age } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'

export function Activity({ item }: { item: WorkItem }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-0 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-border">
          {item.events.map((event) => (
            <div
              key={event.id}
              className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 gap-y-0.5 py-2 sm:grid-cols-[16px_minmax(0,1fr)_auto]"
            >
              <span className="mt-1 size-3.5 rounded-full border-2 border-background bg-slate-500" />
              <div>
                <strong className="block text-xs">{event.summary}</strong>
                <span className="text-[11px] capitalize text-muted-foreground">
                  {event.event_type.replaceAll('_', ' ')} · {event.actor}
                </span>
              </div>
              <span className="col-start-2 text-[11px] text-muted-foreground sm:col-start-auto">{age(event.created_at)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function Relations({ item }: { item: WorkItem }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relationships</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.relations.map((relation) => (
          <Link
            key={`${relation.to_work_item_id}:${relation.relation}`}
            to="/work/$workKey"
            params={{ workKey: relation.key }}
            className="flex min-h-11 items-center gap-2 rounded-lg border p-2.5 hover:bg-accent"
          >
            <Badge variant="outline" className="capitalize">
              {relation.relation.replace('_', ' ')}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs">
              {relation.key} · {relation.title}
            </span>
          </Link>
        ))}
        {!item.relations.length && (
          <p className="text-xs text-muted-foreground">Parent, child, blocker, and related work will appear here.</p>
        )}
      </CardContent>
    </Card>
  )
}
