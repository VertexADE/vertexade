import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Job } from '@vertexade/ui/lib/dashboard-types'
import { followUpDelivery } from '@vertexade/ui/lib/follow-up-delivery'

export async function deliverFocusAgentMessage(job: Job, prompt: string, requested?: 'steer') {
  const delivery = followUpDelivery(job, requested)
  const result = await api<{ position?: number }>(`/api/agent-threads/${job.id}/${delivery}`, {
    method: 'POST',
    headers: focusAgentHeaders(job, delivery),
    body: JSON.stringify({ prompt }),
  })
  return { delivery, position: result.position }
}

function focusAgentHeaders(job: Job, delivery: ReturnType<typeof followUpDelivery>) {
  if (delivery !== 'follow-up') return undefined
  return {
    'x-agent-provider': job.agent_id,
    ...(job.agent_model ? { 'x-agent-model': job.agent_model } : {}),
    ...(job.agent_reasoning_effort ? { 'x-agent-reasoning-effort': job.agent_reasoning_effort } : {}),
  }
}
