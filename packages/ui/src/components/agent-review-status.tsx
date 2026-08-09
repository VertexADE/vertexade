import { AlertTriangle, Check, Eye, Loader2 } from 'lucide-react'

import { Badge } from '@vertexade/ui/components/ui/badge'
import { Button } from '@vertexade/ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@vertexade/ui/components/ui/tooltip'
import { cn } from '@vertexade/ui/lib/utils'

export function AgentReviewStatusControls({
  currentHeadSha,
  reviewedHeadSha,
  reviewId,
  automatic = false,
  watching,
  busy = false,
  compact = false,
  onWatchChange,
}: {
  currentHeadSha: string
  reviewedHeadSha?: string | null
  reviewId?: number | null
  automatic?: boolean
  watching?: boolean
  busy?: boolean
  compact?: boolean
  onWatchChange?(): void
}) {
  const outdated = Boolean(reviewedHeadSha && reviewedHeadSha !== currentHeadSha)
  const watchLabel = watching ? 'Watching new commits' : 'Watch new commits'
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', compact && 'gap-1 lg:flex-nowrap')}>
      {reviewId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                compact && 'h-6 px-1.5 text-[10px]',
                outdated ? 'border-amber-500/40 text-amber-400' : 'border-emerald-500/40 text-emerald-400',
              )}
            >
              {outdated ? <AlertTriangle /> : <Check />}
              {outdated ? 'Out of date' : 'Current'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {outdated
              ? `Reviewed ${reviewedHeadSha?.slice(0, 7)}; PR is now ${currentHeadSha.slice(0, 7)}`
              : `Reviewed current commit ${currentHeadSha.slice(0, 7)}`}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {automatic ? (
        <Badge variant="secondary" className="font-mono text-[9px]">
          Automatic
        </Badge>
      ) : null}
      {onWatchChange ? (
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          aria-label={compact ? watchLabel : undefined}
          className={cn(watching && 'border-blue-500/40 text-blue-400', compact && 'size-7 px-0')}
          onClick={onWatchChange}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Eye />}
          <span className={cn(compact && 'sr-only')}>{watchLabel}</span>
        </Button>
      ) : watching !== undefined ? (
        <span className="text-[10px] text-muted-foreground">
          {watching ? 'Watching new commits for automatic review.' : 'New commits are not watched.'}
        </span>
      ) : null}
    </div>
  )
}
