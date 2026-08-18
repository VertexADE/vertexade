type McpResource = {
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
}

export function safeAgentPluginLink(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

export function mcpResourceDescription(item: McpResource) {
  return item.transport === 'stdio' ? `${item.command} ${(item.args || []).join(' ')}` : item.url
}
