import { useEffect, useState, type ReactNode } from 'react'
import {
  Bot,
  Check,
  CircleDot,
  ExternalLink,
  FileCode2,
  FileSearch,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Link2,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Reply,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'

import { DiffReview, type DiffCommentTarget, type DiffReviewAnnotation } from '@vertexade/ui/components/diff-review'
import { AgentReviewStatusControls } from '@vertexade/ui/components/agent-review-status'
import { MarkdownContent } from '@vertexade/ui/components/markdown-content'
import { PullRequestCommentBody } from '@vertexade/ui/components/sonarqube-comment'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button, buttonVariants } from '@vertexade/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@vertexade/ui/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@vertexade/ui/components/ui/dropdown-menu'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vertexade/ui/components/ui/tabs'
import { Textarea } from '@vertexade/ui/components/ui/textarea'
import { age, api } from '@vertexade/ui/lib/dashboard-api'
import type { DiffFile, PullRequestDialogItem } from '@vertexade/ui/lib/dashboard-types'
import { useIsMobile } from '@vertexade/ui/hooks/use-mobile'
import {
  reviewThreadDiffLines,
  reviewThreadLine,
  reviewThreadTarget,
  type PullRequestReviewComment,
  type PullRequestReviewThread,
  type ReviewDiffLine,
} from '@vertexade/ui/lib/pr-review-thread'
import { cn } from '@vertexade/ui/lib/utils'
import type { ScmReferencePresentation } from '@vertexade/platform-contracts'
import type { Comment, ReviewThread } from './pr-details-model'
import { pullRequestStatusTone } from './pr-details-status'

export function ConversationEntry({
  item,
  label,
  referencePresentation,
}: {
  item: Comment
  label: string
  referencePresentation?: ScmReferencePresentation | null
}) {
  return (
    <article className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <strong className="font-mono text-xs">{item.author?.login || 'Unknown'}</strong>
          <Badge variant="outline" className={cn('font-mono text-xs', pullRequestStatusTone(item.state || label))}>
            {item.state || label}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{age(item.submittedAt || item.createdAt)}</span>
      </div>
      <PullRequestCommentBody
        author={item.author?.login}
        content={item.body || '_No written comment._'}
        linkBaseUrl={item.url || ''}
        referencePresentation={referencePresentation || undefined}
      />
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs text-blue-400 hover:underline">
          Open original <ExternalLink className="ml-1 size-3" />
        </a>
      )}
    </article>
  )
}

function InlineThreadLocation({ thread }: { thread: ReviewThread }) {
  const segments = thread.path.split('/')
  const fileName = segments.pop()
  const directory = segments.join('/')
  const line = reviewThreadLine(thread) ?? '?'
  const commentLabel = ['comments', 'comment'][Number(thread.comments.nodes.length === 1)]
  const directoryVisibility = { true: '', false: 'hidden' }[String(Boolean(directory)) as 'true' | 'false']
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background">
        <FileCode2 className="size-3.5 text-blue-500" />
      </span>
      <div className="min-w-0">
        <code className="block max-w-[11rem] truncate text-xs font-semibold leading-4 text-blue-500 sm:max-w-sm" title={thread.path}>
          {fileName}
        </code>
        <code
          className={cn('block max-w-[11rem] truncate text-xs text-muted-foreground sm:max-w-sm', directoryVisibility)}
          title={thread.path}
        >
          {directory}/
        </code>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Line {line} · {thread.comments.nodes.length} {commentLabel}
        </span>
      </div>
    </div>
  )
}

const diffLineTone: Record<ReviewDiffLine['kind'], string> = {
  addition: 'bg-emerald-500/[.07] text-success',
  deletion: 'bg-red-500/[.07] text-red-100',
  context: 'text-muted-foreground',
  header: 'bg-blue-500/[.06] text-blue-300',
  metadata: 'text-muted-foreground',
}

function ReviewThreadCodeContext({ thread }: { thread: ReviewThread }) {
  const lines = reviewThreadDiffLines(thread)
  if (!lines.length) return null
  return (
    <section className="border-b bg-muted/10 p-2.5 sm:p-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={thread.path}>
          {thread.path}
        </span>
        <Badge variant="outline" className="shrink-0 gap-1 text-xs">
          <FileCode2 className="size-3" />
          Annotated code
        </Badge>
      </div>
      <div className="max-w-full overflow-x-auto rounded-lg border bg-background [scrollbar-width:thin]">
        <pre className="min-w-max py-1 font-mono text-xs leading-5">
          {lines.map((line) => (
            <div
              key={line.key}
              className={cn(
                'grid grid-cols-[2.25rem_2.25rem_1rem_minmax(max-content,1fr)] px-1.5',
                diffLineTone[line.kind],
                line.highlighted && 'border-y border-amber-500/35 bg-amber-500/15 text-foreground',
              )}
            >
              <span className="select-none text-right text-muted-foreground/65">{line.oldLine ?? ''}</span>
              <span className="select-none text-right text-muted-foreground/65">{line.newLine ?? ''}</span>
              <span className="select-none text-center">{line.highlighted ? '●' : ''}</span>
              <code className="pl-2 pr-4">{line.content}</code>
            </div>
          ))}
        </pre>
      </div>
    </section>
  )
}

function resolutionAction(thread: ReviewThread) {
  const allowed = thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve
  if (!allowed) return null
  const resolved = !thread.isResolved
  return {
    label: { true: 'Resolve', false: 'Reopen' }[String(resolved) as 'true' | 'false'],
    resolved,
  }
}

function InlineThreadComment({ comment, continued }: { comment: Comment; continued: boolean }) {
  const login = [comment.author?.login, 'Unknown'].find(Boolean) as string
  const continuationVisibility = { true: '', false: 'hidden' }[String(continued) as 'true' | 'false']
  const linkVisibility = { true: '', false: 'hidden' }[String(Boolean(comment.url)) as 'true' | 'false']
  return (
    <div className="relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2.5 px-3 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:px-4">
      <div className="relative">
        <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-semibold uppercase text-secondary-foreground sm:size-9">
          {login.slice(0, 2)}
        </span>
        <span className={cn('absolute bottom-[-.75rem] left-1/2 top-9 w-px -translate-x-1/2 bg-border', continuationVisibility)} />
      </div>
      <div className="min-w-0 max-w-full overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <strong className="truncate text-xs">{login}</strong>
          <span className="shrink-0 text-xs text-muted-foreground">{age(comment.createdAt)}</span>
        </div>
        <PullRequestCommentBody
          author={comment.author?.login}
          content={comment.body}
          linkBaseUrl={comment.url}
          className="mt-2 min-w-0 max-w-full overflow-hidden text-sm [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:w-max [&_table]:max-w-none"
        />
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'mt-2 inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-blue-500 hover:bg-blue-500/10 hover:underline',
            linkVisibility,
          )}
        >
          Open original <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}

function InlineReplyComposer({ pr, thread, onPosted }: { pr: PullRequestDialogItem; thread: ReviewThread; onPosted: () => Promise<void> }) {
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const lastComment = thread.comments.nodes.at(-1)

  async function submitReply(event: React.FormEvent) {
    event.preventDefault()
    if (!lastComment?.databaseId) return
    setReplying(true)
    try {
      await api(`/api/pulls/${pr.repo_id}/${pr.number}/comments/${lastComment.databaseId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body: reply.trim() }),
      })
      await onPosted()
      setReply('')
      toast.success('Reply posted to source control')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setReplying(false)
    }
  }

  return (
    <form onSubmit={submitReply} className="border-t bg-muted/15 p-3">
      <Textarea
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        className="min-h-20 resize-y bg-background text-sm"
        maxLength={65_536}
        placeholder="Reply in this review thread…"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          <Reply className="mr-1 inline size-3" />
          Reply posts directly to source control.
        </span>
        <Button className="shrink-0" size="sm" disabled={replying || !reply.trim()}>
          {replying ? <Loader2 className="animate-spin" /> : <Send />}
          {replying ? 'Posting…' : 'Reply'}
        </Button>
      </div>
    </form>
  )
}

export function InlineReviewThread({
  pr,
  thread,
  onChanged,
  embedded = false,
}: {
  pr: PullRequestDialogItem
  thread: ReviewThread
  onChanged: () => Promise<void>
  embedded?: boolean
}) {
  const [resolving, setResolving] = useState(false)
  const action = resolutionAction(thread)

  async function changeResolution() {
    if (!action) return
    setResolving(true)
    try {
      await api(`/api/pulls/${pr.repo_id}/${pr.number}/threads/${encodeURIComponent(thread.id)}`, {
        method: 'POST',
        body: JSON.stringify({ resolved: action.resolved }),
      })
      await onChanged()
      toast.success(action.resolved ? 'Review thread resolved' : 'Review thread reopened')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setResolving(false)
    }
  }

  return (
    <article
      className={cn(
        'w-full min-w-0 max-w-full overflow-hidden rounded-xl border bg-background shadow-xs',
        embedded && 'my-2 rounded-lg shadow-none',
        !thread.isResolved && 'border-amber-500/25',
      )}
    >
      <header className="border-b bg-muted/30 px-3 py-2.5 sm:flex sm:items-center sm:justify-between sm:gap-3">
        <InlineThreadLocation thread={thread} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:mt-0 sm:shrink-0">
          <Badge
            variant="outline"
            className={cn('text-xs', thread.isResolved ? 'border-emerald-500/40 text-emerald-500' : 'border-amber-500/40 text-amber-500')}
          >
            {thread.isResolved ? 'Resolved' : 'Needs attention'}
          </Badge>
          {thread.isOutdated && (
            <Badge variant="secondary" className="text-xs">
              Outdated
            </Badge>
          )}
          {action && (
            <Button variant="ghost" size="xs" disabled={resolving} onClick={() => void changeResolution()}>
              {resolving ? <Loader2 className="animate-spin" /> : action.resolved && <Check />}
              {resolving ? 'Updating…' : action.label}
            </Button>
          )}
        </div>
      </header>
      {!embedded && <ReviewThreadCodeContext thread={thread} />}
      <div className="min-w-0 divide-y">
        {thread.comments.nodes.map((comment, index) => (
          <InlineThreadComment key={comment.id || index} comment={comment} continued={index < thread.comments.nodes.length - 1} />
        ))}
      </div>
      {thread.viewerCanReply && thread.comments.nodes.at(-1)?.databaseId && (
        <InlineReplyComposer pr={pr} thread={thread} onPosted={onChanged} />
      )}
    </article>
  )
}
