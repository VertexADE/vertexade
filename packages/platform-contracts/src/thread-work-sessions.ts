export type WorkSessionEvent = {
  key: string
  kind: string
  text: string
  time?: string | null
}

export type ThreadWorkSession<Event extends WorkSessionEvent = WorkSessionEvent> = {
  key: string
  complete: boolean
  trigger?: Event
  activity: Event[]
  finalMessage?: Event
  changes?: Event
  duration: string
  actions: number
}

export function buildThreadWorkSessions<Event extends WorkSessionEvent>(
  events: Event[],
  threadComplete: boolean,
): Array<ThreadWorkSession<Event>> {
  const groups: Event[][] = []
  let current: Event[] = []
  for (const event of events) {
    if (event.kind === 'user_message' && current.length) {
      groups.push(current)
      current = []
    }
    current.push(event)
    if (event.kind === 'completed') {
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)

  return groups.map((messages, index) => {
    const triggerIndex = messages.findIndex((event) => event.kind === 'user_message' && event.text.trim())
    const complete = messages.some((event) => event.kind === 'completed') || (threadComplete && index === groups.length - 1)
    const finalIndex = complete ? findFinalMessage(messages) : -1
    const changesIndex = findLastEvent(messages, (event) => event.kind === 'changes')
    const activity = messages.filter(
      (event, messageIndex) =>
        messageIndex !== triggerIndex &&
        messageIndex !== finalIndex &&
        event.kind !== 'changes' &&
        messages[messageIndex].kind !== 'completed',
    )
    return {
      key: messages[0]?.key || `session-${index}`,
      complete,
      trigger: triggerIndex >= 0 ? messages[triggerIndex] : undefined,
      activity,
      finalMessage: finalIndex >= 0 ? messages[finalIndex] : undefined,
      changes: changesIndex >= 0 ? messages[changesIndex] : undefined,
      duration: sessionDuration(messages),
      actions: activity.filter((event) => event.kind === 'action').length,
    }
  })
}

function findLastEvent<Event>(events: Event[], predicate: (event: Event) => boolean) {
  for (let index = events.length - 1; index >= 0; index -= 1) if (predicate(events[index])) return index
  return -1
}

function findFinalMessage<Event extends WorkSessionEvent>(events: Event[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.kind === 'message' && event.text.trim()) return index
  }
  return -1
}

function sessionDuration(events: WorkSessionEvent[]) {
  const times = events.map((event) => Date.parse(event.time || '')).filter(Number.isFinite)
  if (times.length < 2) return 'a moment'
  const seconds = Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1_000))
  if (seconds < 60) return seconds < 5 ? 'a moment' : `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}
