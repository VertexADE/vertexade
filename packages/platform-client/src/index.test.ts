import { describe, expect, it, vi } from 'vite-plus/test'
import type { PortableCollectionSurface, PortableSettingsSurface } from '@vertexade/platform-contracts'
import {
  createPlatformClient,
  extensionApiPath,
  normalizePlatformBaseUrl,
  PlatformApiError,
  PlatformAuthenticationError,
  PlatformDecodeError,
  PlatformNetworkError,
  type PlatformFetch,
} from './index.ts'

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

describe('platform client', () => {
  it('normalizes server URLs and scopes extension paths', () => {
    expect(normalizePlatformBaseUrl(' https://vertexade.test/// ')).toBe('https://vertexade.test')
    expect(extensionApiPath('airtable records', '/items?view=all')).toBe('/api/extensions/airtable%20records/items?view=all')
    expect(() => normalizePlatformBaseUrl('file:///tmp/api')).toThrow('HTTP or HTTPS')
    expect(() => extensionApiPath('airtable', '/../settings')).toThrow('cannot traverse directories')
    expect(() => extensionApiPath('airtable', '/%2e%2e/settings')).toThrow('cannot traverse directories')
    expect(() => extensionApiPath('airtable', '//unexpected.test/settings')).toThrow('same-origin')
  })

  it('lists modules through the configured platform origin', async () => {
    const fetch = vi.fn<PlatformFetch>(async () => json({ platformApi: 1, platformFeatures: [], modules: [], diagnostics: [] }))
    const client = createPlatformClient({ baseUrl: 'https://vertexade.test/', fetch })

    await expect(client.modules.list()).resolves.toMatchObject({ modules: [] })
    expect(fetch).toHaveBeenCalledWith('https://vertexade.test/api/modules', expect.objectContaining({ method: 'GET' }))
  })

  it('merges runtime headers and attaches optional bearer authentication', async () => {
    const fetch = vi.fn<PlatformFetch>(async () => json({ ok: true }))
    const client = createPlatformClient({
      fetch,
      headers: ({ method }) => ({ 'x-client': 'shared', 'x-method': method }),
      getAccessToken: async () => 'mobile-session',
      credentials: 'include',
    })

    await client.request('/api/test', {
      method: 'POST',
      headers: { 'x-client': 'override' },
      body: '{}',
    })
    const init = fetch.mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer mobile-session')
    expect(headers.get('x-client')).toBe('override')
    expect(headers.get('x-method')).toBe('POST')
    expect(init?.credentials).toBe('include')
  })

  it('does not force JSON content headers onto raw extension responses', async () => {
    const fetch = vi.fn<PlatformFetch>(async () => new Response('archive'))
    const client = createPlatformClient({ fetch })

    await client.extension('reports').fetch('/export')
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers)
    expect(headers.has('accept')).toBe(false)
    expect(headers.has('content-type')).toBe(false)
  })

  it('fails before transport when required authentication is missing', async () => {
    const fetch = vi.fn()
    const client = createPlatformClient({ fetch, getAccessToken: () => null })

    await expect(client.request('/api/private', { auth: 'required' })).rejects.toBeInstanceOf(PlatformAuthenticationError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns structured HTTP errors', async () => {
    const client = createPlatformClient({
      fetch: async () =>
        json(
          { error: 'Not allowed', code: 'forbidden', details: { scope: 'work.read' } },
          {
            status: 403,
            headers: { 'x-request-id': 'request-42' },
          },
        ),
    })

    const error = await client.request('/api/private').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(PlatformApiError)
    expect(error).toMatchObject({
      message: 'Not allowed',
      status: 403,
      code: 'forbidden',
      details: { scope: 'work.read' },
      requestId: 'request-42',
      path: '/api/private',
    })
  })

  it('distinguishes invalid JSON and network failures', async () => {
    const invalid = createPlatformClient({
      fetch: async () => new Response('<html>', { status: 200 }),
    })
    await expect(invalid.request('/api/test')).rejects.toBeInstanceOf(PlatformDecodeError)

    const offline = createPlatformClient({
      fetch: async () => {
        throw new Error('offline')
      },
    })
    await expect(offline.request('/api/test')).rejects.toBeInstanceOf(PlatformNetworkError)
  })

  it('loads and mutates portable surfaces through one scoped extension client', async () => {
    const fetch = vi.fn<PlatformFetch>(async () => json({ ok: true }))
    const extension = createPlatformClient({ baseUrl: 'https://vertexade.test', fetch }).extension('airtable')
    const surface = {
      contractVersion: 1,
      id: 'records',
      kind: 'collection',
      title: 'Records',
      source: { path: '/records', itemsPath: 'items' },
      item: {
        idPath: 'id',
        titlePath: 'title',
        fieldsPath: 'fields',
        fieldNamePath: 'name',
        fieldValuePath: 'value',
      },
      views: { list: true },
    } satisfies PortableCollectionSurface
    const action = {
      id: 'start',
      label: 'Start',
      method: 'POST',
      path: '/records/{id}/start',
    } as const

    await extension.loadSurface(surface)
    await extension.executeAction(action, 'rec/42', { notify: true })
    await extension.executeAction(
      {
        id: 'create',
        label: 'Create',
        method: 'POST',
        path: '/records',
        inputs: [{ name: 'title', label: 'Title', type: 'text', bodyPath: ['fields', 'Title'] }],
      },
      undefined,
      { title: 'Portable' },
    )

    expect(fetch.mock.calls[0]?.[0]).toBe('https://vertexade.test/api/extensions/airtable/records')
    expect(fetch.mock.calls[1]?.[0]).toBe('https://vertexade.test/api/extensions/airtable/records/rec%2F42/start')
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{"notify":true}' })
    expect(fetch.mock.calls[2]?.[0]).toBe('https://vertexade.test/api/extensions/airtable/records')
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: '{"fields":{"Title":"Portable"}}',
    })
  })

  it('loads, saves, discovers, and resets portable settings through the same client', async () => {
    const fetch = vi.fn<PlatformFetch>(async () => json({ configured: true }))
    const extension = createPlatformClient({ baseUrl: 'https://vertexade.test', fetch }).extension('linear')
    const settings = {
      contractVersion: 1,
      id: 'settings',
      title: 'Linear',
      source: { path: '/settings', configuredPath: 'configured' },
      fields: [
        {
          name: 'apiKey',
          label: 'API key',
          type: 'password',
          valuePath: 'api_key',
          storedPath: 'has_api_key',
        },
        {
          name: 'teamIds',
          label: 'Teams',
          type: 'multiselect',
          valuePath: 'team_ids',
          optionsPath: 'teams',
          optionValuePath: 'id',
          optionLabelPath: 'name',
        },
      ],
      submit: { method: 'POST', path: '/settings', label: 'Save' },
      actions: [
        {
          id: 'discover',
          label: 'Discover',
          method: 'POST',
          path: '/discover',
          intent: 'discover',
          includeFields: ['apiKey'],
        },
        { id: 'reset', label: 'Reset', method: 'DELETE', path: '/settings', intent: 'reset' },
      ],
    } satisfies PortableSettingsSurface

    await extension.loadSettings(settings)
    await extension.saveSettings(settings, { apiKey: 'secret', teamIds: ['team-1'] })
    await extension.executeSettingsAction(settings, settings.actions![0]!, {
      apiKey: 'secret',
      teamIds: ['team-1'],
    })
    await extension.executeSettingsAction(settings, settings.actions![1]!)

    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['https://vertexade.test/api/extensions/linear/settings', 'GET', undefined],
      ['https://vertexade.test/api/extensions/linear/settings', 'POST', '{"apiKey":"secret","teamIds":["team-1"]}'],
      ['https://vertexade.test/api/extensions/linear/discover', 'POST', '{"apiKey":"secret"}'],
      ['https://vertexade.test/api/extensions/linear/settings', 'DELETE', undefined],
    ])
  })
})
