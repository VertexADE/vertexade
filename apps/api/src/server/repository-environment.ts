import { chmod, copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export type RepositoryEnvironmentEntry = {
  relativePath: string
  kind: 'file' | 'directory'
}

function isWithin(root: string, candidate: string) {
  const relation = relative(resolve(root), resolve(candidate))
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

function pathValue(value: unknown) {
  return String(typeof value === 'object' && value !== null && 'path' in value ? value.path : value).trim()
}

function validateRelativePath(path: string) {
  if (!path || path.length > 500) throw new Error('Environment paths must contain 1–500 characters')
  if (/[\u0000-\u001f\u007f]/.test(path) || isAbsolute(path))
    throw new Error(`Environment path must be relative and contain no control characters: ${path}`)
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  const segments = normalized.split('/')
  if (normalized !== path || segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Environment path must use a normalized repository-relative path: ${path}`)
  }
  if (normalized === '.git' || normalized.startsWith('.git/')) throw new Error('The .git directory cannot be shared with worktrees')
  return normalized
}

function assertNoOverlappingPaths(paths: string[]) {
  const ordered = [...paths].sort((left, right) => left.localeCompare(right))
  for (const [index, parent] of ordered.entries()) {
    const nested = ordered.find((candidate, candidateIndex) => candidateIndex !== index && candidate.startsWith(`${parent}/`))
    if (nested) throw new Error(`Environment paths cannot overlap: ${parent} and ${nested}`)
  }
}

export function normalizeRepositoryEnvironmentPaths(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('Environment paths must be an array')
  if (input.length > 50) throw new Error('A repository can have at most 50 environment paths')
  const paths = input.map(pathValue).map(validateRelativePath)
  if (new Set(paths).size !== paths.length) throw new Error('Environment paths must be unique')
  assertNoOverlappingPaths(paths)
  return paths
}

async function validateSnapshotSource(source: string): Promise<RepositoryEnvironmentEntry['kind']> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error('Symbolic links cannot be used as environment snapshot sources')
  if (info.isFile()) return 'file'
  if (info.isDirectory()) {
    for (const child of await readdir(source)) await validateSnapshotSource(resolve(source, child))
    return 'directory'
  }
  throw new Error('Environment snapshot sources must be regular files or directories')
}

export async function inspectRepositoryEnvironmentEntries(repositoryRoot: string, input: unknown): Promise<RepositoryEnvironmentEntry[]> {
  const paths = normalizeRepositoryEnvironmentPaths(input)
  return Promise.all(
    paths.map(async (relativePath) => {
      const source = resolve(repositoryRoot, relativePath)
      if (!isWithin(repositoryRoot, source)) throw new Error(`Environment path escapes the repository: ${relativePath}`)
      try {
        return { relativePath, kind: await validateSnapshotSource(source) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new Error(`Environment path does not exist in the repository checkout: ${relativePath}`)
        throw new Error(`Cannot use ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
}

async function assertDestinationMissing(destination: string, relativePath: string) {
  try {
    await lstat(destination)
    throw new Error(`Cannot snapshot ${relativePath}: the destination already exists in the worktree`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function copySnapshotNode(source: string, destination: string, relativePath: string): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Cannot snapshot ${relativePath}: symbolic links are not supported`)
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: false, mode: info.mode })
    for (const child of await readdir(source)) {
      await copySnapshotNode(resolve(source, child), resolve(destination, child), `${relativePath}/${child}`)
    }
    await chmod(destination, info.mode)
    return
  }
  if (!info.isFile()) throw new Error(`Cannot snapshot ${relativePath}: only regular files and directories are supported`)
  await copyFile(source, destination, constants.COPYFILE_EXCL)
  await chmod(destination, info.mode)
}

export async function snapshotRepositoryEnvironment(repositoryRoot: string, worktreeRoot: string, entries: RepositoryEnvironmentEntry[]) {
  const paths = normalizeRepositoryEnvironmentPaths(entries.map(({ relativePath }) => relativePath))
  await inspectRepositoryEnvironmentEntries(repositoryRoot, paths)
  for (const relativePath of paths) {
    const source = resolve(repositoryRoot, relativePath)
    const destination = resolve(worktreeRoot, relativePath)
    if (!isWithin(repositoryRoot, source) || !isWithin(worktreeRoot, destination)) {
      throw new Error(`Environment path escapes its repository root: ${relativePath}`)
    }
    await assertDestinationMissing(destination, relativePath)
  }
  for (const relativePath of paths) {
    const source = resolve(repositoryRoot, relativePath)
    const destination = resolve(worktreeRoot, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    await copySnapshotNode(source, destination, relativePath)
  }
}
