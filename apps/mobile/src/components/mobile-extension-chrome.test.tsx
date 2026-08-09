import { fireEvent, render, screen } from '@testing-library/react-native'
import { MobileExtensionState, MobileExtensionTabs } from './mobile-extension-chrome'

describe('MobileExtensionTabs', () => {
  test('switches between workspace and settings', () => {
    const onChange = jest.fn()
    render(<MobileExtensionTabs mode="workspace" onChange={onChange} />)
    fireEvent.press(screen.getByText('Settings'))
    expect(onChange).toHaveBeenCalledWith('settings')
    fireEvent.press(screen.getByText('Workspace'))
    expect(onChange).toHaveBeenCalledWith('workspace')
  })
})

describe('MobileExtensionState', () => {
  test('renders a loading state', () => {
    render(<MobileExtensionState loading text="Loading extension contract…" />)
    expect(screen.getByText('Loading extension contract…')).toBeOnTheScreen()
  })

  test('renders an actionable error description', () => {
    render(<MobileExtensionState title="Extension unavailable" text="This extension is no longer installed." />)
    expect(screen.getByText('Extension unavailable')).toBeOnTheScreen()
    expect(screen.getByText('This extension is no longer installed.')).toBeOnTheScreen()
  })
})
