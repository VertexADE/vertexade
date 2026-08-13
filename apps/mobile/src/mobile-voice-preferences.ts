import * as SecureStore from 'expo-secure-store'

export type TranscriptCleanupMode = 'off' | 'cleanup' | 'cleanup-and-edit'
export type TranscriptLanguage = 'auto' | 'bg' | 'hr' | 'cs' | 'da' | 'nl' | 'en' | 'et' | 'fi' | 'fr' | 'de' | 'el' | 'hu' | 'it' | 'lv' | 'lt' | 'mt' | 'pl' | 'pt' | 'ro' | 'sk' | 'sl' | 'es' | 'sv' | 'ru' | 'uk'

export type MobileVoicePreferences = {
  cleanupMode: TranscriptCleanupMode
  language: TranscriptLanguage
}

export const defaultMobileVoicePreferences: MobileVoicePreferences = { cleanupMode: 'cleanup-and-edit', language: 'auto' }
export const transcriptLanguages: Array<{ code: TranscriptLanguage; label: string }> = [
  { code: 'auto', label: 'Auto-detect' }, { code: 'bg', label: 'Bulgarian' }, { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' }, { code: 'da', label: 'Danish' }, { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' }, { code: 'et', label: 'Estonian' }, { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' }, { code: 'de', label: 'German' }, { code: 'el', label: 'Greek' },
  { code: 'hu', label: 'Hungarian' }, { code: 'it', label: 'Italian' }, { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' }, { code: 'mt', label: 'Maltese' }, { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' }, { code: 'ro', label: 'Romanian' }, { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' }, { code: 'es', label: 'Spanish' }, { code: 'sv', label: 'Swedish' },
  { code: 'ru', label: 'Russian' }, { code: 'uk', label: 'Ukrainian' },
]

const preferenceKey = 'vertexade.mobile.voice-preferences.v1'

export async function readMobileVoicePreferences(): Promise<MobileVoicePreferences> {
  const raw = await SecureStore.getItemAsync(preferenceKey)
  if (!raw) return defaultMobileVoicePreferences
  try {
    const value = JSON.parse(raw) as Partial<MobileVoicePreferences>
    return {
      cleanupMode: ['off', 'cleanup', 'cleanup-and-edit'].includes(value.cleanupMode || '') ? value.cleanupMode as TranscriptCleanupMode : defaultMobileVoicePreferences.cleanupMode,
      language: transcriptLanguages.some(({ code }) => code === value.language) ? value.language as TranscriptLanguage : 'auto',
    }
  } catch {
    return defaultMobileVoicePreferences
  }
}

export async function saveMobileVoicePreferences(value: MobileVoicePreferences): Promise<void> {
  await SecureStore.setItemAsync(preferenceKey, JSON.stringify(value), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY })
}
