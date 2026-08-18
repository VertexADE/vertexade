import { describe, expect, it, vi } from 'vite-plus/test'
import { azurePortableGroupOrder, parseAzureStoryManifest, selectAzureIterationItems } from './api.ts'
import { loadAzureBoardData } from './board.ts'
import { AzureDevOpsClient, azureConfig } from './client.ts'

describe('Azure planning manifests', () => {
  it('orders story, subtask, state, and board axes using Azure metadata', () => {
    expect(
      azurePortableGroupOrder(
        {
          'User Story': ['New', 'Active', 'Resolved', 'Closed', 'Removed'],
          Task: ['New', 'Active', 'Closed', 'Removed'],
        },
        'User Story',
        [
          { name: 'Done', order: 3 },
          { name: 'Doing', order: 2 },
          { name: 'Ready', order: 1 },
        ],
      ),
    ).toEqual([
      { field: 'Type', value: 'User Story' },
      { field: 'Type', value: 'Task' },
      { field: 'State', value: 'New' },
      { field: 'State', value: 'Active' },
      { field: 'State', value: 'Resolved' },
      { field: 'State', value: 'Closed' },
      { field: 'State', value: 'Removed' },
      { field: 'Board column', value: 'Ready' },
      { field: 'Board column', value: 'Doing' },
      { field: 'Board column', value: 'Done' },
    ])
  })

  it('normalizes the extension-owned planning result', () => {
    const result = parseAzureStoryManifest(`Plan ready.
<!-- AZURE_STORIES_JSON
{"stories":[{"title":" Story ","feature_id":"42","acceptance_criteria":"Done","tags":["api"],"subtasks":[{"title":" Task ","description":"Build it"}]}]}
-->`)

    expect(result).toEqual([
      expect.objectContaining({
        title: 'Story',
        feature_id: 42,
        acceptance_criteria: 'Done',
        tags: ['api'],
        subtasks: [expect.objectContaining({ title: 'Task', description: 'Build it' })],
      }),
    ])
  })

  it('rejects missing and malformed manifests', () => {
    expect(() => parseAzureStoryManifest('No result')).toThrow('did not return a story manifest')
    expect(() => parseAzureStoryManifest('<!-- AZURE_STORIES_JSON\ninvalid\n-->')).toThrow('invalid story manifest')
  })

  it('keeps the active sprint selected while loading its populated active parent', async () => {
    const sprintItems = vi.fn(async (path: string) => (path.endsWith('July 28') ? [] : [{ id: 42 }]))
    const result = await selectAzureIterationItems(
      { sprintItems },
      [
        {
          path: 'VertexADE\\2026 Q3',
          timeframe: 'current',
          start_date: '2026-07-01',
          finish_date: '2026-09-30',
        },
        {
          path: 'VertexADE\\2026 Q3\\July 28',
          timeframe: 'current',
          start_date: '2026-07-28',
          finish_date: '2026-08-10',
        },
        { path: 'VertexADE\\2026 Q3\\Aug 11', timeframe: 'future' },
      ],
      '',
    )

    expect(result).toEqual({
      selectedPath: 'VertexADE\\2026 Q3\\July 28',
      loadedPath: 'VertexADE\\2026 Q3',
      items: [{ id: 42 }],
    })
    expect(sprintItems.mock.calls.map(([path]) => path)).toEqual(['VertexADE\\2026 Q3\\July 28', 'VertexADE\\2026 Q3'])
  })

  it('keeps an explicitly selected past sprint exact when it is empty', async () => {
    const sprintItems = vi.fn(async () => [])
    const result = await selectAzureIterationItems(
      { sprintItems },
      [
        { path: 'VertexADE\\2026 Q3\\July 28', timeframe: 'current' },
        { path: 'VertexADE\\2026 Q3\\July 14', timeframe: 'past' },
      ],
      'VertexADE\\2026 Q3\\July 14',
    )

    expect(result).toEqual({
      selectedPath: 'VertexADE\\2026 Q3\\July 14',
      loadedPath: 'VertexADE\\2026 Q3\\July 14',
      items: [],
    })
    expect(sprintItems).toHaveBeenCalledTimes(1)
  })

  it('loads a Basic-process board without querying unsupported Agile, Scrum, or Feature types', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/_apis/work/teamsettings/iterations')) {
        return Response.json({
          value: [
            {
              id: 'sprint-1',
              name: 'Sprint 1',
              path: 'Milence\\Sprint 1',
              attributes: { timeFrame: 'current' },
            },
          ],
        })
      }
      if (url.pathname.endsWith('/_apis/wit/workitemtypes')) {
        return Response.json({ value: [{ name: 'Issue' }, { name: 'Task' }] })
      }
      if (/\/_apis\/wit\/workitemtypes\/(Issue|Task)\/states$/.test(url.pathname)) {
        return Response.json({ value: [{ name: 'To Do' }, { name: 'Doing' }, { name: 'Done' }] })
      }
      if (url.pathname.endsWith('/_apis/wit/wiql')) {
        const query = JSON.parse(String(init?.body)).query
        expect(query).toContain("[System.WorkItemType] IN ('Issue', 'Task')")
        expect(query).not.toContain('User Story')
        expect(query).not.toContain('Product Backlog Item')
        expect(query).not.toContain("[System.WorkItemType] = 'Feature'")
        return Response.json({ workItems: [] })
      }
      if (url.pathname.endsWith('/_apis/projects/Milence/teams')) return Response.json({ value: [] })
      throw new Error(`Unexpected Azure request: ${url.pathname}`)
    })
    const config = azureConfig({ url: 'https://dev.azure.com/acme', project: 'Milence', pat: 'secret' })
    const provider = {
      id: 'azure-devops',
      name: 'Azure DevOps',
      normalizeConfig: azureConfig,
      createClient: () => new AzureDevOpsClient(config, fetchMock),
    }

    const board = await loadAzureBoardData(provider, config, '')

    expect(board).toMatchObject({ configured: true, story_type: 'Issue', items: [], features: [] })
  })
})
