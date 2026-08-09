import { useEffect, useState } from 'react'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'
import type { ThreadPanelActionOptions } from '@vertexade/ui/hooks/use-thread-panel-action-options'
import { useThreadPanelFollowUpActions } from '@vertexade/ui/hooks/use-thread-panel-follow-up-actions'
import { useThreadPanelInputActions } from '@vertexade/ui/hooks/use-thread-panel-input-actions'
import { useThreadPanelRunActions } from '@vertexade/ui/hooks/use-thread-panel-run-actions'

export function useThreadPanelActions(options: ThreadPanelActionOptions) {
  const { jobId, job, setJob, questions, suggestions, setSuggestions, setFileReference, setActiveTab, setChangesActive, onReviewStarted } =
    options
  const [forkSource, setForkSource] = useState<JobLog | null>(null)
  const [transferSource, setTransferSource] = useState<JobLog | null>(null)

  useEffect(() => {
    setForkSource(null)
    setTransferSource(null)
  }, [jobId])

  const input = useThreadPanelInputActions(jobId, job, questions)
  const followUp = useThreadPanelFollowUpActions({ jobId, job, setJob, setFileReference, setActiveTab, setChangesActive })
  const run = useThreadPanelRunActions({ job, setJob, suggestions, setSuggestions, onReviewStarted })

  return { forkSource, setForkSource, transferSource, setTransferSource, ...input, ...followUp, ...run }
}
