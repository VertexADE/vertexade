import type { PortableActionValue, PortableItemAction } from '@vertexade/platform-contracts'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { actionInputOptions, defaultValue, normalizeActionValue, type AgentOptions, type SourceData } from './portable-action-values'

export function initialActionValues(action: PortableItemAction, data: SourceData, item: PortableCollectionItem | null) {
  return Object.fromEntries((action.inputs || []).map((input) => {
    const options = actionInputOptions(input, data, item)
    const declaredDefault = input.defaultPath ? readPortablePath(input.defaultSource === 'surface' ? data : item?.raw, input.defaultPath) : undefined
    const value = declaredDefault !== undefined
      ? (typeof declaredDefault === 'number' || typeof declaredDefault === 'boolean' ? declaredDefault : String(declaredDefault))
      : options.length === 1 && input.optionValuePath ? String(readPortablePath(options[0], input.optionValuePath) || '') : defaultValue(input)
    return [input.name, value]
  })) as Record<string, PortableActionValue>
}

export function actionAgentHeaders(action: PortableItemAction, agent: AgentOptions) {
  if (action.intent !== 'launch-work') return undefined
  return {
    headers: {
      ...(agent.agentId ? { 'x-agent-provider': agent.agentId } : {}),
      ...(agent.model ? { 'x-agent-model': agent.model } : {}),
      ...(agent.reasoningEffort ? { 'x-agent-reasoning-effort': agent.reasoningEffort } : {}),
    },
  }
}

export function completionAction(action: PortableItemAction, item: PortableCollectionItem | null, data: SourceData) {
  if (!action.job?.completeAction) return null
  const resultName = '__workflow_result'
  const completeAction = {
    ...action.job.completeAction,
    inputs: [...(action.job.completeAction.inputs || []), { name: resultName, label: 'Workflow result', type: 'hidden' as const, bodyPath: action.job.resultBodyPath || ['result'] }],
  }
  const values = Object.fromEntries((action.job.completeAction.inputs || []).map((input) => [
    input.name,
    input.defaultPath ? normalizeActionValue(readPortablePath(input.defaultSource === 'item' ? item?.raw : data, input.defaultPath)) : defaultValue(input),
  ]))
  return { completeAction, resultName, values }
}
