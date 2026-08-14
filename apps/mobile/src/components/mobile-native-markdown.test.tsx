import { fireEvent, render, screen } from '@testing-library/react-native'
import { MobileNativeMarkdown } from './mobile-native-markdown'

describe('MobileNativeMarkdown', () => {
  test('renders formatted content and opens links without a web view', () => {
    const onOpenLink = jest.fn()
    render(<MobileNativeMarkdown content={'Result: **done** via [source](https://example.com).'} tone="default" onOpenLink={onOpenLink} />)

    expect(screen.getByText('done')).toHaveStyle({ fontWeight: '700' })
    fireEvent.press(screen.getByRole('link'))
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com')
  })

  test('renders details lazily and removes html comments', () => {
    render(<MobileNativeMarkdown content={'<!-- hidden --><details><summary>More</summary>Visible **detail**</details>'} tone="default" onOpenLink={jest.fn()} />)

    expect(screen.queryByText(/hidden/)).not.toBeOnTheScreen()
    expect(screen.queryByText('detail')).not.toBeOnTheScreen()
    fireEvent.press(screen.getByRole('button'))
    expect(screen.getByText('detail')).toHaveStyle({ fontWeight: '700' })
  })
})
