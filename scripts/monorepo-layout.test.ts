import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const root = resolve(import.meta.dirname, '..')
const extensionIds = readdirSync(resolve(root, 'packages/extensions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const unifiedPortableExtensions = ['airtable', 'azure-devops', 'coderabbit', 'linear', 'sentry', 'sonarqube']
const formattedLegacyModuleLineLimits = new Map<string, number>()

function manifest(path: string) {
  return JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8'))
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', 'release', 'build', '.output'].includes(entry.name) ? [] : productionTypeScriptFiles(path)
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

describe('monorepo layout', () => {
  it('keeps production TypeScript modules below 800 lines without growing formatted legacy modules', () => {
    const oversized = ['apps', 'packages']
      .flatMap((directory) => productionTypeScriptFiles(resolve(root, directory)))
      .flatMap((file) => {
        const lineCount = readFileSync(file, 'utf8').trimEnd().split('\n').length
        const relativePath = file.slice(root.length + 1)
        const limit = formattedLegacyModuleLineLimits.get(relativePath) ?? 799
        return lineCount > limit ? [`${relativePath} (${lineCount} lines; limit ${limit})`] : []
      })

    expect(oversized).toEqual([])
  })

  it('keeps applications and shared platform code in named workspaces', () => {
    expect([
      manifest('apps/api').name,
      manifest('apps/mobile').name,
      manifest('apps/web').name,
      manifest('packages/platform-contracts').name,
      manifest('packages/platform-server').name,
      manifest('packages/ui').name,
    ]).toEqual([
      '@vertexade/api',
      '@vertexade/mobile',
      '@vertexade/web',
      '@vertexade/platform-contracts',
      '@vertexade/platform-server',
      '@vertexade/ui',
    ])
  })

  it.each(extensionIds)('%s owns a server entrypoint and package manifest', (id) => {
    const extension = manifest(`packages/extensions/${id}`)
    expect(extension.name).toBe(`@vertexade/extension-${id}`)
    expect(extension.exports['.']).toBe('./src/server/extension.ts')
    expect(existsSync(resolve(root, `packages/extensions/${id}/src/server/extension.ts`))).toBe(true)
  })

  it.each(unifiedPortableExtensions)('%s uses one portable runtime for workspace and administration', (id) => {
    const extension = manifest(`packages/extensions/${id}`)
    const source = readFileSync(resolve(root, `packages/extensions/${id}/src/server/extension.ts`), 'utf8')
    expect(extension.exports['./web/module']).toBeUndefined()
    expect(existsSync(resolve(root, `packages/extensions/${id}/src/web/module.tsx`))).toBe(false)
    expect(existsSync(resolve(root, `packages/extensions/${id}/src/shared/surfaces.ts`))).toBe(true)
    expect(existsSync(resolve(root, `packages/extensions/${id}/src/shared/settings.ts`))).toBe(true)
    expect(existsSync(resolve(root, `packages/extensions/${id}/src/web/settings-module.tsx`))).toBe(false)
    expect(source).toContain('portable:')
    expect(source).not.toContain('frontend:')
  })

  it('has no legacy workspace frontend contract or host', () => {
    const contracts = readFileSync(resolve(root, 'packages/platform-contracts/src/index.ts'), 'utf8')
    expect(contracts).not.toContain('MicroFrontend')
    expect(contracts).not.toContain('frontend?:')
    expect(contracts).not.toContain('ModuleSettingsModule')
    expect(contracts).not.toContain('ModuleSettingsManifest')
    expect(existsSync(resolve(root, 'packages/ui/src/components/micro-frontend-host.tsx'))).toBe(false)
    expect(existsSync(resolve(root, 'packages/ui/src/extensions/design-system.ts'))).toBe(false)
    expect(existsSync(resolve(root, 'packages/ui/src/lib/settings-frontends.ts'))).toBe(false)
  })
})
