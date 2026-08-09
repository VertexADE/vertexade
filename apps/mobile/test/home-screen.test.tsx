import { fireEvent, render, screen } from '@testing-library/react-native'
import { createPlatformClient } from '@vertexade/platform-client'
import HomeScreen from '../app/index'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('@vertexade/platform-client', () => ({
  createPlatformClient: jest.fn(),
  normalizePlatformBaseUrl: (value: string) => value.replace(/\/$/, ''),
}))

const createClient = jest.mocked(createPlatformClient)

function modulesList(list: unknown) {
  createClient.mockReturnValue({ modules: { list: jest.fn().mockResolvedValue(list) } } as unknown as ReturnType<typeof createPlatformClient>)
}

describe('HomeScreen', () => {
  test('connects and shows only portable or configurable extensions', async () => {
    modulesList({
      modules: [
        { id: 'work', name: 'Work', description: 'Work', enabled: true, portable: { surfaces: [{ kind: 'collection' }] } },
        { id: 'settings', name: 'Settings only', description: 'Settings', enabled: false, portable: { surfaces: [], settings: { fields: [] } } },
        { id: 'server-only', name: 'Server only', description: 'Hidden', enabled: true },
      ],
    })
    render(<HomeScreen />)
    fireEvent.changeText(screen.getByTestId('connection-url'), 'http://fixture:4174')
    fireEvent.press(screen.getByTestId('connection-submit'))
    expect(await screen.findByTestId('extension-work')).toBeOnTheScreen()
    expect(screen.getByText('Settings only')).toBeOnTheScreen()
    expect(screen.queryByText('Server only')).not.toBeOnTheScreen()
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://fixture:4174' })
  })

  test('clears stale catalog data and announces a connection failure', async () => {
    createClient.mockReturnValue({
      modules: { list: jest.fn().mockRejectedValue(new Error('Fixture unavailable')) },
    } as unknown as ReturnType<typeof createPlatformClient>)
    render(<HomeScreen />)
    fireEvent.press(screen.getByTestId('connection-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fixture unavailable')
    expect(screen.queryByTestId('extension-list')).not.toBeOnTheScreen()
  })
})
