import { createHash } from 'node:crypto'
import type { TriggerEvent } from '@vertexade/platform-contracts'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function automationEventIdempotencyKey(triggerId: string | null, event?: TriggerEvent): string | null {
  if (!triggerId || !event) return null
  const eventId = String(event.id || '').trim()
  if (eventId && !eventId.startsWith('platform:')) return `event:${eventId}`.slice(0, 200)
  const revision = JSON.stringify(
    stableValue({
      triggerId,
      subject: event.subject || null,
      data: event.data ?? null,
    }),
  )
  return `revision:${createHash('sha256').update(revision).digest('hex')}`
}
