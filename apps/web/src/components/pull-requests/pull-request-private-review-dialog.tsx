import { useEffect, useState } from 'react'
import { FileSearch, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { AgentOptionsPicker } from '@vertexade/ui/components/agent-options-picker'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@vertexade/ui/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { backendApi, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { DashboardData, Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { useSingleSubmission } from '../../lib/use-pull-request-mutation'
import { ExecutionServerPicker } from './pull-request-launch-dialogs'
import { defaultPullRequestExecutionTarget, useVerifiedPullRequestExecutionTargets } from './pull-request-execution-target'

type ReviewAgent = { id: string; name: string; enabled: boolean; supportsEphemeral?: boolean }

export function ReviewDialog({
  pr,
  data,
  onOpenChange,
  onStarted,
}: {
  pr: PullRequest | null
  data: DashboardData
  onOpenChange: (open: boolean) => void
  onStarted: (id: number) => void
}) {
  const [mode, setMode] = useState<'single' | 'aggregate'>('single')
  const [agents, setAgents] = useState<ReviewAgent[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [options, setOptions] = useState<AgentLaunchOptions>({
    agentId: '',
    model: '',
    reasoningEffort: '',
    allowSubagents: false,
  })
  const [aggregator, setAggregator] = useState('')
  const [ephemeral, setEphemeral] = useState(true)
  const [backendId, setBackendId] = useState('')
  const targets = useVerifiedPullRequestExecutionTargets(pr, data)
  const submission = useSingleSubmission()

  useEffect(() => {
    if (!pr) return
    setMode('single')
    setSelected([])
  }, [pr?.id])

  useEffect(() => {
    if (!pr) return
    const allowed = targets.filter((target) => target.access === 'allowed')
    if (!allowed.some((target) => target.backend.id === backendId))
      setBackendId(defaultPullRequestExecutionTarget(pr, allowed)?.backend.id || '')
  }, [backendId, pr?.id, targets])

  useEffect(() => {
    if (!pr || !backendId) return
    backendApi<{ agent: ReviewAgent; agents: ReviewAgent[] }>(backendId, '/api/agent/options')
      .then((result) => {
        const enabled = result.agents.filter((item) => item.enabled)
        setAgents(enabled)
        setOptions({
          agentId: result.agent.id,
          model: '',
          reasoningEffort: '',
          allowSubagents: false,
        })
        setAggregator(result.agent.id)
        setEphemeral(Boolean(enabled.find((item) => item.id === result.agent.id)?.supportsEphemeral))
      })
      .catch((error) => toast.error(error.message))
  }, [backendId, pr?.id])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!pr) return
    const target = targets.find((candidate) => candidate.backend.id === backendId)
    if (!target || target.access !== 'allowed') return toast.error('The selected server SCM user cannot access this repository')
    const agentIds = mode === 'single' ? [options.agentId] : selected
    const supportsEphemeral = Boolean(agents.find((agent) => agent.id === options.agentId)?.supportsEphemeral)
    if (!agentIds.filter(Boolean).length) return toast.error('Choose at least one agent')
    const request = privateReviewRequest(mode, agentIds, aggregator, options, ephemeral && supportsEphemeral)
    const result = await submission.run(() => startPrivateReview(target.backend.id, target.repositoryId, pr.number, request))
    if (!result) return
    toast.success(
      mode === 'aggregate'
        ? `Started ${result.threads.length} reviews on ${target.backend.label}; aggregation will follow`
        : `Private review started on ${target.backend.label} as run #${result.threads[0].id}`,
    )
    onStarted(result.threads[0].id)
  }

  const target = targets.find((candidate) => candidate.backend.id === backendId)
  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Private code review</DialogTitle>
            <DialogDescription>
              #{pr?.number} — start a private review with the configured agent. Nothing is posted to source control.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
              <FileSearch />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm">
                {agents.find((item) => item.id === options.agentId)?.name || 'Loading agent…'}
              </strong>
              <small className="text-xs text-muted-foreground">One private review of the current head</small>
            </span>
          </div>
          <ExecutionServerPicker
            targets={targets}
            value={backendId}
            onChange={setBackendId}
            sourceName={pr?.backend_name}
            selectedName={target?.backend.label}
          />
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
                <Settings2 />
                Advanced review setup
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 rounded-lg border p-3">
              <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">One agent</SelectItem>
                  <SelectItem value="aggregate">Multiple agents + aggregate</SelectItem>
                </SelectContent>
              </Select>
              {mode === 'single' ? (
                <div className="space-y-3">
                  <AgentOptionsPicker value={options} onChange={setOptions} />
                  <EphemeralReviewOption
                    agent={agents.find((item) => item.id === options.agentId)}
                    checked={ephemeral}
                    onCheckedChange={setEphemeral}
                  />
                </div>
              ) : (
                <AggregateReviewOptions
                  agents={agents}
                  selected={selected}
                  onToggle={(id, checked) =>
                    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)))
                  }
                  aggregator={aggregator}
                  setAggregator={setAggregator}
                />
              )}
            </CollapsibleContent>
          </Collapsible>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={submission.busy || target?.access !== 'allowed' || !options.agentId || (mode === 'aggregate' && !selected.length)}
            >
              <FileSearch />
              {submission.busy ? 'Starting…' : mode === 'aggregate' ? `Run ${selected.length} reviews` : 'Start review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type PrivateReviewRequest = {
  body: Record<string, unknown>
  allowSubagents: boolean
}

function privateReviewRequest(
  mode: 'single' | 'aggregate',
  agentIds: string[],
  aggregator: string,
  options: AgentLaunchOptions,
  ephemeral: boolean,
): PrivateReviewRequest {
  if (mode === 'aggregate') {
    return {
      body: { agent_ids: agentIds, aggregator_agent_id: aggregator, model: '', reasoning_effort: '', service_tier: '' },
      allowSubagents: false,
    }
  }
  return {
    body: {
      agent_ids: agentIds,
      aggregator_agent_id: null,
      model: options.model,
      reasoning_effort: options.reasoningEffort,
      service_tier: options.serviceTier || '',
      ephemeral,
    },
    allowSubagents: options.allowSubagents,
  }
}

function startPrivateReview(backendId: string, repositoryId: number, pullRequestNumber: number, request: PrivateReviewRequest) {
  return backendApi<{ threads: Job[]; batch_id: number | null }>(backendId, `/api/pulls/${repositoryId}/${pullRequestNumber}/review`, {
    method: 'POST',
    body: JSON.stringify(request.body),
    headers: { 'x-agent-subagents': request.allowSubagents ? 'true' : 'false' },
  })
}

function AggregateReviewOptions({
  agents,
  selected,
  onToggle,
  aggregator,
  setAggregator,
}: {
  agents: ReviewAgent[]
  selected: string[]
  onToggle(id: string, checked: boolean): void
  aggregator: string
  setAggregator(value: string): void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-2">
        {agents.map((item) => (
          <Label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-accent">
            <Checkbox checked={selected.includes(item.id)} onCheckedChange={(checked) => onToggle(item.id, Boolean(checked))} />
            <span className="text-sm">{item.name}</span>
          </Label>
        ))}
      </div>
      <Label className="flex-col items-stretch gap-1.5">
        Aggregation agent
        <Select value={aggregator} onValueChange={setAggregator}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <p className="text-xs text-muted-foreground">
        Select every reviewer explicitly. Each runs independently, then the aggregation agent revalidates disagreements and creates one
        deduplicated private review.
      </p>
    </div>
  )
}

function EphemeralReviewOption({
  agent,
  checked,
  onCheckedChange,
}: {
  agent?: ReviewAgent
  checked: boolean
  onCheckedChange(value: boolean): void
}) {
  const supported = Boolean(agent?.supportsEphemeral)
  return (
    <Label className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        className="mt-0.5"
        checked={supported && checked}
        disabled={!supported}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
      />
      <span>
        <strong className="block text-xs">Ephemeral provider session</strong>
        <small className="text-[11px] leading-relaxed text-muted-foreground">
          {supported
            ? 'VertexADE keeps the complete review, activity, and findings; the agent provider does not retain a resumable transcript.'
            : `${agent?.name || 'This agent'} does not expose an ephemeral-session flag.`}
        </small>
      </span>
    </Label>
  )
}
