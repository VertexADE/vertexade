import * as matchers from '@testing-library/react-native/matchers'

expect.extend(matchers)

jest.mock('expo-widgets', () => ({
  createLiveActivity: () => ({
    getInstances: () => [],
    start: () => ({ end: jest.fn(), update: jest.fn() }),
  }),
}))

jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
)

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

jest.mock('expo-ai-kit', () => ({
  generateObject: jest.fn(async () => ({ object: { text: '' }, text: '' })),
  isAvailable: jest.fn(async () => false),
  prepareBuiltInModel: jest.fn(async () => undefined),
  sendMessage: jest.fn(async () => ({ text: '' })),
}))

jest.mock('react-native-diffs', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return { DiffsView: ReactNative.View }
})
