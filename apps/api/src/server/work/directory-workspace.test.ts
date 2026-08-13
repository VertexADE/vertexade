import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { applyDirectoryWorkspace, previewDirectoryApply } from './directory-workspace.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vertexade-directory-workspace-'))
  const source = join(root, 'source')
  const workspace = join(root, 'workspace')
  const baseline = `${workspace}.baseline`
  await Promise.all([mkdir(source), mkdir(workspace), mkdir(baseline)])
  for (const directory of [source, workspace, baseline]) await writeFile(join(directory, 'value.txt'), 'before')
  return { source, workspace }
}

describe('directory workspace apply', () => {
  it('previews and applies an isolated copy without replacing unrelated source files', async () => {
    const { source, workspace } = await fixture()
    await writeFile(join(source, 'source-only.txt'), 'keep')
    await writeFile(join(workspace, 'value.txt'), 'after')
    await writeFile(join(workspace, 'new.txt'), 'new')

    const preview = await previewDirectoryApply(source, workspace, 'copy')
    expect(preview).toMatchObject({ changed: ['new.txt', 'value.txt'], conflicts: [] })
    await applyDirectoryWorkspace(source, workspace, 'copy')

    await expect(readFile(join(source, 'value.txt'), 'utf8')).resolves.toBe('after')
    await expect(readFile(join(source, 'new.txt'), 'utf8')).resolves.toBe('new')
    await expect(readFile(join(source, 'source-only.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('blocks apply when an affected source path changed after isolation', async () => {
    const { source, workspace } = await fixture()
    await writeFile(join(source, 'value.txt'), 'source changed')
    await writeFile(join(workspace, 'value.txt'), 'workspace changed')

    await expect(applyDirectoryWorkspace(source, workspace, 'copy')).rejects.toThrow('source directory changed')
  })

  it('replaces the source only after staging move-mode output', async () => {
    const { source, workspace } = await fixture()
    await writeFile(join(workspace, 'value.txt'), 'replacement')

    await applyDirectoryWorkspace(source, workspace, 'move')

    await expect(readFile(join(source, 'value.txt'), 'utf8')).resolves.toBe('replacement')
  })
})
