import type { ModuleAccent, ModuleCatalogEntry, ModuleCatalogIcon } from '@vertexade/platform-contracts'
import { createElement, forwardRef, useEffect, useState } from 'react'
import { Blocks, type LucideProps, type LucideIcon } from 'lucide-react'
import { backendApiPath } from './backend-registry'
import { browserPairedServersRequestHeaders } from './browser-paired-servers'

const iconComponents = new Map<string, LucideIcon>()
const iconAssetRequests = new Map<string, Promise<Blob | null>>()

export function extensionBrowserAssetSource(source: string, backendId = '') {
  return source.startsWith('/api/extensions/') ? backendApiPath(source, backendId) : source
}

export function extensionIconSource(moduleId: string, asset: string, backendId = '') {
  void asset
  return extensionBrowserAssetSource(`/api/extensions/${encodeURIComponent(moduleId)}/catalog-icon`, backendId)
}

export async function fetchExtensionIconAsset(source: string, request = globalThis.fetch) {
  try {
    const response = await request(source, {
      headers: { accept: 'image/svg+xml', ...browserPairedServersRequestHeaders() },
    })
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('image/svg+xml')) return null
    return response.blob()
  } catch {
    return null
  }
}

function iconAsset(source: string) {
  const cached = iconAssetRequests.get(source)
  if (cached) return cached
  const request = fetchExtensionIconAsset(source).then((asset) => {
    if (!asset) iconAssetRequests.delete(source)
    return asset
  })
  iconAssetRequests.set(source, request)
  return request
}

function BrandAsset({ source }: { source: string }) {
  const [assetSource, setAssetSource] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    let objectUrl = ''
    void iconAsset(source).then((asset) => {
      if (!mounted || !asset) return
      objectUrl = URL.createObjectURL(asset)
      setAssetSource(objectUrl)
    })
    return () => {
      mounted = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])
  if (!assetSource)
    return createElement('path', {
      d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
      fill: 'currentColor',
      'data-extension-icon-loading': true,
    })
  return createElement('image', {
    href: assetSource,
    width: 24,
    height: 24,
    preserveAspectRatio: 'xMidYMid meet',
  })
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
        createElement(BrandAsset, { source }),
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
