import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ArchitectureContextPacket } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vertexade/ui/components/ui/empty'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import { api } from '@vertexade/ui/lib/dashboard-api'

type ArchitectureContextPanelProps = {
  repositoryId: number
  pullRequestNumber: number
}

function shortRevision(value: string): string {
  return value.slice(0, 8)
}

function ContextLoading() {
  return (
    <Card aria-label="Loading architecture context">
      <CardHeader>
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </CardContent>
    </Card>
  )
}

export function ArchitectureContextView({
  packet,
  generating,
  onGenerate,
}: {
  packet: ArchitectureContextPacket
  generating: boolean
  onGenerate(): void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Architecture context
          <Badge variant={packet.freshness === 'stale' ? 'destructive' : 'outline'}>{packet.freshness}</Badge>
          {packet.truncated && <Badge variant="secondary">Budget limited</Badge>}
        </CardTitle>
        <CardDescription>
          {shortRevision(packet.revision)} · {packet.facts.length} facts · {packet.citations.length} source citations ·{' '}
          {packet.estimatedBytes.toLocaleString()} of {packet.byteBudget.toLocaleString()} bytes
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={generating} onClick={onGenerate}>
            <RefreshCw data-icon="inline-start" />
            {generating ? 'Rebuilding…' : 'Rebuild'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 md:grid-cols-2">
          {packet.facts.map((fact) => (
            <div key={fact.node.key} className="rounded-md border bg-muted/20 p-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <strong className="truncate text-sm">{fact.node.label}</strong>
                <Badge variant="outline">{fact.node.kind}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{fact.reason}</p>
              {fact.node.path && <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{fact.node.path}</p>}
            </div>
          ))}
        </div>
        {packet.decisions.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="architecture-decisions-title">
            <h3 id="architecture-decisions-title" className="text-sm font-semibold">
              Relevant decisions
            </h3>
            {packet.decisions.map((decision) => (
              <div key={`${decision.id}:${decision.citation.path}`} className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block truncate text-sm">{decision.title}</strong>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{decision.citation.path}</span>
                </div>
                <Badge variant="secondary">{decision.status}</Badge>
              </div>
            ))}
          </section>
        )}
        {packet.warnings.length > 0 && (
          <section className="flex flex-col gap-2" aria-labelledby="architecture-warnings-title">
            <h3 id="architecture-warnings-title" className="text-sm font-semibold">
              Context limitations
            </h3>
            {packet.warnings.map((warning, index) => (
              <p key={`${warning.code}:${warning.path || index}`} className="text-xs text-muted-foreground">
                {warning.message}
              </p>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  )
}

export function ArchitectureContextPanel({ repositoryId, pullRequestNumber }: ArchitectureContextPanelProps) {
  const [packet, setPacket] = useState<ArchitectureContextPacket | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const endpoint = useMemo(() => `/api/pulls/${repositoryId}/${pullRequestNumber}/architecture-context`, [pullRequestNumber, repositoryId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ packet: ArchitectureContextPacket | null }>(endpoint)
      setPacket(result.packet)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    setPacket(null)
    void load()
  }, [load])

  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const value = await api<ArchitectureContextPacket>(endpoint, {
        method: 'POST',
        body: '{}',
      })
      setPacket(value)
      toast.success('Architecture context rebuilt')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setGenerating(false)
    }
  }, [endpoint])

  if (loading && !packet) return <ContextLoading />
  if (!packet)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>No architecture context for this revision</EmptyTitle>
          <EmptyDescription>
            Build a cited packet from package boundaries, contracts, deployment configuration, architecture documents, and decisions.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={generating} onClick={() => void generate()}>
            <RefreshCw data-icon="inline-start" />
            {generating ? 'Building…' : 'Build architecture context'}
          </Button>
        </EmptyContent>
      </Empty>
    )
  return <ArchitectureContextView packet={packet} generating={generating} onGenerate={() => void generate()} />
}
