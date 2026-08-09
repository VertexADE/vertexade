import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api } from '@vertexade/ui/lib/dashboard-api'
import type { PullRequestDialogItem } from '@vertexade/ui/lib/dashboard-types'
import type { PullRequestDetails } from './pr-details-model'

export function usePullRequestDetails(pr: PullRequestDialogItem | null, refreshKey: number) {
  const [details, setDetails] = useState<PullRequestDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    setDetails(null)
    setLoadError('')
  }, [pr?.number, pr?.repo_id])

  useEffect(() => {
    if (!pr) return
    let active = true
    setLoading(true)
    setLoadError('')
    void api<PullRequestDetails>(`/api/pulls/${pr.repo_id}/${pr.number}/details`)
      .then((value) => active && setDetails(value))
      .catch((error: Error) => {
        if (active) setLoadError(error.message)
        toast.error(error.message)
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [pr?.number, pr?.repo_id, refreshKey, retryKey])

  async function refreshDetails() {
    if (!pr) return
    setLoadError('')
    try {
      setDetails(await api<PullRequestDetails>(`/api/pulls/${pr.repo_id}/${pr.number}/details`))
    } catch (error) {
      setLoadError((error as Error).message)
      throw error
    }
  }

  return {
    details,
    loading,
    loadError,
    refreshDetails,
    retry: () => setRetryKey((value) => value + 1),
  }
}
