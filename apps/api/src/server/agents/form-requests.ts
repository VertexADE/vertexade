type FormResolution = { status: 'submitted'; markdown: string } | { status: 'cancelled'; reason: string }

type PendingForm = {
  jobId: number
  resolve(value: FormResolution): void
  signal?: AbortSignal
  abort?: () => void
}

const pending = new Map<string, PendingForm>()

export function waitForFormResolution(requestId: string, jobId: number, signal?: AbortSignal) {
  if (pending.has(requestId)) throw new Error('Form request is already active')
  return new Promise<FormResolution>((resolve) => {
    const abort = () => resolveFormRequest(requestId, { status: 'cancelled', reason: 'The agent stopped waiting for form input' })
    pending.set(requestId, { jobId, resolve, signal, abort })
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export function resolveFormRequest(requestId: string, resolution: FormResolution) {
  const request = pending.get(requestId)
  if (!request) return false
  pending.delete(requestId)
  if (request.signal && request.abort) request.signal.removeEventListener('abort', request.abort)
  request.resolve(resolution)
  return true
}

export function cancelFormForJob(jobId: number, reason: string) {
  const entry = [...pending.entries()].find(([, request]) => request.jobId === jobId)
  return entry ? resolveFormRequest(entry[0], { status: 'cancelled', reason }) : false
}

export function formResponseMarkdown(questions: Array<Record<string, unknown>>, answers: Record<string, { answers?: unknown[] }>) {
  const title = String(questions[0]?.formTitle || 'Form response')
  const lines = [`## ${title}`, '']
  for (const question of questions) {
    const id = String(question.id || '')
    const values = Array.isArray(answers[id]?.answers) ? answers[id].answers.map(String).filter(Boolean) : []
    lines.push(`- **${String(question.question || id)}:** ${values.length ? values.join(', ') : '_Not provided_'}`)
  }
  return lines.join('\n')
}
