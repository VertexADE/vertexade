import { eq, sql } from 'drizzle-orm'
import { agentThreadContext, mergeAgentThreadContext } from '../agents/thread-context.ts'
import { jobs } from '../database/schema/tables.ts'
import { runtimeDb as db, runtimeJobFollowUps as jobFollowUps, runtimeNotifyClients as notifyClients } from './runtime-context.ts'

export function persistDetectedThreadContext(jobId, event) {
  const detected = agentThreadContext(event)
  if (!detected) return
  const current =
    db
      .select({ agent_model: jobs.agentModel, agent_reasoning_effort: jobs.agentReasoningEffort })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .get() || {}
  const next = mergeAgentThreadContext(current, detected)
  if (JSON.stringify(next) === JSON.stringify({ model: current.agent_model, reasoningEffort: current.agent_reasoning_effort })) return
  db.update(jobs)
    .set({ agentModel: next.model, agentReasoningEffort: next.reasoningEffort, activityAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(jobs.id, jobId))
    .run()
  jobFollowUps.updateQueuedContext(jobId, detected.model, detected.reasoningEffort)
  notifyClients('thread_context_updated', jobId)
}
