import { afterEach, describe, expect, it } from 'vite-plus/test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { browseServerDirectories, DirectoryBrowserError } from './directory-browser.ts'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('browseServerDirectories', () => {
  it('returns directories only, including directory symlinks, in pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-directories-'))
    cleanup.push(root)
    await Promise.all([mkdir(join(root, 'Beta')), mkdir(join(root, 'alpha')), writeFile(join(root, 'file.txt'), 'hidden')])
    await symlink(join(root, 'Beta'), join(root, 'linked'))

    const first = await browseServerDirectories(root, 0, 2)
    expect(first.entries.map((entry) => entry.name)).toEqual(['alpha', 'Beta'])
    expect(first.total).toBe(3)
    expect(first.has_more).toBe(true)

    const second = await browseServerDirectories(root, 2, 2)
    expect(second.entries.map((entry) => entry.name)).toEqual(['linked'])
    expect(second.has_more).toBe(false)
  })

  it('rejects relative paths', async () => {
    await expect(browseServerDirectories('relative/path')).rejects.toEqual(
      expect.objectContaining<Partial<DirectoryBrowserError>>({ status: 400 }),
    )
  })
})
