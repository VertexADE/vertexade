import { describe, expect, it } from 'vite-plus/test'
import { automationEventIdempotencyKey } from './automation-idempotency.ts'

describe('automation event idempotency', () => {
  it('uses a provider event id when one is available', () => {
    expect(
      automationEventIdempotencyKey('source.changed', {
        id: 'delivery-42',
        occurredAt: '2026-07-24T10:00:00Z',
        data: { revision: 'abc' },
      }),
    ).toBe('event:delivery-42')
  })

  it('deduplicates equivalent platform revisions despite volatile event metadata and key order', () => {
    const first = automationEventIdempotencyKey('core.work-item-changed', {
      id: 'platform:100:1',
      occurredAt: '2026-07-24T10:00:00Z',
      subject: 'work-item:7',
      data: { reason: 'work_item_updated', entity: { title: 'Repair', state: 'active' } },
    })
    const duplicate = automationEventIdempotencyKey('core.work-item-changed', {
      id: 'platform:200:2',
      occurredAt: '2026-07-24T10:01:00Z',
      subject: 'work-item:7',
      data: { entity: { state: 'active', title: 'Repair' }, reason: 'work_item_updated' },
    })
    expect(duplicate).toBe(first)
  })

  it('allows a new run when the target revision changes', () => {
    const first = automationEventIdempotencyKey('core.work-item-changed', {
      subject: 'work-item:7',
      data: { reason: 'work_item_updated', entity: { state: 'active' } },
    })
    const changed = automationEventIdempotencyKey('core.work-item-changed', {
      subject: 'work-item:7',
      data: { reason: 'work_item_updated', entity: { state: 'done' } },
    })
    expect(changed).not.toBe(first)
  })

  it('leaves manual runs intentionally repeatable', () => {
    expect(automationEventIdempotencyKey(null, undefined)).toBeNull()
  })
})
