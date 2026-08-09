import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { runCommand } from '../process.ts'
import { populateWorktreeSnapshot } from './worktree-snapshot.ts'

async function git(path: string, ...args: string[]) {
  return runCommand('git', ['-C', path, ...args])
}

async function repositories() {
  const root = await mkdtemp(join(tmpdir(), 'vertexade-review-snapshot-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  await runCommand('git', ['init', source])
  await git(source, 'config', 'user.name', 'Snapshot Test')
  await git(source, 'config', 'user.email', 'snapshot@example.test')
  await writeFile(join(source, 'tracked.txt'), 'base\n')
  await writeFile(join(source, 'staged.txt'), 'base\n')
  await git(source, 'add', '.')
  await git(source, 'commit', '-m', 'base')
  await runCommand('git', ['clone', source, destination])
  return { source, destination }
}

describe('populateWorktreeSnapshot', () => {
  it('copies staged, unstaged, and untracked files without changing the source', async () => {
    const { source, destination } = await repositories()
    await writeFile(join(source, 'staged.txt'), 'staged change\n')
    await git(source, 'add', 'staged.txt')
    await writeFile(join(source, 'tracked.txt'), 'unstaged change\n')
    await writeFile(join(source, 'untracked.txt'), 'untracked change\n')
    const sourceStatus = await git(source, 'status', '--short')

    await populateWorktreeSnapshot(source, destination, runCommand)

    expect(await readFile(join(destination, 'staged.txt'), 'utf8')).toBe('staged change\n')
    expect(await readFile(join(destination, 'tracked.txt'), 'utf8')).toBe('unstaged change\n')
    expect(await readFile(join(destination, 'untracked.txt'), 'utf8')).toBe('untracked change\n')
    expect(await git(source, 'status', '--short')).toBe(sourceStatus)
  })

  it('refuses untracked symbolic links instead of exposing files outside the snapshot', async () => {
    const { source, destination } = await repositories()
    await symlink('/etc/passwd', join(source, 'unsafe-link'))
    await expect(populateWorktreeSnapshot(source, destination, runCommand)).rejects.toThrow(
      'Cannot safely snapshot untracked symbolic link',
    )
  })
})
