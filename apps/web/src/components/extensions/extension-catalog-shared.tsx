import type { KnownModuleCatalogCategory, ModuleCatalogCategory, ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { AlertTriangle, Check } from 'lucide-react'
import { Badge } from '@vertexade/ui/components/ui/badge'
import { cn } from '@vertexade/ui/lib/utils'

const categoryLabels: Record<KnownModuleCatalogCategory, string> = {
  'source-control': 'Source control',
  planning: 'Planning',
  quality: 'Code quality',
  observability: 'Observability',
  automation: 'Automation',
  data: 'Data',
  other: 'Other',
}

export function categoryLabel(category: ModuleCatalogCategory) {
  return (
    categoryLabels[category as KnownModuleCatalogCategory] ||
    category
      .split('-')
      .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
      .join(' ')
  )
}

const lifecycleLabels: Record<ModuleCatalogEntry['lifecycle'], string> = {
  disabled: 'Available',
  'setup-required': 'Needs configuration',
  degraded: 'Needs attention',
  ready: 'Active',
  failed: 'Unavailable',
}

export function LifecycleBadge({ module }: { module: ModuleCatalogEntry }) {
  const alert = module.lifecycle === 'setup-required' || module.lifecycle === 'degraded' || module.lifecycle === 'failed'
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-border/80 bg-background/70',
        module.lifecycle === 'ready' && 'border-emerald-500/35 text-emerald-400',
        alert && 'border-amber-500/35 text-amber-400',
      )}
    >
      {module.lifecycle === 'ready' ? (
        <Check className="size-3" />
      ) : alert ? (
        <AlertTriangle className="size-3" />
      ) : (
        <span className="size-1.5 rounded-full bg-muted-foreground" />
      )}
      {lifecycleLabels[module.lifecycle]}
    </Badge>
  )
}
