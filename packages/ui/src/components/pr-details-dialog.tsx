import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, Code2, ExternalLink, Link2, Loader2, MessageSquareText, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'

import type { DiffCommentTarget, DiffReviewAnnotation } from '@vertexade/ui/components/diff-review'
import { EntityTabBar } from '@vertexade/ui/components/entity-workspace'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent } from '@vertexade/ui/components/ui/dialog'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { api } from '@vertexade/ui/lib/dashboard-api'
import type { DiffFile, PullRequestDialogItem } from '@vertexade/ui/lib/dashboard-types'
import {
  reviewThreadDiffLines,
  reviewThreadLine,
  reviewThreadTarget,
  type PullRequestReviewComment,
  type PullRequestReviewThread,
  type ReviewDiffLine,
} from '@vertexade/ui/lib/pr-review-thread'
import { cn } from '@vertexade/ui/lib/utils'
import { diffLineContent, suggestionMarkdown, type ScmReferencePresentation } from '@vertexade/platform-contracts'
import {
  pullRequestInitialTab,
  type Comment,
  type PrDetailsActions,
  type PrDetailsTab,
  type PullRequestDetails,
  type ReviewThread,
} from './pr-details-model'
import { usePullRequestDetails } from './pr-details-data'
import { PullRequestDecisionBar, PullRequestHeader, PullRequestOverview } from './pr-details-summary'
import { ConversationEntry, InlineReviewThread } from '@vertexade/ui/components/pr-details-conversation'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
export type { PrDetailsActions, PrDetailsTab } from './pr-details-model'

const inlineComposerLayout = { true: 'my-2 max-w-none', false: '' }
type InlineReviewMode = 'comment' | 'suggestion'
const inlineReviewCopy = {
  comment: { posted: 'Inline comment', submit: 'Post comment' },
  suggestion: { posted: 'Suggested change', submit: 'Post suggestion' },
} satisfies Record<InlineReviewMode, { posted: string; submit: string }>

type InlineCommentComposerProps = {
  pr: PullRequestDialogItem
  details: PullRequestDetails
  target: DiffCommentTarget
  onCancel: () => void
  onPosted: () => Promise<void>
  embedded?: boolean
}

function InlineCommentComposer({ pr, details, target, onCancel, onPosted, embedded = false }: InlineCommentComposerProps) {
  const sourceLine = diffLineContent(details.diff, target)
  const canSuggest = target.side === 'RIGHT' && sourceLine !== null
  const [mode, setMode] = useState<InlineReviewMode>('comment')
  const [comment, setComment] = useState('')
  const [replacement, setReplacement] = useState(sourceLine || '')
  const [posting, setPosting] = useState(false)
  const body = mode === 'suggestion' ? suggestionMarkdown(comment, replacement) : comment.trim()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mode === 'suggestion' && !canSuggest) return
    setPosting(true)
    const post = async () => {
      await api(`/api/pulls/${pr.repo_id}/${pr.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, commit_id: details.headRefOid, ...target }),
      })
      await onPosted()
      toast.success(`${inlineReviewCopy[mode].posted} posted on ${target.path}:${target.line}`)
      onCancel()
    }
    void post()
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setPosting(false))
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        'mx-auto mb-3 max-w-4xl rounded-xl border border-blue-500/30 bg-blue-500/[.04] p-3',
        inlineComposerLayout[String(embedded) as 'true' | 'false'],
      )}
    >
      <InlineComposerHeader target={target} />
      <InlineModePicker mode={mode} canSuggest={canSuggest} onChange={setMode} />
      <InlineComposerFields
        mode={mode}
        line={target.line}
        comment={comment}
        replacement={replacement}
        onCommentChange={setComment}
        onReplacementChange={setReplacement}
      />
      <InlineComposerActions
        mode={mode}
        posting={posting}
        canSuggest={canSuggest}
        hasComment={Boolean(comment.trim())}
        onCancel={onCancel}
      />
    </form>
  )
}

function InlineComposerHeader({ target }: { target: DiffCommentTarget }) {
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <strong className="min-w-0 break-all font-mono text-xs text-blue-400">
        {target.path}:{target.line}
      </strong>
      <Badge variant="outline" className="shrink-0">
        {target.side === 'RIGHT' ? 'New line' : 'Deleted line'}
      </Badge>
    </div>
  )
}

function InlineModePicker({
  mode,
  canSuggest,
  onChange,
}: {
  mode: InlineReviewMode
  canSuggest: boolean
  onChange(mode: InlineReviewMode): void
}) {
  return (
    <div className="mb-2 flex w-fit items-center rounded-md border bg-background p-0.5" role="group" aria-label="Inline review type">
      <Button
        type="button"
        variant={mode === 'comment' ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={mode === 'comment'}
        onClick={() => onChange('comment')}
      >
        <MessageSquareText /> Comment
      </Button>
      <Button
        type="button"
        variant={mode === 'suggestion' ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={mode === 'suggestion'}
        disabled={!canSuggest}
        title={canSuggest ? 'Propose replacement code for this line' : 'Suggestions can only replace a current-file line'}
        onClick={() => onChange('suggestion')}
      >
        <Code2 /> Suggest edit
      </Button>
    </div>
  )
}

function InlineComposerFields({
  mode,
  line,
  comment,
  replacement,
  onCommentChange,
  onReplacementChange,
}: {
  mode: InlineReviewMode
  line: number
  comment: string
  replacement: string
  onCommentChange(value: string): void
  onReplacementChange(value: string): void
}) {
  if (mode === 'comment')
    return (
      <Textarea
        value={comment}
        onChange={(event) => onCommentChange(event.target.value)}
        autoFocus
        className="min-h-24 bg-background"
        maxLength={65_536}
        placeholder="Leave an inline review comment…"
      />
    )
  return (
    <div className="space-y-2">
      <Textarea
        value={comment}
        onChange={(event) => onCommentChange(event.target.value)}
        className="min-h-16 bg-background"
        maxLength={10_000}
        placeholder="Why is this change better? (optional)"
        aria-label="Suggestion explanation"
      />
      <Textarea
        value={replacement}
        onChange={(event) => onReplacementChange(event.target.value)}
        autoFocus
        className="min-h-24 bg-background font-mono text-xs"
        maxLength={50_000}
        aria-label="Replacement code"
      />
      <p className="text-xs text-muted-foreground">Replaces line {line}. Leave the code empty to delete the line.</p>
    </div>
  )
}

function InlineComposerActions({
  mode,
  posting,
  canSuggest,
  hasComment,
  onCancel,
}: {
  mode: InlineReviewMode
  posting: boolean
  canSuggest: boolean
  hasComment: boolean
  onCancel(): void
}) {
  const valid = { comment: hasComment, suggestion: canSuggest }[mode]
  const label = posting ? 'Posting…' : inlineReviewCopy[mode].submit
  const SubmitIcon = posting ? Loader2 : Send
  const disabled = [posting, !valid].some(Boolean)
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" size="sm" disabled={posting} onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" disabled={disabled}>
        <SubmitIcon className={cn(posting && 'animate-spin')} />
        {label}
      </Button>
    </div>
  )
}

type PrDiffAnnotation = { kind: 'thread'; thread: ReviewThread } | { kind: 'draft'; target: DiffCommentTarget }

const LazyDiffReview = lazy(() =>
  import('@vertexade/ui/components/diff-review').then(({ DiffReview }) => ({ default: DiffReview<PrDiffAnnotation> })),
)
const LazyPullRequestIntelligenceTab = lazy(() => import('@vertexade/ui/components/pull-request-intelligence-tab'))
const LazyPullRequestStatusTab = lazy(() => import('@vertexade/ui/components/pr-details-checks'))

function pullRequestDiffAnnotations(threads: ReviewThread[], draft: DiffCommentTarget | null): DiffReviewAnnotation<PrDiffAnnotation>[] {
  const existing = threads.flatMap((thread) => {
    const target = reviewThreadTarget(thread)
    return target ? [{ ...target, metadata: { kind: 'thread' as const, thread } }] : []
  })
  return draft ? [...existing, { ...draft, metadata: { kind: 'draft', target: draft } }] : existing
}

function PrDiffAnnotationCard({
  annotation,
  pr,
  details,
  onChanged,
  onCancel,
}: {
  annotation: PrDiffAnnotation
  pr: PullRequestDialogItem
  details: PullRequestDetails
  onChanged: () => Promise<void>
  onCancel: () => void
}) {
  if (annotation.kind === 'thread') return <InlineReviewThread pr={pr} thread={annotation.thread} onChanged={onChanged} embedded />
  return (
    <InlineCommentComposer
      key={`${annotation.target.path}:${annotation.target.line}:${annotation.target.side}`}
      pr={pr}
      details={details}
      target={annotation.target}
      onCancel={onCancel}
      onPosted={onChanged}
      embedded
    />
  )
}

function PullRequestReviewThreads({
  pr,
  threads,
  onChanged,
}: {
  pr: PullRequestDialogItem
  threads: ReviewThread[]
  onChanged(): Promise<void>
}) {
  if (!threads.length) return null
  return (
    <section className="min-w-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <MessageSquareText className="size-4" />
          Inline review threads
        </h3>
        <Badge variant="secondary">{threads.length}</Badge>
      </div>
      <div className="min-w-0 space-y-3">
        {threads.map((thread) => (
          <InlineReviewThread key={thread.id} pr={pr} thread={thread} onChanged={onChanged} />
        ))}
      </div>
    </section>
  )
}

function PullRequestReviews({
  reviews,
  referencePresentation,
}: {
  reviews: Comment[]
  referencePresentation?: ScmReferencePresentation | null
}) {
  if (!reviews.length) return null
  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Reviews</h3>
      <div className="space-y-2">
        {reviews.map((review, index) => (
          <ConversationEntry key={review.id || index} item={review} label="Review" referencePresentation={referencePresentation} />
        ))}
      </div>
    </section>
  )
}

function PullRequestComments({
  comments,
  referencePresentation,
}: {
  comments: Comment[]
  referencePresentation?: ScmReferencePresentation | null
}) {
  if (!comments.length) return null
  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Comments</h3>
      <div className="space-y-2">
        {comments.map((comment, index) => (
          <ConversationEntry key={comment.id || index} item={comment} label="Comment" referencePresentation={referencePresentation} />
        ))}
      </div>
    </section>
  )
}

function ShadowReviewComment({
  review,
  onOpen,
}: {
  review: NonNullable<PullRequestDetails['shadow_review']>
  onOpen?: (id: number) => void
}) {
  if (!review.body.trim()) return null
  return (
    <section>
      <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Private review result</h3>
      <article className="rounded-lg border border-dashed bg-muted/20 p-3 text-muted-foreground shadow-inner">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <strong className="font-mono">{review.author}</strong>
          <button className="text-blue-400 hover:underline" type="button" onClick={() => onOpen?.(review.id)}>
            Shadow comment · Review #{review.id}
          </button>
        </div>
        <div className="italic">
          <MarkdownContent content={review.body} />
        </div>
      </article>
    </section>
  )
}

function EmptyConversation({ count }: { count: number }) {
  if (count) return null
  return <p className="py-10 text-center text-sm text-muted-foreground">No discussion yet.</p>
}

function PullRequestConversation({
  pr,
  details,
  conversationCount,
  onOpenRun,
  onChanged,
  embedded,
}: {
  pr: PullRequestDialogItem
  details: PullRequestDetails
  conversationCount: number
  onOpenRun?: (jobId: number) => void
  onChanged(): Promise<void>
  embedded: boolean
}) {
  const content = (
    <div className="w-full min-w-0 space-y-5 p-3 sm:p-4">
      <PullRequestOverview pr={pr} details={details} onOpenRun={onOpenRun} />
      <PullRequestReviewThreads pr={pr} threads={details.reviewThreads} onChanged={onChanged} />
      <PullRequestReviews reviews={details.reviews} referencePresentation={details.reference_presentation} />
      {details.shadow_review ? <ShadowReviewComment review={details.shadow_review} onOpen={onOpenRun} /> : null}
      <PullRequestComments comments={details.comments} referencePresentation={details.reference_presentation} />
      <EmptyConversation count={conversationCount} />
    </div>
  )
  return embedded ? content : <ScrollArea className="h-[72vh] min-w-0">{content}</ScrollArea>
}

export function PrDetailsDialog({
  pr,
  onOpenChange,
  onOpenRun,
  actions,
  backAction,
  embedded = false,
  stickyTabs = false,
  tab,
  onTabChange,
  refreshKey = 0,
}: {
  pr: PullRequestDialogItem | null
  onOpenChange: (open: boolean) => void
  onOpenRun?: (jobId: number) => void
  actions?: PrDetailsActions
  backAction?: ReactNode
  embedded?: boolean
  stickyTabs?: boolean
  tab?: PrDetailsTab
  onTabChange?: (tab: PrDetailsTab) => void
  refreshKey?: number
}) {
  const detailsState = usePullRequestDetails(pr, refreshKey)
  const { details, loading, loadError, refreshDetails } = detailsState
  const [inlineTarget, setInlineTarget] = useState<DiffCommentTarget | null>(null)
  const pageFlow = embedded

  useEffect(() => {
    setInlineTarget(null)
  }, [pr?.number, pr?.repo_id])

  const conversationCount =
    (details?.comments.length || 0) +
    (details?.reviews.length || 0) +
    (details?.reviewThreads.length || 0) +
    (details?.shadow_review ? 1 : 0)
  const diffAnnotations = pullRequestDiffAnnotations(details?.reviewThreads || [], inlineTarget)
  async function copyLink() {
    if (!pr) return
    const url =
      embedded && window.location.pathname.startsWith('/pull-requests/')
        ? new URL(window.location.href)
        : new URL('/pull-requests', window.location.origin)
    if (!url.pathname.startsWith('/pull-requests/')) {
      url.searchParams.set('repo', pr.full_name)
      url.searchParams.set('pr', String(pr.number))
    }
    await navigator.clipboard.writeText(url.toString())
    toast.success('PR link copied')
  }

  const providerName = details?.scm_provider_name || 'source control'
  const headerActions = pr && (
    <div className="flex w-auto gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        className="size-9 px-0 sm:h-7 sm:w-auto sm:px-2"
        aria-label="Copy pull request link"
        onClick={() => void copyLink()}
      >
        <Link2 />
        <span className="hidden sm:inline">Copy link</span>
      </Button>
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open on ${providerName}`}
        className={buttonVariants({
          variant: 'ghost',
          size: 'sm',
          className: 'size-9 px-0 sm:h-7 sm:w-auto sm:px-2',
        })}
      >
        <ExternalLink />
        <span className="hidden truncate sm:inline">{providerName}</span>
      </a>
    </div>
  )
  const header = pr ? (
    <PullRequestHeader
      pr={pr}
      details={details}
      providerName={providerName}
      headerActions={headerActions}
      backAction={backAction}
      embedded={embedded}
    />
  ) : null
  const body = (
    <>
      {loading && !details ? (
        <div className="grid min-h-[28rem] flex-1 place-items-center text-sm text-muted-foreground">
          Loading pull request from source control…
        </div>
      ) : loadError && !details ? (
        <div className="grid min-h-[28rem] flex-1 place-items-center p-4">
          <div role="alert" className="w-full max-w-lg rounded-xl border border-red-500/30 bg-red-500/[.05] p-4">
            <AlertCircle className="mb-3 size-5 text-red-400" />
            <h2 className="font-semibold">Pull request details could not be loaded</h2>
            <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={detailsState.retry}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        </div>
      ) : (
        details &&
        pr && (
          <>
            {loadError && (
              <div
                role="alert"
                className="flex min-w-0 items-center gap-3 border-b border-amber-500/25 bg-amber-500/[.06] px-3 py-2 sm:px-5"
              >
                <AlertCircle className="size-4 shrink-0 text-amber-400" />
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={loadError}>
                  The latest pull-request state could not be refreshed. The content below may be stale.
                </p>
                <Button variant="outline" size="xs" disabled={loading} onClick={detailsState.retry}>
                  <RefreshCw className={cn(loading && 'animate-spin')} />
                  Retry
                </Button>
              </div>
            )}
            <PullRequestDecisionBar details={details} actions={actions} mobileDock={embedded} />
            <Tabs
              value={tab}
              defaultValue={tab ? undefined : pullRequestInitialTab(details)}
              onValueChange={(value) => onTabChange?.(value as PrDetailsTab)}
              className={cn('min-h-0 flex-1 gap-0', pageFlow ? 'overflow-visible' : 'overflow-hidden')}
            >
              <EntityTabBar className={cn('shrink-0 py-1 sm:py-2', pageFlow && stickyTabs && 'top-[3.25rem] z-20')}>
                <TabsList variant="line" className="grid h-10 w-full grid-cols-6 gap-0 p-0 sm:flex sm:h-8 sm:w-fit sm:gap-1 sm:p-[3px]">
                  <TabsTrigger value="conversation" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Discussion <span className="text-muted-foreground">{conversationCount}</span>
                  </TabsTrigger>
                  <TabsTrigger value="changes" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Changes <span className="text-muted-foreground">{details.changedFiles}</span>
                  </TabsTrigger>
                  <TabsTrigger value="impact" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Impact
                  </TabsTrigger>
                  <TabsTrigger value="evidence" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Evidence
                  </TabsTrigger>
                  <TabsTrigger value="checks" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Checks <span className="text-muted-foreground">{details.statusCheckRollup.length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="commits" className="min-w-0 px-1 text-[11px] sm:px-1.5 sm:text-sm">
                    Commits <span className="text-muted-foreground">{details.commits.length}</span>
                  </TabsTrigger>
                </TabsList>
              </EntityTabBar>
              <TabsContent
                value="changes"
                className={cn(
                  'min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden p-2 sm:p-3',
                  pageFlow ? 'overflow-y-visible' : 'overflow-y-auto',
                )}
              >
                <div className="mb-2 hidden items-start gap-2 rounded-lg border border-blue-500/25 bg-blue-500/[.04] px-3 py-2 text-xs text-muted-foreground sm:flex">
                  <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-blue-400" />
                  <span>
                    Tap a line number to comment or suggest a change.
                    <span className="hidden sm:inline"> Your choice posts directly to {providerName}.</span>
                  </span>
                </div>
                <Suspense
                  fallback={
                    <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" />
                        Loading changed files…
                      </span>
                    </div>
                  }
                >
                  <LazyDiffReview
                    patch={details.diff}
                    files={details.diff_summary.files}
                    annotations={diffAnnotations}
                    onLineComment={setInlineTarget}
                    renderAnnotation={(annotation) =>
                      pr && (
                        <PrDiffAnnotationCard
                          annotation={annotation}
                          pr={pr}
                          details={details}
                          onChanged={refreshDetails}
                          onCancel={() => setInlineTarget(null)}
                        />
                      )
                    }
                  />
                </Suspense>
              </TabsContent>
              <TabsContent
                value="conversation"
                className={cn('min-h-0 min-w-0 flex-1 p-0', pageFlow ? 'overflow-visible' : 'overflow-hidden')}
              >
                <PullRequestConversation
                  pr={pr}
                  details={details}
                  conversationCount={conversationCount}
                  onOpenRun={onOpenRun}
                  onChanged={refreshDetails}
                  embedded={pageFlow}
                />
              </TabsContent>
              <Suspense fallback={null}>
                <TabsContent value="impact" className={cn('min-h-0 min-w-0 flex-1 p-3', pageFlow ? 'overflow-visible' : 'overflow-y-auto')}>
                  <LazyPullRequestIntelligenceTab tab="impact" repositoryId={pr.repo_id} pullRequestNumber={pr.number} />
                </TabsContent>
                <TabsContent
                  value="evidence"
                  className={cn('min-h-0 min-w-0 flex-1 p-3', pageFlow ? 'overflow-visible' : 'overflow-y-auto')}
                >
                  <LazyPullRequestIntelligenceTab
                    tab="evidence"
                    repositoryId={pr.repo_id}
                    pullRequestNumber={pr.number}
                    onNavigate={onTabChange}
                  />
                </TabsContent>
              </Suspense>
              <TabsContent value="checks" className={cn('min-h-0 flex-1 p-0', pageFlow ? 'overflow-visible' : 'overflow-hidden')}>
                <Suspense fallback={null}>
                  <LazyPullRequestStatusTab tab="checks" details={details} embedded={pageFlow} />
                </Suspense>
              </TabsContent>
              <TabsContent value="commits" className={cn('min-h-0 flex-1 p-0', pageFlow ? 'overflow-visible' : 'overflow-hidden')}>
                <Suspense fallback={null}>
                  <LazyPullRequestStatusTab tab="commits" details={details} embedded={pageFlow} />
                </Suspense>
              </TabsContent>
            </Tabs>
          </>
        )
      )}
    </>
  )
  const content = (
    <>
      {header}
      {body}
    </>
  )
  if (embedded)
    return (
      <section data-pr-details className="-mx-4 flex min-h-[calc(100svh-8.25rem)] min-w-0 flex-col overflow-visible sm:mx-0">
        {content}
      </section>
    )
  return (
    <Dialog open={Boolean(pr)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:h-auto sm:max-w-7xl">
        {content}
      </DialogContent>
    </Dialog>
  )
}
