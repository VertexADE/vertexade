import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vite-plus/test'
import { drizzleDashboardDatabase } from './database/dashboard-database.ts'
import { handleRepositoryEnvironmentApi } from './repository-environment-routes.ts'

function fixture() {
  const database = new DatabaseSync(':memory:')
  database.exec('CREATE TABLE repositories (id INTEGER PRIMARY KEY, full_name TEXT, local_path TEXT)')
  database.prepare('INSERT INTO repositories (id,full_name,local_path) VALUES (1,?,?)').run('vertexade/platform', '/repos/platform')
  const profiles = {
    list: vi.fn(() => [{ scope: '', variables: [], envFiles: [] }]),
    replace: vi.fn(async () => [{ scope: 'apps/api', variables: [{ name: 'TOKEN', configured: true }], envFiles: [] }]),
  }
  const notify = vi.fn()
  const dependencies = {
    body: vi.fn(async (request: Request) => request.json()),
    database: drizzleDashboardDatabase(database),
    json: (status: number, value: unknown) => Response.json(value, { status }),
    notify,
    profiles: profiles as any,
  }
  return { dependencies, notify, profiles }
}

describe('repository environment routes', () => {
  it('reads public profile metadata without secret values', async () => {
    const { dependencies, profiles } = fixture()
    const response = await handleRepositoryEnvironmentApi(
      new Request('http://local/api/repositories/1/environment-profiles'),
      new URL('http://local/api/repositories/1/environment-profiles'),
      dependencies,
    )
    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({
      repository_id: 1,
      profiles: [{ scope: '', variables: [], envFiles: [] }],
    })
    expect(profiles.list).toHaveBeenCalledWith(1)
  })

  it('writes profiles through the Effect route and publishes one change event', async () => {
    const { dependencies, notify, profiles } = fixture()
    const request = new Request('http://local/api/repositories/1/environment-profiles', {
      method: 'PUT',
      body: JSON.stringify({ profiles: [{ scope: 'apps/api' }] }),
    })
    const response = await handleRepositoryEnvironmentApi(request, new URL(request.url), dependencies)
    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({
      repository_id: 1,
      profiles: [{ scope: 'apps/api', variables: [{ name: 'TOKEN', configured: true }], envFiles: [] }],
    })
    expect(profiles.replace).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [{ scope: 'apps/api' }])
    expect(notify).toHaveBeenCalledWith('repository_environment_profiles_updated', 1)
  })

  it('turns validation failures into a useful client error', async () => {
    const { dependencies, profiles } = fixture()
    profiles.replace.mockRejectedValueOnce(new Error('Profile scope does not exist'))
    const request = new Request('http://local/api/repositories/1/environment-profiles', {
      method: 'PUT',
      body: JSON.stringify({ profiles: [] }),
    })
    const response = await handleRepositoryEnvironmentApi(request, new URL(request.url), dependencies)
    expect(response?.status).toBe(400)
    expect(await response?.json()).toEqual({ error: 'Profile scope does not exist' })
  })
})
