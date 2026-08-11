import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { createPlatformClient } from '@vertexade/platform-client'
import * as SecureStore from 'expo-secure-store'
import HomeScreen from '../app/index'
import { resetMobileSessionCacheForTests } from '../src/mobile-session'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@vertexade/platform-client', () => ({
  createPlatformClient: jest.fn(),
  normalizePlatformBaseUrl: (value: string) => value.replace(/\/$/, ''),
}))

const createClient = jest.mocked(createPlatformClient)

const workspaceResponse = {
  instanceId: 'fixture',
  version: 1,
  updates: {
    repositories: { mode: 'replace', entries: [] },
    pullRequests: { mode: 'replace', entries: [] },
    workItems: { mode: 'replace', entries: [] },
    agentThreads: { mode: 'replace', entries: [] },
  },
}

function backendIdFromOptions(options: Parameters<typeof createPlatformClient>[0]): string | undefined {
  return (options.headers as Record<string, string> | undefined)?.['x-vertexade-backend']
}

function serverCatalogs(catalogs: Record<string, unknown>) {
  createClient.mockImplementation((options) => {
    const backendId = backendIdFromOptions(options)
    if (!backendId) {
      return { request: jest.fn((path: string) => Promise.resolve(path.startsWith('/api/read-model')
        ? workspaceResponse
        : { backends: Object.keys(catalogs).map((id, index) => ({ id, label: id === 'local' ? 'Local' : 'Team', isDefault: index === 0 })) })) } as unknown as ReturnType<typeof createPlatformClient>
    }
    const catalog = catalogs[backendId]
    const list = catalog instanceof Error ? jest.fn().mockRejectedValue(catalog) : jest.fn().mockResolvedValue(catalog)
    return { modules: { list } } as unknown as ReturnType<typeof createPlatformClient>
  })
}

describe('HomeScreen', () => {
  beforeEach(() => {
    createClient.mockReset()
    resetMobileSessionCacheForTests()
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({
      serviceUrl: 'http://localhost:4173',
      sessionToken: 'paired-session',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }))
  })
  beforeAll(() => jest.useFakeTimers())
  afterEach(() => act(() => jest.runOnlyPendingTimers()))
  afterAll(() => jest.useRealTimers())

  test('automatically connects and shows only portable or configurable extensions under More', async () => {
    serverCatalogs({
      local: {
        modules: [
          { id: 'work', name: 'Work', description: 'Work', enabled: true, portable: { surfaces: [{ kind: 'collection' }] } },
          { id: 'server-only', name: 'Server only', description: 'Hidden', enabled: true },
        ],
      },
      team: {
        modules: [{ id: 'settings', name: 'Settings only', description: 'Settings', enabled: false, portable: { surfaces: [], settings: { fields: [] } } }],
      },
    })
    render(<HomeScreen />)
    expect(await screen.findByText('Pull requests')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-tab-more'))
    expect(await screen.findByTestId('extension-work')).toBeOnTheScreen()
    expect(screen.getByText('Settings only')).toBeOnTheScreen()
    expect(screen.queryByText('Server only')).not.toBeOnTheScreen()
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://localhost:4173', getAccessToken: expect.any(Function) })
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://localhost:4173', getAccessToken: expect.any(Function), headers: { 'x-vertexade-backend': 'team' } })
  })

  test('clears stale catalog data and announces a connection failure', async () => {
    createClient.mockReturnValue({
      request: jest.fn().mockRejectedValue(new Error('Fixture unavailable')),
    } as unknown as ReturnType<typeof createPlatformClient>)
    render(<HomeScreen />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Fixture unavailable')
    expect(screen.queryByTestId('extension-list')).not.toBeOnTheScreen()
  })

  test('shows a partial backend failure without hiding the healthy catalog', async () => {
    serverCatalogs({
      local: { modules: [{ id: 'work', name: 'Work', description: 'Work', enabled: true, portable: { surfaces: [{ kind: 'collection' }] } }] },
      team: new Error('Team unavailable'),
    })
    render(<HomeScreen />)
    expect(await screen.findByText('Pull requests')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-tab-more'))
    expect(await screen.findByTestId('extension-work')).toBeOnTheScreen()
    expect(screen.getByRole('alert')).toHaveTextContent('Team unavailable')
  })

  test('starts with pair-link setup when no secure session exists', async () => {
    resetMobileSessionCacheForTests()
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
    render(<HomeScreen />)

    expect(await screen.findByText('Desktop pair link')).toBeOnTheScreen()
    expect(screen.getByTestId('connection-submit')).toBeDisabled()
    expect(createClient).not.toHaveBeenCalled()
  })
})
