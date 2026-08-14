type McpStatus = { name?: string; tools?: Record<string, unknown> }

export function resumedThreadNeedsMcpMigration(requiredServerName: string | null, statuses: McpStatus[]) {
  if (!requiredServerName) return false
  const server = statuses.find((status) => status.name === requiredServerName)
  return !server || !Object.hasOwn(server.tools || {}, 'form')
}
