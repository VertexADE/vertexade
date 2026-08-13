import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { createPlatformClient } from '@vertexade/platform-client'
import * as SecureStore from 'expo-secure-store'
import HomeScreen from '../app/index'
import { MobileAppProvider } from '../src/components/mobile-app-context'
import { resetMobileSessionCacheForTests } from '../src/mobile-session'

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native') as typeof import('react-native')
    return <Text accessibilityLabel={href}>Redirected</Text>
  },
  router: { push: jest.fn() },
}))
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
  function renderHome() {
    return render(<MobileAppProvider><HomeScreen /></MobileAppProvider>)
  }
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
    renderHome()
    expect(await screen.findByLabelText('/(tabs)')).toBeOnTheScreen()
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://localhost:4173', getAccessToken: expect.any(Function) })
    expect(createClient).not.toHaveBeenCalledWith({ baseUrl: 'http://localhost:4173', getAccessToken: expect.any(Function), headers: { 'x-vertexade-backend': 'team' } })
  })

  test('clears stale catalog data and announces a connection failure', async () => {
    createClient.mockReturnValue({
      request: jest.fn().mockRejectedValue(new Error('Fixture unavailable')),
    } as unknown as ReturnType<typeof createPlatformClient>)
    renderHome()
    expect(await screen.findByRole('alert')).toHaveTextContent('Fixture unavailable')
    expect(screen.queryByTestId('extension-list')).not.toBeOnTheScreen()
  })

  test('does not inherit a linked backend failure into the directly paired server', async () => {
    serverCatalogs({
      local: { modules: [{ id: 'work', name: 'Work', description: 'Work', enabled: true, portable: { surfaces: [{ kind: 'collection' }] } }] },
      team: new Error('Team unavailable'),
    })
    renderHome()
    expect(await screen.findByLabelText('/(tabs)')).toBeOnTheScreen()
    expect(screen.queryByText('Team unavailable')).not.toBeOnTheScreen()
  })

  test('merges every directly paired server into one workspace even when backend IDs match', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => key === 'vertexade.mobile.sessions.v2' ? JSON.stringify({
      activeServiceUrl: 'http://one:4173',
      sessions: [
        { serviceUrl: 'http://one:4173', sessionToken: 'one-token', expiresAt },
        { serviceUrl: 'http://two:4173', sessionToken: 'two-token', expiresAt },
      ],
    }) : null)
    createClient.mockImplementation((options) => {
      const backendId = backendIdFromOptions(options)
      if (backendId) return { modules: { list: jest.fn().mockResolvedValue({ modules: [] }) } } as unknown as ReturnType<typeof createPlatformClient>
      return { request: jest.fn((path: string) => {
        if (path === '/api/backends') return Promise.resolve({ backends: [{ id: 'local', label: options.baseUrl, isDefault: true }] })
        const title = options.baseUrl === 'http://one:4173' ? 'Work from one' : 'Work from two'
        return Promise.resolve({ ...workspaceResponse, updates: {
          ...workspaceResponse.updates,
          workItems: { mode: 'replace', entries: [{ value: { id: 1, key: 'W-0001', title, state: 'active', priority: 'normal', backend_id: 'local', updated_at: '2026-08-12T10:00:00Z' } }] },
        } })
      }) } as unknown as ReturnType<typeof createPlatformClient>
    })

    renderHome()

    expect(await screen.findByLabelText('/(tabs)')).toBeOnTheScreen()
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://one:4173', getAccessToken: expect.any(Function) })
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://two:4173', getAccessToken: expect.any(Function) })
  })

  test('starts with pair-link setup when no secure session exists', async () => {
    resetMobileSessionCacheForTests()
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
    renderHome()

    expect(await screen.findByText('Desktop pair link')).toBeOnTheScreen()
    expect(screen.getByTestId('connection-submit')).toBeDisabled()
    expect(createClient).not.toHaveBeenCalled()
  })
})
