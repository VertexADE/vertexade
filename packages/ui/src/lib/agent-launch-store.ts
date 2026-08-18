import { useEffect } from 'react'
import { Store, useSelector } from '@tanstack/react-store'

export type AgentLaunchOptions = {
  agentId: string
  model: string
  reasoningEffort: string
  serviceTier?: string
  allowSubagents: boolean
}

const AGENT_OPTIONS_STORAGE_KEY = 'agent-launch-options'
type AgentModelOptions = Omit<AgentLaunchOptions, 'agentId'>
type StoredAgentLaunchOptions = {
  version: 4
  agentId: string
  byAgent: Record<string, AgentModelOptions>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function storedAgentLaunchOptions(): StoredAgentLaunchOptions {
  const empty: StoredAgentLaunchOptions = { version: 4, agentId: '', byAgent: {} }
  if (typeof window === 'undefined') return empty
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_OPTIONS_STORAGE_KEY) || '') as Record<string, unknown>
    const agentId = text(parsed.agentId)
    if ([2, 3, 4].includes(Number(parsed.version)) && parsed.byAgent && typeof parsed.byAgent === 'object') {
      const byAgent = Object.fromEntries(
        Object.entries(parsed.byAgent as Record<string, unknown>).map(([id, value]) => {
          const options = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
          return [
            id,
            {
              model: text(options.model),
              reasoningEffort: text(options.reasoningEffort),
              serviceTier: text(options.serviceTier),
              allowSubagents: options.allowSubagents === true,
            },
          ]
        }),
      )
      return { version: 4, agentId, byAgent }
    }
    return {
      version: 4,
      agentId,
      byAgent: agentId
        ? {
            [agentId]: {
              model: text(parsed.model),
              reasoningEffort: text(parsed.reasoningEffort),
              serviceTier: '',
              allowSubagents: false,
            },
          }
        : {},
    }
  } catch {
    return empty
  }
}

function optionsFromStored(stored: StoredAgentLaunchOptions, agentId?: string): AgentLaunchOptions {
  const selectedAgentId = agentId ? agentId : stored.agentId
  const options: AgentModelOptions = stored.byAgent[selectedAgentId] ?? {
    model: '',
    reasoningEffort: '',
    serviceTier: '',
    allowSubagents: false,
  }
  const serviceTier = selectedAgentId === 'codex' ? options.serviceTier : ''
  return {
    agentId: selectedAgentId,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    serviceTier,
    allowSubagents: options.allowSubagents,
  }
}

export const agentLaunchOptionsStore = new Store<StoredAgentLaunchOptions>(storedAgentLaunchOptions())

export function agentLaunchOptions(agentId?: string): AgentLaunchOptions {
  const stored = storedAgentLaunchOptions()
  return optionsFromStored(stored, agentId)
}

export function saveAgentLaunchOptions(value: AgentLaunchOptions): void {
  const stored = storedAgentLaunchOptions()
  const agentId = text(value.agentId)
  const byAgent = { ...stored.byAgent }
  if (agentId) {
    byAgent[agentId] = {
      model: text(value.model),
      reasoningEffort: text(value.reasoningEffort),
      serviceTier: agentId === 'codex' ? text(value.serviceTier) : '',
      allowSubagents: value.allowSubagents === true,
    }
  }
  const next = { version: 4, agentId, byAgent } satisfies StoredAgentLaunchOptions
  localStorage.setItem(AGENT_OPTIONS_STORAGE_KEY, JSON.stringify(next))
  agentLaunchOptionsStore.setState(() => next)
}

export function useAgentLaunchOptions(agentId?: string): AgentLaunchOptions {
  const stored = useSelector(agentLaunchOptionsStore, (state) => state)
  useEffect(() => {
    const sync = (event: StorageEvent): void => {
      if (event.key === null || event.key === AGENT_OPTIONS_STORAGE_KEY) {
        agentLaunchOptionsStore.setState(() => storedAgentLaunchOptions())
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return optionsFromStored(stored, agentId)
}
