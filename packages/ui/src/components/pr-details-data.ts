import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api } from '@vertexade/ui/lib/dashboard-api'
import type { PullRequestDialogItem } from '@vertexade/ui/lib/dashboard-types'
import { platformQueryKey } from '@vertexade/ui/lib/platform-query'
import type { PullRequestDetails } from './pr-details-model'

export function usePullRequestDetails(pr: PullRequestDialogItem | null, refreshKey: number) {
  const endpoint = pr ? `/api/pulls/${pr.repo_id}/${pr.number}/details` : '/api/pulls/unselected/details'
  const query = useQuery({
    queryKey: [...platformQueryKey(endpoint), refreshKey],
    queryFn: ({ signal }) => api<PullRequestDetails>(endpoint, { signal }),
    enabled: Boolean(pr),
  })

  useEffect(() => {
    if (query.error) toast.error(query.error.message)
  }, [query.error])

  async function refreshDetails() {
    if (!pr) return
    const result = await query.refetch()
    if (result.error) throw result.error
  }

  return {
    details: query.data ?? null,
    loading: query.isFetching,
    loadError: query.error?.message || '',
    refreshDetails,
    retry: () => void query.refetch(),
  }
}
