import { describe, expect, it, vi } from 'vite-plus/test'
import { LinearClient, normalizeLinearConfig } from './client.ts'

describe('LinearClient', () => {
  it('preserves a stored API key while replacing selected teams', () => {
    expect(
      normalizeLinearConfig({ team_ids: ['team-2', 'team-2'] }, { apiKey: 'secret', teamIds: ['team-1'], webhookSecret: 'webhook-secret' }),
    ).toEqual({ apiKey: 'secret', teamIds: ['team-2'], webhookSecret: 'webhook-secret' })
  })

  it('authenticates with the personal API key and filters overview data to selected teams', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      Response.json({
        data: {
          viewer: { id: 'viewer' },
          teams: {
            nodes: [
              { id: 'team-1', name: 'One' },
              { id: 'team-2', name: 'Two' },
            ],
          },
          projects: {
            nodes: [
              { id: 'project-1', teams: { nodes: [{ id: 'team-1' }] } },
              { id: 'project-2', teams: { nodes: [{ id: 'team-2' }] } },
            ],
          },
          workflowStates: {
            nodes: [
              { id: 'state-1', team: { id: 'team-1' } },
              { id: 'state-2', team: { id: 'team-2' } },
            ],
          },
          issues: {
            nodes: [
              { id: 'issue-1', team: { id: 'team-1' } },
              { id: 'issue-2', team: { id: 'team-2' } },
            ],
          },
        },
      }),
    )
    const result = await new LinearClient({ apiKey: 'lin_api_key', teamIds: ['team-2'] }, fetchMock).overview()
    expect(result.teams).toEqual([{ id: 'team-2', name: 'Two' }])
    expect(result.projects).toEqual([{ id: 'project-2', teams: { nodes: [{ id: 'team-2' }] } }])
    expect(result.issues).toEqual([{ id: 'issue-2', team: { id: 'team-2' } }])
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'lin_api_key' })
  })

  it('surfaces GraphQL errors even when Linear returns HTTP 200', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ errors: [{ message: 'Invalid API key' }] }))
    await expect(new LinearClient({ apiKey: 'bad', teamIds: [] }, fetchMock).teams()).rejects.toThrow('Invalid API key')
  })
})
