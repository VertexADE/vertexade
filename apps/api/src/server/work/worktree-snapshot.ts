import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

type Run = (command: string, args: string[], options?: { input?: string; maxOutputBytes?: number }) => Promise<string>

function snapshotPath(root: string, relativePath: string) {
  if (!relativePath || relativePath.includes('\0')) throw new Error('The source worktree contains an invalid untracked path')
  const target = resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`Untracked path escapes the worktree: ${relativePath}`)
  return target
}

async function pathExists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function copySnapshotEntry(sourceRoot: string, destinationRoot: string, relativePath: string) {
  const source = snapshotPath(sourceRoot, relativePath)
  const destination = snapshotPath(destinationRoot, relativePath)
  if (await pathExists(destination)) return
  const entry = await lstat(source)
  if (entry.isSymbolicLink()) throw new Error(`Cannot safely snapshot untracked symbolic link: ${relativePath}`)
  if (entry.isDirectory()) {
    await mkdir(destination, { recursive: true })
    for (const child of await readdir(source)) await copySnapshotEntry(sourceRoot, destinationRoot, join(relativePath, child))
    return
  }
  if (!entry.isFile()) throw new Error(`Cannot snapshot unsupported untracked entry: ${relativePath}`)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}

export async function populateWorktreeSnapshot(sourcePath: string, destinationPath: string, run: Run) {
  const maximumSnapshotBytes = 50 * 1024 * 1024
  const trackedChanges = await run('git', ['-C', sourcePath, 'diff', '--binary', 'HEAD', '--'], {
    maxOutputBytes: maximumSnapshotBytes,
  })
  if (trackedChanges)
    await run('git', ['-C', destinationPath, 'apply', '--whitespace=nowarn', '-'], {
      input: trackedChanges,
      maxOutputBytes: maximumSnapshotBytes,
    })
  const untracked = await run('git', ['-C', sourcePath, 'ls-files', '--others', '--exclude-standard', '-z'], {
    maxOutputBytes: maximumSnapshotBytes,
  })
  for (const relativePath of untracked.split('\0').filter(Boolean)) await copySnapshotEntry(sourcePath, destinationPath, relativePath)
}
