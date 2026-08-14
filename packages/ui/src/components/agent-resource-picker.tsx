import { useEffect, useMemo, useState } from 'react'
import { PlugZap, Sparkles } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Button } from '@vertexade/ui/components/ui/button'
import { backendApi } from '@vertexade/ui/lib/dashboard-api'

export type AgentResourceSelection = { skills: string[]; mcpServers: string[] }
type Selectable = {
  id: string
  name: string
  enabled: boolean
  defaultEnabled: boolean
  transport?: 'stdio' | 'http' | 'sse'
  source?: string
  skill?: string
}
type SelectionResponse = { skills: Selectable[]; mcpServers: Selectable[] }

export const emptyAgentResourceSelection: AgentResourceSelection = { skills: [], mcpServers: [] }

export function useAgentResourceSelection() {
  return useState<AgentResourceSelection | null>(null)
}

function enabledIds(items: Selectable[]) {
  return items.filter((item) => item.enabled).map((item) => item.id)
}

function selectionFromCatalog(catalog: SelectionResponse) {
  return { skills: enabledIds(catalog.skills), mcpServers: enabledIds(catalog.mcpServers) }
}

export function AgentResourcePicker({
  workItemId,
  value,
  onChange,
  backendId,
}: {
  workItemId?: number
  value: AgentResourceSelection
  onChange(value: AgentResourceSelection): void
  backendId?: string
}) {
  const [catalog, setCatalog] = useState<SelectionResponse>({ skills: [], mcpServers: [] })
  useEffect(() => {
    const query = workItemId ? `?work_item_id=${workItemId}` : ''
    void backendApi<SelectionResponse>(backendId, `/api/agent-resources/selection${query}`)
      .then((result) => {
        setCatalog(result)
        onChange(selectionFromCatalog(result))
      })
      .catch(() => {})
  }, [backendId, workItemId])
  const count = value.skills.length + value.mcpServers.length
  const defaults = useMemo(() => [...catalog.skills, ...catalog.mcpServers].filter((item) => item.defaultEnabled).length, [catalog])
  function toggle(kind: keyof AgentResourceSelection, id: string, checked: boolean) {
    onChange({
      ...value,
      [kind]: checked ? [...new Set([...value[kind], id])] : value[kind].filter((item) => item !== id),
    })
  }
  if (!catalog.skills.length && !catalog.mcpServers.length) return null
  return (
    <div className="rounded-lg border bg-muted/[.12] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <PlugZap className="size-3.5 text-violet-400" />
            Skills and MCP
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {count} enabled for this Work item · {defaults} global defaults
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="xs" variant="outline">
              Choose
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(32rem,calc(100vw-1rem))] space-y-3">
            <div>
              <strong className="text-sm">Work capabilities</strong>
              <p className="text-xs text-muted-foreground">Overrides stay with this Work item and apply to every agent thread.</p>
            </div>
            <ResourceGroup
              title="AI skills"
              icon={<Sparkles className="size-3.5 text-amber-400" />}
              items={catalog.skills}
              selected={value.skills}
              onToggle={(id, checked) => toggle('skills', id, checked)}
            />
            <ResourceGroup
              title="MCP servers"
              icon={<PlugZap className="size-3.5 text-violet-400" />}
              items={catalog.mcpServers}
              selected={value.mcpServers}
              onToggle={(id, checked) => toggle('mcpServers', id, checked)}
            />
          </PopoverContent>
        </Popover>
      </div>
      <SelectionBadges catalog={catalog} value={value} />
    </div>
  )
}

function ResourceGroup({
  title,
  icon,
  items,
  selected,
  onToggle,
}: {
  title: string
  icon: React.ReactNode
  items: Selectable[]
  selected: string[]
  onToggle(id: string, checked: boolean): void
}) {
  if (!items.length) return null
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </legend>
      {items.map((item) => (
        <ResourceOption key={item.id} item={item} checked={selected.includes(item.id)} onToggle={onToggle} />
      ))}
    </fieldset>
  )
}

function ResourceOption({ item, checked, onToggle }: { item: Selectable; checked: boolean; onToggle(id: string, checked: boolean): void }) {
  const detail = item.transport || (item.source && item.skill ? `${item.source}@${item.skill}` : '')
  return (
    <Label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 hover:bg-accent">
      <Checkbox checked={checked} onCheckedChange={(value) => onToggle(item.id, Boolean(value))} />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-xs">{item.name}</strong>
        <small className="block truncate text-xs text-muted-foreground">{detail}</small>
      </span>
      <DefaultBadge enabled={item.defaultEnabled} />
    </Label>
  )
}

function DefaultBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="secondary" className="text-xs">
      Default
    </Badge>
  ) : null
}

function SelectionBadges({ catalog, value }: { catalog: SelectionResponse; value: AgentResourceSelection }) {
  const skills = catalog.skills.filter((item) => value.skills.includes(item.id))
  const servers = catalog.mcpServers.filter((item) => value.mcpServers.includes(item.id))
  if (!skills.length && !servers.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {skills.map((item) => (
        <Badge key={item.id} variant="secondary" className="text-xs">
          {item.name}
        </Badge>
      ))}
      {servers.map((item) => (
        <Badge key={item.id} variant="outline" className="text-xs">
          {item.name}
        </Badge>
      ))}
    </div>
  )
}
