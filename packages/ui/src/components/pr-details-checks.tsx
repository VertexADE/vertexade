import { ExternalLink, GitCommit, GitPullRequest } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { ScrollArea } from '@vertexade/ui/components/ui/scroll-area'
import { age } from '@vertexade/ui/lib/dashboard-api'
import { cn } from '@vertexade/ui/lib/utils'
import type { CheckResult, PullRequestDetails } from './pr-details-model'
import { pullRequestStatusTone } from './pr-details-status'

export default function PullRequestStatusTab({
  tab,
  details,
  embedded,
}: {
  tab: 'checks' | 'commits'
  details: PullRequestDetails
  embedded: boolean
}) {
  return tab === 'checks' ? (
    <PullRequestChecks details={details} embedded={embedded} />
  ) : (
    <PullRequestCommits details={details} embedded={embedded} />
  )
}

export function PullRequestChecks({ details, embedded }: { details: PullRequestDetails; embedded: boolean }) {
  const content = (
    <section className="mx-auto max-w-4xl p-3 sm:p-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <GitPullRequest className="size-4" />
        Checks ({details.statusCheckRollup.length})
      </h3>
      <div className="space-y-2">
        {details.statusCheckRollup.map((check, index) => (
          <PullRequestCheck key={`${check.name || check.context}-${index}`} check={check} />
        ))}
        {!details.statusCheckRollup.length && (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No checks reported.</p>
        )}
      </div>
    </section>
  )
  return embedded ? content : <ScrollArea className="h-[72vh]">{content}</ScrollArea>
}

function PullRequestCheck({ check }: { check: CheckResult }) {
  const status = firstText([check.conclusion, check.state, check.status], 'UNKNOWN')
  const url = firstText([check.detailsUrl, check.targetUrl])
  const name = firstText([check.name, check.context], 'Check')
  const source = firstText([check.workflowName, check.__typename])
  return (
    <article className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
      <div className="min-w-0">
        <strong className="block truncate text-sm">{name}</strong>
        <span className="text-xs text-muted-foreground">{source}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={pullRequestStatusTone(status)}>
          {status}
        </Badge>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${name} check details`}>
            <ExternalLink className="size-4 text-muted-foreground" />
          </a>
        ) : null}
      </div>
    </article>
  )
}

function firstText(values: Array<string | undefined>, fallback = '') {
  return values.find((value) => Boolean(value)) || fallback
}

export function PullRequestCommits({ details, embedded }: { details: PullRequestDetails; embedded: boolean }) {
  const content = (
    <section className="mx-auto max-w-4xl p-3 sm:p-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <GitCommit className="size-4" />
        Commits ({details.commits.length})
      </h3>
      <div className="space-y-2">
        {details.commits.map((commit) => (
          <article key={commit.oid} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <strong className="min-w-0 break-words text-sm leading-snug">{commit.messageHeadline}</strong>
              <code className="shrink-0 text-xs text-blue-400">{commit.oid.slice(0, 7)}</code>
            </div>
            {commit.messageBody && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{commit.messageBody}</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {commit.authors.map((author) => author.login || author.name).join(', ')} · {age(commit.committedDate)}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
  return embedded ? content : <ScrollArea className="h-[72vh]">{content}</ScrollArea>
}
