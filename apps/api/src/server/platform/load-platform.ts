import { join } from 'node:path'
import type { ExtensionCommandRunner } from '@vertexade/platform-contracts'
import { loadExtensions } from '../extensions/loader.ts'
import type { DashboardExtensionHostServices } from '../extensions/host-services.ts'
import type { ExtensionMigrationStore } from '../extensions/registry.ts'

export function loadModulePlatform({
  root,
  run,
  host,
  isEnabled,
  extensionDirectories = [],
  migrationStore,
}: {
  root: string
  run: ExtensionCommandRunner<string>
  host?: DashboardExtensionHostServices
  isEnabled?: (id: string) => boolean
  extensionDirectories?: string[]
  migrationStore?: ExtensionMigrationStore
}) {
  const bundled = join(root, 'packages', 'extensions')
  const local = [...new Set(extensionDirectories)].filter((directory) => directory !== bundled)
  return loadExtensions({
    directories: [{ directory: bundled, origin: 'bundled' }, ...local.map((directory) => ({ directory, origin: 'local' as const }))],
    isEnabled,
    context: { root, run, host },
    migrationStore,
  })
}
