import type { JobLog, LogEvent } from './dashboard-types'

export function threadActivityEvents(job: JobLog): LogEvent[] {
  if (job.events.length || !job.result_text?.trim()) return job.events
  return [
    {
      kind: 'message',
      title: job.agent_name,
      text: job.result_text,
      time: job.finished_at || job.activity_at || job.created_at,
      status: 'completed',
    },
  ]
}
