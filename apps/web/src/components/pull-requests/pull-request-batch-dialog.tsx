import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bot, Check, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { Button } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { GithubReviewer, Job, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { reconcilePullRequestChange } from '../../lib/use-pull-request-mutation'

import {
  pullRequestBatchActions,
  pullRequestBatchCandidates,
  pullRequestBatchKey,
  type PullRequestBatchAction,
  type PullRequestBatchCandidate,
} from './pull-request-batch-model'

type BatchResult = { status: 'running' | 'succeeded' | 'failed'; message: string }

export function PullRequestBatchDialog({
  open,
  pullRequests,
  currentUser,
  onOpenChange,
  onReconcile,
}: {
  open: boolean
  pullRequests: PullRequest[]
  currentUser: GithubReviewer | null
  onOpenChange(open: boolean): void
  onReconcile(): Promise<void>
}) {
  const [action, setAction] = useState<PullRequestBatchAction>('review')
  const [results, setResults] = useState<Record<string, BatchResult>>({})
  const [syncError, setSyncError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const candidates = useMemo(() => pullRequestBatchCandidates(pullRequests, action, currentUser), [action, currentUser, pullRequests])
  const eligible = candidates.filter((candidate) => candidate.eligible)
  const excluded = candidates.filter((candidate) => !candidate.eligible)
  const busy = Object.values(results).some((result) => result.status === 'running')
  const failed = eligible.filter((candidate) => results[pullRequestBatchKey(candidate.pr)]?.status === 'failed')
  const pending = eligible.filter((candidate) => !results[pullRequestBatchKey(candidate.pr)])

  useEffect(() => {
    if (!open) return
    setResults({})
    setSyncError(null)
  }, [action, open])

  function updateResult(pr: PullRequest, result: BatchResult) {
    setResults((current) => ({ ...current, [pullRequestBatchKey(pr)]: result }))
  }

  async function run(targets: PullRequestBatchCandidate[]) {
    if (busyRef.current || !targets.length) return
    busyRef.current = true
    setSyncError(null)
    targets.forEach(({ pr }) => updateResult(pr, { status: 'running', message: 'Submitting…' }))
    for (const { pr } of targets) {
      updateResult(pr, await executeBatchCandidate(action, pr))
    }
    await reconcilePullRequestChange(onReconcile, 'The operations finished', setSyncError)
    busyRef.current = false
  }

  async function retrySync() {
    await reconcilePullRequestChange(onReconcile, 'The operations finished', setSyncError)
  }

  const selectedAction = pullRequestBatchActions.find((item) => item.id === action)!
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Batch actions</DialogTitle>
          <DialogDescription>{pullRequests.length} selected · only safe, non-verdict actions are available.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <BatchActionPicker action={action} description={selectedAction.description} busy={busy} onChange={setAction} />
          <BatchPreview candidates={candidates} results={results} included={eligible.length} excluded={excluded.length} />
          <BatchSyncError message={syncError} onRetry={retrySync} />
        </div>
        <BatchDialogFooter
          busy={busy}
          failed={failed}
          pending={pending}
          actionLabel={selectedAction.label}
          onClose={() => onOpenChange(false)}
          onRun={run}
        />
      </DialogContent>
    </Dialog>
  )
}

function BatchActionPicker({
  action,
  description,
  busy,
  onChange,
}: {
  action: PullRequestBatchAction
  description: string
  busy: boolean
  onChange(action: PullRequestBatchAction): void
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="pr-batch-action" className="text-xs font-medium">
        Action
      </label>
      <Select value={action} onValueChange={(value) => onChange(value as PullRequestBatchAction)} disabled={busy}>
        <SelectTrigger id="pr-batch-action" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {pullRequestBatchActions.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function BatchPreview({
  candidates,
  results,
  included,
  excluded,
}: {
  candidates: PullRequestBatchCandidate[]
  results: Record<string, BatchResult>
  included: number
  excluded: number
}) {
  return (
    <section className="rounded-lg border bg-muted/15">
      <header className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <strong>Preview</strong>
        <span className="tabular-nums text-muted-foreground">
          {included} included · {excluded} excluded
        </span>
      </header>
      <div className="max-h-64 divide-y overflow-y-auto">
        {candidates.map((candidate) => (
          <BatchCandidateRow
            key={pullRequestBatchKey(candidate.pr)}
            candidate={candidate}
            result={results[pullRequestBatchKey(candidate.pr)]}
          />
        ))}
      </div>
    </section>
  )
}

function BatchCandidateRow({ candidate, result }: { candidate: PullRequestBatchCandidate; result?: BatchResult }) {
  const message = batchCandidateMessage(candidate, result)
  return (
    <div className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs">
      <BatchStatusIcon eligible={candidate.eligible} result={result} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {candidate.pr.full_name} #{candidate.pr.number}
        </p>
        <p className={batchCandidateMessageClass(result)}>{message}</p>
      </div>
    </div>
  )
}

function batchCandidateMessage(candidate: PullRequestBatchCandidate, result?: BatchResult) {
  return result?.message || candidate.reason || candidate.pr.title
}

function batchCandidateMessageClass(result?: BatchResult) {
  return cn('truncate text-muted-foreground', result?.status === 'failed' && 'text-red-300')
}

function BatchSyncError({ message, onRetry }: { message: string | null; onRetry(): Promise<void> }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/8 p-2 text-xs text-red-300">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button variant="ghost" size="xs" onClick={() => void onRetry()}>
        <RefreshCw />
        Retry sync
      </Button>
    </div>
  )
}

function BatchDialogFooter({
  busy,
  failed,
  pending,
  actionLabel,
  onClose,
  onRun,
}: {
  busy: boolean
  failed: PullRequestBatchCandidate[]
  pending: PullRequestBatchCandidate[]
  actionLabel: string
  onClose(): void
  onRun(targets: PullRequestBatchCandidate[]): Promise<void>
}) {
  return (
    <DialogFooter className="shrink-0">
      <Button variant="outline" disabled={busy} onClick={onClose}>
        Close
      </Button>
      <FailedBatchRetry busy={busy} failed={failed} onRun={onRun} />
      <PrimaryBatchAction busy={busy} pending={pending} actionLabel={actionLabel} onRun={onRun} />
    </DialogFooter>
  )
}

function FailedBatchRetry({
  busy,
  failed,
  onRun,
}: {
  busy: boolean
  failed: PullRequestBatchCandidate[]
  onRun(targets: PullRequestBatchCandidate[]): Promise<void>
}) {
  if (!failed.length) return null
  return (
    <Button variant="secondary" disabled={busy} onClick={() => void onRun(failed)}>
      <RefreshCw />
      Retry failed ({failed.length})
    </Button>
  )
}

function PrimaryBatchAction({
  busy,
  pending,
  actionLabel,
  onRun,
}: {
  busy: boolean
  pending: PullRequestBatchCandidate[]
  actionLabel: string
  onRun(targets: PullRequestBatchCandidate[]): Promise<void>
}) {
  const label = batchPrimaryLabel(busy, pending.length, actionLabel)
  return (
    <Button disabled={busy || !pending.length} onClick={() => void onRun(pending)}>
      {busy ? <LoaderCircle className="animate-spin" /> : <Bot />}
      {label}
    </Button>
  )
}

function batchPrimaryLabel(busy: boolean, pending: number, actionLabel: string) {
  if (busy) return 'Working…'
  if (!pending) return 'Completed'
  return `${actionLabel} (${pending})`
}

function BatchStatusIcon({ eligible, result }: { eligible: boolean; result?: BatchResult }) {
  const status = result?.status || (eligible ? 'included' : 'excluded')
  const presentation = batchStatusPresentation[status]
  return <presentation.Icon aria-label={presentation.label} className={cn('mt-0.5 size-3.5 shrink-0', presentation.className)} />
}

async function executeBatchAction(action: PullRequestBatchAction, pr: PullRequest) {
  return batchActionExecutor[action](pr)
}

async function executeBatchCandidate(action: PullRequestBatchAction, pr: PullRequest): Promise<BatchResult> {
  try {
    return { status: 'succeeded', message: await executeBatchAction(action, pr) }
  } catch (error) {
    return { status: 'failed', message: (error as Error).message }
  }
}

const batchStatusPresentation = {
  excluded: { label: 'Excluded', Icon: X, className: 'text-muted-foreground' },
  included: { label: 'Included', Icon: Check, className: 'text-muted-foreground' },
  running: { label: 'Running', Icon: LoaderCircle, className: 'animate-spin text-blue-400' },
  failed: { label: 'Failed', Icon: AlertTriangle, className: 'text-red-400' },
  succeeded: { label: 'Succeeded', Icon: Check, className: 'text-emerald-400' },
}

const batchActionExecutor: Record<PullRequestBatchAction, (pr: PullRequest) => Promise<string>> = {
  review: startBatchReview,
  watch: watchBatchPullRequest,
  assign: assignBatchPullRequest,
  update: updateBatchPullRequest,
}

async function startBatchReview(pr: PullRequest) {
  const result = await api<{ threads: Job[] }>(`/api/pulls/${pr.repo_id}/${pr.number}/review`, { method: 'POST', body: '{}' })
  const run = result.threads[0]
  return run ? `Review started as run #${run.id}` : 'Review started'
}

async function watchBatchPullRequest(pr: PullRequest) {
  const result = await api<{ queued: boolean }>(`/api/pulls/${pr.repo_id}/${pr.number}/review-watch`, {
    method: 'POST',
    body: JSON.stringify({ enabled: true }),
  })
  return result.queued ? 'Watching; current head queued' : 'Watching new commits'
}

async function assignBatchPullRequest(pr: PullRequest) {
  await api(`/api/pulls/${pr.repo_id}/${pr.number}/reviewers`, { method: 'POST', body: JSON.stringify({ me: true }) })
  return 'Assigned to you'
}

async function updateBatchPullRequest(pr: PullRequest) {
  const result = await api<{ message: string }>(`/api/pulls/${pr.repo_id}/${pr.number}/update-branch`, {
    method: 'POST',
    body: '{}',
  })
  return result.message
}
