import {
  buildThreadWorkSessions as buildSharedThreadWorkSessions,
  type ThreadWorkSession as SharedThreadWorkSession,
} from '@vertexade/platform-contracts'
import type { TimelineEvent } from './agent-timeline'

export type ThreadWorkSession = SharedThreadWorkSession<TimelineEvent>

export function buildThreadWorkSessions(events: TimelineEvent[], threadComplete: boolean): ThreadWorkSession[] {
  return buildSharedThreadWorkSessions(events, threadComplete)
}
