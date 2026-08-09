import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { cleanupFailedCompose, removeComposePreview } from './container-lifecycle.ts'

const directories: string[] = []

afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('preview container lifecycle', () => {
  it('force-removes labeled containers before deleting sensitive generated files when Compose down fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-preview-cleanup-'))
    directories.push(root)
    const composeFile = join(root, 'preview.json')
    const assets = join(root, 'assets')
    await mkdir(assets)
    await writeFile(composeFile, '{"services":{}}')
    await writeFile(join(assets, 'secret.env'), 'TOKEN=secret')
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('down')) throw new Error('Compose unavailable')
      if (args.includes('ps')) return 'container-one\n'
      return ''
    })

    await cleanupFailedCompose(run, 'vertexade-preview-42', composeFile, assets)

    await expect(readFile(composeFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(assets, 'secret.env'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(run).toHaveBeenCalledWith('docker', ['rm', '--force', 'container-one'], expect.objectContaining({ timeoutMs: 60_000 }))
  })

  it('treats an already-removed Compose file as idempotent cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-preview-missing-'))
    directories.push(root)
    const composeFile = join(root, 'already-removed.json')
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('down')) throw new Error(`open ${composeFile}: no such file or directory`)
      if (args.includes('ps')) return 'stale-container\n'
      return ''
    })

    await expect(removeComposePreview(run, 'vertexade-preview-52', composeFile)).resolves.toBeUndefined()

    expect(run).toHaveBeenCalledWith('docker', ['rm', '--force', 'stale-container'], expect.objectContaining({ timeoutMs: 60_000 }))
  })
})
