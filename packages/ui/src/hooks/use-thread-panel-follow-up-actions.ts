import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { toast } from 'sonner'
import type { FileReference } from '@vertexade/ui/components/markdown-content'
import type { PromptInputMessage } from '@vertexade/ui/components/ai-elements/prompt-input'
import { api, type AgentLaunchOptions } from '@vertexade/ui/lib/dashboard-api'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'
import { appendCodeSelectionToPrompt, type ChatCodeSelection } from '@vertexade/ui/lib/code-selection'
import { followUpDelivery } from '@vertexade/ui/lib/follow-up-delivery'
import { embedPromptImages } from '@vertexade/ui/lib/prompt-images'

type FollowUpOptions = {
  jobId: number | null
  job: JobLog | null
  setJob: Dispatch<SetStateAction<JobLog | null>>
  setFileReference: Dispatch<SetStateAction<FileReference | null>>
  setActiveTab: Dispatch<SetStateAction<string | null>>
  setChangesActive: Dispatch<SetStateAction<boolean>>
}

const emptyLaunchOptions = (): AgentLaunchOptions => ({ agentId: '', model: '', reasoningEffort: '', allowSubagents: false })

export function useThreadPanelFollowUpActions({ jobId, job, setJob, setFileReference, setActiveTab, setChangesActive }: FollowUpOptions) {
  const [followUp, setFollowUp] = useState('')
  const [composerFocusToken, setComposerFocusToken] = useState(0)
  const [followUpOptions, setFollowUpOptions] = useState<AgentLaunchOptions>(emptyLaunchOptions)
  const [sendingFollowUp, setSendingFollowUp] = useState(false)
  const [steeringQueuedId, setSteeringQueuedId] = useState<number | null>(null)
  const [cancellingQueuedId, setCancellingQueuedId] = useState<number | null>(null)

  useEffect(() => {
    setFollowUp('')
    setComposerFocusToken(0)
    setSteeringQueuedId(null)
    setCancellingQueuedId(null)
    setFollowUpOptions(emptyLaunchOptions())
  }, [jobId])

  useEffect(() => {
    if (!job || job.id !== jobId) return
    setFollowUpOptions({
      agentId: job.agent_id,
      model: job.agent_model || '',
      reasoningEffort: job.agent_reasoning_effort || '',
      allowSubagents: false,
    })
  }, [job?.agent_id, job?.agent_model, job?.agent_reasoning_effort, job?.id, jobId])

  async function submitFollowUp(message?: PromptInputMessage, event?: FormEvent<HTMLFormElement>) {
    const prepared = preparedFollowUp(message, followUp)
    if (!job || !prepared) return
    setSendingFollowUp(true)
    try {
      const prompt = await embedPromptImages(prepared.text, prepared.files)
      const delivery = followUpDelivery(job, requestedDelivery(event))
      const result = await api<{ position?: number }>(`/api/agent-threads/${job.id}/${delivery}`, {
        method: 'POST',
        headers: followUpHeaders(job, followUpOptions, delivery),
        body: JSON.stringify({ prompt }),
      })
      setFollowUp('')
      setJob(await api<JobLog>(`/api/agent-threads/${job.id}/log`))
      toast.success(deliveryMessage(delivery, result.position))
    } catch (error) {
      toast.error((error as Error).message)
      throw error
    } finally {
      setSendingFollowUp(false)
    }
  }

  function addCodeSelectionToChat(selection: ChatCodeSelection) {
    setFollowUp((current) => appendCodeSelectionToPrompt(current, selection))
    setFileReference(null)
    setActiveTab('activity')
    setChangesActive(false)
    setComposerFocusToken((current) => current + 1)
    toast.success(`Added ${selectionLocation(selection)} to the agent message`)
  }

  async function steerQueuedFollowUp(id: number) {
    if (!job) return
    setSteeringQueuedId(id)
    try {
      await api(`/api/agent-threads/${job.id}/queue/${id}/steer`, { method: 'POST', body: '{}' })
      setJob(await api<JobLog>(`/api/agent-threads/${job.id}/log`))
      toast.success('Queued message used to steer the active turn')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSteeringQueuedId(null)
    }
  }

  async function cancelQueuedFollowUp(id: number) {
    if (!job) return
    setCancellingQueuedId(id)
    try {
      await api(`/api/agent-threads/${job.id}/queue/${id}`, { method: 'DELETE' })
      setJob(await api<JobLog>(`/api/agent-threads/${job.id}/log`))
      toast.success('Queued message removed')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setCancellingQueuedId(null)
    }
  }

  return {
    followUp,
    setFollowUp,
    composerFocusToken,
    followUpOptions,
    setFollowUpOptions,
    sendingFollowUp,
    steeringQueuedId,
    cancellingQueuedId,
    submitFollowUp,
    addCodeSelectionToChat,
    steerQueuedFollowUp,
    cancelQueuedFollowUp,
  }
}

function preparedFollowUp(message: PromptInputMessage | undefined, fallback: string) {
  const text = message?.text.trim() || fallback.trim()
  const files = message?.files || []
  if (!text && !files.length) return null
  return { text, files }
}

function requestedDelivery(event: FormEvent<HTMLFormElement> | undefined) {
  return ((event?.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | null)?.value
}

function followUpHeaders(job: JobLog, options: AgentLaunchOptions, delivery: string) {
  if (delivery !== 'follow-up') return undefined
  const headers: Record<string, string> = {
    'x-agent-provider': job.agent_id,
    'x-agent-subagents': options.allowSubagents ? 'true' : 'false',
  }
  addHeader(headers, 'x-agent-model', options.model)
  addHeader(headers, 'x-agent-reasoning-effort', options.reasoningEffort)
  addHeader(headers, 'x-agent-service-tier', options.serviceTier || '')
  return headers
}

function addHeader(headers: Record<string, string>, name: string, value: string) {
  if (value) headers[name] = value
}

function deliveryMessage(delivery: string, position: number | undefined) {
  if (delivery === 'queue') return `Queued for the next turn${position ? ` · position ${position}` : ''}`
  if (delivery === 'steer') return 'Work run steered'
  return 'Follow-up sent'
}

function selectionLocation(selection: ChatCodeSelection) {
  if (selection.startLine === selection.endLine) return `${selection.path}:${selection.startLine}`
  return `${selection.path}:${selection.startLine}-${selection.endLine}`
}
