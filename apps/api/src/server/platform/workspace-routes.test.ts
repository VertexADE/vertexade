import { afterEach, describe, expect, it } from 'vite-plus/test'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { ExtensionRegistry } from '../extensions/registry.ts'
import { WorkService } from '../work/service.ts'
import { CapabilityExecutionService } from '../workflows/capability-execution.ts'
import { createWorkspaceRoutes } from './workspace-routes.ts'
import { MAX_REQUEST_BODY_BYTES } from '@vertexade/platform-server/http'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture({ inbox = false, failingInbox = false, search = false, failingSearch = false } = {}) {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  const work = new WorkService(database)
  work.initialize()
  const extensions = new ExtensionRegistry().install(
    {
      manifest: {
        id: 'example',
        name: 'Example',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'other',
        ui: {
          commands: [
            {
              id: 'example.open',
              label: 'Open example',
              to: '/extensions/example',
              keywords: ['special'],
            },
          ],
        },
        providers: [
          ...(inbox || failingInbox ? [{ id: 'example-inbox', name: 'Example signals', kind: 'inbox' }] : []),
          ...(search || failingSearch ? [{ id: 'example-search', name: 'Example search', kind: 'search' }] : []),
        ],
      },
    },
    { enabled: true },
  )
  if (inbox || failingInbox)
    extensions.providers.forModule('example').inbox.register({
      id: 'example-inbox',
      name: 'Example signals',
      async items() {
        if (failingInbox) throw new Error('upstream unavailable')
        return [
          {
            id: 'incident-42',
            type: 'incident',
            severity: 'error',
            title: 'Production incident',
            summary: 'Checkout errors exceed the threshold',
            href: '/extensions/example/incidents/42',
            actionLabel: 'Investigate',
            unread: true,
          },
        ]
      },
    })
  if (search || failingSearch)
    extensions.providers.forModule('example').search.register({
      id: 'example-search',
      name: 'Example search',
      async search() {
        if (failingSearch) throw new Error('search unavailable')
        return [
          {
            id: 'incident-42',
            type: 'Incident',
            title: 'Checkout failure',
            subtitle: 'Production',
            to: 'javascript:alert(1)',
          },
        ]
      },
    })
  const executions = new CapabilityExecutionService(database, extensions.contributions)
  return { database, work, routes: createWorkspaceRoutes({ database, extensions, executions }) }
}

describe('workspace discovery routes', () => {
  it('searches Work items and extension commands', async () => {
    const { work, routes } = fixture()
    work.create({ title: 'Harden extension platform', description: 'Durable capability runtime' })

    const workResponse = await routes.dispatch(new Request('http://localhost/api/search?q=extension'), {})
    const commandResponse = await routes.dispatch(new Request('http://localhost/api/search?q=special'), {})

    await expect(workResponse?.json()).resolves.toMatchObject({
      results: [{ type: 'Work', title: 'W-0001 · Harden extension platform' }],
    })
    await expect(commandResponse?.json()).resolves.toMatchObject({
      results: [{ type: 'Extension action', title: 'Open example' }],
    })
  })

  it('collects extension-owned search results and sanitizes their destination', async () => {
    const { work, routes } = fixture({ search: true })
    for (let index = 0; index < 45; index += 1) work.create({ title: `Checkout task ${index}` })

    const response = await routes.dispatch(new Request('http://localhost/api/search?q=checkout'), {})

    const body = (await response?.json()) as { results: Array<Record<string, unknown>> }
    expect(body.results).toHaveLength(13)
    expect(body.results).toContainEqual(
      expect.objectContaining({
        id: 'provider:example:example-search:incident-42',
        type: 'Incident',
        title: 'Checkout failure',
        subtitle: 'Production',
        to: '/extensions/example',
      }),
    )
  })

  it('isolates failing search providers from core search results', async () => {
    const { routes } = fixture({ failingSearch: true })

    const response = await routes.dispatch(new Request('http://localhost/api/search?q=special'), {})

    await expect(response?.json()).resolves.toMatchObject({
      results: [{ type: 'Extension action', title: 'Open example' }],
    })
  })

  it('collects Work attention into the engineering inbox', async () => {
    const { database, work, routes } = fixture()
    const item = work.create({ title: 'Blocked delivery' })!
    database.$client.prepare('UPDATE work_items SET attention=? WHERE id=?').run('Waiting for approval', item.id)

    const response = await routes.dispatch(new Request('http://localhost/api/inbox'), {})

    await expect(response?.json()).resolves.toMatchObject({
      summary: { total: 1, warnings: 1 },
      items: [
        {
          id: 'work:W-0001',
          summary: 'Waiting for approval',
          href: '/work/W-0001',
          actionLabel: 'Open Work',
        },
      ],
    })
  })

  it('collects extension-owned signals and preserves their action metadata', async () => {
    const { routes } = fixture({ inbox: true })

    const response = await routes.dispatch(new Request('http://localhost/api/inbox'), {})

    await expect(response?.json()).resolves.toMatchObject({
      summary: { total: 1, errors: 1, unread: 1 },
      items: [
        {
          id: 'provider:example:example-inbox:incident-42',
          source: 'Example signals',
          actionLabel: 'Investigate',
          href: '/extensions/example/incidents/42',
        },
      ],
    })
  })

  it('isolates failing inbox providers from core inbox signals', async () => {
    const { database, routes } = fixture({ failingInbox: true })
    database.$client
      .prepare('INSERT INTO notifications (kind,title,message) VALUES (?,?,?)')
      .run('task_complete', 'Finished', 'Ready to inspect')

    const response = await routes.dispatch(new Request('http://localhost/api/inbox'), {})

    await expect(response?.json()).resolves.toMatchObject({
      summary: { total: 2, warnings: 1 },
      items: [
        {
          id: 'provider-health:example:example-inbox',
          title: 'Example signals could not refresh',
          actionLabel: 'Check extension',
          href: '/extensions/example',
        },
        { id: 'notification:1', title: 'Finished' },
      ],
    })
  })

  it('persists inbox triage state and removes completed items from the open count', async () => {
    const { database, routes } = fixture()
    database.$client
      .prepare('INSERT INTO notifications (kind,title,message) VALUES (?,?,?)')
      .run('task_complete', 'Finished', 'Ready to inspect')

    const update = await routes.dispatch(
      new Request('http://localhost/api/inbox/notification%3A1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'done' }),
      }),
      {},
    )
    const response = await routes.dispatch(new Request('http://localhost/api/inbox'), {})

    await expect(update?.json()).resolves.toMatchObject({ itemId: 'notification:1', state: 'done' })
    await expect(response?.json()).resolves.toMatchObject({
      summary: { total: 0 },
      items: [{ id: 'notification:1', triageState: 'done' }],
    })
  })

  it('rejects an oversized inbox update before parsing it', async () => {
    const { routes } = fixture()
    const response = await routes.dispatch(
      new Request('http://localhost/api/inbox/example', {
        method: 'PATCH',
        body: JSON.stringify({ state: 'done', padding: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }),
      }),
      {},
    )

    expect(response?.status).toBe(413)
    await expect(response?.json()).resolves.toEqual({ error: 'Request body is too large' })
  })
})
