import { access, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const usage = 'Usage: pnpm create:extension <kebab-case-id> [Display name] [--server-only]'

function defaultName(id) {
  return id
    .split('-')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ')
}

export function parseExtensionArgs(args) {
  const unknownFlag = args.find((argument) => argument.startsWith('--') && argument !== '--server-only')
  if (unknownFlag) throw new Error(`Unknown option ${unknownFlag}\n${usage}`)
  const serverOnly = args.includes('--server-only')
  const positional = args.filter((argument) => !argument.startsWith('--'))
  const id = String(positional[0] || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(usage)
  const name = String(positional.slice(1).join(' ') || defaultName(id)).trim()
  if (!name) throw new Error(usage)
  return { id, name, portable: !serverOnly }
}

function packageManifest(id, portable) {
  return {
    name: `@vertexade/extension-${id}`,
    version: '0.0.1',
    private: true,
    type: 'module',
    exports: {
      '.': './src/server/extension.ts',
      ...(portable ? { './shared/surfaces': './src/shared/surfaces.ts' } : {}),
      ...(portable ? { './shared/settings': './src/shared/settings.ts' } : {}),
    },
    scripts: { check: 'vp check --no-fmt', test: 'vp test run --passWithNoTests' },
    dependencies: {
      '@vertexade/platform-contracts': '*',
      '@vertexade/platform-extension-sdk': '*',
    },
  }
}

function portableSurfaceSource(name) {
  return `import { definePortableCollection } from '@vertexade/platform-extension-sdk'

export const mainSurface = definePortableCollection({
  id: 'main',
  title: ${JSON.stringify(`${name} items`)},
  description: 'A host-native collection rendered from one shared extension declaration.',
  source: {
    path: '/items',
    itemsPath: 'items',
  },
  item: {
    idPath: 'id',
    titlePath: 'title',
    fieldsPath: 'fields',
    fieldNamePath: 'name',
    fieldValuePath: 'value',
    fieldStylePath: 'style',
    fieldPlacementPath: 'placement',
    relationItemsPath: 'relation.items',
    relationIdPath: 'id',
    relationTitlePath: 'title',
    relationUrlPath: 'url',
  },
  views: {
    list: true,
    kanban: {
      enabled: true,
      groupFieldsPath: 'group_fields',
      groupFieldNamePath: 'name',
    },
  },
})
`
}

function portableSettingsSource(name) {
  return `import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const mainSettings = definePortableSettings({
  id: 'settings',
  title: ${JSON.stringify(`${name} settings`)},
  description: 'Configuration rendered natively by every host.',
  source: { path: '/settings', configuredPath: 'configured' },
  fields: [{
    name: 'label',
    label: 'Display label',
    type: 'text',
    required: true,
  }],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save settings',
    successMessage: 'Settings saved.',
  },
})
`
}

function portableExtensionSource(id, name) {
  return `import { PLATFORM_API_VERSION, type ExtensionHostServices } from '@vertexade/platform-contracts'
import { defineExtension } from '@vertexade/platform-extension-sdk'
import { mainSurface } from '../shared/surfaces.ts'
import { mainSettings } from '../shared/settings.ts'

// Replace this starter data with a provider or service owned by the extension.
const starterItems = [{
  id: 'welcome',
  title: ${JSON.stringify(`${name} is ready`)},
  fields: [{
    name: 'Status',
    value: 'Ready',
    style: 'badge',
    placement: 'card',
    relation: null,
  }],
}]

export function createExtension({ host }: { host: ExtensionHostServices }) {
  return defineExtension({
  manifest: {
    id: '${id}',
    name: ${JSON.stringify(name)},
    version: '0.0.1',
    platformApi: PLATFORM_API_VERSION,
    kind: 'other',
    description: 'Describe what this extension contributes.',
    navigation: {
      to: '/extensions/${id}',
      label: ${JSON.stringify(name)},
      description: ${JSON.stringify(`Open ${name}`)},
    },
    permissions: ['settings.read', 'settings.write'],
    portable: { surfaces: [mainSurface], settings: mainSettings },
  },
  register(registration) {
    registration.routes.register({
      method: 'GET',
      path: '/items',
      handler: () => Response.json({
        items: starterItems,
        group_fields: [{ name: 'Status' }],
      }),
    })
    registration.routes.register({
      method: 'GET',
      path: '/settings',
      availability: 'installed',
      handler: () => {
        const value = host.settings.read('config', { label: ${JSON.stringify(name)} })
        return Response.json({ configured: true, label: value.label })
      },
    })
    registration.routes.register({
      method: 'POST',
      path: '/settings',
      availability: 'installed',
      handler: async (request) => {
        const input = await request.json() as { label?: unknown }
        const label = String(input.label || '').trim()
        if (!label) return Response.json({ error: 'Display label is required' }, { status: 400 })
        host.settings.write('config', { label })
        return Response.json({ configured: true, label })
      },
    })
  },
  })
}
`
}

function serverOnlyExtensionSource(id, name) {
  return `import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import { defineExtension } from '@vertexade/platform-extension-sdk'

export default defineExtension({
  manifest: {
    id: '${id}',
    name: ${JSON.stringify(name)},
    version: '0.0.1',
    platformApi: PLATFORM_API_VERSION,
    kind: 'other',
    description: 'Describe what this extension contributes.',
  },
})
`
}

export async function createExtensionWorkspace({ root = process.cwd(), id, name, portable = true }) {
  const normalizedId = String(id || '').trim()
  const normalizedName = String(name || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedId) || !normalizedName) throw new Error(usage)
  const directory = resolve(root, 'packages', 'extensions', normalizedId)
  try {
    await access(directory)
    throw new Error(`Extension already exists: ${directory}`)
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
  }

  await mkdir(resolve(directory, 'src', 'server'), { recursive: true })
  if (portable) await mkdir(resolve(directory, 'src', 'shared'), { recursive: true })
  await writeFile(resolve(directory, 'package.json'), `${JSON.stringify(packageManifest(normalizedId, portable), null, 2)}\n`)
  await writeFile(
    resolve(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../../tsconfig.base.json',
        compilerOptions: { exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    resolve(directory, 'src', 'server', 'extension.ts'),
    portable ? portableExtensionSource(normalizedId, normalizedName) : serverOnlyExtensionSource(normalizedId, normalizedName),
  )
  if (portable) await writeFile(resolve(directory, 'src', 'shared', 'surfaces.ts'), portableSurfaceSource(normalizedName))
  if (portable) await writeFile(resolve(directory, 'src', 'shared', 'settings.ts'), portableSettingsSource(normalizedName))
  return { directory, portable }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const options = parseExtensionArgs(process.argv.slice(2))
  const result = await createExtensionWorkspace(options)
  console.log(`Created ${result.portable ? 'portable' : 'server-only'} extension workspace at ${result.directory}`)
  if (result.portable) console.log(`Web and Expo workspace/settings: discovered automatically from /api/modules`)
}
