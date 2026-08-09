import { useCallback, useState } from 'react'

export function usePullRequestRefresh(refreshDashboard: () => Promise<void>) {
  const [detailsRevision, setDetailsRevision] = useState(0)
  const refreshPullRequest = useCallback(async () => {
    setDetailsRevision((value) => value + 1)
    await refreshDashboard()
  }, [refreshDashboard])
  return { detailsRevision, refreshPullRequest }
}
