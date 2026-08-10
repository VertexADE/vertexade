import type { ModuleAccent, ModuleCatalogEntry, ModuleCatalogIcon } from '@vertexade/platform-contracts'
import { createElement, forwardRef } from 'react'
import { Blocks, type LucideProps, type LucideIcon } from 'lucide-react'
import { activeBackendId, backendApiPath } from './backend-registry'

const iconComponents = new Map<string, LucideIcon>()

export function extensionBrowserAssetSource(source: string, backendId = activeBackendId()) {
  return source.startsWith('/api/extensions/') ? backendApiPath(source, backendId) : source
}

export function extensionIconSource(moduleId: string, asset: string, backendId = activeBackendId()) {
  void asset
  return extensionBrowserAssetSource(`/api/extensions/${encodeURIComponent(moduleId)}/catalog-icon`, backendId)
}

function brandLogo(icon: ModuleCatalogIcon, moduleId: string, backendId?: string): LucideIcon {
  const source = extensionIconSource(moduleId, icon.asset, backendId)
  const cached = iconComponents.get(source)
  if (cached) return cached
  const Logo = forwardRef<SVGSVGElement, LucideProps>(
    ({ className, size: _size, color: _color, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth, ...props }, ref) =>
      createElement(
        'svg',
        {
          ref,
          viewBox: '0 0 24 24',
          className: ['brightness-0 dark:invert', className].filter(Boolean).join(' '),
          'aria-hidden': true,
          focusable: false,
          ...props,
        },
        createElement('image', {
          href: source,
          width: 24,
          height: 24,
          preserveAspectRatio: 'xMidYMid meet',
        }),
      ),
  )
  Logo.displayName = `${moduleId}-brand-logo`
  const component = Logo as LucideIcon
  iconComponents.set(source, component)
  return component
}

const accentClasses: Record<ModuleAccent, { panel: string; icon: string; glow: string }> = {
  blue: {
    panel: 'border-blue-500/25',
    icon: 'bg-blue-500/12 text-blue-400',
    glow: 'from-blue-500/10',
  },
  cyan: {
    panel: 'border-cyan-500/25',
    icon: 'bg-cyan-500/12 text-cyan-400',
    glow: 'from-cyan-500/10',
  },
  emerald: {
    panel: 'border-emerald-500/25',
    icon: 'bg-emerald-500/12 text-emerald-400',
    glow: 'from-emerald-500/10',
  },
  amber: {
    panel: 'border-amber-500/25',
    icon: 'bg-amber-500/12 text-amber-400',
    glow: 'from-amber-500/10',
  },
  orange: {
    panel: 'border-orange-500/25',
    icon: 'bg-orange-500/12 text-orange-400',
    glow: 'from-orange-500/10',
  },
  rose: {
    panel: 'border-rose-500/25',
    icon: 'bg-rose-500/12 text-rose-400',
    glow: 'from-rose-500/10',
  },
  violet: {
    panel: 'border-violet-500/25',
    icon: 'bg-violet-500/12 text-violet-400',
    glow: 'from-violet-500/10',
  },
  slate: {
    panel: 'border-slate-500/25',
    icon: 'bg-slate-500/12 text-slate-300',
    glow: 'from-slate-500/10',
  },
}

export function extensionIcon(icon?: ModuleCatalogIcon, moduleId?: string, backendId?: string) {
  return icon && moduleId ? brandLogo(icon, moduleId, backendId) : Blocks
}

export function extensionAccent(accent?: ModuleAccent) {
  return accentClasses[accent || 'slate']
}

export function extensionPresentation(module: Pick<ModuleCatalogEntry, 'id' | 'catalog'>, backendId?: string) {
  return {
    Icon: extensionIcon(module.catalog?.icon, module.id, backendId),
    accent: extensionAccent(module.catalog?.accent),
  }
}
