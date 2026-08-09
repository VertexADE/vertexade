export type FollowUpDelivery = 'steer' | 'queue' | 'follow-up'

export function canShowFollowUpComposer(
  job: { thread_id?: string | null; kind?: string | null },
  options: { activityOnly: boolean; needsInput: boolean },
) {
  if (!job.thread_id || options.needsInput) return false
  const privateReview = job.kind === 'review' || job.kind === 'work_review'
  return options.activityOnly || !privateReview
}

export function followUpDelivery(job: { status: string; can_steer: boolean }, requested?: string): FollowUpDelivery {
  const active = ['starting', 'running'].includes(job.status)
  if (!active) return 'follow-up'
  if (requested === 'steer' && job.can_steer) return 'steer'
  return 'queue'
}
