import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { createExtensionWorkspace, parseExtensionArgs } from './create-extension.mjs'

describe('extension scaffolder', () => {
  it('parses portable-first and explicit server-only modes', () => {
    expect(parseExtensionArgs(['release-notes'])).toEqual({
      id: 'release-notes',
      name: 'Release Notes',
      portable: true,
    })
    expect(parseExtensionArgs(['release-notes', 'Notes', '--server-only'])).toEqual({
      id: 'release-notes',
      name: 'Notes',
      portable: false,
    })
    expect(() => parseExtensionArgs(['Not Valid'])).toThrow('Usage:')
  })

  it('creates one shared workspace and settings surface for web and Expo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vertexade-portable-extension-'))
    try {
      const { directory } = await createExtensionWorkspace({
        root,
        id: 'release-notes',
        name: 'Release Notes',
      })
      const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        exports: Record<string, string>
      }
      const extension = await readFile(join(directory, 'src/server/extension.ts'), 'utf8')
      const surfaces = await readFile(join(directory, 'src/shared/surfaces.ts'), 'utf8')
      const settings = await readFile(join(directory, 'src/shared/settings.ts'), 'utf8')

      expect(packageJson.exports).toEqual({
        '.': './src/server/extension.ts',
        './shared/surfaces': './src/shared/surfaces.ts',
        './shared/settings': './src/shared/settings.ts',
      })
      expect(extension).toContain('portable: { surfaces: [mainSurface], settings: mainSettings }')
      expect(extension).toContain("path: '/items'")
      expect(extension).toContain("path: '/settings'")
      expect(surfaces).toContain('definePortableCollection({')
      expect(settings).toContain('definePortableSettings({')
      expect(surfaces).not.toContain('react')
      expect(settings).not.toContain('react')
      await expect(access(join(directory, 'src/web'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
