import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, PlugZap, Search, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@vertexade/ui/lib/dashboard-api'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { CustomAgentSettings, type CustomAgentProfile } from '@vertexade/ui/components/custom-agent-settings'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'

type Skill = {
  id: string
  source: string
  skill: string
  name: string
  description: string
  url: string
  defaultEnabled: boolean
}
type Mcp = {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  defaultEnabled: boolean
  env?: { name: string }[]
  headers?: { name: string }[]
}
type Catalog = { skills: Skill[]; mcpServers: Mcp[]; profiles: CustomAgentProfile[] }
type SkillResult = { source: string; skill: string; name: string; installs: string; url: string }
type McpRegistryResult = {
  id: string
  name: string
  description: string
  version: string
  repositoryUrl: string
  installable: boolean
  transport?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  requiredInputs: string[]
}
const emptyCatalog: Catalog = { skills: [], mcpServers: [], profiles: [] }

function pairs(value: string) {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=')
        if (separator < 1) throw new Error('Environment and header entries must use NAME=value')
        return [line.slice(0, separator).trim(), line.slice(separator + 1)]
      }),
  )
}

type AgentResourceSection = 'all' | 'agents' | 'context' | 'skills' | 'mcp'

export function AgentResourceSettings({ section = 'all' }: { section?: AgentResourceSection }) {
  const confirmAction = useConfirm()
  const [catalog, setCatalog] = useState(emptyCatalog)
  const load = useCallback(
    () =>
      void api<Catalog>('/api/agent-resources')
        .then(setCatalog)
        .catch((error) => toast.error(error.message)),
    [],
  )
  useEffect(load, [load])
  async function setDefault(kind: 'skill' | 'mcp', id: string, enabled: boolean) {
    try {
      await api(`/api/agent-resources/${kind}/${encodeURIComponent(id)}/default`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  async function remove(kind: 'skill' | 'mcp', id: string, name: string) {
    const confirmed = await confirmAction({
      title: `Remove ${name}?`,
      description: 'The resource is removed from future selections and cleaned up from existing Work defaults.',
      confirmLabel: 'Remove resource',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await api(`/api/agent-resources/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast.success(`${name} removed`)
      load()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3">
      {['all', 'context', 'skills'].includes(section) && (
        <SkillSettings skills={catalog.skills} reload={load} onDefault={setDefault} onRemove={remove} />
      )}
      {['all', 'context', 'mcp'].includes(section) && (
        <McpSettings servers={catalog.mcpServers} reload={load} onDefault={setDefault} onRemove={remove} />
      )}
      {['all', 'agents'].includes(section) && (
        <div className="col-span-full min-w-0">
          <CustomAgentSettings profiles={catalog.profiles} skills={catalog.skills} mcpServers={catalog.mcpServers} reload={load} />
        </div>
      )}
    </div>
  )
}

type ResourceActions = {
  onDefault(kind: 'skill' | 'mcp', id: string, enabled: boolean): void
  onRemove(kind: 'skill' | 'mcp', id: string, name: string): void
}

function SkillSettings({ skills, reload, ...actions }: { skills: Skill[]; reload(): void } & ResourceActions) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SkillResult[]>([])
  const [searching, setSearching] = useState(false)
  async function search(event: React.FormEvent) {
    event.preventDefault()
    setSearching(true)
    try {
      setResults((await api<{ results: SkillResult[] }>(`/api/agent-resources/skills/search?query=${encodeURIComponent(query)}`)).results)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSearching(false)
    }
  }
  async function add(skill: SkillResult) {
    try {
      await api('/api/agent-resources/skills', {
        method: 'POST',
        body: JSON.stringify({ ...skill, defaultEnabled: false }),
      })
      toast.success(`${skill.name} added`)
      reload()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-amber-400" />
          AI skills
        </CardTitle>
        <CardDescription>
          Discover skills through the official skills.sh CLI registry, add them once, and choose sensible defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <form onSubmit={search} className="flex gap-2">
          <Input required value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills.sh…" />
          <Button disabled={searching} variant="outline">
            <Search />
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </form>
        <SkillResults results={results} installed={skills} onAdd={add} />
        <ResourceList items={skills} kind="skill" {...actions} />
      </CardContent>
    </Card>
  )
}

function SkillResults({ results, installed, onAdd }: { results: SkillResult[]; installed: Skill[]; onAdd(skill: SkillResult): void }) {
  if (!results.length) return null
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1">
      {results.map((item) => (
        <SkillResultRow key={`${item.source}@${item.skill}`} item={item} installed={installed} onAdd={onAdd} />
      ))}
    </div>
  )
}

function SkillResultRow({ item, installed, onAdd }: { item: SkillResult; installed: Skill[]; onAdd(skill: SkillResult): void }) {
  const exists = installed.some((skill) => skill.source === item.source && skill.skill === item.skill)
  return (
    <div className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-xs">{item.name}</strong>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {item.source} · {item.installs} installs
        </span>
      </div>
      <Button type="button" size="xs" variant="outline" disabled={exists} onClick={() => onAdd(item)}>
        Add
      </Button>
    </div>
  )
}

function McpSettings({ servers, reload, ...actions }: { servers: Mcp[]; reload(): void } & ResourceActions) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<McpRegistryResult[]>([])
  const [searching, setSearching] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'sse'>('stdio')
  const [endpoint, setEndpoint] = useState('')
  const [args, setArgs] = useState('')
  const [secrets, setSecrets] = useState('')
  const [defaultEnabled, setDefaultEnabled] = useState(false)
  async function searchRegistry(event: React.FormEvent) {
    event.preventDefault()
    setSearching(true)
    try {
      const result = await api<{ results: McpRegistryResult[] }>(`/api/agent-resources/mcp/search?query=${encodeURIComponent(query)}`)
      setResults(result.results)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSearching(false)
    }
  }
  function configure(result: McpRegistryResult) {
    if (!result.installable || !result.transport) return
    setName(result.name)
    setTransport(result.transport)
    setEndpoint(result.transport === 'stdio' ? result.command || '' : result.url || '')
    setArgs((result.args || []).join('\n'))
    setSecrets(result.requiredInputs.map((input) => `${input.replace(/ \(secret\)$/, '')}=`).join('\n'))
    setFormOpen(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api('/api/agent-resources/mcp', {
        method: 'POST',
        body: JSON.stringify(mcpInput({ name, transport, endpoint, args, secrets, defaultEnabled })),
      })
      setName('')
      setEndpoint('')
      setArgs('')
      setSecrets('')
      setDefaultEnabled(false)
      setFormOpen(false)
      toast.success('MCP server added')
      reload()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
  const stdio = transport === 'stdio'
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PlugZap className="size-4 text-violet-400" />
          MCP servers
        </CardTitle>
        <CardDescription>
          Add local stdio or remote SSE servers. Environment values and headers are encrypted; only names return to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <form onSubmit={searchRegistry} className="flex gap-2">
          <Input
            required
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the official MCP Registry…"
          />
          <Button disabled={searching} variant="outline">
            <Search />
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </form>
        <McpRegistryResults results={results} installed={servers} onConfigure={configure} />
        <details
          open={formOpen}
          onToggle={(event) => setFormOpen(event.currentTarget.open)}
          className="group rounded-lg border bg-background/25"
        >
          <summary
            data-audit-action="settings.mcp.add"
            className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs font-medium marker:hidden"
          >
            Add MCP server
            <span className="font-normal text-primary group-open:hidden">Open form</span>
          </summary>
          <form onSubmit={save} className="space-y-2 border-t p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
              <Input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Server name" />
              <Select value={transport} onValueChange={(value) => setTransport(value as 'stdio' | 'sse')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input
              required
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={stdio ? 'Executable, e.g. npx' : 'https://example.com/sse'}
            />
            <StdioArguments visible={stdio} value={args} onChange={setArgs} />
            <Textarea
              value={secrets}
              onChange={(event) => setSecrets(event.target.value)}
              className="min-h-20 text-xs"
              placeholder={stdio ? 'Environment: NAME=value' : 'Headers: Authorization=Bearer …'}
            />
            <Label className="flex items-center gap-2 text-xs">
              <Checkbox checked={defaultEnabled} onCheckedChange={(value) => setDefaultEnabled(Boolean(value))} />
              Enable by default for Work items
            </Label>
            <Button className="w-full sm:w-auto" size="sm">
              Add MCP server
            </Button>
          </form>
        </details>
        <ResourceList items={servers} kind="mcp" {...actions} />
      </CardContent>
    </Card>
  )
}

function McpRegistryResults({
  results,
  installed,
  onConfigure,
}: {
  results: McpRegistryResult[]
  installed: Mcp[]
  onConfigure(result: McpRegistryResult): void
}) {
  if (!results.length) return null
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
      {results.map((result) => {
        const configured = installed.some((server) => server.name === result.name)
        return (
          <div key={`${result.id}@${result.version}`} className="flex items-center gap-2 rounded-md p-2 hover:bg-accent">
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-xs">{result.name}</strong>
              <span className="block truncate text-xs text-muted-foreground">{result.description}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {result.id}@{result.version}
                {result.requiredInputs.length ? ` · needs ${result.requiredInputs.join(', ')}` : ''}
              </span>
            </div>
            {result.repositoryUrl && (
              <Button type="button" size="icon-xs" variant="ghost" asChild>
                <a href={result.repositoryUrl} target="_blank" rel="noreferrer" aria-label={`Open ${result.name} source`}>
                  <ExternalLink />
                </a>
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={!result.installable || configured}
              onClick={() => onConfigure(result)}
            >
              {configured ? 'Added' : result.installable ? 'Configure' : 'Unsupported'}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function mcpInput(input: {
  name: string
  transport: 'stdio' | 'sse'
  endpoint: string
  args: string
  secrets: string
  defaultEnabled: boolean
}) {
  return input.transport === 'stdio'
    ? {
        name: input.name,
        transport: input.transport,
        command: input.endpoint,
        args: input.args.split(/\r?\n/).filter(Boolean),
        env: pairs(input.secrets),
        defaultEnabled: input.defaultEnabled,
      }
    : {
        name: input.name,
        transport: input.transport,
        url: input.endpoint,
        headers: pairs(input.secrets),
        defaultEnabled: input.defaultEnabled,
      }
}

function StdioArguments({ visible, value, onChange }: { visible: boolean; value: string; onChange(value: string): void }) {
  return visible ? (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-20 font-mono text-xs"
      placeholder={'One argument per line\n--yes\n@scope/server'}
    />
  ) : null
}

function ResourceList({ items, kind, onDefault, onRemove }: { items: Array<Skill | Mcp>; kind: 'skill' | 'mcp' } & ResourceActions) {
  if (!items.length)
    return <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">Nothing added yet.</p>
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <ResourceRow key={item.id} item={item} kind={kind} onDefault={onDefault} onRemove={onRemove} />
      ))}
    </div>
  )
}

function ResourceRow({ item, kind, onDefault, onRemove }: { item: Skill | Mcp; kind: 'skill' | 'mcp' } & ResourceActions) {
  const detail = 'transport' in item ? mcpDescription(item) : `${item.source}@${item.skill}`
  const defaultAction = item.defaultEnabled ? 'Disable default' : 'Default on'
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-lg border p-2.5">
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-xs">{item.name}</strong>
        <span className="block truncate font-mono text-xs text-muted-foreground">{detail}</span>
      </div>
      <DefaultBadge enabled={item.defaultEnabled} />
      <Button type="button" size="xs" variant="ghost" onClick={() => onDefault(kind, item.id, !item.defaultEnabled)}>
        {defaultAction}
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="text-red-400"
        aria-label={`Remove ${item.name}`}
        onClick={() => onRemove(kind, item.id, item.name)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function mcpDescription(item: Mcp) {
  return item.transport === 'stdio' ? `${item.command} ${(item.args || []).join(' ')}` : item.url
}

function DefaultBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="secondary" className="text-xs">
      Default
    </Badge>
  ) : null
}
