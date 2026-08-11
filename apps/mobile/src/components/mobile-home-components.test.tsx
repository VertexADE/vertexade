import { fireEvent, render, screen } from '@testing-library/react-native'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { router } from 'expo-router'
import { MobileConnectionPanel, MobileExtensionList } from './mobile-home-components'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))

function moduleEntry(overrides: Record<string, unknown> = {}): ModuleCatalogEntry {
  return {
    id: 'work',
    name: 'Work',
    description: 'Manage outcomes',
    enabled: true,
    capabilities: [],
    portable: { surfaces: [], settings: undefined },
    ...overrides,
  } as unknown as ModuleCatalogEntry
}

describe('MobileConnectionPanel', () => {
  test('edits the endpoint and connects when it is usable', () => {
    const onServiceUrlChange = jest.fn()
    const onConnect = jest.fn()
    render(
      <MobileConnectionPanel
        serviceUrl="http://localhost:4173"
        loading={false}
        error=""
        onServiceUrlChange={onServiceUrlChange}
        onConnect={onConnect}
      />,
    )
    fireEvent.changeText(screen.getByLabelText('VertexADE service URL'), 'http://10.0.2.2:4173')
    fireEvent.press(screen.getByLabelText('Load VertexADE servers'))
    expect(onServiceUrlChange).toHaveBeenCalledWith('http://10.0.2.2:4173')
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  test('announces errors and exposes a disabled busy state', () => {
    render(
      <MobileConnectionPanel serviceUrl="" loading error="Connection refused" onServiceUrlChange={jest.fn()} onConnect={jest.fn()} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Connection refused')
    expect(screen.getByTestId('connection-submit')).toBeDisabled()
    expect(screen.getByTestId('connection-submit')).toHaveProp('accessibilityState', { busy: true, disabled: true })
  })
})

describe('MobileExtensionList', () => {
  test('renders the empty state', () => {
    render(<MobileExtensionList servers={[{ id: 'local', label: 'Local', isDefault: true, modules: [], error: '' }]} serviceUrl="http://localhost:4173" />)
    expect(screen.getByText('No portable extensions')).toBeOnTheScreen()
  })

  test('groups servers and opens extensions with backend-aware normalized parameters', () => {
    render(
      <MobileExtensionList
        serviceUrl="http://localhost:4173/"
        servers={[
          {
            id: 'local',
            label: 'Local',
            isDefault: true,
            error: '',
            modules: [moduleEntry({ portable: { surfaces: [{ id: 'work', kind: 'collection', title: 'Work', source: { path: '/work' }, item: { idPath: 'id', titlePath: 'title', fields: [] } }], settings: undefined } })],
          },
          {
            id: 'team',
            label: 'Team',
            isDefault: false,
            error: '',
            modules: [moduleEntry({ id: 'disabled', name: 'Disabled extension', enabled: false, portable: { surfaces: [], settings: { title: 'Settings', fields: [] } } })],
          },
        ]}
      />,
    )
    fireEvent.press(screen.getByTestId('extension-team-disabled'))
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/extensions/[moduleId]',
      params: { moduleId: 'disabled', serviceUrl: 'http://localhost:4173', backendId: 'team' },
    })
    expect(screen.getByText('2/2 live · 2 portable extensions')).toBeOnTheScreen()
    expect(screen.getByText('Settings · Disabled')).toBeOnTheScreen()
  })

  test('keeps healthy servers visible when another server is unavailable', () => {
    render(<MobileExtensionList serviceUrl="http://localhost:4173" servers={[
      { id: 'local', label: 'Local', isDefault: true, modules: [moduleEntry()], error: '' },
      { id: 'team', label: 'Team', isDefault: false, modules: [], error: 'Team is offline' },
    ]} />)
    expect(screen.getByText('1/2 live · 1 portable extension')).toBeOnTheScreen()
    expect(screen.getByRole('alert')).toHaveTextContent('Team is offline')
    expect(screen.getByTestId('extension-work')).toBeOnTheScreen()
  })
})
