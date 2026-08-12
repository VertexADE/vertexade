import { History } from 'lucide-react'
import type { ImpactAnalysisListItem } from '@vertexade/platform-contracts'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'

const riskVariant = {
  low: 'outline',
  medium: 'secondary',
  high: 'destructive',
  unknown: 'secondary',
} as const

function revision(value: string): string {
  return value.slice(0, 8)
}

function timestamp(value: string | null): string {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime()) ? value || 'In progress' : date.toLocaleString()
}

export function ImpactAnalysisHistory({
  analyses,
  selectedId,
  loading,
  onSelect,
}: {
  analyses: ImpactAnalysisListItem[]
  selectedId: number | null
  loading: boolean
  onSelect(analysisId: number): void
}) {
  const selected = analyses.find((analysis) => analysis.id === selectedId) || analyses[0]
  if (!selected) return null

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" /> Analysis history
          <Badge variant="outline">{analyses.length} saved</Badge>
        </CardTitle>
        <CardDescription>Compare persisted, revision-bound snapshots as the work item evolves.</CardDescription>
        <CardAction>
          <Select value={String(selected.id)} disabled={loading} onValueChange={(value) => onSelect(Number(value))}>
            <SelectTrigger className="w-72 max-w-full" aria-label="Selected impact analysis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {analyses.map((analysis) => (
                <SelectItem key={analysis.id} value={String(analysis.id)}>
                  {timestamp(analysis.finishedAt || analysis.createdAt)} · {revision(analysis.subject.headRevision)} · {analysis.risk} risk
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={riskVariant[selected.risk]}>{selected.risk} risk</Badge>
        <span>{selected.changedFileCount} changed files</span>
        <span aria-hidden="true">·</span>
        <span>{selected.affectedProjectCount} affected projects</span>
        <span aria-hidden="true">·</span>
        <span>
          {revision(selected.subject.baseRevision)} → {revision(selected.subject.headRevision)}
        </span>
      </CardContent>
    </Card>
  )
}
