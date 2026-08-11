import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Alert, TextInput } from 'react-native'
import { PORTABLE_SURFACE_API_VERSION, type ModuleCatalogEntry, type PortableSettingsSurface } from '@vertexade/platform-contracts'
import { createPlatformClient } from '@vertexade/platform-client'
import { PortableSettingsScreen } from './portable-settings-screen'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

const createClient = jest.mocked(createPlatformClient)
const moduleEntry = { id: 'fixture', name: 'Fixture' } as ModuleCatalogEntry
const settings: PortableSettingsSurface = {
  contractVersion: PORTABLE_SURFACE_API_VERSION,
  id: 'fixture-settings',
  title: 'Fixture settings',
  source: { path: '/settings' },
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }],
  submit: { method: 'POST', path: '/settings', label: 'Save settings', successMessage: 'Saved.' },
  actions: [
    { id: 'discover', label: 'Discover choices', method: 'POST', path: '/discover', intent: 'discover', successMessage: 'Discovered.' },
    {
      id: 'reset',
      label: 'Reset settings',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      successMessage: 'Reset.',
      confirm: { title: 'Reset?', description: 'This clears settings.', confirmLabel: 'Reset', destructive: true },
    },
  ],
}

function extension(overrides: Record<string, jest.Mock> = {}) {
  const value = {
    loadSettings: jest.fn().mockResolvedValue({ name: 'Initial' }),
    saveSettings: jest.fn().mockResolvedValue({}),
    executeSettingsAction: jest.fn().mockResolvedValue({ choices: ['one'] }),
    ...overrides,
  }
  createClient.mockReturnValue({ extension: () => value } as unknown as ReturnType<typeof createPlatformClient>)
  return value
}

async function loadedName(view: ReturnType<typeof render>, value: string) {
  await act(async () => {
    await Promise.resolve()
  })
  const input = view.UNSAFE_getByType(TextInput)
  expect(input.props).toMatchObject({ testID: 'settings-field-name', value })
  return input
}

describe('PortableSettingsScreen', () => {
  test('loads, edits, saves, reloads, and announces success', async () => {
    const api = extension()
    const onSaved = jest.fn()
    const view = render(<PortableSettingsScreen module={moduleEntry} serviceUrl="http://fixture" backendId="local" settings={settings} onSaved={onSaved} />)
    const input = await loadedName(view, 'Initial')
    fireEvent.changeText(input, 'Updated')
    fireEvent.press(view.getByTestId('settings-submit'))
    await waitFor(() => {
      expect(api.saveSettings).toHaveBeenCalledWith(settings, { name: 'Updated' })
      expect(api.loadSettings).toHaveBeenCalledTimes(2)
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(view.getByText('Saved.')).toBeOnTheScreen()
  }, 15_000)

  test('blocks invalid values before transport', async () => {
    const api = extension({ loadSettings: jest.fn().mockResolvedValue({ name: '' }) })
    render(<PortableSettingsScreen module={moduleEntry} serviceUrl="http://fixture" backendId="local" settings={settings} />)
    await screen.findByTestId('settings-submit')
    fireEvent.press(screen.getByTestId('settings-submit'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.')
    expect(api.saveSettings).not.toHaveBeenCalled()
  })

  test('shows a load failure and retries', async () => {
    const api = extension({ loadSettings: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ name: 'Recovered' }) })
    const view = render(<PortableSettingsScreen module={moduleEntry} serviceUrl="http://fixture" backendId="local" settings={settings} />)
    expect(await screen.findByText('offline')).toBeOnTheScreen()
    fireEvent.press(screen.getByText('Retry'))
    await loadedName(view, 'Recovered')
    expect(api.loadSettings).toHaveBeenCalledTimes(2)
  })

  test('executes discovery and presents its result message', async () => {
    const api = extension()
    const view = render(<PortableSettingsScreen module={moduleEntry} serviceUrl="http://fixture" backendId="local" settings={settings} />)
    await loadedName(view, 'Initial')
    fireEvent.press(screen.getByTestId('settings-action-discover'))
    await screen.findByText('Discovered.')
    expect(api.executeSettingsAction).toHaveBeenCalledWith(settings, settings.actions?.[0], { name: 'Initial' })
  })

  test('does not reset before destructive confirmation and reloads after confirmation', async () => {
    const api = extension()
    let confirm: (() => void) | undefined
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _description, buttons) => {
      confirm = buttons?.[1]?.onPress
    })
    const view = render(<PortableSettingsScreen module={moduleEntry} serviceUrl="http://fixture" backendId="local" settings={settings} />)
    await loadedName(view, 'Initial')
    fireEvent.press(screen.getByTestId('settings-action-reset'))
    expect(api.executeSettingsAction).not.toHaveBeenCalled()
    await act(async () => confirm?.())
    await waitFor(() => expect(api.executeSettingsAction).toHaveBeenCalledWith(settings, settings.actions?.[1], { name: 'Initial' }))
    expect(api.loadSettings).toHaveBeenCalledTimes(2)
  })
})
