export type ConventionalTitle = {
  type: string
  scope: string | null
  breaking: boolean
  subject: string
}

export function parseConventionalTitle(title: string): ConventionalTitle | null {
  const match = title.trim().match(/^([a-z][a-z\d-]*)(?:\(([^()\r\n]+)\))?(!)?:\s+(.+)$/i)
  if (!match) return null
  return {
    type: match[1].toLowerCase(),
    scope: match[2]?.trim() || null,
    breaking: Boolean(match[3]),
    subject: match[4].trim(),
  }
}
