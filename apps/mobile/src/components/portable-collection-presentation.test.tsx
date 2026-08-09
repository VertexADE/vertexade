import { fireEvent, render, screen } from '@testing-library/react-native'
import { CollectionScreenState } from './portable-collection-presentation'

describe('CollectionScreenState', () => {
  test.each([
    ['Loading Work', 'Fetching current work…', true],
    ['No Work yet', 'Create an outcome to get started.', false],
    ['Work unavailable', 'The fixture API could not be reached.', false],
  ])('renders %s', (title, text, loading) => {
    render(<CollectionScreenState title={title} text={text} loading={loading} />)
    expect(screen.getByText(title)).toBeOnTheScreen()
    expect(screen.getByText(text)).toBeOnTheScreen()
  })

  test('offers retry only when an action is provided', () => {
    const retry = jest.fn()
    render(<CollectionScreenState title="Work unavailable" text="Offline" action="Retry" onAction={retry} />)
    fireEvent.press(screen.getByText('Retry'))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
