import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit } from 'lucide-react'
import { AgentSubagentOption, type SubagentChoice } from '@vertexade/ui/components/agent-subagent-option'
import { Button } from '@vertexade/ui/components/ui/button'
import { Label } from '@vertexade/ui/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@vertexade/ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import {
  backendApi,
  agentLaunchOptions,
  saveAgentLaunchOptions,
  useAgentLaunchOptions,
  type AgentLaunchOptions,
} from '@vertexade/ui/lib/dashboard-api'

type Model = {
  id: string
  name: string
  description: string
  default_reasoning_effort: string
  reasoning_efforts: { id: string; description: string }[]
}
type AgentPreset = { model: string; reasoningEffort: string }
type AgentChoice = SubagentChoice & {
  id: string
  name: string
  enabled: boolean
  preset?: AgentPreset
  selectable?: boolean
  supportsReadOnlyMode?: boolean
}
type AgentOptionsResponse = {
  agent: { id: string; name: string; preset?: AgentPreset }
  agents: AgentChoice[]
  models: Model[]
}

export function optionsForAgentChoice(choice: AgentChoice | undefined, stored: AgentLaunchOptions): AgentLaunchOptions {
  return choice?.preset
    ? {
        agentId: choice.id,
        ...choice.preset,
        serviceTier: choice.id === 'codex' ? stored.serviceTier || '' : '',
        allowSubagents: stored.allowSubagents,
      }
    : stored
}

export function reconcileAgentOptions(current: AgentLaunchOptions, models: Model[]) {
  if (!current.model || !models.length) return current
  const model = models.find((candidate) => candidate.id === current.model)
  if (!model) return { ...current, model: '', reasoningEffort: '' }
  if (!current.reasoningEffort || model.reasoning_efforts.some((effort) => effort.id === current.reasoningEffort)) return current
  return { ...current, reasoningEffort: model.default_reasoning_effort || '' }
}

export function optionsAfterAgentLoad(current: AgentLaunchOptions, choice: AgentChoice, models: Model[], fallback: AgentLaunchOptions) {
  if (!current.agentId) return optionsForAgentChoice(choice, fallback)
  return choice.preset
    ? { agentId: choice.id, ...choice.preset, allowSubagents: current.allowSubagents }
    : reconcileAgentOptions(current, models)
}

export function loadedAgentOptions(current: AgentLaunchOptions, result: AgentOptionsResponse, fallback: AgentLaunchOptions) {
  if (current.agentId && current.agentId !== result.agent.id) return null
  const models = result.models || []
  const agents = result.agents || []
  const choice = agents.find((candidate) => candidate.id === result.agent.id) || {
    ...result.agent,
    enabled: true,
  }
  return {
    agentName: result.agent.name,
    agents,
    models,
    next: optionsAfterAgentLoad(current, choice, models, fallback),
  }
}

export function AgentOptionsPicker({
  compact = false,
  value,
  onChange,
  lockedAgentId,
  nativeOnly = false,
  readOnlyOnly = false,
  showSubagents = true,
  backendId,
}: {
  compact?: boolean
  value?: AgentLaunchOptions
  onChange?: (value: AgentLaunchOptions) => void
  lockedAgentId?: string
  nativeOnly?: boolean
  readOnlyOnly?: boolean
  showSubagents?: boolean
  backendId?: string
}) {
  const controlled = Boolean(value && onChange)
  const [models, setModels] = useState<Model[]>([])
  const [agents, setAgents] = useState<AgentChoice[]>([])
  const stored = useAgentLaunchOptions()
  const current = controlled ? value! : stored
  const [agentName, setAgentName] = useState('Agent')
  function update(next: AgentLaunchOptions) {
    if (controlled) onChange!(next)
    else saveAgentLaunchOptions(next)
  }
  function changeAgent(agentId: string) {
    const options = agentLaunchOptions(agentId)
    update(
      optionsForAgentChoice(
        agents.find((agent) => agent.id === agentId),
        {
          agentId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          serviceTier: agentId === 'codex' ? options.serviceTier || '' : '',
          allowSubagents: options.allowSubagents,
        },
      ),
    )
  }
  useEffect(() => {
    let active = true
    const query = current.agentId ? `?agent=${encodeURIComponent(current.agentId)}` : ''
    void backendApi<AgentOptionsResponse>(backendId, `/api/agent/options${query}`)
      .then((result) => {
        if (!active) return
        const saved = agentLaunchOptions(result.agent.id)
        const loaded = loadedAgentOptions(current, result, {
          agentId: result.agent.id,
          model: saved.model,
          reasoningEffort: saved.reasoningEffort,
          serviceTier: result.agent.id === 'codex' ? saved.serviceTier || '' : '',
          allowSubagents: saved.allowSubagents,
        })
        if (!loaded) return
        setAgentName(loaded.agentName)
        setAgents(loaded.agents)
        setModels(loaded.models)
        if (!lockedAgentId) {
          const next = loaded.next
          if (
            next.agentId !== current.agentId ||
            next.model !== current.model ||
            next.reasoningEffort !== current.reasoningEffort ||
            next.allowSubagents !== current.allowSubagents
          )
            update(next)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [backendId, current.agentId, current.model, current.reasoningEffort, current.allowSubagents, lockedAgentId])
  const selected = useMemo(() => models.find((model) => model.id === current.model), [models, current.model])
  const pendingModel = current.model && !selected ? current.model : ''
  const reasoningEfforts = selected?.reasoning_efforts || []
  const pendingReasoningEffort =
    current.reasoningEffort && !reasoningEfforts.some((effort) => effort.id === current.reasoningEffort) ? current.reasoningEffort : ''
  const fixedPreset = agents.find((agent) => agent.id === current.agentId)?.preset
  const selectedAgent = agents.find((agent) => agent.id === current.agentId)
  function changeModel(model: string) {
    const item = models.find((candidate) => candidate.id === model)
    update({
      ...current,
      model,
      reasoningEffort: item?.reasoning_efforts.some((effort) => effort.id === current.reasoningEffort)
        ? current.reasoningEffort
        : item?.default_reasoning_effort || '',
    })
  }
  const choices = agents.filter(
    (item) =>
      item.enabled &&
      (item.selectable !== false || item.id === current.agentId) &&
      (!nativeOnly || !item.preset) &&
      (!readOnlyOnly || item.supportsReadOnlyMode),
  )
  const controls = (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
      <Label className="min-w-0 flex-col items-stretch gap-1.5">
        Agent
        <Select disabled={Boolean(lockedAgentId)} value={current.agentId || 'default'} onValueChange={changeAgent}>
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
                {item.preset ? ' · custom' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      {current.agentId === 'codex' && (
        <Label className="min-w-0 flex-col items-stretch gap-1.5">
          Service speed
          <Select
            value={current.serviceTier || 'normal'}
            onValueChange={(value) => update({ ...current, serviceTier: value === 'normal' ? '' : value })}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="priority">Fast</SelectItem>
            </SelectContent>
          </Select>
        </Label>
      )}
      <Label className="min-w-0 flex-col items-stretch gap-1.5">
        Model
        <Select
          disabled={Boolean(fixedPreset)}
          value={current.model || 'default'}
          onValueChange={(next) => changeModel(next === 'default' ? '' : next)}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{agentName} default</SelectItem>
            {pendingModel && <SelectItem value={pendingModel}>{pendingModel}</SelectItem>}
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Label className="min-w-0 flex-col items-stretch gap-1.5">
        Reasoning level
        <Select
          disabled={Boolean(fixedPreset)}
          value={current.reasoningEffort || 'default'}
          onValueChange={(next) => update({ ...current, reasoningEffort: next === 'default' ? '' : next })}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Model default</SelectItem>
            {pendingReasoningEffort && <SelectItem value={pendingReasoningEffort}>{pendingReasoningEffort}</SelectItem>}
            {reasoningEfforts.map((effort) => (
              <SelectItem key={effort.id} value={effort.id}>
                {effort.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
    </div>
  )
  const delegation =
    showSubagents && !readOnlyOnly ? (
      <AgentSubagentOption
        agent={selectedAgent}
        checked={current.allowSubagents}
        onCheckedChange={(allowSubagents) => update({ ...current, allowSubagents })}
      />
    ) : null
  if (!compact)
    return (
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{agentName} execution</p>
        {controls}
        {delegation}
      </div>
    )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 max-w-[22rem] gap-1.5 px-2 text-[11px] font-normal"
          aria-label="Change model, reasoning, and delegation settings"
          title="Change model and reasoning"
        >
          <BrainCircuit className="size-3.5 shrink-0 text-blue-500" />
          <span className="max-w-36 truncate font-medium">{selected?.name || current.model || `${agentName} default`}</span>
          <span className="text-muted-foreground">·</span>
          <span className="max-w-20 truncate capitalize text-muted-foreground">{current.reasoningEffort || 'Default reasoning'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(42rem,calc(100vw-1rem))] space-y-3">
        <div>
          <strong className="text-sm">{agentName} launch settings</strong>
          <p className="text-xs text-muted-foreground">Applied to the next agent run.</p>
        </div>
        {controls}
        {delegation}
      </PopoverContent>
    </Popover>
  )
}
