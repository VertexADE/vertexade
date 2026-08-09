function truncatePreview(value: string, maximum: number) {
  if (value.length <= maximum) return value
  const candidate = value.slice(0, maximum + 1)
  const sentenceEnd = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '))
  const wordEnd = candidate.lastIndexOf(' ')
  const end = sentenceEnd >= maximum * 0.6 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : maximum
  return `${value.slice(0, end).trimEnd()}…`
}

export function activityPreview(value?: string | null, maximum = 220) {
  if (!value) return 'No activity recorded'
  const normalized = value
    .replace(/```[\s\S]*?```/g, ' Code change ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[\*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^Review summary\s*/i, '')
    .trim()
  return truncatePreview(normalized, maximum)
}
