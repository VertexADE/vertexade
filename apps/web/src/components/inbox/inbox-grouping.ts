import type { InboxItem } from './inbox-types'

export type InboxGroup = { key: string; items: InboxItem[] }

export function groupInboxItems(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxItem[]>()
  for (const item of items) {
    const key = [item.severity, item.type, item.source, item.title.trim().toLowerCase()].join('::')
    groups.set(key, [...(groups.get(key) || []), item])
  }
  return [...groups].map(([key, groupedItems]) => ({ key, items: groupedItems }))
}
