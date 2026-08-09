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
    const onServerChange = jest.fn()
    const onConnect = jest.fn()
    render(
      <MobileConnectionPanel
        server="http://localhost:4174"
        loading={false}
        error=""
        onServerChange={onServerChange}
        onConnect={onConnect}
      />,
    )
    fireEvent.changeText(screen.getByLabelText('VertexADE API URL'), 'http://10.0.2.2:4174')
    fireEvent.press(screen.getByLabelText('Connect to VertexADE'))
    expect(onServerChange).toHaveBeenCalledWith('http://10.0.2.2:4174')
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  test('announces errors and exposes a disabled busy state', () => {
    render(
      <MobileConnectionPanel server="" loading error="Connection refused" onServerChange={jest.fn()} onConnect={jest.fn()} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Connection refused')
    expect(screen.getByTestId('connection-submit')).toBeDisabled()
    expect(screen.getByTestId('connection-submit')).toHaveProp('accessibilityState', { busy: true, disabled: true })
  })
})

describe('MobileExtensionList', () => {
  test('renders the empty state', () => {
    render(<MobileExtensionList modules={[]} server="http://localhost:4174" />)
    expect(screen.getByText('No portable extensions')).toBeOnTheScreen()
  })

  test('opens enabled and disabled-but-configurable extensions with normalized parameters', () => {
    render(
      <MobileExtensionList
        server="http://localhost:4174/"
        modules={[
          moduleEntry({ portable: { surfaces: [{ id: 'work', kind: 'collection', title: 'Work', source: { path: '/work' }, item: { idPath: 'id', titlePath: 'title', fields: [] } }], settings: undefined } }),
          moduleEntry({ id: 'disabled', name: 'Disabled extension', enabled: false, portable: { surfaces: [], settings: { title: 'Settings', fields: [] } } }),
        ]}
      />,
    )
    fireEvent.press(screen.getByTestId('extension-disabled'))
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/extensions/[moduleId]',
      params: { moduleId: 'disabled', server: 'http://localhost:4174' },
    })
    expect(screen.getByText('Settings · Disabled')).toBeOnTheScreen()
  })
})
