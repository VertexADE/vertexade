import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

type Entry = { kind: 'file' | 'directory'; hash?: string }
export type DirectoryApplyPreview = { strategy: 'copy' | 'move'; changed: string[]; deleted: string[]; conflicts: string[] }

async function inventory(root: string, current = root, result = new Map<string, Entry>()) {
  for (const name of await readdir(current)) {
    const path = join(current, name)
    const key = relative(root, path)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`Directory workspaces do not support symbolic links: ${key}`)
    if (info.isDirectory()) {
      result.set(key, { kind: 'directory' })
      await inventory(root, path, result)
    } else if (info.isFile()) {
      result.set(key, {
        kind: 'file',
        hash: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      })
    } else throw new Error(`Directory workspaces do not support special files: ${key}`)
  }
  return result
}

function same(left?: Entry, right?: Entry) {
  return left?.kind === right?.kind && left?.hash === right?.hash
}

export async function previewDirectoryApply(source: string, workspace: string, strategy: 'copy' | 'move'): Promise<DirectoryApplyPreview> {
  const [baseline, currentSource, currentWorkspace] = await Promise.all([
    inventory(`${workspace}.baseline`),
    inventory(source),
    inventory(workspace),
  ])
  const paths = new Set([...baseline.keys(), ...currentWorkspace.keys()])
  const changed = [...paths].filter((path) => !same(baseline.get(path), currentWorkspace.get(path))).sort()
  const deleted = changed.filter((path) => !currentWorkspace.has(path))
  const conflicts = changed.filter((path) => !same(baseline.get(path), currentSource.get(path))).sort()
  return { strategy, changed, deleted, conflicts }
}

async function applyCopy(source: string, workspace: string, preview: DirectoryApplyPreview) {
  for (const path of preview.deleted.sort((left, right) => right.length - left.length))
    await rm(join(source, path), { recursive: true, force: true })
  for (const path of preview.changed.filter((path) => !preview.deleted.includes(path))) {
    const from = join(workspace, path)
    const to = join(source, path)
    const info = await lstat(from)
    if (info.isDirectory()) await mkdir(to, { recursive: true })
    else {
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { force: true })
    }
  }
}

async function applyMove(source: string, workspace: string) {
  const parent = dirname(source)
  const token = randomUUID().slice(0, 8)
  const staging = join(parent, `.${basename(source)}.vertexade-staging-${token}`)
  const backup = join(parent, `.${basename(source)}.vertexade-backup-${token}`)
  await cp(workspace, staging, { recursive: true, errorOnExist: true, force: false })
  await rename(source, backup)
  try {
    await rename(staging, source)
  } catch (error) {
    await rename(backup, source)
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  await rm(backup, { recursive: true, force: true })
}

export async function applyDirectoryWorkspace(source: string, workspace: string, strategy: 'copy' | 'move') {
  if (resolve(source) === resolve(workspace)) throw new Error('Direct workspaces do not need to be applied')
  const preview = await previewDirectoryApply(source, workspace, strategy)
  if (preview.conflicts.length)
    throw new Error(`The source directory changed in ${preview.conflicts.length} affected path(s); resolve conflicts before applying`)
  if (strategy === 'move') await applyMove(source, workspace)
  else await applyCopy(source, workspace, preview)
  return preview
}
