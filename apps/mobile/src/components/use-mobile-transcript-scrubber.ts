import { useState } from 'react'
import { applyDictationToDraft, scrubTranscript } from '@/mobile-transcript-scrubber'
import type { MobileVoicePreferences } from '@/mobile-voice-preferences'

export function useMobileTranscriptScrubber(onChange: (value: string) => void, preferences: MobileVoicePreferences) {
  const [scrubbing, setScrubbing] = useState(false)
  const [error, setError] = useState('')

  async function scrub(value: string) {
    if (!value.trim() || scrubbing) return
    setScrubbing(true)
    setError('')
    try {
      onChange(preferences.cleanupMode === 'off' ? value : await scrubTranscript(value, preferences.language))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not clean up this text')
    } finally {
      setScrubbing(false)
    }
  }

  async function applyDictation(existingDraft: string, transcript: string) {
    if (!transcript.trim() || scrubbing) return
    setScrubbing(true)
    setError('')
    try {
      if (preferences.cleanupMode === 'off') onChange([existingDraft.trim(), transcript.trim()].filter(Boolean).join(' '))
      else if (preferences.cleanupMode === 'cleanup') onChange([existingDraft.trim(), await scrubTranscript(transcript, preferences.language)].filter(Boolean).join(' '))
      else onChange(await applyDictationToDraft(existingDraft, transcript, preferences.language))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not apply this voice edit')
    } finally {
      setScrubbing(false)
    }
  }

  return { applyDictation, error, scrub, scrubbing }
}
