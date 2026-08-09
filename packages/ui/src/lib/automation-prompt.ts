export type AutomationPromptSummary = {
  flow: string
  phase: string
  instruction: string
  subject: string
  reason: string
  repository: string
  entityTitle: string
  entityNumber: string
  state: string
}

type JsonRecord = Record<string, unknown>

export function automationPromptSummary(text: string): AutomationPromptSummary | null {
  const header = text.match(/^\[Automation flow:\s*(.+?)\]\s*\n\[Phase\s+(.+?)\]\s*\n/i)
  if (!header) return null

  const marker = '\nTrigger context:\n'
  const markerIndex = text.indexOf(marker, header[0].length)
  if (markerIndex < 0) return null

  const instruction = text.slice(header[0].length, markerIndex).trim()
  const context = parseLeadingObject(text.slice(markerIndex + marker.length))
  if (!context) return null

  const data = record(context.data)
  const entity = record(data.entity)
  return {
    flow: header[1]?.trim() || 'Automation',
    phase: header[2]?.trim() || 'Current phase',
    instruction,
    subject: stringValue(context.subject),
    reason: humanize(stringValue(data.reason)),
    repository: stringValue(entity.repository),
    entityTitle: stringValue(entity.title),
    entityNumber: stringValue(entity.number),
    state: humanize(stringValue(entity.merge_state_status)),
  }
}

function parseLeadingObject(text: string): JsonRecord | null {
  const source = text.match(/^\s*(\{[\s\S]*?\n\})\s*(?:\n|$)/)?.[1]
  if (!source) return null
  try {
    return record(JSON.parse(source))
  } catch {
    return null
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function humanize(value: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bPr\b/g, 'PR')
}
