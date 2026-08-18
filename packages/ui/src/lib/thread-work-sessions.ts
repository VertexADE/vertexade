import {
  buildThreadWorkSessions as buildSharedThreadWorkSessions,
  type ThreadWorkSession as SharedThreadWorkSession,
} from '@vertexade/platform-contracts'
import type { TimelineEvent } from './agent-timeline'

export type ThreadWorkSession = SharedThreadWorkSession<TimelineEvent>

export function buildThreadWorkSessions(events: TimelineEvent[], threadComplete: boolean): ThreadWorkSession[] {
  return buildSharedThreadWorkSessions(events, threadComplete).map((session) => {
    if (session.complete || session.finalMessage) return session
    const finalMessageIndex = session.activity.findLastIndex(
      (event) => event.data?.presentation === 'plain_assistant_message' && event.text.trim().length > 0,
    )
    if (finalMessageIndex < 0 || finalMessageIndex !== session.activity.length - 1) return session

    const finalMessage = session.activity[finalMessageIndex]
    const activity = session.activity.filter((_, index) => index !== finalMessageIndex)
    return {
      ...session,
      activity,
      finalMessage,
      actions: activity.filter((event) => event.kind === 'action').length,
    }
  })
}
