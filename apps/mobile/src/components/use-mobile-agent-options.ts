import { useEffect, useRef, useState } from 'react'
import type { AgentOptions } from './portable-action-values'
import { createMobilePlatformClient } from '@/platform-service'

export type SelectableAgent = { id: string; name: string }
export type SelectableModel = { id: string; name: string; reasoning_efforts: { id: string }[] }

type AgentOptionsResponse = {
  agent: { id: string }
  agents: Array<SelectableAgent & { enabled: boolean; selectable?: boolean }>
  models: SelectableModel[]
}

export function useMobileAgentOptions(serviceUrl: string, backendId: string, value: AgentOptions, onChange: (value: AgentOptions) => void) {
  const [agents, setAgents] = useState<SelectableAgent[]>([])
  const [models, setModels] = useState<SelectableModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  valueRef.current = value
  onChangeRef.current = onChange

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void requestAgentOptions(serviceUrl, backendId, value.agentId)
      .then((result) => applyAgentOptions(result, current, valueRef.current, onChangeRef.current, setAgents, setModels))
      .catch((reason: unknown) => applyAgentOptionsFailure(reason, current, setAgents, setModels, setError))
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [backendId, serviceUrl, value.agentId, revision])

  return { agents, models, loading, error, retry: () => setRevision((current) => current + 1) }
}

function requestAgentOptions(serviceUrl: string, backendId: string, agentId: string) {
  const query = agentId ? `?agent=${encodeURIComponent(agentId)}` : ''
  return createMobilePlatformClient(serviceUrl, backendId).request<AgentOptionsResponse>(`/api/agent/options${query}`)
}

function applyAgentOptions(
  result: AgentOptionsResponse,
  current: boolean,
  value: AgentOptions,
  onChange: (value: AgentOptions) => void,
  setAgents: (agents: SelectableAgent[]) => void,
  setModels: (models: SelectableModel[]) => void,
) {
  if (!current) return
  setAgents(result.agents.filter((agent) => agent.enabled && agent.selectable !== false))
  setModels(result.models)
  if (!value.agentId) onChange({ ...value, agentId: result.agent.id })
}

function applyAgentOptionsFailure(
  reason: unknown,
  current: boolean,
  setAgents: (agents: SelectableAgent[]) => void,
  setModels: (models: SelectableModel[]) => void,
  setError: (error: string) => void,
) {
  if (!current) return
  setAgents([])
  setModels([])
  setError(reason instanceof Error ? reason.message : 'Agent options could not be loaded')
}
