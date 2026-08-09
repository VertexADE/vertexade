import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { loadExtensions } from './loader.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('extension loader errors', () => {
  it('skips directories without an extension entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extensions-'))
    roots.push(root)
    await mkdir(join(root, 'docs-only'))
    await expect(loadExtensions({ directory: root })).resolves.toBeDefined()
  })

  it('isolates missing transitive dependencies as load diagnostics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extensions-'))
    roots.push(root)
    const directory = join(root, 'broken', 'src', 'server')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'extension.ts'), `await import('./missing-dependency.js')\nexport default {}`)
    const extensions = await loadExtensions({ directory: root })
    expect(extensions.diagnostics()).toEqual([
      {
        moduleId: 'broken',
        phase: 'load',
        message: expect.stringContaining('Could not load extension broken'),
      },
    ])
  })

  it('isolates a missing catalog icon owned by an extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extensions-'))
    roots.push(root)
    const directory = join(root, 'broken', 'src', 'server')
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'extension.ts'),
      `export default { manifest: { id: 'broken', name: 'Broken', version: '1.0.0', platformApi: '1', kind: 'other', catalog: { tagline: 'Broken icon', category: 'other', publisher: { name: 'Test' }, icon: { asset: 'assets/icon.svg' } } } }`,
    )
    const extensions = await loadExtensions({ directory: root })
    expect(extensions.catalog()[0]).toMatchObject({
      lifecycle: 'failed',
      failure: {
        phase: 'assets',
        message: expect.stringContaining('Could not load extension broken icon assets/icon.svg'),
      },
    })
  })

  it('keeps healthy extensions available when a neighbor cannot load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'extensions-'))
    roots.push(root)
    const broken = join(root, 'broken', 'src', 'server')
    await mkdir(broken, { recursive: true })
    const healthy = join(root, 'healthy', 'src', 'server')
    await mkdir(healthy, { recursive: true })
    await writeFile(join(broken, 'extension.ts'), `throw new Error('broken import')`)
    await writeFile(
      join(healthy, 'extension.ts'),
      `export default { manifest: { id: 'healthy', name: 'Healthy', version: '1.0.0', platformApi: '1', kind: 'other' } }`,
    )

    const extensions = await loadExtensions({ directory: root })
    expect(extensions.catalog()).toHaveLength(1)
    expect(extensions.require('healthy').manifest.name).toBe('Healthy')
    expect(extensions.diagnostics()).toContainEqual({
      moduleId: 'broken',
      phase: 'load',
      message: expect.stringContaining('broken import'),
    })
  })

  it('loads additional local extension directories with explicit origin metadata', async () => {
    const bundledRoot = await mkdtemp(join(tmpdir(), 'extensions-bundled-'))
    roots.push(bundledRoot)
    const localRoot = await mkdtemp(join(tmpdir(), 'extensions-local-'))
    roots.push(localRoot)
    const bundled = join(bundledRoot, 'bundled', 'src', 'server')
    await mkdir(bundled, { recursive: true })
    const local = join(localRoot, 'local-addon', 'src', 'server')
    await mkdir(local, { recursive: true })
    await writeFile(
      join(bundled, 'extension.ts'),
      `export default { manifest: { id: 'bundled', name: 'Bundled', version: '1.0.0', platformApi: '1', kind: 'other' } }`,
    )
    await writeFile(
      join(local, 'extension.ts'),
      `export default { manifest: { id: 'local-addon', name: 'Local addon', version: '1.0.0', platformApi: '1', kind: 'incident-management' } }`,
    )

    const extensions = await loadExtensions({
      directories: [
        { directory: bundledRoot, origin: 'bundled' },
        { directory: localRoot, origin: 'local' },
      ],
    })
    expect(extensions.catalog().map(({ id, installation }) => ({ id, origin: installation.origin }))).toEqual([
      { id: 'bundled', origin: 'bundled' },
      { id: 'local-addon', origin: 'local' },
    ])
  })

  it('reports duplicate local ids without corrupting the bundled extension', async () => {
    const bundledRoot = await mkdtemp(join(tmpdir(), 'extensions-bundled-'))
    roots.push(bundledRoot)
    const localRoot = await mkdtemp(join(tmpdir(), 'extensions-local-'))
    roots.push(localRoot)
    const bundled = join(bundledRoot, 'example', 'src', 'server')
    await mkdir(bundled, { recursive: true })
    const local = join(localRoot, 'example', 'src', 'server')
    await mkdir(local, { recursive: true })
    await writeFile(
      join(bundled, 'extension.ts'),
      `export default { manifest: { id: 'example', name: 'Bundled example', version: '1.0.0', platformApi: '1', kind: 'other' } }`,
    )
    await writeFile(join(local, 'extension.ts'), `throw new Error('duplicate local code should not execute')`)

    const extensions = await loadExtensions({
      directories: [
        { directory: bundledRoot, origin: 'bundled' },
        { directory: localRoot, origin: 'local' },
      ],
    })
    expect(extensions.catalog()[0]).toMatchObject({ name: 'Bundled example', lifecycle: 'ready' })
    expect(extensions.diagnostics()).toContainEqual({
      moduleId: 'example',
      phase: 'manifest',
      message: 'Extension already installed: example',
    })
  })
})
