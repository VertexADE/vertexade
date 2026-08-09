import { access, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DashboardExtension, ModuleInstallationOrigin } from '@vertexade/platform-contracts'
import { ExtensionRegistry, type ExtensionMigrationStore } from './registry.ts'
import { createScopedExtensionContext, type ScopedExtensionContext } from './scoped-context.ts'

async function registerCatalogIcon(registry: ExtensionRegistry, extension: DashboardExtension, extensionDirectory: string) {
  const icon = extension.manifest.catalog?.icon
  if (!icon) return
  let source: string
  try {
    source = await readFile(join(extensionDirectory, icon.asset), 'utf8')
  } catch (error) {
    throw new Error(`Could not load extension ${extension.manifest.id} icon ${icon.asset}: ${(error as Error).message}`, { cause: error })
  }
  const iconRoute = (path: string) =>
    registry.routes.register(extension.manifest.id, {
      method: 'GET',
      path,
      availability: 'installed',
      handler: () =>
        new Response(source, {
          headers: {
            'cache-control': 'public, max-age=3600',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'content-type': 'image/svg+xml; charset=utf-8',
            'x-content-type-options': 'nosniff',
          },
        }),
    })
  iconRoute(`/${icon.asset}`)
  iconRoute('/catalog-icon')
}

export type ExtensionDirectory = {
  directory: string
  origin?: ModuleInstallationOrigin
  removable?: boolean
}

type ExtensionModule = {
  createExtension?: (context: ScopedExtensionContext) => DashboardExtension | Promise<DashboardExtension>
  default?: DashboardExtension
}

type LoadOptions = {
  enabled?: Set<string>
  isEnabled?: (id: string) => boolean
  context: ScopedExtensionContext
}

async function discoverEntrypoints(directory: string) {
  let entries: { name: string; isDirectory(): boolean }[] = []
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entrypoints: Array<{ id: string; source: string }> = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    let source = ''
    for (const candidate of ['extension.js', 'extension.mjs', 'extension.ts']) {
      const path = join(directory, entry.name, 'src', 'server', candidate)
      try {
        await access(path)
        source = path
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (!source) continue
    entrypoints.push({ id: entry.name, source })
  }
  return entrypoints
}

async function importExtension(registry: ExtensionRegistry, id: string, source: string): Promise<ExtensionModule | null> {
  try {
    return await import(pathToFileURL(source).href)
  } catch (error) {
    registry.diagnose(id, 'load', new Error(`Could not load extension ${id}: ${(error as Error).message}`, { cause: error }))
    return null
  }
}

async function createExtension(registry: ExtensionRegistry, id: string, module: ExtensionModule, context: ScopedExtensionContext) {
  const scoped = createScopedExtensionContext(id, context)
  try {
    const extension = module.createExtension ? await module.createExtension(scoped.context) : module.default
    if (!extension) throw new Error(`${id}/src/server/extension.ts does not export createExtension or a default extension`)
    return { extension, scoped }
  } catch (error) {
    registry.diagnose(id, 'load', error)
    return null
  }
}

function installExtension(
  registry: ExtensionRegistry,
  extensionSource: ExtensionDirectory,
  source: string,
  checksum: string,
  created: Awaited<ReturnType<typeof createExtension>>,
  options: LoadOptions,
) {
  if (!created) return false
  const { extension, scoped } = created
  try {
    scoped.setPermissions(extension.manifest.permissions || [])
    registry.install(extension, {
      enabled: options.isEnabled
        ? options.isEnabled(extension.manifest.id)
        : options.enabled
          ? options.enabled.has(extension.manifest.id)
          : true,
      source,
      origin: extensionSource.origin || 'bundled',
      removable: extensionSource.removable ?? false,
      checksum,
    })
    return true
  } catch (error) {
    registry.diagnose(extension.manifest.id, 'manifest', error)
    return false
  }
}

async function loadExtension(
  registry: ExtensionRegistry,
  extensionSource: ExtensionDirectory,
  id: string,
  source: string,
  options: LoadOptions,
) {
  if (registry.installed(id)) {
    registry.diagnose(id, 'manifest', new Error(`Extension already installed: ${id}`))
    return
  }
  const module = await importExtension(registry, id, source)
  if (!module) return
  const created = await createExtension(registry, id, module, options.context)
  if (!created) return
  if (!created.extension.manifest || created.extension.manifest.id !== id) {
    registry.diagnose(
      id,
      'manifest',
      new Error(`${id}/src/server/extension.ts declares mismatched module id ${created.extension.manifest?.id || '(missing)'}`),
    )
    return
  }
  const checksum = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
  if (!installExtension(registry, extensionSource, source, checksum, created, options)) return
  try {
    await registry.migrate(id)
  } catch {
    return
  }
  await activateExtension(registry, extensionSource, id, created.extension)
}

async function activateExtension(
  registry: ExtensionRegistry,
  extensionSource: ExtensionDirectory,
  id: string,
  extension: DashboardExtension,
) {
  try {
    await registerCatalogIcon(registry, extension, join(extensionSource.directory, id))
  } catch (error) {
    registry.fail(id, 'assets', error)
    return
  }
}

export async function loadExtensions({
  directory,
  directories,
  enabled,
  isEnabled,
  context = {},
  migrationStore,
}: {
  directory?: string
  directories?: ExtensionDirectory[]
  enabled?: Set<string>
  isEnabled?: (id: string) => boolean
  context?: ScopedExtensionContext
  migrationStore?: ExtensionMigrationStore
}) {
  const registry = new ExtensionRegistry(migrationStore)
  const sources = directories || (directory ? [{ directory }] : [])
  for (const extensionSource of sources) {
    const entrypoints = await discoverEntrypoints(extensionSource.directory)
    for (const { id, source } of entrypoints) await loadExtension(registry, extensionSource, id, source, { enabled, isEnabled, context })
  }
  for (const { extension } of registry.installed()) {
    try {
      await registry.register(extension.manifest.id)
    } catch {}
  }
  if (!registry.agents.capabilities().length) {
    for (const { extension } of registry.installed()) {
      if (extension.manifest.requires?.agent)
        registry.fail(extension.manifest.id, 'requirements', new Error('Extension requires an agent extension'))
    }
  }
  await registry.initialize()
  return registry
}
