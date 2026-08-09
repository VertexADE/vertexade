import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, isThreadEvent, subscribeToDashboardEvents } from '@vertexade/ui/lib/dashboard-api'
import type { JobDiffPreview, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { useThreadReviewSuggestions } from '@vertexade/ui/hooks/use-thread-review-suggestions'

export function useThreadPanelData(jobId: number | null, changesActive: boolean) {
  const [job, setJob] = useState<JobLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffPreview, setDiffPreview] = useState<JobDiffPreview | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState('')
  const [diffAttempt, setDiffAttempt] = useState(0)
  const [refreshToken, setRefreshToken] = useState(0)
  const { suggestions, setSuggestions } = useThreadReviewSuggestions(jobId, job, refreshToken)

  useEffect(() => {
    setJob(null)
    setLoading(Boolean(jobId))
    setDiffPreview(null)
    setDiffError('')
    setSuggestions([])
  }, [jobId, setSuggestions])

  useEffect(() => {
    if (!jobId) return
    return subscribeToDashboardEvents(
      () => setRefreshToken((value) => value + 1),
      (event) => isThreadEvent(event, jobId),
    )
  }, [jobId])

  useEffect(() => {
    if (!changesActive || !jobId || diffPreview) return
    const controller = new AbortController()
    setDiffLoading(true)
    setDiffError('')
    api<JobDiffPreview>(`/api/agent-threads/${jobId}/diff`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return
        setDiffPreview(value)
        setDiffLoading(false)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setDiffError(error instanceof Error ? error.message : String(error))
        setDiffLoading(false)
      })
    return () => controller.abort()
  }, [changesActive, diffAttempt, diffPreview, jobId])

  useEffect(() => {
    if (!jobId) return
    const controller = new AbortController()
    api<JobLog>(`/api/agent-threads/${jobId}/log`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setJob(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [jobId, refreshToken])

  return {
    job,
    setJob,
    loading,
    suggestions,
    setSuggestions,
    diffPreview,
    diffLoading,
    diffError,
    retryDiff: () => setDiffAttempt((value) => value + 1),
  }
}
