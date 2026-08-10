import { useEffect, useState } from 'react'
import { AlertTriangle, GitBranch, GitFork, RefreshCw, Settings2, Tags, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ArchitectureContextPacket } from '@vertexade/platform-contracts'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { PromptImageTextarea } from '@vertexade/ui/components/prompt-images'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@vertexade/ui/components/ui/collapsible'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { api, backendApi, parseJson } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, GithubLabel, Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestFlowDecision } from '@vertexade/ui/lib/pull-request-flow'
import { reconcilePullRequestChange, useSingleSubmission } from '../../lib/use-pull-request-mutation'
import {
  defaultPullRequestExecutionTarget,
  useVerifiedPullRequestExecutionTargets,
  type VerifiedPullRequestExecutionTarget,
} from './pull-request-execution-target'

function renderPreset(template: string, pr: PullRequest) {
  const values: Record<string, string> = {
    repo: pr.full_name,
    pr_number: String(pr.number),
    pr_title: pr.title,
    pr_url: pr.url,
    author: pr.author || '',
    base_branch: pr.base_ref || '',
    head_branch: pr.head_ref || '',
  }
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (match, key) => values[key.toLowerCase()] ?? match)
}

export function LaunchDialog({
  pr,
  data,
  decision,
  onOpenChange,
  onStarted,
}: {
  pr: PullRequest | null
  data: DashboardData
  decision?: PullRequestFlowDecision
  onOpenChange: (open: boolean) => void
  onStarted: (id: number) => void
}) {
  const [preset, setPreset] = useState('pr')
  const [prompt, setPrompt] = useState('')
  const [backendId, setBackendId] = useState('')
  const [architecturePacket, setArchitecturePacket] = useState<ArchitectureContextPacket | null>(null)
  const [architectureLoading, setArchitectureLoading] = useState(false)
  const [selectedArchitectureFacts, setSelectedArchitectureFacts] = useState<Set<string>>(new Set())
  const targets = useVerifiedPullRequestExecutionTargets(pr, data)
  const submission = useSingleSubmission()
  useEffect(() => {
    if (!pr) return
    setPreset(defaultLaunchPreset(data))
    setPrompt(launchDecisionPrompt(decision))
  }, [decision?.detail, pr?.id])
  useEffect(() => {
    if (!pr) return
    const allowed = targets.filter((target) => target.access === 'allowed')
    if (!allowed.some((target) => target.backend.id === backendId))
      setBackendId(defaultPullRequestExecutionTarget(pr, allowed)?.backend.id || '')
  }, [backendId, pr?.id, targets])
  useEffect(() => {
    setArchitecturePacket(null)
    setSelectedArchitectureFacts(new Set())
    if (!pr) return
    setArchitectureLoading(true)
    api<{ packet: ArchitectureContextPacket | null }>(`/api/pulls/${pr.repo_id}/${pr.number}/architecture-context`)
      .then((result) => {
        setArchitecturePacket(result.packet)
        setSelectedArchitectureFacts(new Set(result.packet?.facts.map((fact) => fact.node.key) || []))
      })
      .catch((error) => toast.error((error as Error).message))
      .finally(() => setArchitectureLoading(false))
  }, [pr?.id, pr?.number, pr?.repo_id])
  async function buildArchitectureContext() {
    if (!pr) return
    setArchitectureLoading(true)
    try {
      const packet = await api<ArchitectureContextPacket>(`/api/pulls/${pr.repo_id}/${pr.number}/architecture-context`, {
        method: 'POST',
        body: JSON.stringify({ byteBudget: 32_000 }),
      })
      setArchitecturePacket(packet)
      setSelectedArchitectureFacts(new Set(packet.facts.map((fact) => fact.node.key)))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setArchitectureLoading(false)
    }
  }
  async function submit() {
    if (!pr) return
    const target = targets.find((candidate) => candidate.backend.id === backendId)
    if (!target || target.access !== 'allowed') return toast.error('The selected server SCM user cannot access this repository')
    const job = await submission.run(() =>
      backendApi<Job>(target.backend.id, `/api/pulls/${target.repositoryId}/${pr.number}/launch`, {
        method: 'POST',
        body: JSON.stringify({
          preset: preset === 'none' ? '' : preset,
          prompt,
          architecture_context:
            architecturePacket?.freshness === 'current'
              ? {
                  packetId: architecturePacket.id,
                  digest: architecturePacket.digest,
                  revision: architecturePacket.revision,
                  facts: architecturePacket.facts
                    .filter((fact) => selectedArchitectureFacts.has(fact.node.key))
                    .map((fact) => ({
                      key: fact.node.key,
                      label: fact.node.label,
                      summary: fact.node.summary,
                      path: fact.node.path,
                      reason: fact.reason,
                      citations: fact.node.citations,
                    })),
                }
              : null,
        }),
      }),
    )
    if (!job) return
    toast.success(`${job.agent_name} started on ${target.backend.label} as run #${job.id}`)
    onStarted(job.id)
  }
  const selected = data.presets.find((item) => item.name === preset)
  const target = targets.find((candidate) => candidate.backend.id === backendId)
  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{decision?.label || `Fix with ${data.presentation.defaultAgent.name}`}</DialogTitle>
          <DialogDescription>
            #{pr?.number} — {pr?.title}
            {decision ? ` · ${decision.title}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ExecutionServerPicker
            targets={targets}
            value={backendId}
            onChange={setBackendId}
            sourceName={pr?.backend_name}
            selectedName={target?.backend.label}
          />
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No preset</SelectItem>
              {data.presets.map((item) => (
                <SelectItem key={item.id} value={item.name}>
                  [{item.name}]
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && pr ? (
            <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{renderPreset(selected.prompt, pr)}</p>
          ) : null}
          <PromptImageTextarea
            value={prompt}
            onValueChange={setPrompt}
            placeholder="Optional instructions or pasted reference images…"
            className="min-h-32"
          />
          <Collapsible>
            <div className="flex items-center gap-2 rounded-lg border p-2">
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start">
                  <GitFork />
                  Architecture context
                  {architecturePacket && (
                    <Badge variant={architecturePacket.freshness === 'stale' ? 'destructive' : 'outline'}>
                      {selectedArchitectureFacts.size}/{architecturePacket.facts.length} facts
                    </Badge>
                  )}
                </Button>
              </CollapsibleTrigger>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={architectureLoading}
                onClick={() => void buildArchitectureContext()}
              >
                <RefreshCw data-icon="inline-start" />
                {architectureLoading ? 'Building…' : architecturePacket ? 'Rebuild' : 'Build'}
              </Button>
            </div>
            <CollapsibleContent className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border p-3">
              {!architecturePacket && !architectureLoading && (
                <p className="text-xs text-muted-foreground">
                  Build a revision-bound packet to preview source-cited architecture before launch.
                </p>
              )}
              {architecturePacket?.freshness === 'stale' && (
                <p className="text-xs text-destructive">This packet is stale and will not be attached. Rebuild it for the current head.</p>
              )}
              {architecturePacket?.facts.map((fact) => (
                <Label key={fact.node.key} className="flex items-start gap-2 rounded-md border p-2 text-xs">
                  <Checkbox
                    checked={selectedArchitectureFacts.has(fact.node.key)}
                    onCheckedChange={(checked) =>
                      setSelectedArchitectureFacts((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(fact.node.key)
                        else next.delete(fact.node.key)
                        return next
                      })
                    }
                  />
                  <span className="min-w-0">
                    <strong className="block truncate">{fact.node.label}</strong>
                    <span className="block text-muted-foreground">{fact.reason}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {fact.node.citations.map((citation) => citation.path).join(', ') || fact.node.path || 'No source citation'}
                    </span>
                  </span>
                </Label>
              ))}
              {architecturePacket && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  {architecturePacket.digest.slice(0, 12)} · {architecturePacket.estimatedBytes}/{architecturePacket.byteBudget} bytes
                </p>
              )}
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                <Settings2 />
                Advanced agent setup
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="rounded-lg border p-3">
              <AgentOptionsPicker />
            </CollapsibleContent>
          </Collapsible>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submission.busy || target?.access !== 'allowed'} onClick={submit}>
            <GitBranch />
            Start work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ExecutionServerPicker({
  targets,
  value,
  onChange,
  sourceName,
  selectedName,
}: {
  targets: VerifiedPullRequestExecutionTarget[]
  value: string
  onChange(value: string): void
  sourceName?: string
  selectedName?: string
}) {
  return (
    <section className="space-y-2 rounded-lg border border-blue-500/25 bg-blue-500/[.06] p-3" aria-label="Execution location">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-xs">Execution server</strong>
        <Badge variant="outline" className="border-blue-500/30 text-blue-300">
          Runs + stores here
        </Badge>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a server" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.backend.id} value={target.backend.id} disabled={target.access !== 'allowed'}>
              {target.backend.label} ·{' '}
              {target.access === 'allowed'
                ? `access as ${target.scmLogin}`
                : target.access === 'checking'
                  ? 'checking access…'
                  : 'no SCM access'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The PR stays on <strong className="text-foreground/80">{sourceName || 'its source server'}</strong>. The agent process, worktree,
        logs, and run history are executed and stored on{' '}
        <strong className="text-foreground/80">{selectedName || 'the selected server'}</strong>. A destination is enabled only after its SCM
        identity successfully reads the repository.
      </p>
    </section>
  )
}

function defaultLaunchPreset(data: DashboardData) {
  return data.presets.some((item) => item.name === 'pr') ? 'pr' : 'none'
}

function launchDecisionPrompt(decision?: PullRequestFlowDecision) {
  return decision?.detail || ''
}

export function ForkPrDialog({
  pr,
  presentation,
  onOpenChange,
  onStarted,
}: {
  pr: PullRequest | null
  presentation: DashboardData['presentation']
  onOpenChange: (open: boolean) => void
  onStarted: (id: number) => void
}) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [branchType, setBranchType] = useState('feature')
  const submission = useSingleSubmission()
  useEffect(() => {
    if (pr) {
      setTitle('')
      setPrompt('')
      setBranchType('feature')
    }
  }, [pr?.id])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!pr) return
    const job = await submission.run(() =>
      api<Job>(`/api/pulls/${pr.repo_id}/${pr.number}/fork`, {
        method: 'POST',
        body: JSON.stringify({ title, prompt, branch_type: branchType }),
      }),
    )
    if (!job) return
    toast.success(`Stacked task started on ${job.branch_name}`)
    onStarted(job.id)
  }
  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Fork {presentation.scm.changeRequestLabel}</DialogTitle>
            <DialogDescription className="break-words">
              Create a new branch from <span className="text-blue-400">{pr?.head_ref}</span>. {presentation.defaultAgent.name} will open a
              draft {presentation.scm.changeRequestLabel} targeting that branch when the work is complete.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
              <Select value={branchType} onValueChange={setBranchType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">feature/</SelectItem>
                  <SelectItem value="fix">fix/</SelectItem>
                  <SelectItem value="chore">chore/</SelectItem>
                  <SelectItem value="refactor">refactor/</SelectItem>
                  <SelectItem value="test">test/</SelectItem>
                  <SelectItem value="docs">docs/</SelectItem>
                </SelectContent>
              </Select>
              <Input
                required
                maxLength={100}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short task title"
              />
            </div>
            <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">
              New stack:{' '}
              <span className="text-blue-400">
                {branchType}/
                {title
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 40) || 'task'}
                -…
              </span>{' '}
              → {pr?.head_ref}
            </p>
            <PromptImageTextarea
              required
              value={prompt}
              onValueChange={setPrompt}
              placeholder="Describe the work and paste reference images…"
              className="min-h-28 sm:min-h-36"
            />
            <AgentOptionsPicker />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={submission.busy || !title.trim() || !prompt.trim()}>
              <GitFork />
              Fork and start
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LabelDialog({
  pr,
  onOpenChange,
  onChanged,
}: {
  pr: PullRequest | null
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const [available, setAvailable] = useState<GithubLabel[]>([])
  const [assigned, setAssigned] = useState<GithubLabel[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  useEffect(() => {
    if (!pr) return
    const current = parseJson<GithubLabel[]>(pr.labels, [])
    setAssigned(current)
    setLabel('')
    setSyncError(null)
    api<{ labels: GithubLabel[] }>(`/api/repositories/${pr.repo_id}/labels`)
      .then((result) => setAvailable(result.labels))
      .catch((error) => toast.error(error.message))
  }, [pr])
  const choices = available.filter((item) => !assigned.some((current) => current.name === item.name))
  async function reconcile() {
    await reconcilePullRequestChange(onChanged, 'The labels changed', setSyncError)
  }
  async function submit() {
    if (!pr || !label) return
    setBusy(label)
    try {
      const result = await api<{ labels: GithubLabel[] }>(`/api/pulls/${pr.repo_id}/${pr.number}/labels`, {
        method: 'POST',
        body: JSON.stringify({ label }),
      })
      setAssigned(result.labels)
      setLabel('')
      toast.success(`Added ${label}`)
      await reconcile()
    } catch (error) {
      setSyncError((error as Error).message)
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function remove(item: GithubLabel) {
    if (!pr) return
    setBusy(item.name)
    try {
      const result = await api<{ labels: GithubLabel[] }>(`/api/pulls/${pr.repo_id}/${pr.number}/labels`, {
        method: 'DELETE',
        body: JSON.stringify({ label: item.name }),
      })
      setAssigned(result.labels)
      toast.success(`Removed ${item.name}`)
      await reconcile()
    } catch (error) {
      setSyncError((error as Error).message)
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage labels</DialogTitle>
          <DialogDescription className="line-clamp-2">
            #{pr?.number} — {pr?.title}
          </DialogDescription>
        </DialogHeader>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Assigned labels</p>
          <div className="flex max-h-40 min-h-10 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
            {assigned.map((item) => (
              <Badge key={item.name} variant="outline" className="max-w-full gap-1 pl-2 text-xs">
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: `#${item.color}` }} />
                <span className="truncate">{item.name}</span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => remove(item)}
                  className="ml-0.5 rounded p-0.5 hover:bg-destructive/15 hover:text-red-400"
                  aria-label={`Remove ${item.name}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            {!assigned.length && <span className="self-center text-xs text-muted-foreground">No labels assigned.</span>}
          </div>
        </section>
        <section>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Add a label</p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select value={label} onValueChange={setLabel}>
              <SelectTrigger className="min-w-0 w-full">
                <SelectValue placeholder="Choose a repository label" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((item) => (
                  <SelectItem key={item.name} value={item.name}>
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ backgroundColor: `#${item.color}` }} />
                      {item.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!label || busy !== null} onClick={submit}>
              <Tags />
              Add
            </Button>
          </div>
        </section>
        {syncError ? (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/8 p-2 text-xs text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{syncError}</span>
            <Button variant="ghost" size="xs" onClick={() => void reconcile()}>
              <RefreshCw />
              Retry
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
