import { useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@vertexade/ui/components/confirm-provider'
import type { ReviewSuggestion } from '@vertexade/ui/components/thread-review-suggestions'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { Job, JobLog } from '@vertexade/ui/lib/dashboard-types'

type RunActionOptions = {
  job: JobLog | null
  setJob: Dispatch<SetStateAction<JobLog | null>>
  suggestions: ReviewSuggestion[]
  setSuggestions: Dispatch<SetStateAction<ReviewSuggestion[]>>
  onReviewStarted?(job: Job): void
}

export function useThreadPanelRunActions({ job, setJob, suggestions, setSuggestions, onReviewStarted }: RunActionOptions) {
  const confirmAction = useConfirm()
  const [savingTasks, setSavingTasks] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [reReviewing, setReReviewing] = useState(false)
  const [postingSuggestions, setPostingSuggestions] = useState(false)

  async function saveTasks() {
    if (!job) return
    setSavingTasks(true)
    try {
      const result = await api<{ saved: number }>(`/api/agent-threads/${job.id}/save-stack-tasks`, { method: 'POST', body: '{}' })
      toast.success(`Saved ${result.saved} PR task${result.saved === 1 ? '' : 's'} to the action list`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSavingTasks(false)
    }
  }

  async function copyLink() {
    if (!job) return
    const url = new URL('/threads', window.location.origin)
    url.searchParams.set('run', String(job.id))
    await navigator.clipboard.writeText(url.toString())
    toast.success(`${['review', 'work_review'].includes(job.kind) ? 'Review' : 'Run'} link copied`)
  }

  async function retry() {
    if (!job) return
    setRetrying(true)
    try {
      await api(`/api/agent-threads/${job.id}/retry`, { method: 'POST', body: '{}' })
      setJob(await api<JobLog>(`/api/agent-threads/${job.id}/log`))
      toast.success('Failed run restarted')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRetrying(false)
    }
  }

  async function stop() {
    if (!job || !(await confirmStop(confirmAction, job.id))) return
    setStopping(true)
    try {
      await api(`/api/agent-threads/${job.id}/interrupt`, { method: 'POST', body: '{}' })
      toast.success(`Interrupting thread #${job.id}`)
      setJob(await api<JobLog>(`/api/agent-threads/${job.id}/log`))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setStopping(false)
    }
  }

  async function reReview() {
    if (!job) return
    setReReviewing(true)
    try {
      const result = await api<{ threads: Job[]; batch_id: number | null; mode: 'single' | 'aggregate' }>(
        `/api/agent-threads/${job.id}/re-review`,
        { method: 'POST', body: '{}' },
      )
      const next = result.threads[0]
      toast.success(reviewStartedMessage(result.mode, result.threads.length, next.id))
      onReviewStarted?.(next)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setReReviewing(false)
    }
  }

  function changeSuggestion(id: number, patch: Partial<ReviewSuggestion>) {
    setSuggestions((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function postSuggestions() {
    if (!job) return
    setPostingSuggestions(true)
    try {
      const result = await api<{ posted: number }>(`/api/agent-threads/${job.id}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ suggestions: suggestions.map(suggestionInput) }),
      })
      toast.success(`Posted ${result.posted} suggested change${result.posted === 1 ? '' : 's'} in one GitHub review`)
      setSuggestions((await api<{ suggestions: ReviewSuggestion[] }>(`/api/agent-threads/${job.id}/suggestions`)).suggestions)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setPostingSuggestions(false)
    }
  }

  return {
    savingTasks,
    retrying,
    stopping,
    reReviewing,
    postingSuggestions,
    saveTasks,
    copyLink,
    retry,
    stop,
    reReview,
    changeSuggestion,
    postSuggestions,
  }
}

function confirmStop(confirmAction: ReturnType<typeof useConfirm>, jobId: number) {
  return confirmAction({
    title: `Interrupt thread #${jobId}?`,
    description:
      'The active turn will receive a graceful interrupt signal. The thread and its worktree stay available so you can continue or retry it afterward.',
    confirmLabel: 'Interrupt thread',
    destructive: true,
  })
}

function reviewStartedMessage(mode: string, count: number, jobId: number) {
  if (mode === 'aggregate') return `Started ${count} fresh reviews; aggregation will follow`
  return `Fresh review started as run #${jobId}`
}

function suggestionInput({ id, selected, description, replacement }: ReviewSuggestion) {
  return { id, selected: Boolean(selected), description, replacement }
}
