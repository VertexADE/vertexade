import * as matchers from '@testing-library/react-native/matchers'

expect.extend(matchers)

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

jest.mock('react-native-diffs', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return { DiffsView: ReactNative.View }
})
