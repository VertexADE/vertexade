import * as SecureStore from 'expo-secure-store'
import {
  defaultMobileVoicePreferences,
  readMobileVoicePreferences,
  saveMobileVoicePreferences,
} from './mobile-voice-preferences'

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync)
const mockedSetItemAsync = jest.mocked(SecureStore.setItemAsync)

describe('mobile voice preferences', () => {
  beforeEach(() => {
    mockedGetItemAsync.mockResolvedValue(null)
  })

  test('defaults to automatic language detection and contextual cleanup', async () => {
    await expect(readMobileVoicePreferences()).resolves.toEqual(defaultMobileVoicePreferences)
  })

  test('loads a valid cleanup mode and Parakeet language', async () => {
    mockedGetItemAsync.mockResolvedValue(JSON.stringify({ cleanupMode: 'cleanup', language: 'fr' }))

    await expect(readMobileVoicePreferences()).resolves.toEqual({ cleanupMode: 'cleanup', language: 'fr' })
  })

  test('falls back safely for invalid persisted values', async () => {
    mockedGetItemAsync.mockResolvedValue(JSON.stringify({ cleanupMode: 'rewrite-everything', language: 'xx' }))

    await expect(readMobileVoicePreferences()).resolves.toEqual(defaultMobileVoicePreferences)
  })

  test('persists preferences using device-only secure storage', async () => {
    await saveMobileVoicePreferences({ cleanupMode: 'off', language: 'nl' })

    expect(mockedSetItemAsync).toHaveBeenCalledWith(
      'vertexade.mobile.voice-preferences.v1',
      JSON.stringify({ cleanupMode: 'off', language: 'nl' }),
      { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
    )
  })
})
