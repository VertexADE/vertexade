export function displayMobileFilePath(path: string, worktreePath = ''): string {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedRoot = worktreePath.replaceAll('\\', '/').replace(/\/$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) return normalizedPath.slice(normalizedRoot.length + 1)

  const workItemPath = normalizedPath.match(/\/\.vertex-ade\/work-items\/[^/]+\/(.+)$/)?.[1]
  if (workItemPath) return workItemPath

  return normalizedPath
    .replace(/^\/Users\/[^/]+\//, '~/')
    .replace(/^\/home\/[^/]+\//, '~/')
}
