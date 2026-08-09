import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { api, parseJson } from '@vertexade/ui/lib/dashboard-api'
import type { GithubReviewer, PullRequest } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'
import { reconcilePullRequestChange } from '../../lib/use-pull-request-mutation'

export function ReviewerDialog({
  pr,
  onOpenChange,
  onChanged,
}: {
  pr: PullRequest | null
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
}) {
  const [reviewers, setReviewers] = useState<GithubReviewer[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const assigned = useMemo(() => new Set(parseJson<GithubReviewer[]>(pr?.reviewers, []).map((reviewer) => reviewer.login)), [pr?.reviewers])
  const visible = reviewers.filter((reviewer) => reviewer.login.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (!pr) return
    setSelected([])
    setQuery('')
    setSyncError(null)
    setLoading(true)
    api<{ reviewers: GithubReviewer[] }>(`/api/repositories/${pr.repo_id}/reviewers`)
      .then((result) => setReviewers(result.reviewers))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [pr])

  function toggle(login: string, checked: boolean) {
    setSelected((current) => (checked ? Array.from(new Set([...current, login])) : current.filter((item) => item !== login)))
  }

  async function submit() {
    if (!pr || !selected.length) return
    setBusy(true)
    try {
      await api(`/api/pulls/${pr.repo_id}/${pr.number}/reviewers`, {
        method: 'POST',
        body: JSON.stringify({ reviewers: selected }),
      })
      toast.success(`Requested ${selected.length} reviewer${selected.length === 1 ? '' : 's'}`)
      if (await reconcilePullRequestChange(onChanged, 'The reviewers changed', setSyncError)) onOpenChange(false)
    } catch (error) {
      setSyncError((error as Error).message)
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Assign reviewers</DialogTitle>
          <DialogDescription className="line-clamp-2">
            #{pr?.number} — {pr?.title}
          </DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repository collaborators" />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border p-1.5">
          {loading ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Loading collaborators…</p>
          ) : (
            visible.map((reviewer) => {
              const alreadyAssigned = assigned.has(reviewer.login)
              return (
                <Label
                  key={reviewer.login}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-accent',
                    alreadyAssigned && 'cursor-default opacity-60',
                  )}
                >
                  <Checkbox
                    checked={alreadyAssigned || selected.includes(reviewer.login)}
                    disabled={alreadyAssigned}
                    onCheckedChange={(value) => toggle(reviewer.login, Boolean(value))}
                  />
                  {reviewer.avatar_url && <img src={reviewer.avatar_url} alt="" className="size-6 rounded-full" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{reviewer.login}</span>
                  {alreadyAssigned && <span className="text-xs text-muted-foreground">Assigned</span>}
                </Label>
              )
            })
          )}
          {!loading && !visible.length && <p className="p-6 text-center text-xs text-muted-foreground">No matching collaborators.</p>}
        </div>
        {syncError ? (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-red-500/25 bg-red-500/8 p-2 text-xs text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{syncError}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                void reconcilePullRequestChange(onChanged, 'The reviewers changed', setSyncError).then(
                  (synchronized) => synchronized && onOpenChange(false),
                )
              }
            >
              <RefreshCw />
              Retry
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selected.length || busy} onClick={submit}>
            <UserRoundPlus />
            Request review{selected.length ? ` (${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
