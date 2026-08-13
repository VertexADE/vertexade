import { renderHook, waitFor } from '@testing-library/react-native'
import * as Haptics from 'expo-haptics'
import type { MobileThreadDetails } from '@/mobile-detail-service'
import { useSessionCompletionHaptic } from './use-session-completion-haptic'

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn().mockResolvedValue(undefined),
}))

type ThreadEvent = MobileThreadDetails['events'][number]
const completion = (id: string): ThreadEvent => ({ id, kind: 'system', title: 'Completed', text: '', time: '', status: 'completed', event: 'turn_completed' })

describe('useSessionCompletionHaptic', () => {
  beforeEach(() => jest.clearAllMocks())

  test('primes silently and haptics once for each newly completed session', async () => {
    const { rerender } = renderHook<void, { events: ThreadEvent[] }>(
      ({ events }) => useSessionCompletionHaptic('server:7', events),
      { initialProps: { events: [completion('complete-1')] } },
    )
    expect(Haptics.notificationAsync).not.toHaveBeenCalled()

    rerender({ events: [completion('complete-1'), completion('complete-2')] })
    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledWith('success'))

    rerender({ events: [completion('complete-1'), completion('complete-2')] })
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1)
  })

  test('does not haptic when opening another already-completed thread', () => {
    const { rerender } = renderHook<void, { threadKey: string; events: ThreadEvent[] }>(
      ({ threadKey, events }) => useSessionCompletionHaptic(threadKey, events),
      { initialProps: { threadKey: 'server:7', events: [completion('complete-1')] } },
    )
    rerender({ threadKey: 'server:8', events: [completion('complete-8')] })
    expect(Haptics.notificationAsync).not.toHaveBeenCalled()
  })
})
