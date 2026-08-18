import { isCodeReviewKind } from '../../reviews.ts'
import { eq, sql } from 'drizzle-orm'
import { jobs } from '../../database/schema/tables.ts'
import {
  runtimeActiveJobs as activeJobs,
  runtimeAgentProvider as agentProvider,
  runtimeAgents as agents,
  runtimeBody as body,
  runtimeCancellingJobs as cancellingJobs,
  runtimeDb as db,
  runtimeDrainJobFollowUpQueue as drainJobFollowUpQueue,
  runtimeFollowUpJob as followUpJob,
  runtimeJobFollowUps as jobFollowUps,
  runtimeJson as json,
  runtimeNotifyClients as notifyClients,
  runtimeRetryJob as retryJob,
  runtimeSteerResponse as steerResponse,
} from '../runtime-context.ts'
import { matchThreadRoute, rejectThreadRoute, storedJob, type MatchedThreadRoute, type ThreadRoute } from './support.ts'
import { cancelFormForJob, formResponseMarkdown, resolveFormRequest } from '../../agents/form-requests.ts'

const controlRoutes = [
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/steer$/,
    handle: steer,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/queue\/(\d+)\/steer$/,
    handle: steerQueuedFollowUp,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/agent-threads\/(\d+)\/queue\/(\d+)$/,
    handle: removeQueuedFollowUp,
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/agent-threads\/(\d+)\/queue$/,
    handle: reorderQueuedFollowUps,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/queue$/,
    handle: queueFollowUp,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/follow-up$/,
    handle: followUp,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/retry$/,
    handle: retry,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/cancel$/,
    handle: cancel,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/interrupt$/,
    handle: cancel,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agent-threads\/(\d+)\/input$/,
    handle: submitInput,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/agent-threads\/(\d+)\/input$/,
    handle: cancelInput,
  },
] satisfies MatchedThreadRoute[]

export const handleThreadControlRoutes: ThreadRoute = (request, url) => matchThreadRoute(request, url, controlRoutes)

async function steer(request: Request, _url: URL, match: RegExpMatchArray) {
  const job = requiredStoredJob(match, 'Agent run not found')
  const prompt = await requiredPrompt(request, 'Steering prompt is required')
  cancelPendingForm(job, 'Replaced by a chat message')
  return steerResponse(job, prompt)
}

async function steerQueuedFollowUp(_request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const queuedId = Number(match[2])
  const job = requiredStoredJob(match, 'Agent run not found')
  const queued = jobFollowUps.queued(jobId, queuedId)
  if (!queued) rejectThreadRoute(404, 'Queued message not found')
  const response = await steerResponse(job, queued.prompt)
  if (response.status === 202) completeSteeredFollowUp(jobId, queuedId)
  return response
}

function completeSteeredFollowUp(jobId: number, queuedId: number) {
  jobFollowUps.completeQueued(jobId, queuedId)
  notifyClients('job_follow_up_steered', jobId)
}

async function removeQueuedFollowUp(_request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const queuedId = Number(match[2])
  const job = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).get()
  if (!job) rejectThreadRoute(404, 'Agent run not found')
  if (!jobFollowUps.removeQueued(jobId, queuedId)) rejectThreadRoute(404, 'Queued message not found')
  notifyClients('job_follow_up_removed', jobId)
  return json(200, { removed: true })
}

async function queueFollowUp(request: Request, _url: URL, match: RegExpMatchArray) {
  const { job } = followUpContext(match, 'queue')
  const prompt = await requiredPrompt(request, 'Queued follow-up prompt is required')
  cancelPendingForm(job, 'Replaced by a chat message')
  const queued = jobFollowUps.enqueue(job.id, prompt, job.agent_model, job.agent_reasoning_effort)
  notifyClients('job_follow_up_queued', job.id)
  if (!['starting', 'running'].includes(job.status)) void drainJobFollowUpQueue(job.id)
  return json(202, { queued: true, ...queued })
}

async function reorderQueuedFollowUps(request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  if (!storedJob(jobId)) rejectThreadRoute(404, 'Agent run not found')
  const input = await body(request)
  const ids = Array.isArray(input.ids) ? input.ids.map(Number) : []
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    rejectThreadRoute(400, 'A unique ordered list of queued message IDs is required')
  if (!jobFollowUps.reorder(jobId, ids)) rejectThreadRoute(409, 'The queued messages changed; refresh and try again')
  notifyClients('job_follow_up_reordered', jobId)
  return json(200, { reordered: true })
}

async function followUp(request: Request, _url: URL, match: RegExpMatchArray) {
  const { job, runtimeAgent } = followUpContext(match, 'resume')
  if (['running', 'starting'].includes(job.status)) rejectThreadRoute(409, `Wait for the current ${runtimeAgent.name} turn to finish first`)
  if (jobFollowUps.hasPending(job.id)) rejectThreadRoute(409, 'A queued follow-up is already waiting to run')
  const prompt = await requiredPrompt(request, 'Follow-up prompt is required')
  cancelPendingForm(job, 'Replaced by a chat message')
  return json(202, await followUpJob(job, prompt))
}

function followUpContext(match: RegExpMatchArray, mode: 'queue' | 'resume') {
  const job = requiredStoredJob(match, 'Agent run not found')
  const runtimeAgent = agents.require(job.agent_id || agentProvider)
  const startingMessage =
    mode === 'queue'
      ? `Wait for the ${runtimeAgent.name} thread to finish starting`
      : `This run has no ${runtimeAgent.name} thread to resume`
  const ephemeralMessage =
    mode === 'queue'
      ? 'Ephemeral runs cannot receive follow-ups after their active turn ends'
      : 'Ephemeral runs cannot be resumed because their provider session is not retained'
  assertRetainedThread(job, startingMessage)
  assertFollowUpsSupported(job, ephemeralMessage)
  return { job, runtimeAgent }
}

async function retry(_request: Request, _url: URL, match: RegExpMatchArray) {
  const job = requiredStoredJob(match, 'Agent run not found')
  if (!['failed', 'resumable', 'cancelled'].includes(job.status))
    rejectThreadRoute(409, 'Only failed, resumable, or stopped runs can be retried')
  return json(202, await retryJob(job))
}

function requiredStoredJob(match: RegExpMatchArray, message: string) {
  const job = storedJob(Number(match[1]))
  if (!job) rejectThreadRoute(404, message)
  return job
}

function assertRetainedThread(job: ReturnType<typeof requiredStoredJob>, message: string) {
  if (!job.thread_id) rejectThreadRoute(409, message)
}

function assertFollowUpsSupported(job: ReturnType<typeof requiredStoredJob>, message: string) {
  if (job.ephemeral && !isCodeReviewKind(job.kind)) rejectThreadRoute(409, message)
}

async function requiredPrompt(request: Request, message: string) {
  const input = await body(request)
  const prompt = String(input.prompt || '').trim()
  if (!prompt) rejectThreadRoute(400, message)
  return prompt
}

async function cancel(_request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const job = requiredStoredJob(match, 'Thread not found')
  if (!['starting', 'running'].includes(job.status)) rejectThreadRoute(409, 'This thread is not active')
  cancelPendingForm(job, 'The thread was interrupted')
  const child = requiredActiveJob(jobId)
  markCancelling(jobId)
  terminateChild(child, jobId)
  scheduleForcedTermination(child, jobId)
  notifyClients('job_cancelling', jobId)
  return json(202, { accepted: true })
}

function requiredActiveJob(jobId: number) {
  const child = activeJobs.get(jobId)
  if (!child) rejectThreadRoute(409, 'The active process is no longer attached to this server')
  return child
}

function markCancelling(jobId: number) {
  cancellingJobs.add(jobId)
  db.update(jobs)
    .set({
      latestActivity: 'Interrupting by user request…',
      activityAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(jobs.id, jobId))
    .run()
}

function terminateChild(child: ReturnType<typeof requiredActiveJob>, jobId: number) {
  try {
    signalChild(child, 'SIGTERM')
  } catch {
    terminateAttachedChild(child, jobId)
  }
}

function terminateAttachedChild(child: ReturnType<typeof requiredActiveJob>, jobId: number) {
  try {
    child.kill('SIGTERM')
  } catch (error) {
    cancellingJobs.delete(jobId)
    rejectThreadRoute(409, error instanceof Error ? error.message : String(error))
  }
}

function signalChild(child: ReturnType<typeof requiredActiveJob>, signal: NodeJS.Signals) {
  if (child.pid) process.kill(-child.pid, signal)
  else child.kill(signal)
}

function scheduleForcedTermination(child: ReturnType<typeof requiredActiveJob>, jobId: number) {
  const forceTimer = setTimeout(() => forceTerminate(child, jobId), 8_000)
  forceTimer.unref()
}

function forceTerminate(child: ReturnType<typeof requiredActiveJob>, jobId: number) {
  if (!activeJobs.has(jobId)) return
  try {
    signalChild(child, 'SIGKILL')
  } catch {}
}

async function submitInput(request: Request, _url: URL, match: RegExpMatchArray) {
  const jobId = Number(match[1])
  const job = requiredStoredJob(match, 'Codex run not found')
  if (!job.input_request_id || !job.input_questions) rejectThreadRoute(409, 'This run is not waiting for input')
  const input = await body(request)
  const answers = input.answers && typeof input.answers === 'object' ? input.answers : null
  const questions = JSON.parse(job.input_questions) as StoredInputQuestion[]
  const requestId = JSON.parse(job.input_request_id)
  if (typeof requestId === 'string' && requestId.startsWith('form:')) {
    if (!answers || questions.some((question) => question.required !== false && missingAnswer(answers, question.id))) {
      rejectThreadRoute(400, 'Answer every required form field before continuing')
    }
    if (questions.some((question) => invalidFormAnswer(question, answers))) rejectThreadRoute(400, 'The form response is invalid')
    if (!resolveFormRequest(requestId, { status: 'submitted', markdown: formResponseMarkdown(questions, answers) })) {
      rejectThreadRoute(409, 'This form is no longer connected to the agent')
    }
    clearInputRequest(jobId, 'Form submitted; the agent is continuing…')
  } else {
    const child = requiredActiveJob(jobId)
    if (!child.stdin?.writable) rejectThreadRoute(409, 'The live Codex connection is no longer available')
    if (!answers || questions.some((question) => missingAnswer(answers, question.id)))
      rejectThreadRoute(400, 'Answer every Codex question before continuing')
    await writeInputResponse(child, requestId, answers)
  }
  notifyClients('input_submitted', jobId)
  return json(202, { accepted: true })
}

async function cancelInput(_request: Request, _url: URL, match: RegExpMatchArray) {
  const job = requiredStoredJob(match, 'Agent run not found')
  if (!cancelPendingForm(job, 'Cancelled by the user')) rejectThreadRoute(409, 'This form cannot be cancelled')
  return json(202, { cancelled: true })
}

function cancelPendingForm(job: ReturnType<typeof requiredStoredJob>, reason: string) {
  if (!job.input_request_id) return false
  let requestId: unknown
  try {
    requestId = JSON.parse(job.input_request_id)
  } catch {
    return false
  }
  if (typeof requestId !== 'string' || !requestId.startsWith('form:') || !cancelFormForJob(job.id, reason)) return false
  clearInputRequest(job.id, reason)
  job.input_questions = null
  job.input_request_id = null
  notifyClients('input_cancelled', job.id)
  return true
}

function clearInputRequest(jobId: number, activity: string) {
  db.update(jobs)
    .set({
      inputRequestId: null,
      inputQuestions: null,
      inputRequestedAt: null,
      latestActivity: activity,
      activityAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(jobs.id, jobId))
    .run()
}

function missingAnswer(answers: Record<string, { answers?: unknown[] }>, questionId: string) {
  return !Array.isArray(answers[questionId]?.answers) || answers[questionId].answers.length === 0
}

type StoredInputQuestion = {
  id: string
  type?: 'text' | 'textarea' | 'select' | 'checkbox' | 'number' | 'date' | 'email' | 'url' | 'password'
  required?: boolean
  options?: Array<{ label?: unknown; value?: unknown }>
}

const scalarFormValidators: Partial<Record<NonNullable<StoredInputQuestion['type']>, (value: string) => boolean>> = {
  number: (value) => Number.isFinite(Number(value)),
  date: validDate,
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  url: validHttpUrl,
}

function validDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function invalidFormAnswer(question: StoredInputQuestion, answers: Record<string, { answers?: unknown[] }>) {
  const values = Array.isArray(answers[question.id]?.answers) ? answers[question.id].answers.map(String) : []
  if (values.some((value) => !value.trim() || value.length > 20_000)) return true
  if (question.type !== 'checkbox' && values.length > 1) return true
  const validator = question.type ? scalarFormValidators[question.type] : undefined
  if (validator && values.some((value) => !validator(value))) return true
  if (question.type !== 'checkbox') return false
  const allowed = new Set((question.options || []).map((option) => String(option.value || option.label)))
  return values.filter((value) => !allowed.has(value)).length > 1
}

function writeInputResponse(child: ReturnType<typeof requiredActiveJob>, requestId: unknown, answers: object) {
  return new Promise<void>((resolveWrite, rejectWrite) => {
    child.stdin!.write(`${JSON.stringify({ type: 'user_input_response', request_id: requestId, answers })}\n`, (error) => {
      if (error) rejectWrite(error instanceof Error ? error : new Error(String(error)))
      else resolveWrite()
    })
  })
}
