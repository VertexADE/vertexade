import { useEffect, useState } from 'react'

import type { ReviewSuggestion } from '@vertexade/ui/components/thread-review-suggestions'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'

export function useThreadReviewSuggestions(jobId: number | null, job: JobLog | null, refreshToken: number) {
  const [suggestions, setSuggestions] = useState<ReviewSuggestion[]>([])

  useEffect(() => {
    if (!jobId || job?.id !== jobId || !['review', 'work_review'].includes(job.kind)) {
      setSuggestions([])
      return
    }
    let active = true
    api<{ suggestions: ReviewSuggestion[] }>(`/api/agent-threads/${jobId}/suggestions`)
      .then((value) => {
        if (active) setSuggestions(value.suggestions)
      })
      .catch(() => {
        if (active) setSuggestions([])
      })
    return () => {
      active = false
    }
  }, [job?.id, job?.kind, jobId, refreshToken])

  return { suggestions, setSuggestions }
}
