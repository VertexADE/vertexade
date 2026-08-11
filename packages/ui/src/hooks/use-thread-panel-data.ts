import { useEffect, useState, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, isThreadEvent, subscribeToDashboardEvents } from '@vertexade/ui/lib/dashboard-api'
import type { JobDiffPreview, JobLog } from '@vertexade/ui/lib/dashboard-types'
import { useThreadReviewSuggestions } from '@vertexade/ui/hooks/use-thread-review-suggestions'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'

export function useThreadPanelData(jobId: number | null, changesActive: boolean) {
  const queryClient = useQueryClient()
  const [refreshToken, setRefreshToken] = useState(0)
  const jobEndpoint = `/api/agent-threads/${jobId ?? 'unselected'}/log`
  const diffEndpoint = `/api/agent-threads/${jobId ?? 'unselected'}/diff`
  const jobQueryKey = platformQueryKey(jobEndpoint)
  const jobQuery = useQuery({
    queryKey: jobQueryKey,
    queryFn: ({ signal }) => api<JobLog>(jobEndpoint, { signal }),
    enabled: Boolean(jobId),
  })
  const diffQuery = useQuery({
    queryKey: platformQueryKey(diffEndpoint),
    queryFn: ({ signal }) => api<JobDiffPreview>(diffEndpoint, { signal }),
    enabled: Boolean(changesActive && jobId),
  })
  const job = jobQuery.data ?? null
  const { suggestions, setSuggestions } = useThreadReviewSuggestions(jobId, job, refreshToken)

  useEffect(() => {
    setSuggestions([])
  }, [jobId, setSuggestions])

  useEffect(() => {
    if (!jobId) return
    return subscribeToDashboardEvents(
      () => {
        setRefreshToken((value) => value + 1)
        void queryClient.invalidateQueries({ queryKey: jobQueryKey })
      },
      (event) => isThreadEvent(event, jobId),
    )
  }, [jobId, jobQueryKey[1], jobQueryKey[2], queryClient])

  useEffect(() => {
    if (jobQuery.error) toast.error(jobQuery.error.message)
  }, [jobQuery.error])

  return {
    job,
    setJob: (value: SetStateAction<JobLog | null>) => {
      queryClient.setQueryData<JobLog | null>(jobQueryKey, (current) => (typeof value === 'function' ? value(current ?? null) : value))
    },
    loading: jobQuery.isFetching,
    suggestions,
    setSuggestions,
    diffPreview: diffQuery.data ?? null,
    diffLoading: diffQuery.isFetching,
    diffError: diffQuery.error?.message || '',
    retryDiff: () => void diffQuery.refetch(),
  }
}
