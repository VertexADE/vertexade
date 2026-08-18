import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Blocks } from 'lucide-react'
import {
  extensionAccent,
  extensionBrowserAssetSource,
  fetchExtensionIconAsset,
  extensionIcon,
  extensionIconSource,
  extensionPresentation,
} from './extension-presentation'
import { browserPairedServersHeaderName } from './browser-paired-servers'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('does not load extension assets through an image request that cannot carry pairing headers', () => {
    const Icon = extensionIcon({ asset: 'assets/icon.svg' }, 'airtable')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    expect(markup).not.toContain('/api/extensions/airtable/catalog-icon')
    expect(markup).toContain('data-extension-icon-loading="true"')
  })

  it('does not server-render a remote asset request without its browser credential', () => {
    const Icon = extensionIcon({ asset: 'assets/icon.svg' }, 'airtable', 'team')
    const markup = renderToStaticMarkup(createElement(Icon, { className: 'size-4' }))
    expect(markup).not.toContain('/api/backends/team/extensions/airtable/catalog-icon')
  })

  it('fetches icon assets with pairing metadata and rejects non-SVG responses', async () => {
    const localStorage = {
      getItem: () => JSON.stringify([{ id: 'team', name: 'Team', serviceUrl: 'https://team.test', namespace: 7, sessionToken: 'secret' }]),
    }
    vi.stubGlobal('localStorage', localStorage)
    const request = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    const asset = await fetchExtensionIconAsset('/api/backends/team/extensions/airtable/catalog-icon', request)
    expect(asset).toBeInstanceOf(Blob)
    expect(request).toHaveBeenCalledWith(
      '/api/backends/team/extensions/airtable/catalog-icon',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'image/svg+xml', [browserPairedServersHeaderName]: expect.any(String) }),
      }),
    )
    await expect(
      fetchExtensionIconAsset('/api/backends/team/extensions/broken/catalog-icon', async () => Response.json({ error: 'missing' })),
    ).resolves.toBeNull()
  })

  it('returns the manifest accent with a safe default', () => {
    expect(extensionAccent('violet').icon).toContain('violet')
    expect(extensionPresentation({ id: 'unknown', catalog: undefined }).accent.icon).toContain('slate')
  })
})
