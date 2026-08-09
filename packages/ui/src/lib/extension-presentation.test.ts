import { describe, expect, it } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Blocks } from 'lucide-react'
import { extensionAccent, extensionIcon, extensionIconSource, extensionPresentation } from './extension-presentation'

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

  it('renders the extension-owned vector asset without a hardcoded icon registry', () => {
    const Icon = extensionIcon({ asset: 'assets/icon.svg' }, 'airtable')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    expect(markup).toContain('href="/api/extensions/airtable/catalog-icon"')
    expect(markup).toContain('brightness-0 dark:invert')
    expect(markup).not.toContain('https://')
  })

  it('returns the manifest accent with a safe default', () => {
    expect(extensionAccent('violet').icon).toContain('violet')
    expect(extensionPresentation({ id: 'unknown', catalog: undefined }).accent.icon).toContain('slate')
  })
})
