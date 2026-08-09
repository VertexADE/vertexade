import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { loadModulePlatform } from '../platform/load-platform.ts'
import type { DashboardExtensionHostServices } from './host-services.ts'
import { ExtensionCacheStore } from './cache.ts'

function testHost(
  initialSettings: Record<string, unknown> = {},
  onEvent: (reason: string, id?: number | null) => void = () => undefined,
): DashboardExtensionHostServices {
  const legacyModuleIds: Record<string, string> = {
    airtable: 'airtable',
    azure_devops: 'azure-devops',
    github_app: 'github',
    sentry: 'sentry',
    sonarqube: 'sonarqube',
  }
  const settings = new Map<string, unknown>(
    Object.entries(initialSettings).map(([name, value]) => [`extension:${legacyModuleIds[name] || name}:config`, value]),
  )
  let scmAuthentication = {
    source: 'test',
    connected: true,
    error: '',
    expiresAt: null as string | null,
  }
  return {
    settings: {
      read: (name, fallback) => (settings.has(name) ? settings.get(name) : fallback) as never,
      write: (name, value) => {
        settings.set(name, value)
      },
      delete: (name) => {
        settings.delete(name)
      },
      has: (name) => settings.has(name),
    },
    repositories: { get: () => null, list: () => [] },
    tasks: {
      launch: async () => ({}),
      followUpInWorktree: async () => ({
        workItem: {
          id: 1,
          key: 'W-0001',
          title: 'Follow-up',
          description: '',
          kind: 'implementation',
          state: 'active',
          priority: 'normal',
        },
        destinationJobId: 2,
        transferId: 1,
        status: 'running',
      }),
      plan: async () => ({}),
      refinePlan: async () => ({}),
      planningJob: () => null,
    },
    events: { emit: onEvent },
    network: { fetch: (input, init) => globalThis.fetch(input, init) },
    cache: new ExtensionCacheStore(),
    scmAuthentication: {
      state: () => scmAuthentication,
      useToken: (source, _token, expiresAt = null) => {
        scmAuthentication = { source, connected: true, error: '', expiresAt }
      },
      restore: () => {
        scmAuthentication = { source: 'test', connected: true, error: '', expiresAt: null }
      },
      clearCachedUser: () => undefined,
      fail: (source, error) => {
        scmAuthentication = { source, connected: false, error: String(error), expiresAt: null }
      },
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('extension discovery', () => {
  it('discovers every installed extension directory', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost(),
    })
    const agents = extensions.agents
    expect(extensions.catalog().find(({ id }) => id === 'acp')?.lifecycle).toBe('setup-required')
    expect(agents.capabilities().map(({ id }) => id)).toEqual(['acp', 'claude-code', 'codex', 'opencode'])
    expect(extensions.capabilities().map(({ id, enabled }) => ({ id, enabled }))).toEqual([
      { id: 'acp', enabled: true },
      { id: 'airtable', enabled: true },
      { id: 'azure-devops', enabled: true },
      { id: 'claude-code', enabled: true },
      { id: 'coderabbit', enabled: true },
      { id: 'codex', enabled: true },
      { id: 'github', enabled: true },
      { id: 'linear', enabled: true },
      { id: 'opencode', enabled: true },
      { id: 'sentry', enabled: true },
      { id: 'sonarqube', enabled: true },
    ])
    expect(extensions.providers.records.require('airtable').name).toBe('Airtable')
    expect(extensions.providers.workManagement.get('azure-devops')?.name).toBe('Azure DevOps')
    expect(extensions.providers.scm.get('github')?.name).toBe('GitHub')
    expect(extensions.providers.findings.get('sentry')?.name).toBe('Sentry')
    expect(extensions.providers.findings.get('sonarqube')?.name).toBe('SonarQube')
    expect(extensions.providers.findings.get('coderabbit')?.name).toBe('CodeRabbit')
    expect(extensions.providers.workManagement.get('linear')?.name).toBe('Linear')
    for (const module of extensions.capabilities()) {
      const packageJson = JSON.parse(await readFile(resolve(root, 'packages', 'extensions', module.id, 'package.json'), 'utf8')) as {
        version: string
      }
      expect(module.version, `${module.id} manifest version`).toBe(packageJson.version)
      expect(module.installation.checksum).toMatch(/^[a-f0-9]{64}$/)
      if (module.portable)
        expect(Boolean(module.portable.surfaces.length || module.portable.settings), `${module.id} contribution must be portable`).toBe(
          true,
        )
    }
    const unified = new Set(['airtable', 'azure-devops', 'coderabbit', 'linear', 'sentry', 'sonarqube'])
    const portableModules = extensions.capabilities().filter((module) => unified.has(module.id))
    expect(portableModules.every((module) => Boolean(module.portable?.surfaces.length) && Boolean(module.portable?.settings))).toBe(true)
    expect(
      Object.fromEntries(
        portableModules.map((module) => [
          module.id,
          {
            item: module.portable?.surfaces[0]?.actions?.map((action) => action.id) || [],
            collection: module.portable?.surfaces[0]?.collectionActions?.map((action) => action.id) || [],
          },
        ]),
      ),
    ).toEqual({
      airtable: { item: ['start-work'], collection: [] },
      'azure-devops': { item: ['start-work', 'change-state'], collection: [] },
      coderabbit: { item: ['start-work', 'request-review'], collection: [] },
      linear: { item: ['start-work', 'change-state'], collection: ['create-issue'] },
      sentry: { item: ['start-work'], collection: [] },
      sonarqube: { item: ['start-work'], collection: [] },
    })
    expect(extensions.contributions.actions.require('sentry.remediate').moduleId).toBe('sentry')
    expect(extensions.contributions.triggers.capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'github.deployments-refreshed', moduleId: 'github' }),
        expect.objectContaining({ id: 'linear.board-refreshed', moduleId: 'linear' }),
        expect.objectContaining({ id: 'azure-devops.board-refreshed', moduleId: 'azure-devops' }),
        expect.objectContaining({ id: 'sentry.findings-refreshed', moduleId: 'sentry' }),
        expect.objectContaining({ id: 'sonarqube.findings-refreshed', moduleId: 'sonarqube' }),
        expect.objectContaining({ id: 'coderabbit.findings-refreshed', moduleId: 'coderabbit' }),
      ]),
    )

    const airtableIcon = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/airtable/assets/icon.svg'))
    expect(airtableIcon?.status).toBe(200)
    expect(airtableIcon?.headers.get('content-type')).toContain('image/svg+xml')
    expect(await airtableIcon?.text()).toContain('<svg')
    const proxiedAirtableIcon = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/airtable/catalog-icon'))
    expect(proxiedAirtableIcon?.status).toBe(200)
    expect(proxiedAirtableIcon?.headers.get('content-type')).toContain('image/svg+xml')

    const codexSettings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/codex/settings'))
    expect(await codexSettings?.json()).toEqual({
      agent: { id: 'codex', name: 'Codex', variables: [] },
    })
    const savedCodexSettings = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/codex/settings', {
        method: 'POST',
        body: JSON.stringify({ variables: [{ name: 'OPENAI_API_KEY', value: 'secret' }] }),
      }),
    )
    expect(await savedCodexSettings?.json()).toEqual({
      agent: {
        id: 'codex',
        name: 'Codex',
        variables: [{ name: 'OPENAI_API_KEY', has_value: true }],
      },
    })
    expect(agents.require('codex').environment?.()).toEqual({ OPENAI_API_KEY: 'secret' })
    extensions.enable('codex', false)
    expect(() => agents.require('codex')).toThrow('Codex agent is disabled')
    extensions.enable('codex', true)

    const acpSettings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/acp/settings'))
    expect(await acpSettings?.json()).toEqual({
      configured: false,
      harnesses: [
        {
          id: 'default',
          agent_id: 'acp',
          name: 'ACP Agent',
          command: '',
          args: [],
          permission_policy: 'approve',
          active: true,
          variables: [],
        },
      ],
      registry_agent_ids: [],
      protocol_version: 1,
    })
    const savedAcpSettings = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/acp/harnesses', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Gemini',
          command: 'gemini',
          args: ['--experimental-acp'],
          permission_policy: 'deny',
        }),
      }),
    )
    expect(await savedAcpSettings?.json()).toMatchObject({
      harnesses: [
        {
          id: 'default',
          command: 'gemini',
          args: ['--experimental-acp'],
          permission_policy: 'deny',
        },
      ],
    })
    expect(agents.require('acp').launch({ cwd: '/tmp', prompt: 'hello' }).args).toEqual(expect.arrayContaining(['--command', 'gemini']))
    await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/acp/harnesses', {
        method: 'POST',
        body: JSON.stringify({ id: 'kimi', name: 'Kimi', command: 'kimi', active: true }),
      }),
    )
    expect(agents.capabilities()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'acp', name: 'Gemini', selectable: true }),
        expect.objectContaining({ id: 'acp:kimi', name: 'Kimi', selectable: true }),
      ]),
    )
    expect(agents.require('acp:kimi').launch({ cwd: '/tmp', prompt: 'hello' }).args).toEqual(expect.arrayContaining(['--command', 'kimi']))

    const settings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/airtable/settings'))
    expect(settings?.status).toBe(200)
    expect(await settings?.json()).toMatchObject({ configured: false })

    extensions.enable('sentry', false)
    const disabledSettings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sentry/settings'))
    expect(disabledSettings?.status).toBe(200)
    const disabledBoard = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sentry/findings'))
    expect(disabledBoard?.status).toBe(404)
  })

  it('exposes Sentry issue details and guards unconfigured detail providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json({
          id: '42',
          shortId: 'API-42',
          title: 'Checkout failed',
          culprit: 'checkout.submit',
          level: 'error',
          status: 'unresolved',
          project: { slug: 'checkout' },
          count: '3',
          userCount: 2,
        }),
      ),
    )
    const root = resolve(import.meta.dirname, '../../../../..')
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost({
        sentry: {
          url: 'https://sentry.example',
          organization: 'acme',
          project: '',
          token: 'secret',
        },
      }),
    })

    const refreshEvents: Array<{ data?: unknown }> = []
    await extensions.contributions.triggers.require('sentry.findings-refreshed').subscribe((event) => refreshEvents.push(event))
    const sentryDetails = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sentry/findings/42'))
    expect(sentryDetails?.status).toBe(200)
    expect(await sentryDetails?.json()).toMatchObject({
      id: '42',
      key: 'API-42',
      project: 'checkout',
      count: 3,
      users: 2,
    })
    const initialFetches = vi.mocked(fetch).mock.calls.length
    await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sentry/findings/42'))
    expect(fetch).toHaveBeenCalledTimes(initialFetches)
    await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sentry/findings/42?force_refresh=1'))
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(initialFetches)
    expect(refreshEvents).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'refresh', resource: 'findings' }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'force-refresh', resource: 'findings' }),
      }),
    ])

    const sonarDetails = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sonarqube/findings/42'))
    expect(sonarDetails?.status).toBe(503)
  })

  it('requires fresh credentials when a findings endpoint changes', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const root = resolve(import.meta.dirname, '../../../../..')
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost({
        sentry: {
          url: 'https://sentry.example',
          organization: 'acme',
          project: '',
          token: 'secret',
        },
      }),
    })
    const response = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/sentry/settings', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://other.example',
          organization: 'acme',
          project: '',
          token: '',
        }),
      }),
    )
    expect(response?.status).toBe(400)
    expect(await response?.json()).toMatchObject({ error: expect.stringContaining('incomplete') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-object extension settings before provider normalization', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const extensions = await loadModulePlatform({ root, run: async () => '', host: testHost() })
    const response = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/sentry/settings', {
        method: 'POST',
        body: JSON.stringify(['not', 'an', 'object']),
      }),
    )

    expect(response?.status).toBe(400)
    await expect(response?.json()).resolves.toEqual({ error: 'Request body must be a JSON object' })
  })

  it('accepts signed Linear issue webhooks and rejects invalid deliveries', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const events: string[] = []
    const webhookSecret = 'linear-webhook-secret'
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost(
        {
          linear: { apiKey: 'linear-api-key', teamIds: ['team-1'], webhookSecret },
        },
        (reason) => events.push(reason),
      ),
    })
    const body = JSON.stringify({
      type: 'Issue',
      action: 'update',
      webhookTimestamp: Date.now(),
      data: { id: 'issue-1', teamId: 'team-1' },
    })
    const signature = createHmac('sha256', webhookSecret).update(body).digest('hex')
    const response = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/linear/webhook', {
        method: 'POST',
        headers: { 'linear-signature': signature, 'linear-delivery': 'delivery-1' },
        body,
      }),
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(events).toContain('linear_issue_updated')

    const invalid = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/linear/webhook', {
        method: 'POST',
        headers: { 'linear-signature': '0'.repeat(64) },
        body,
      }),
    )
    expect(invalid?.status).toBe(401)

    const settings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/linear/settings'))
    const publicSettings = await settings?.json()
    expect(publicSettings).toMatchObject({
      configured: true,
      has_webhook_secret: true,
      webhook_path: '/api/extensions/linear/webhook',
    })
    expect(JSON.stringify(publicSettings)).not.toContain(webhookSecret)
  })

  it('accepts authenticated Azure work-item hooks without exposing the password', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const events: string[] = []
    const webhookSecret = 'azure-webhook-secret'
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost(
        {
          azure_devops: {
            url: 'https://dev.azure.com/acme',
            project: 'Delivery',
            pat: 'azure-pat',
            webhookSecret,
          },
        },
        (reason) => events.push(reason),
      ),
    })
    const body = JSON.stringify({
      id: 'delivery-1',
      eventType: 'workitem.updated',
      resource: { workItemId: 42, revision: { fields: { 'System.TeamProject': 'Delivery' } } },
    })
    const response = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/azure-devops/webhook', {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`vertexade:${webhookSecret}`).toString('base64')}`,
        },
        body,
      }),
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(events).toContain('azure_work_item_updated')

    const invalid = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/azure-devops/webhook', {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from('vertexade:wrong').toString('base64')}` },
        body,
      }),
    )
    expect(invalid?.status).toBe(401)

    const settings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/azure-devops/settings'))
    const publicSettings = await settings?.json()
    expect(publicSettings).toMatchObject({
      configured: true,
      has_webhook_secret: true,
      webhook_path: '/api/extensions/azure-devops/webhook',
      webhook_username: 'vertexade',
    })
    expect(JSON.stringify(publicSettings)).not.toContain(webhookSecret)
    expect(JSON.stringify(publicSettings)).not.toContain('azure-pat')
  })

  it('accepts signed Airtable notifications without exposing the managed MAC secret', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const events: string[] = []
    const secret = Buffer.from('airtable-mac-secret')
    const webhook = {
      id: 'ach-webhook-1',
      macSecretBase64: secret.toString('base64'),
      publicUrl: 'https://vertexade.example',
      notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
      expirationTime: null,
    }
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost(
        {
          airtable: {
            token: 'airtable-pat',
            baseId: 'app-base-1',
            tableId: 'tbl-work',
            view: '',
            titleField: 'Title',
            cardFields: [],
            webhook,
          },
        },
        (reason) => events.push(reason),
      ),
    })
    const body = JSON.stringify({
      base: { id: 'app-base-1' },
      webhook: { id: 'ach-webhook-1' },
      timestamp: '2026-07-28T12:00:00.000Z',
    })
    const signature = `hmac-sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const response = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/airtable/webhook', {
        method: 'POST',
        headers: { 'x-airtable-content-mac': signature },
        body,
      }),
    )

    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ accepted: true, refreshed: true })
    expect(events).toContain('airtable_records_changed')

    const invalid = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/airtable/webhook', {
        method: 'POST',
        headers: { 'x-airtable-content-mac': 'hmac-sha256=' + '0'.repeat(64) },
        body,
      }),
    )
    expect(invalid?.status).toBe(401)

    const settings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/airtable/settings'))
    const publicSettings = await settings?.json()
    expect(publicSettings).toMatchObject({
      configured: true,
      live_sync: true,
      public_url: 'https://vertexade.example',
      webhook_path: '/api/extensions/airtable/webhook',
    })
    expect(JSON.stringify(publicSettings)).not.toContain(webhook.macSecretBase64)
    expect(JSON.stringify(publicSettings)).not.toContain('airtable-pat')
  })

  it('creates, reuses, and removes Airtable webhook registrations with the connection', async () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        return Response.json({
          id: 'ach-managed-1',
          macSecretBase64: Buffer.from('managed-secret').toString('base64'),
        })
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return Response.json({ error: { message: 'Unexpected request' } }, { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost(),
    })
    const input = {
      token: 'airtable-pat',
      base_id: 'app-base-1',
      table_id: 'tbl-work',
      view: '',
      title_field: 'Title',
      card_fields: [],
      live_sync: true,
      public_url: 'https://vertexade.example',
    }
    const saved = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/airtable/settings', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
    expect(saved?.status).toBe(200)
    await expect(saved?.json()).resolves.toMatchObject({
      configured: true,
      live_sync: true,
      public_url: 'https://vertexade.example',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.airtable.com/v0/bases/app-base-1/webhooks')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      notificationUrl: 'https://vertexade.example/api/extensions/airtable/webhook',
      specification: { options: { filters: { recordChangeScope: 'tbl-work' } } },
    })

    const unchanged = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/airtable/settings', {
        method: 'POST',
        body: JSON.stringify({ ...input, token: '' }),
      }),
    )
    expect(unchanged?.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const disabled = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/airtable/settings', {
        method: 'POST',
        body: JSON.stringify({ ...input, token: '', live_sync: false, public_url: '' }),
      }),
    )
    expect(disabled?.status).toBe(200)
    await expect(disabled?.json()).resolves.toMatchObject({ live_sync: false, public_url: '' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('migrates legacy SonarQube settings and discovers browseable projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json({
          paging: { total: 2 },
          components: [
            { key: 'legacy-project', name: 'Legacy project', qualifier: 'TRK' },
            { key: 'new-project', name: 'New project', qualifier: 'TRK' },
          ],
        }),
      ),
    )
    const root = resolve(import.meta.dirname, '../../../../..')
    const extensions = await loadModulePlatform({
      root,
      run: async () => '',
      host: testHost({
        sonarqube: { url: 'https://sonar.example', projectKey: 'legacy-project', token: 'secret' },
      }),
    })

    const settings = await extensions.routes.dispatch(new Request('http://localhost/api/extensions/sonarqube/settings'))
    expect(settings?.status).toBe(200)
    expect(await settings?.json()).toMatchObject({
      configured: true,
      project_keys: ['legacy-project'],
      has_token: true,
    })

    const projects = await extensions.routes.dispatch(
      new Request('http://localhost/api/extensions/sonarqube/projects', {
        method: 'POST',
        body: '{}',
      }),
    )
    expect(projects?.status).toBe(200)
    expect(await projects?.json()).toMatchObject({
      projects: [{ key: 'legacy-project' }, { key: 'new-project' }],
    })
  })
})
