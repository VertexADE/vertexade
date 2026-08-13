import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { onModelLoadProgress, StreamingASRManager, type ModelLoadProgressEvent, type StreamingUpdate } from '@fluidinference/react-native-fluidaudio'
import { warmMobileVoiceModel } from '@/mobile-voice-model'

type VoiceState = 'idle' | 'preparing' | 'listening' | 'finishing'

export function useMobileVoiceInput(onTranscript: (text: string) => void | Promise<void>) {
  const manager = useRef<StreamingASRManager | null>(null)
  const [state, setState] = useState<VoiceState>('idle')
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [modelProgress, setModelProgress] = useState<ModelLoadProgressEvent | null>(null)

  useEffect(
    () => {
      void warmMobileVoiceModel().catch(() => undefined)
      return () => {
        if (manager.current?.isStreaming()) void manager.current.stop()
      }
    },
    [],
  )

  async function start() {
    if (Platform.OS !== 'ios') {
      setError('FluidAudio voice input currently requires iOS 17 or newer.')
      return
    }
    setError('')
    setPreview('')
    setModelProgress({ type: 'asr', status: 'compiling', progress: 0 })
    setState('preparing')
    const progressSubscription = onModelLoadProgress((event) => {
      if (!event.type || event.type === 'asr') setModelProgress(event)
    })
    try {
      const streaming = manager.current || new StreamingASRManager()
      manager.current = streaming
      await warmMobileVoiceModel()
      await streaming.start({ source: 'microphone' }, updatePreview)
      setModelProgress(null)
      setState('listening')
    } catch (reason) {
      setError(errorMessage(reason, 'Could not start voice input'))
      setState('idle')
      setModelProgress(null)
    } finally {
      progressSubscription.remove()
    }
  }

  async function stop() {
    const streaming = manager.current
    if (!streaming?.isStreaming()) return
    setState('finishing')
    try {
      const result = await streaming.stop()
      const transcript = result.text.trim() || preview.trim()
      if (transcript) await onTranscript(transcript)
      setPreview('')
    } catch (reason) {
      setError(errorMessage(reason, 'Could not finish voice input'))
    } finally {
      setState('idle')
    }
  }

  function updatePreview(update: StreamingUpdate) {
    setPreview([update.confirmed, update.volatile].filter(Boolean).join(' ').trim())
  }

  return { state, preview, error, modelProgress, active: state !== 'idle', toggle: () => void (state === 'listening' ? stop() : state === 'idle' ? start() : undefined) }
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}
