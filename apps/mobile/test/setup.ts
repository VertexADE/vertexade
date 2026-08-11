import * as matchers from '@testing-library/react-native/matchers'

expect.extend(matchers)

jest.mock('react-native-diffs', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return { DiffsView: ReactNative.View }
})
