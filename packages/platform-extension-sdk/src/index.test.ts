import { describe, expect, it } from 'vite-plus/test'
import { PLATFORM_API_VERSION } from '@vertexade/platform-contracts'
import {
  createTrigger,
  defineAction,
  defineAgentEnvironmentSettings,
  defineExtension,
  defineManifest,
  definePortableCollection,
  definePortableSettings,
  defineQuery,
  defineTransform,
  extensionConformance,
  objectSchema,
} from './index.ts'

describe('extension authoring SDK', () => {
  it('defines typed capabilities and validates package conformance', async () => {
    const action = defineAction<{ message: string }, { echoed: string }>({
      id: 'example.echo',
      name: 'Echo',
      inputSchema: objectSchema({ message: { type: 'string' } }, ['message']),
      execute: async (input) => ({ echoed: input.message }),
    })
    const manifest = defineManifest({
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      platformApi: PLATFORM_API_VERSION,
      kind: 'other',
      contributes: { actions: [{ id: action.id, name: action.name }] },
    })

    await expect(action.execute({ message: 'hello' }, { moduleId: 'example' })).resolves.toEqual({
      echoed: 'hello',
    })
    expect(extensionConformance({ manifest }, '1.0.0')).toMatchObject({
      id: 'example',
      capabilities: { actions: ['example.echo'] },
    })
    expect(() => extensionConformance({ manifest }, '2.0.0')).toThrow('does not match manifest version')
  })

  it('creates an extension trigger that can emit normalized events', async () => {
    const trigger = createTrigger({ id: 'example.changed', name: 'Example changed' })
    const events: unknown[] = []
    const unsubscribe = await trigger.capability.subscribe((event) => events.push(event))

    const event = trigger.emit({ subject: 'example:1', data: { reason: 'updated' } })
    expect(events).toEqual([event])
    expect(event).toMatchObject({ subject: 'example:1', data: { reason: 'updated' } })
    expect(event.id).toMatch(/^example\.changed:/)
    expect(event.occurredAt).toBeTruthy()
    unsubscribe?.()
    trigger.emit({ subject: 'example:2' })
    expect(events).toHaveLength(1)
  })

  it('defines typed query and transform primitives', async () => {
    const query = defineQuery<{ key: string }, { value: number }>({
      id: 'example.lookup',
      name: 'Lookup',
      query: async () => ({ value: 3 }),
    })
    const transform = defineTransform<{ key: string }, { key: string }>({
      id: 'example.normalize',
      name: 'Normalize',
      transform: async ({ key }) => ({ key: key.trim() }),
    })

    await expect(query.query({ key: 'x' }, { moduleId: 'example' })).resolves.toEqual({ value: 3 })
    await expect(transform.transform({ key: ' x ' }, { moduleId: 'example' })).resolves.toEqual({
      key: 'x',
    })
  })

  it('defines a validated portable collection without host-specific UI code', () => {
    const surface = definePortableCollection({
      id: 'items',
      title: 'Items',
      source: { path: '/items', itemsPath: 'items' },
      item: {
        idPath: 'id',
        titlePath: 'title',
        fieldsPath: 'fields',
        fieldNamePath: 'name',
        fieldValuePath: 'value',
      },
      views: { list: true },
    })
    const extension = defineExtension({
      manifest: {
        id: 'portable-example',
        name: 'Portable example',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'other',
        portable: { surfaces: [surface] },
      },
    })

    expect(surface).toMatchObject({ contractVersion: 1, kind: 'collection', id: 'items' })
    expect(extension.manifest.portable?.surfaces).toEqual([surface])
  })

  it('rejects portable routes that can escape the scoped extension API', () => {
    expect(() =>
      definePortableCollection({
        id: 'items',
        title: 'Items',
        source: { path: '/../items', itemsPath: 'items' },
        item: {
          idPath: 'id',
          titlePath: 'title',
          fieldsPath: 'fields',
          fieldNamePath: 'name',
          fieldValuePath: 'value',
        },
        views: { list: true },
      }),
    ).toThrow('source must use a scoped path')
  })

  it('defines portable settings and the shared agent environment schema', () => {
    const settings = definePortableSettings({
      id: 'settings',
      title: 'Connection',
      source: { path: '/settings' },
      fields: [{ name: 'token', label: 'Token', type: 'password', storedPath: 'has_token' }],
      submit: { method: 'POST', path: '/settings', label: 'Save' },
    })
    expect(settings.contractVersion).toBe(1)
    expect(defineAgentEnvironmentSettings('Codex')).toMatchObject({
      contractVersion: 1,
      fields: [{ name: 'variables', type: 'object-list' }],
    })
  })
})
