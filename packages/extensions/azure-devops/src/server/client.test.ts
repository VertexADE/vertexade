import { describe, expect, it, vi } from 'vite-plus/test'
import { AzureDevOpsClient, azureConfig, normalizeWorkItem } from './client.ts'

describe('Azure DevOps client', () => {
  it('keeps the PAT server-side and reports configuration state', () => {
    expect(azureConfig({ url: 'https://dev.azure.com/acme/', project: 'Portal', pat: 'secret' })).toEqual({
      configured: true,
      url: 'https://dev.azure.com/acme',
      project: 'Portal',
      pat: 'secret',
      webhookSecret: '',
    })
  })

  it('normalizes identity and hierarchy fields', () => {
    expect(
      normalizeWorkItem({
        id: 42,
        fields: {
          'System.Title': 'Story',
          'System.AreaPath': 'Portal\\Checkout',
          'System.Tags': 'frontend; urgent',
          'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>It works</p>',
          'System.AssignedTo': { displayName: 'Ada', uniqueName: 'ada@example.com' },
        },
        relations: [
          { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://example/items/7' },
          { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://example/items/43' },
        ],
      }),
    ).toMatchObject({
      id: 42,
      title: 'Story',
      area_path: 'Portal\\Checkout',
      tags: ['frontend', 'urgent'],
      acceptance_criteria: '<p>It works</p>',
      assigned_to: { display_name: 'Ada', unique_name: 'ada@example.com' },
      parent_id: '7',
      child_ids: ['43'],
    })
  })

  it('creates a child using JSON Patch and a hierarchy parent link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 9, fields: { 'System.Title': 'Task' } }),
    })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    await client.createWorkItem({
      type: 'Task',
      title: 'Task',
      iterationPath: 'Portal\\Sprint 1',
      assignedTo: 'ada@example.com',
      areaPath: 'Portal\\Web',
      tags: ['frontend', 'urgent'],
      parentId: 7,
    })
    const [, request] = fetchMock.mock.calls[0]
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from(':secret').toString('base64')}`)
    expect(JSON.parse(request.body)).toContainEqual(
      expect.objectContaining({
        path: '/relations/-',
        value: expect.objectContaining({ rel: 'System.LinkTypes.Hierarchy-Reverse' }),
      }),
    )
    expect(JSON.parse(request.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/fields/System.AreaPath', value: 'Portal\\Web' }),
        expect.objectContaining({ path: '/fields/System.Tags', value: 'frontend; urgent' }),
      ]),
    )
  })

  it('updates a work item state with JSON Patch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 9, fields: { 'System.Title': 'Task', 'System.State': 'Active' } }),
    })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    await client.updateWorkItemState(9, 'Active')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      headers: { 'content-type': 'application/json-patch+json' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([{ op: 'add', path: '/fields/System.State', value: 'Active' }])
  })

  it('moves a work item between sprint taskboard columns', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    await client.moveTaskboardItem('Portal Team', 'iteration-id', 9, 'Review')
    expect(fetchMock.mock.calls[0][0]).toContain('/Portal%20Team/_apis/work/taskboardworkitems/iteration-id/9?api-version=7.1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ newColumn: 'Review' }),
    })
  })

  it('requests hierarchy relations without the incompatible fields filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ value: [] }) })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    await client.workItems([1, 2])
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestBody).toEqual({ ids: [1, 2], $expand: 'Relations' })
    expect(requestBody).not.toHaveProperty('fields')
  })

  it('loads every work item when Azure requires multiple 200-item batches', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, request) => {
      const ids = JSON.parse(request.body).ids
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            value: ids.map((id: number) => ({ id, fields: { 'System.Title': `Item ${id}` } })),
          }),
      }
    })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    const items = await client.workItems(Array.from({ length: 401 }, (_, index) => index + 1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, request]) => JSON.parse(request.body).ids.length)).toEqual([200, 200, 1])
    expect(items).toHaveLength(401)
    expect(items.at(-1)).toMatchObject({ id: 401, title: 'Item 401' })
  })

  it('caps structured work-item batch concurrency at four requests', async () => {
    let activeRequests = 0
    let maximumConcurrency = 0
    const fetchMock = vi.fn().mockImplementation(async (_url, request) => {
      activeRequests += 1
      maximumConcurrency = Math.max(maximumConcurrency, activeRequests)
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      activeRequests -= 1
      const ids = JSON.parse(request.body).ids
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            value: ids.map((id: number) => ({
              id,
              fields: { 'System.Title': `Item ${id}` },
            })),
          }),
      }
    })
    const client = new AzureDevOpsClient(
      azureConfig({
        url: 'https://dev.azure.com/acme',
        project: 'Portal',
        pat: 'secret',
      }),
      fetchMock,
    )

    await expect(client.workItems(Array.from({ length: 1_001 }, (_, index) => index + 1))).resolves.toHaveLength(1_001)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(maximumConcurrency).toBe(4)
  })

  it('propagates caller cancellation to active work-item batches', async () => {
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn().mockImplementation(async (_url, request) => {
      requestSignal = request.signal
      await new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Cancelled', 'AbortError'))
          },
          { once: true },
        )
      })
    })
    const client = new AzureDevOpsClient(
      azureConfig({
        url: 'https://dev.azure.com/acme',
        project: 'Portal',
        pat: 'secret',
      }),
      fetchMock,
    )
    const controller = new AbortController()
    const request = client.workItems([1], controller.signal)
    const rejection = expect(request).rejects.toThrow('Azure DevOps request failed: Cancelled')

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    controller.abort()

    await rejection
    expect(requestSignal?.aborted).toBe(true)
  })

  it('loads one work item with all fields and relations for its detail view', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: 42, fields: { 'System.Title': 'Story' } }),
    })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'secret' }), fetchMock)
    await client.workItem(42)
    expect(fetchMock.mock.calls[0][0]).toContain('/_apis/wit/workitems/42?$expand=Relations&api-version=7.1')
  })

  it('falls back to project iteration paths when the default team has none', async () => {
    const responses = [
      { value: [] },
      {
        name: 'VertexADE',
        path: '\\VertexADE\\Iteration',
        children: [
          {
            id: 1,
            identifier: 'sprint-1',
            name: 'Sprint 1',
            path: '\\VertexADE\\Iteration\\Sprint 1',
            attributes: { startDate: '2026-01-01', finishDate: '2026-01-14' },
          },
        ],
      },
    ]
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      text: async () => JSON.stringify(responses.shift()),
    }))
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'VertexADE', pat: 'secret' }), fetchMock)
    await expect(client.iterations()).resolves.toMatchObject([{ id: 'sprint-1', name: 'Sprint 1', path: 'VertexADE\\Sprint 1' }])
    expect(fetchMock.mock.calls[1][0]).toContain('classificationnodes/Iterations?$depth=10&api-version=7.1')
  })

  it('ranks the active nested sprint ahead of its active quarter', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      const responses = [
        { value: [] },
        {
          name: 'VertexADE',
          path: '\\VertexADE\\Iteration',
          children: [
            {
              id: 1,
              identifier: 'q3',
              name: '2026 Q3',
              path: '\\VertexADE\\Iteration\\2026 Q3',
              attributes: { startDate: '2026-07-01', finishDate: '2026-09-30' },
              children: [
                {
                  id: 2,
                  identifier: 'july-14',
                  name: 'July 14',
                  path: '\\VertexADE\\Iteration\\2026 Q3\\July 14',
                  attributes: { startDate: '2026-07-14', finishDate: '2026-07-27' },
                },
              ],
            },
          ],
        },
      ]
      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        text: async () => JSON.stringify(responses.shift()),
      }))
      const client = new AzureDevOpsClient(
        azureConfig({ url: 'https://dev.azure.com/acme', project: 'VertexADE', pat: 'secret' }),
        fetchMock,
      )
      const iterations = await client.iterations()
      expect(iterations.slice(0, 2).map((item) => item.path)).toEqual(['VertexADE\\2026 Q3\\July 14', 'VertexADE\\2026 Q3'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses process-independent fields in the sprint WIQL query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ workItems: [] }) })
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'VertexADE', pat: 'secret' }), fetchMock)
    await client.sprintItems('VertexADE\\Sprint 1')
    const query = JSON.parse(fetchMock.mock.calls[0][1].body).query
    expect(query).toContain('ORDER BY [System.ChangedDate] DESC')
    expect(query).not.toContain('System.BacklogPriority')
  })

  it('adds a timeout signal and preserves non-JSON upstream errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('gateway unavailable', { status: 502 }))
    const client = new AzureDevOpsClient(azureConfig({ url: 'https://dev.azure.com/acme', project: 'VertexADE', pat: 'secret' }), fetchMock)
    await expect(client.workItem(42)).rejects.toThrow('Azure DevOps returned 502: gateway unavailable')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})
