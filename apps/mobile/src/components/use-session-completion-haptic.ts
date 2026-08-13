import { useEffect, useRef } from 'react'
import * as Haptics from 'expo-haptics'
import type { MobileThreadDetails } from '@/mobile-detail-service'

export function useSessionCompletionHaptic(threadKey: string, events: MobileThreadDetails['events'] | undefined) {
  const latestByThread = useRef(new Map<string, string>())
  const latestCompletion = latestCompletionId(events)
  useEffect(() => {
    if (!latestCompletion) return
    const previous = latestByThread.current.get(threadKey)
    latestByThread.current.set(threadKey, latestCompletion)
    if (previous === undefined || previous === latestCompletion) return
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((reason: unknown) => {
      console.warn('Could not play session completion haptic', reason)
    })
  }, [latestCompletion, threadKey])
}

function latestCompletionId(events: MobileThreadDetails['events'] | undefined): string | null {
  if (!events) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.event.toLowerCase().replaceAll('-', '_') === 'turn_completed') return event.id
  }
  return null
}
