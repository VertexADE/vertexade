import { describe, expect, it } from 'vite-plus/test'
import { groupInboxItems } from './inbox-grouping'
import type { InboxItem } from './inbox-types'

function item(id: string, title: string, source = 'Automation'): InboxItem {
  return {
    id,
    title,
    source,
    type: 'notification',
    severity: 'error',
    summary: `Failure ${id}`,
    createdAt: '2026-08-03T08:00:00.000Z',
    href: null,
    unread: true,
    triageState: 'open',
    snoozedUntil: null,
  }
}

describe('groupInboxItems', () => {
  it('groups repeated signals while preserving event order', () => {
    const grouped = groupInboxItems([item('1', 'Task failed'), item('2', ' task failed '), item('3', 'Review failed')])

    expect(grouped).toHaveLength(2)
    expect(grouped[0].items.map(({ id }) => id)).toEqual(['1', '2'])
    expect(grouped[1].items.map(({ id }) => id)).toEqual(['3'])
  })

  it('keeps the same title from different sources separate', () => {
    expect(groupInboxItems([item('1', 'Task failed'), item('2', 'Task failed', 'GitHub')])).toHaveLength(2)
  })
})
