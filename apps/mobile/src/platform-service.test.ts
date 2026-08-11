import { createPlatformClient } from '@vertexade/platform-client'
import { createMobilePlatformClient, loadMobileServerCatalogs } from './platform-service'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

const createClient = jest.mocked(createPlatformClient)

describe('mobile platform service', () => {
  beforeEach(() => {
    createClient.mockReset()
  })

  test('routes backend requests through the port 4173 service header', () => {
    const client = {} as ReturnType<typeof createPlatformClient>
    createClient.mockReturnValue(client)

    expect(createMobilePlatformClient('http://fixture:4173', 'team')).toBe(client)
    expect(createClient).toHaveBeenCalledWith({
      baseUrl: 'http://fixture:4173',
      headers: { 'x-vertexade-backend': 'team' },
    })
  })

  test.each(['', '../team', 'team space', 'a'.repeat(49)])('rejects invalid backend ID %p', (backendId) => {
    expect(() => createMobilePlatformClient('http://fixture:4173', backendId)).toThrow('VertexADE backend ID is invalid')
    expect(createClient).not.toHaveBeenCalled()
  })

  test('loads linked server catalogs in order and isolates a backend failure', async () => {
    createClient.mockImplementation((options) => {
      const backendId = (options?.headers as Record<string, string> | undefined)?.['x-vertexade-backend']
      if (!backendId) {
        return { request: jest.fn().mockResolvedValue({
          backends: [
            { id: 'local', label: 'Local', isDefault: true },
            { id: 'team', label: 'Team', isDefault: false },
          ],
        }) } as unknown as ReturnType<typeof createPlatformClient>
      }
      const list = backendId === 'local'
        ? jest.fn().mockResolvedValue({ modules: [{ id: 'work' }] })
        : jest.fn().mockRejectedValue(new Error('Team unavailable'))
      return { modules: { list } } as unknown as ReturnType<typeof createPlatformClient>
    })

    await expect(loadMobileServerCatalogs('http://fixture:4173')).resolves.toEqual([
      { id: 'local', label: 'Local', isDefault: true, modules: [{ id: 'work' }], error: '' },
      { id: 'team', label: 'Team', isDefault: false, modules: [], error: 'Team unavailable' },
    ])
  })

  test('rejects an invalid discovery response before contacting a backend', async () => {
    createClient.mockReturnValue({ request: jest.fn().mockResolvedValue({ backends: [{ id: '../team', label: 'Team' }] }) } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileServerCatalogs('http://fixture:4173')).rejects.toThrow('VertexADE service returned an invalid backend')
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})
