export type InboxSeverity = 'info' | 'warning' | 'error'
export type InboxState = 'open' | 'saved' | 'snoozed' | 'done'
export type InboxView = 'action' | 'updates' | Exclude<InboxState, 'open'>

export type InboxSearch = {
  queue?: InboxView
  severity?: InboxSeverity
  type?: string
  source?: string
  q?: string
}

export type InboxItem = {
  id: string
  type: string
  severity: InboxSeverity
  title: string
  summary: string
  source: string
  createdAt: string
  href: string | null
  actionLabel?: string
  unread: boolean
  triageState: InboxState
  snoozedUntil: string | null
}

export type InboxResult = {
  items: InboxItem[]
  summary: { total: number; errors: number; warnings: number; unread: number }
}
