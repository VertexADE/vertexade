import { Check, CircleDot, ExternalLink, ShieldAlert, ShieldCheck } from 'lucide-react'

import { MarkdownContent, type MarkdownContentProps } from '@vertexade/ui/components/markdown-content'
import { Status } from '@vertexade/ui/components/ui/status'
import { cn } from '@vertexade/ui/lib/utils'

type SonarQubeTone = 'success' | 'neutral' | 'danger'

export type SonarQubeMetric = {
  label: string
  value: string
  url: string
  tone: SonarQubeTone
}

export type SonarQubeCommentSummary = {
  gate: 'passed' | 'failed'
  analysisUrl: string
  issues: SonarQubeMetric[]
  measures: SonarQubeMetric[]
}

const sonarQubeAuthor = /^(?:sonarqubecloud|sonarqube-cloud|sonarcloud|sonarqube)(?:\[bot\])?$/i
const metricLink = /\[([^\]\n]+)]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)\s*$/

function metricTone(line: string): SonarQubeTone {
  if (/\/(?:failed|error)-\d+px\.png/i.test(line)) return 'danger'
  if (/\/passed-\d+px\.png/i.test(line)) return 'success'
  return 'neutral'
}

function metricParts(text: string) {
  const match = text.trim().match(/^([+-]?\d+(?:[.,]\d+)?%?)\s+(.+)$/)
  return match ? { value: match[1], label: match[2] } : null
}

function analysisUrl(body: string) {
  const details = body.match(/\[See analysis details(?: on [^\]]+)?]\((https?:\/\/[^\s)]+)\)/i)
  if (details) return details[1]
  return body.match(/https?:\/\/[^\s)]+\/dashboard\?[^\s)]+/i)?.[0] || ''
}

function commentMetrics(body: string) {
  const issues: SonarQubeMetric[] = []
  const measures: SonarQubeMetric[] = []
  let group: 'issues' | 'measures' | null = null
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    const heading = line.match(/^(?:#{1,6}\s*)?(Issues|Measures)\s*$/i)
    if (heading) {
      group = heading[1].toLowerCase() as 'issues' | 'measures'
      continue
    }
    if (!group) continue
    const link = line.match(metricLink)
    if (!link) continue
    const parts = metricParts(link[1])
    if (!parts) continue
    const metric = { ...parts, url: link[2], tone: metricTone(line) }
    const metrics = group === 'issues' ? issues : measures
    metrics.push(metric)
  }
  return { issues, measures }
}

function qualityGate(body: string) {
  const status = body.match(/Quality Gate\s+(passed|failed)/i)?.[1].toLowerCase()
  return status === 'passed' || status === 'failed' ? status : null
}

export function parseSonarQubeComment(author: string | undefined, body: string): SonarQubeCommentSummary | null {
  if (!author || !sonarQubeAuthor.test(author.trim())) return null
  const gate = qualityGate(body)
  const url = analysisUrl(body)
  if (!gate || !url) return null

  const { issues, measures } = commentMetrics(body)
  if (!issues.length && !measures.length) return null
  return {
    gate,
    analysisUrl: url,
    issues,
    measures,
  }
}

function MetricIcon({ tone }: { tone: SonarQubeTone }) {
  if (tone === 'success') return <Check className="size-3.5 text-success" aria-hidden="true" />
  if (tone === 'danger') return <ShieldAlert className="size-3.5 text-destructive" aria-hidden="true" />
  return <CircleDot className="size-3.5 text-muted-foreground" aria-hidden="true" />
}

function MetricGroup({ title, metrics }: { title: string; metrics: SonarQubeMetric[] }) {
  if (!metrics.length) return null
  return (
    <section className="min-w-0 px-3 py-2.5" aria-label={title}>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{title}</h4>
      <div className="space-y-0.5">
        {metrics.map((metric) => (
          <a
            key={`${metric.label}:${metric.url}`}
            href={metric.url}
            target="_blank"
            rel="noreferrer"
            className="group flex min-h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-xs transition-colors hover:bg-muted/60"
          >
            <MetricIcon tone={metric.tone} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">{metric.label}</span>
            {metric.value && <strong className="shrink-0 tabular-nums text-foreground">{metric.value}</strong>}
          </a>
        ))}
      </div>
    </section>
  )
}

export function SonarQubeComment({ summary, className }: { summary: SonarQubeCommentSummary; className?: string }) {
  const passed = summary.gate === 'passed'
  const gateLabel = passed ? 'Quality Gate passed' : 'Quality Gate failed'
  return (
    <section
      data-sonarqube-comment
      aria-label="SonarQube quality analysis"
      className={cn('min-w-0 overflow-hidden rounded-lg border bg-muted/[.08]', className)}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2.5 border-b px-3 py-2.5">
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md border',
            passed ? 'border-success/25 bg-success/10 text-success' : 'border-destructive/25 bg-destructive/10 text-destructive',
          )}
        >
          {passed ? <ShieldCheck className="size-4" aria-hidden="true" /> : <ShieldAlert className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{gateLabel}</strong>
          <span className="block text-xs text-muted-foreground">SonarQube analysis</span>
        </div>
        <Status tone={passed ? 'success' : 'danger'}>{passed ? 'Passed' : 'Failed'}</Status>
      </header>
      <div className="grid min-w-0 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <MetricGroup title="Issues" metrics={summary.issues} />
        <MetricGroup title="Measures" metrics={summary.measures} />
      </div>
      <footer className="border-t px-3 py-2">
        <a
          href={summary.analysisUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-blue-500 hover:bg-blue-500/10 hover:underline"
        >
          Open analysis <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </footer>
    </section>
  )
}

export function PullRequestCommentBody({ author, ...props }: MarkdownContentProps & { author?: string }) {
  const summary = parseSonarQubeComment(author, props.content)
  if (summary) return <SonarQubeComment summary={summary} className={props.className} />
  return <MarkdownContent {...props} />
}
