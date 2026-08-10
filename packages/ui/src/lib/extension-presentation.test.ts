import { describe, expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Blocks } from 'lucide-react'
import {
  extensionAccent,
  extensionBrowserAssetSource,
  extensionIcon,
  extensionIconSource,
  extensionPresentation,
} from './extension-presentation'

describe('extension presentation', () => {
  it('resolves the icon declared by the extension catalog', () => {
    expect(extensionIcon({ asset: 'assets/icon.svg' }, 'airtable').displayName).toBe('airtable-brand-logo')
  })

  it('falls back to the generic extension icon when the manifest has no icon', () => {
    expect(extensionIcon(undefined, 'sentry')).toBe(Blocks)
  })

  it('derives the asset URL from generic manifest metadata', () => {
    expect(extensionIconSource('example-extension', 'assets/brand icon.svg')).toBe('/api/extensions/example-extension/catalog-icon')
  })

  it('pins headerless extension assets to their owning backend', () => {
    expect(extensionIconSource('example-extension', 'assets/brand icon.svg', 'team server')).toBe(
      '/api/backends/team%20server/extensions/example-extension/catalog-icon',
    )
    expect(extensionBrowserAssetSource('/api/extensions/azure-devops/avatar?user=ada', 'team')).toBe(
      '/api/backends/team/extensions/azure-devops/avatar?user=ada',
    )
    expect(extensionBrowserAssetSource('https://images.example.test/ada.png', 'team')).toBe('https://images.example.test/ada.png')
  })

  it('renders the extension-owned vector asset without a hardcoded icon registry', () => {
    const Icon = extensionIcon({ asset: 'assets/icon.svg' }, 'airtable')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    expect(markup).toContain('href="/api/extensions/airtable/catalog-icon"')
    expect(markup).toContain('brightness-0 dark:invert')
    expect(markup).not.toContain('https://')
  })

  it('renders a backend-scoped vector asset for a remote catalog', () => {
    const Icon = extensionIcon({ asset: 'assets/icon.svg' }, 'airtable', 'team')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    expect(markup).toContain('href="/api/backends/team/extensions/airtable/catalog-icon"')
  })

  it('returns the manifest accent with a safe default', () => {
    expect(extensionAccent('violet').icon).toContain('violet')
    expect(extensionPresentation({ id: 'unknown', catalog: undefined }).accent.icon).toContain('slate')
  })
})
