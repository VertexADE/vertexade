import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { readdir, realpath, stat } from 'node:fs/promises'

export type ServerDirectoryListing = {
  path: string
  parent: string | null
  home: string
  entries: Array<{ name: string; path: string }>
  offset: number
  limit: number
  total: number
  has_more: boolean
}

export class DirectoryBrowserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function statusForFileError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === 'EACCES' || code === 'EPERM') return 403
  if (code === 'ENOENT') return 404
  if (code === 'ENOTDIR') return 400
  return 500
}

export async function browseServerDirectories(
  requestedPath?: string,
  requestedOffset = 0,
  requestedLimit = 100,
): Promise<ServerDirectoryListing> {
  const home = homedir()
  const input = requestedPath?.trim() || home
  if (!isAbsolute(input)) throw new DirectoryBrowserError('Directory path must be absolute', 400)

  const offset = Math.max(0, Math.trunc(requestedOffset) || 0)
  const limit = Math.min(200, Math.max(1, Math.trunc(requestedLimit) || 100))
  let path: string
  try {
    path = await realpath(resolve(input))
    if (!(await stat(path)).isDirectory()) throw new DirectoryBrowserError('Path is not a directory', 400)
  } catch (error) {
    if (error instanceof DirectoryBrowserError) throw error
    throw new DirectoryBrowserError(error instanceof Error ? error.message : 'Directory could not be opened', statusForFileError(error))
  }

  try {
    const candidates = await readdir(path, { withFileTypes: true })
    const directories = (
      await Promise.all(
        candidates.map(async (entry) => {
          const entryPath = resolve(path, entry.name)
          if (entry.isDirectory()) return { name: entry.name, path: entryPath }
          if (!entry.isSymbolicLink()) return null
          try {
            return (await stat(entryPath)).isDirectory() ? { name: entry.name, path: entryPath } : null
          } catch {
            return null
          }
        }),
      )
    )
      .filter((entry): entry is { name: string; path: string } => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))

    return {
      path,
      parent: dirname(path) === path ? null : dirname(path),
      home,
      entries: directories.slice(offset, offset + limit),
      offset,
      limit,
      total: directories.length,
      has_more: offset + limit < directories.length,
    }
  } catch (error) {
    throw new DirectoryBrowserError(error instanceof Error ? error.message : 'Directory could not be listed', statusForFileError(error))
  }
}
