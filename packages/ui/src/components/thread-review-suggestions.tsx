import { useMemo } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Send, Sparkles } from 'lucide-react'
import { createDiffLineIndex, indexedDiffLineContent } from '@vertexade/platform-contracts'
import { DiffReview, type DiffReviewAnnotation } from '@vertexade/ui/components/diff-review'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Checkbox } from '@vertexade/ui/components/ui/checkbox'
import { Label } from '@vertexade/ui/components/ui/label'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import type { JobDiffPreview } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

export type ReviewSuggestion = {
  id: number
  path: string
  line: number
  side: 'LEFT' | 'RIGHT'
  description: string
  replacement: string
  selected: number
  posted_at: string | null
}

export function locateReviewSuggestions(suggestions: ReviewSuggestion[], patch: string) {
  const diffLines = createDiffLineIndex(patch)
  const annotations: DiffReviewAnnotation<ReviewSuggestion>[] = []
  const unmatched: ReviewSuggestion[] = []
  for (const suggestion of suggestions) {
    if (indexedDiffLineContent(diffLines, suggestion) === null) unmatched.push(suggestion)
    else annotations.push({ ...suggestion, metadata: suggestion })
  }
  return { annotations, unmatched }
}

type ThreadReviewSuggestionsProps = {
  status: string
  suggestions: ReviewSuggestion[]
  posting: boolean
  loading: boolean
  error: string
  preview: JobDiffPreview | null
  onChange(id: number, patch: Partial<ReviewSuggestion>): void
  onPost(): void
  onRetry(): void
}

function suggestionSelection(suggestions: ReviewSuggestion[]) {
  const pending = suggestions.filter((item) => item.selected && !item.posted_at)
  const ready = pending.filter((item) => item.side === 'RIGHT' && item.description.trim())
  return {
    pending: pending.length,
    ready: ready.length,
    blocked: pending.length !== ready.length,
    posted: suggestions.filter((item) => item.posted_at).length,
  }
}

export function ThreadReviewSuggestions({
  status,
  suggestions,
  posting,
  loading,
  error,
  preview,
  onChange,
  onPost,
  onRetry,
}: ThreadReviewSuggestionsProps) {
  const located = useMemo(() => locateReviewSuggestions(suggestions, preview?.diff || ''), [preview?.diff, suggestions])
  const selection = suggestionSelection(suggestions)
  const preferredSuggestion = located.annotations.find((item) => item.metadata.selected && !item.metadata.posted_at)
  const unmatched = preview ? located.unmatched : []

  return (
    <div
      className="space-y-3"
      data-audit-action="review-suggestions"
      data-audit-state={preview ? 'review-suggestions-ready' : 'review-suggestions-loading'}
    >
      <SuggestionHeader selection={selection} unmatched={unmatched.length} posting={posting} onPost={onPost} />
      {selection.blocked && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[.05] px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          Deselect proposals on deleted lines or add a review comment to every selected proposal before posting.
        </p>
      )}
      <SuggestionStatus status={status} suggestions={suggestions} />
      <DiffStatus loading={loading} error={error} hasPreview={Boolean(preview)} onRetry={onRetry} />
      <TruncatedDiffNotice preview={preview} />
      <UnmatchedSuggestions suggestions={unmatched} onChange={onChange} />
      <SuggestionDiff preview={preview} annotations={located.annotations} preferredSuggestion={preferredSuggestion} onChange={onChange} />
    </div>
  )
}

type SuggestionSelection = ReturnType<typeof suggestionSelection>

function SuggestionHeader({
  selection,
  unmatched,
  posting,
  onPost,
}: {
  selection: SuggestionSelection
  unmatched: number
  posting: boolean
  onPost(): void
}) {
  const postLabel = selection.ready ? `Post ${selection.ready} as one review` : 'Post selected as one review'
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3">
      <div className="min-w-0">
        <strong className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-amber-400" /> Suggestions on the real PR diff
        </strong>
        <p className="mt-1 text-xs text-muted-foreground">
          Review and edit each proposal in file context. Nothing is posted until you confirm one batched review.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{selection.pending} selected</Badge>
          {selection.posted > 0 && <Badge variant="outline">{selection.posted} posted</Badge>}
          {unmatched > 0 && <Badge variant="outline">{unmatched} outside preview</Badge>}
        </div>
      </div>
      <Button size="sm" disabled={posting || !selection.ready || selection.blocked} onClick={onPost}>
        {posting ? <Loader2 className="animate-spin" /> : <Send />}
        {posting ? 'Posting…' : postLabel}
      </Button>
    </div>
  )
}

function TruncatedDiffNotice({ preview }: { preview: JobDiffPreview | null }) {
  if (!preview?.truncated) return null
  return (
    <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      This large diff preview omits {preview.omitted_files.length} file{preview.omitted_files.length === 1 ? '' : 's'}. Proposals outside
      the preview remain below and are revalidated before posting.
    </p>
  )
}

function UnmatchedSuggestions({
  suggestions,
  onChange,
}: {
  suggestions: ReviewSuggestion[]
  onChange(id: number, patch: Partial<ReviewSuggestion>): void
}) {
  if (!suggestions.length) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="size-3.5 text-amber-400" /> Outside the loaded diff
      </div>
      {suggestions.map((item) => (
        <SuggestionEditor key={item.id} item={item} onChange={onChange} />
      ))}
    </section>
  )
}

function SuggestionDiff({
  preview,
  annotations,
  preferredSuggestion,
  onChange,
}: {
  preview: JobDiffPreview | null
  annotations: DiffReviewAnnotation<ReviewSuggestion>[]
  preferredSuggestion?: DiffReviewAnnotation<ReviewSuggestion>
  onChange(id: number, patch: Partial<ReviewSuggestion>): void
}) {
  if (!preview?.diff || !preview.diff_summary.files.length) return null
  return (
    <DiffReview
      patch={preview.diff}
      files={preview.diff_summary.files}
      annotations={annotations}
      preferredPath={preferredSuggestion?.path}
      preferredTarget={preferredSuggestion}
      renderAnnotation={(item) => <SuggestionEditor item={item} inline onChange={onChange} />}
    />
  )
}

function SuggestionStatus({ status, suggestions }: Pick<ThreadReviewSuggestionsProps, 'status' | 'suggestions'>) {
  if (status === 'completed' && !suggestions.length)
    return (
      <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        This review did not produce any safe inline suggested changes. The changed files remain available below for context.
      </p>
    )
  if (['starting', 'running'].includes(status) && !suggestions.length)
    return (
      <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
        Suggestions will be placed on the changed files when the review completes.
      </p>
    )
  return null
}

function DiffStatus({
  loading,
  error,
  hasPreview,
  onRetry,
}: Pick<ThreadReviewSuggestionsProps, 'loading' | 'error' | 'onRetry'> & { hasPreview: boolean }) {
  if (loading && !hasPreview)
    return (
      <p className="flex items-center justify-center gap-2 rounded-lg border bg-background p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the pull request files…
      </p>
    )
  if (error)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/[.04] p-3 text-sm">
        <span className="text-muted-foreground">{error}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      </div>
    )
  return null
}

function SuggestionEditor({
  item,
  inline = false,
  onChange,
}: {
  item: ReviewSuggestion
  inline?: boolean
  onChange(id: number, patch: Partial<ReviewSuggestion>): void
}) {
  const unavailable = item.side !== 'RIGHT'
  return (
    <article
      data-audit-state={inline ? 'review-suggestion-inline' : undefined}
      data-diff-annotation-target={inline ? '' : undefined}
      className={cn(
        'rounded-lg border bg-background p-3 shadow-xs',
        inline && 'mx-2 my-2 max-w-none border-amber-500/25 bg-amber-500/[.035]',
        item.posted_at && 'opacity-60',
      )}
    >
      <div className="mb-2 flex min-w-0 items-start gap-2">
        <Checkbox
          aria-label={`Select suggestion for ${item.path}:${item.line}`}
          checked={Boolean(item.selected)}
          disabled={Boolean(item.posted_at)}
          onCheckedChange={(value) => onChange(item.id, { selected: value ? 1 : 0 })}
        />
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-xs">
            {item.path}:{item.line}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline">{item.side === 'RIGHT' ? 'Current file' : 'Deleted line'}</Badge>
            {item.posted_at && <Badge variant="outline">Posted</Badge>}
          </div>
        </div>
      </div>
      {unavailable && (
        <p className="mb-2 text-xs text-amber-400">GitHub suggestions can only be posted on a current-file line. Deselect this proposal.</p>
      )}
      <Label className="flex-col items-stretch gap-1.5 text-xs">
        Review comment
        <Textarea
          disabled={Boolean(item.posted_at)}
          value={item.description}
          onChange={(event) => onChange(item.id, { description: event.target.value })}
          className="min-h-16 bg-background"
          maxLength={10_000}
        />
      </Label>
      <Label className="mt-2 flex-col items-stretch gap-1.5 text-xs">
        Replacement code
        <Textarea
          disabled={Boolean(item.posted_at)}
          value={item.replacement}
          onChange={(event) => onChange(item.id, { replacement: event.target.value })}
          className="min-h-24 bg-background font-mono text-xs"
          maxLength={50_000}
        />
      </Label>
      {!item.posted_at && <p className="mt-1.5 text-xs text-muted-foreground">Leave the replacement empty to delete this line.</p>}
    </article>
  )
}
