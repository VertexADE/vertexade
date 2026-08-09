import { Alert } from 'react-native'
import { confirmDestructive } from './confirm-destructive'

describe('confirmDestructive', () => {
  test.each([
    ['cancel', false],
    ['dismiss', false],
    ['confirm', true],
  ] as const)('resolves %s safely', async (choice, expected) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _description, buttons, options) => {
      if (choice === 'cancel') buttons?.[0]?.onPress?.()
      else if (choice === 'confirm') buttons?.[1]?.onPress?.()
      else options?.onDismiss?.()
    })
    await expect(confirmDestructive('Reset?', 'This clears configuration.', 'Reset')).resolves.toBe(expected)
    expect(alert).toHaveBeenCalledWith(
      'Reset?',
      'This clears configuration.',
      expect.arrayContaining([expect.objectContaining({ text: 'Cancel' }), expect.objectContaining({ text: 'Reset', style: 'destructive' })]),
      expect.objectContaining({ cancelable: true }),
    )
  })

  test('settles only once when a native host dismisses after confirmation', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _description, buttons, options) => {
      buttons?.[1]?.onPress?.()
      options?.onDismiss?.()
    })
    await expect(confirmDestructive('Reset?', 'This clears configuration.', 'Reset')).resolves.toBe(true)
  })
})
