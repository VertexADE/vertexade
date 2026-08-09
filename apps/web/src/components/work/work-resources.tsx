import { useEffect, useState } from 'react'
import type { WorkResourcePresentation } from '@vertexade/platform-contracts'
import { ExternalLink, GitBranch, GitPullRequest, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  AgentResourcePicker,
  emptyAgentResourceSelection,
  type AgentResourceSelection,
} from '@vertexade/ui/components/agent-resource-picker'
import { resourceReference, WorkReferencePicker } from '@vertexade/ui/components/work-reference-picker'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { WorkItem, WorkReferenceSelection } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

function contextResources(item: WorkItem) {
  return item.resources.filter((resource) => resource.role === 'context')
}

function referenceKey(reference: WorkReferenceSelection) {
  return `${reference.provider}:${reference.kind}:${reference.externalId}`
}

function resourceKey(resource: WorkItem['resources'][number]) {
  return `${resource.provider}:${resource.kind}:${resource.external_id}`
}

function referencesChanged(current: WorkItem['resources'], selected: WorkReferenceSelection[]) {
  const currentKeys = new Set(current.map(resourceKey))
  const selectedKeys = new Set(selected.map(referenceKey))
  if (currentKeys.size !== selectedKeys.size) return true
  return current.some((resource) => !selectedKeys.has(resourceKey(resource)))
}

async function updateContextReferences(itemId: number, current: WorkItem['resources'], selected: WorkReferenceSelection[]) {
  const currentKeys = new Set(current.map(resourceKey))
  const selectedKeys = new Set(selected.map(referenceKey))
  const additions = selected.filter((reference) => !currentKeys.has(referenceKey(reference)))
  const removals = current.filter((resource) => !selectedKeys.has(resourceKey(resource)))
  await Promise.all([
    ...additions.map((reference) =>
      api(`/api/work-items/${itemId}/resources`, {
        method: 'POST',
        body: JSON.stringify({ ...reference, role: 'context' }),
      }),
    ),
    ...removals.map((resource) =>
      api(`/api/work-items/${itemId}/resources`, {
        method: 'DELETE',
        body: JSON.stringify({ resource_id: resource.id, role: 'context' }),
      }),
    ),
  ])
}

function ContextReferenceEditor({ item }: { item: WorkItem }) {
  const current = contextResources(item)
  const [selected, setSelected] = useState<WorkReferenceSelection[]>(current.map(resourceReference))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setSelected(current.map(resourceReference))
  }, [item.id])
  async function saveReferences() {
    setSaving(true)
    try {
      await updateContextReferences(item.id, current, selected)
      toast.success('Work context updated')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const changed = referencesChanged(current, selected)
  return (
    <>
      <WorkReferencePicker selected={selected} onChange={setSelected} />
      {changed && (
        <Button className="w-full" size="sm" disabled={saving} onClick={() => void saveReferences()}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}Save context references
        </Button>
      )}
    </>
  )
}

export function Resources({
  item,
  presentations,
  onOpenPullRequest,
}: {
  item: WorkItem
  presentations: Record<string, WorkResourcePresentation>
  onOpenPullRequest: (resource: WorkItem['resources'][number]) => void
}) {
  return (
    <Card id="links" className="scroll-mt-32">
      <CardHeader>
        <CardTitle>Linked work</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <WorkAgentResources item={item} />
        <ContextReferenceEditor item={item} />
        {item.resources.map((resource) => (
          <ResourceRow
            key={`${resource.id}:${resource.role}`}
            resource={resource}
            presentation={presentations[resource.kind]}
            workKey={item.key}
            onOpenPullRequest={onOpenPullRequest}
          />
        ))}
        {!item.resources.length && (
          <p className="text-xs text-muted-foreground">Resources will appear as work moves through its lifecycle.</p>
        )}
      </CardContent>
    </Card>
  )
}

function WorkAgentResources({ item }: { item: WorkItem }) {
  const [selection, setSelection] = useState<AgentResourceSelection | null>(null)
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await api(`/api/work-items/${item.id}/agent-resources`, {
        method: 'PUT',
        body: JSON.stringify(selection),
      })
      toast.success('Work capabilities updated')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2">
      <AgentResourcePicker workItemId={item.id} value={selection || emptyAgentResourceSelection} onChange={setSelection} />
      <Button type="button" className="w-full" size="sm" variant="outline" disabled={saving || !selection} onClick={() => void save()}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}Save Work capabilities
      </Button>
    </div>
  )
}

function ResourceRow({
  resource,
  presentation,
  workKey,
  onOpenPullRequest,
}: {
  resource: WorkItem['resources'][number]
  presentation?: WorkResourcePresentation
  workKey: string
  onOpenPullRequest: (resource: WorkItem['resources'][number]) => void
}) {
  const Icon = resource.kind === 'pull_request' ? GitPullRequest : resource.kind === 'branch' ? GitBranch : ExternalLink
  const tone = {
    blue: 'text-blue-400',
    cyan: 'text-cyan-400',
    violet: 'text-violet-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    orange: 'text-orange-400',
    rose: 'text-rose-400',
    neutral: 'text-muted-foreground',
  }[presentation?.tone || 'neutral']
  const contributionRoute = presentation?.routeTemplate
    ?.replaceAll('{externalId}', encodeURIComponent(resource.external_id))
    .replaceAll('{workKey}', encodeURIComponent(workKey))
    .replaceAll('{repositoryId}', String(resource.repository_id || ''))
  const content = (
    <>
      <Icon className={cn('size-3.5 shrink-0', tone)} />
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-xs">{resource.label}</strong>
        <span className="text-[11px] text-muted-foreground">
          {presentation?.label || resource.provider} · {resource.role.replace('_', ' ')}
        </span>
      </div>
      {resource.state && (
        <Badge variant="outline" className="capitalize">
          {resource.state.replace('_', ' ')}
        </Badge>
      )}
    </>
  )
  if (resource.kind === 'pull_request')
    return (
      <div className="flex min-h-11 overflow-hidden rounded-lg border">
        <button
          type="button"
          onClick={() => onOpenPullRequest(resource)}
          className="flex min-w-0 flex-1 items-center gap-2 p-2.5 text-left hover:bg-accent"
        >
          {content}
        </button>
        {resource.url && (
          <a
            href={resource.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${resource.label} on GitHub`}
            className="grid min-w-11 shrink-0 place-items-center border-l px-3 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    )
  const target = resource.url || contributionRoute
  return target ? (
    <a
      href={target}
      {...(target.startsWith('/') ? {} : { target: '_blank', rel: 'noreferrer' })}
      className="flex min-h-11 items-center gap-2 rounded-lg border p-2.5 hover:bg-accent"
    >
      {content}
    </a>
  ) : (
    <div className="flex min-h-11 items-center gap-2 rounded-lg border p-2.5">{content}</div>
  )
}
