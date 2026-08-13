import type { JobLog, LogEvent } from './dashboard-types'

export function threadActivityEvents(job: JobLog): LogEvent[] {
  if (job.events.length) {
    const prompt = job.display_prompt?.trim()
    const promptAlreadyPresent = job.events.some((event) => event.kind === 'user_message')
    return prompt && !promptAlreadyPresent
      ? [{ kind: 'user_message', title: 'You', text: prompt, time: job.created_at }, ...job.events]
      : job.events
  }
  if (!job.result_text?.trim()) return []
  return [
    ...(job.display_prompt?.trim() ? [{ kind: 'user_message', title: 'You', text: job.display_prompt, time: job.created_at }] : []),
    {
      kind: 'message',
      title: job.agent_name,
      text: job.result_text,
      time: job.finished_at || job.activity_at || job.created_at,
      status: 'completed',
    },
  ]
}
