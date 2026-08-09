import { useEffect, useState } from 'react'
import type { PortableActionValue, PortableItemAction } from '@vertexade/platform-contracts'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { type PlatformExtensionClient } from '@vertexade/platform-client'
import { actionValueMissing, visibleInputs, type AgentOptions, type SourceData } from './portable-action-values'
import { actionAgentHeaders, completionAction, initialActionValues } from './portable-action-workflow'
export function usePortableAction({ action, item, data, extension, onClose, onCompleted }: {
  action: PortableItemAction
  item: PortableCollectionItem | null
  data: SourceData
  extension: PlatformExtensionClient
  onClose: () => void
  onCompleted: () => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, PortableActionValue>>({})
  const [agent, setAgent] = useState<AgentOptions>({ agentId: '', model: '', reasoningEffort: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState('')
  const [jobStatus, setJobStatus] = useState('')
  const [jobResult, setJobResult] = useState('')
  const [refinement, setRefinement] = useState('')

  useEffect(() => {
    setError('')
    setValues(initialActionValues(action, data, item))
  }, [action, data, item])

  useEffect(() => {
    if (!jobId || !action.job || action.job.completedValues.includes(jobStatus) || action.job.failedValues.includes(jobStatus)) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const response = await extension.request(action.job!.statusPath.replaceAll('{jobId}', encodeURIComponent(jobId)))
        if (cancelled) return
        const status = String(readPortablePath(response, action.job!.statusValuePath) || '')
        setJobStatus(status)
        const result = readPortablePath(response, action.job!.resultPath)
        if (result !== undefined) setJobResult(JSON.stringify(result, null, 2))
        const workflowError = readPortablePath(response, action.job!.errorPath)
        if (workflowError) setError(String(workflowError))
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not read workflow status')
      }
    }, action.job.pollIntervalMs || 1500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [action.job, extension, jobId, jobStatus])

  async function execute() {
    const missing = visibleInputs(action.inputs || [], values).find((input) => input.required && actionValueMissing(values[input.name]))
    if (missing) return setError(`${missing.label} is required`)
    setBusy(true); setError('')
    try {
      const response = await extension.executeAction(action, item || undefined, values, actionAgentHeaders(action, agent))
      if (action.job) {
        const id = String(readPortablePath(response, action.job.idPath) || '')
        if (!id) throw new Error(`${action.label} did not return a workflow id`)
        setJobId(id); setJobStatus('queued')
      } else {
        onClose(); await onCompleted()
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${action.label} failed`)
    } finally { setBusy(false) }
  }

  async function completeWorkflow() {
    const completion = completionAction(action, item, data)
    if (!completion) return
    setBusy(true); setError('')
    try {
      await extension.executeAction(completion.completeAction, item || undefined, { ...completion.values, [completion.resultName]: JSON.parse(jobResult || 'null') })
      onClose(); await onCompleted()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete workflow')
    } finally { setBusy(false) }
  }

  async function refineWorkflow() {
    if (!action.job?.refineAction || !refinement.trim()) return
    setBusy(true); setError('')
    try {
      const refineAction = { ...action.job.refineAction, path: action.job.refineAction.path.replaceAll('{jobId}', encodeURIComponent(jobId)) }
      const response = await extension.executeAction(refineAction, item || undefined, { prompt: refinement })
      const id = String(readPortablePath(response, action.job.idPath) || '')
      if (!id) throw new Error('Refinement did not return a workflow id')
      setJobId(id); setJobStatus('queued'); setJobResult(''); setRefinement('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refine workflow')
    } finally { setBusy(false) }
  }

  const jobComplete = Boolean(action.job && action.job.completedValues.includes(jobStatus))
  return {
    values, setValues, agent, setAgent, busy, error, jobId, jobStatus, jobResult, setJobResult,
    refinement, setRefinement, jobComplete, execute, completeWorkflow, refineWorkflow,
  }
}
