import { describe, expect, it } from 'vite-plus/test'
import { PLATFORM_API_VERSION, defineExtension, validateModuleManifest, type ModuleManifest } from '@vertexade/platform-contracts'

function manifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: 'example-module',
    name: 'Example module',
    version: '1.0.0',
    platformApi: PLATFORM_API_VERSION,
    kind: 'other',
    ...overrides,
  }
}

describe('module manifest contract', () => {
  it('accepts a versioned module with backend, portable, and settings contributions', () => {
    const value = manifest({
      catalog: {
        tagline: 'Example workspace integration',
        category: 'automation',
        publisher: { name: 'Example publisher', url: 'https://example.com' },
        icon: { asset: 'assets/icon.svg' },
        accent: 'violet',
        tags: ['Automation'],
        highlights: ['Runs example workflows'],
      },
      permissions: ['settings.read', 'tasks.launch'],
      contributes: { actions: [{ id: 'findings.remediate', name: 'Remediate finding' }] },
      agents: [{ id: 'example-agent', name: 'Example agent' }],
      portable: {
        surfaces: [
          {
            contractVersion: 1,
            id: 'items',
            kind: 'collection',
            title: 'Example items',
            source: { path: '/items', itemsPath: 'items' },
            item: {
              idPath: 'id',
              titlePath: 'title',
              fieldsPath: 'fields',
              fieldNamePath: 'name',
              fieldValuePath: 'value',
            },
            views: { list: true },
          },
        ],
        settings: {
          contractVersion: 1,
          id: 'settings',
          title: 'Example settings',
          source: { path: '/settings' },
          fields: [{ name: 'token', label: 'Token', type: 'password' }],
          submit: { method: 'POST', path: '/settings', label: 'Save' },
        },
      },
    })

    expect(validateModuleManifest(value)).toBe(value)
  })

  it('validates store presentation metadata', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          catalog: { tagline: '', category: 'other', publisher: { name: 'Example' } },
        }),
      ),
    ).toThrow('requires a tagline')
    expect(() =>
      validateModuleManifest(
        manifest({
          catalog: {
            tagline: 'Example',
            category: 'other',
            publisher: { name: 'Example' },
            links: { homepage: 'file:///private/path' },
          },
        }),
      ),
    ).toThrow('must use http or https')
    expect(() =>
      validateModuleManifest(
        manifest({
          catalog: {
            tagline: 'Example',
            category: 'other',
            publisher: { name: 'Example' },
            tags: ['Agent', 'agent'],
          },
        }),
      ),
    ).toThrow('contains duplicates')
    expect(() =>
      validateModuleManifest(
        manifest({
          catalog: {
            tagline: 'Example',
            category: 'other',
            publisher: { name: 'Example' },
            icon: { asset: '../private/icon.svg' },
          },
        }),
      ),
    ).toThrow('invalid catalog icon asset')
  })

  it('rejects incompatible platform versions', () => {
    expect(() => validateModuleManifest(manifest({ platformApi: '2' as '1' }))).toThrow('unsupported platform API 2')
  })

  it('accepts extension-defined taxonomy and provider kinds', () => {
    const value = manifest({
      kind: 'incident-management',
      catalog: {
        tagline: 'Coordinate incidents',
        category: 'operations',
        publisher: { name: 'Example' },
      },
      providers: [{ id: 'example-incidents', name: 'Example incidents', kind: 'incident-management' }],
    })
    expect(validateModuleManifest(value)).toBe(value)
  })

  it('accepts snake-case extension notification kinds', () => {
    const value = manifest({
      ui: { notifications: [{ kind: 'review_started', label: 'Review started' }] },
    })
    expect(validateModuleManifest(value)).toBe(value)
  })

  it('rejects malformed extension-defined taxonomy', () => {
    expect(() => validateModuleManifest(manifest({ kind: 'Incident Management' }))).toThrow('invalid kind')
    expect(() =>
      validateModuleManifest(
        manifest({
          catalog: {
            tagline: 'Example',
            category: '../operations',
            publisher: { name: 'Example' },
          },
        }),
      ),
    ).toThrow('invalid catalog category')
    expect(() =>
      validateModuleManifest(
        manifest({
          providers: [{ id: 'example', name: 'Example', kind: 'Incident Management' }],
        }),
      ),
    ).toThrow('invalid provider kind')
  })

  it('validates portable settings as host-neutral extension surfaces', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          portable: {
            surfaces: [],
            settings: {
              contractVersion: 1,
              id: 'settings',
              title: 'Settings',
              source: { path: 'remote' },
              fields: [{ name: 'token', label: 'Token', type: 'password' }],
            },
          },
        }),
      ),
    ).toThrow('source must use a scoped path')
    expect(() =>
      validateModuleManifest(
        manifest({
          portable: {
            surfaces: [],
            settings: {
              contractVersion: 1,
              id: 'settings',
              title: 'Settings',
              source: { path: '/settings' },
              fields: [{ name: 'token', label: 'Token', type: 'password', optionsAction: 'missing' }],
            },
          },
        }),
      ),
    ).toThrow('references an unknown action')
  })

  it('rejects duplicate capability declarations', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          contributes: {
            gates: [
              { id: 'ci.green', name: 'CI green' },
              { id: 'ci.green', name: 'Still green' },
            ],
          },
        }),
      ),
    ).toThrow('declares ci.green more than once')
  })

  it('validates contextual actions against executable action declarations', () => {
    const value = manifest({
      contributes: { actions: [{ id: 'example.approve', name: 'Approve' }] },
      ui: {
        contextualActions: [
          {
            id: 'example.approve-pr',
            capabilityId: 'example.approve',
            label: 'Approve',
            placements: ['pull-request.primary'],
            entityKinds: ['pull-request'],
            inputMapping: { repository: 'full_name', pull_number: 'number' },
            conditions: [
              {
                field: 'draft',
                operator: 'equals',
                value: false,
                disabledReason: 'Draft pull requests cannot be approved',
              },
            ],
            confirmation: { level: 'confirm', title: 'Approve pull request?' },
          },
        ],
      },
    })
    expect(validateModuleManifest(value)).toBe(value)
  })

  it('validates extension-contributed automation templates', () => {
    const value = manifest({
      ui: {
        automationTemplates: [
          {
            id: 'assigned-review',
            name: 'Review assigned pull requests',
            description: 'Review pull requests assigned to a username.',
            triggerId: 'core.pull-request-reviewers-changed',
            conditions: [{ field: 'data.entity.reviewer_logins', operator: 'contains' }],
            threadAction: 'review',
            promptSteps: [{ name: 'Review', prompt: 'Review the assigned pull request.' }],
          },
        ],
      },
    })
    expect(validateModuleManifest(value)).toBe(value)
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            automationTemplates: [
              {
                id: 'broken',
                name: 'Broken',
                description: 'Missing a complete prompt.',
                triggerId: 'core.pull-request-changed',
                threadAction: 'improve',
                promptSteps: [],
              },
            ],
          },
        }),
      ),
    ).toThrow('requires at least one complete prompt phase')
  })

  it('validates extension-owned notification presentation and actions', () => {
    const value = manifest({
      ui: {
        notifications: [
          {
            kind: 'review_posted',
            label: 'Review posted',
            severity: 'success',
            actionLabel: 'Open pull requests',
            to: '/pull-requests',
          },
        ],
      },
    })
    expect(validateModuleManifest(value)).toBe(value)
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            notifications: [{ kind: 'review_posted', label: 'Review posted', actionLabel: 'Open' }],
          },
        }),
      ),
    ).toThrow('action requires a route')
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            notifications: [{ kind: 'review_posted', label: 'Review posted', to: 'https://example.test' }],
          },
        }),
      ),
    ).toThrow('requires an absolute route')
  })

  it('validates setup and run presentation primitives', () => {
    const value = manifest({
      setupChecks: [
        {
          id: 'example-cli',
          name: 'Example CLI',
          command: 'example',
          args: ['--version'],
          install: 'Install Example CLI',
        },
      ],
      ui: {
        runKinds: [
          {
            kind: 'example_plan',
            label: 'Example plan',
            workKind: 'investigation',
            tone: 'violet',
          },
        ],
      },
    })
    expect(validateModuleManifest(value)).toBe(value)
    expect(() =>
      validateModuleManifest(
        manifest({
          setupChecks: [
            { id: 'duplicate', name: 'One', command: 'one', args: [], install: 'Install one' },
            { id: 'duplicate', name: 'Two', command: 'two', args: [], install: 'Install two' },
          ],
        }),
      ),
    ).toThrow('invalid or duplicate setup check')
    expect(() => validateModuleManifest(manifest({ ui: { runKinds: [{ kind: '../plan', label: 'Plan' }] } }))).toThrow('invalid run kind')
  })

  it('rejects duplicate passive UI contribution identifiers', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            workResources: [
              { kind: 'pull_request', label: 'Pull request' },
              { kind: 'pull_request', label: 'Change request' },
            ],
          },
        }),
      ),
    ).toThrow('declares Work resource pull_request more than once')
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            runKinds: [
              { kind: 'review', label: 'Review' },
              { kind: 'review', label: 'Code review' },
            ],
          },
        }),
      ),
    ).toThrow('declares run kind review more than once')
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            commands: [
              { id: 'open-review', label: 'Open review', to: '/reviews' },
              { id: 'open-review', label: 'Review', to: '/pull-requests' },
            ],
          },
        }),
      ),
    ).toThrow('declares command open-review more than once')
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            notifications: [
              { kind: 'review_posted', label: 'Review posted' },
              { kind: 'review_posted', label: 'Review complete' },
            ],
          },
        }),
      ),
    ).toThrow('declares notification review_posted more than once')
  })

  it('rejects contextual actions that cannot resolve to their module capability', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          ui: {
            contextualActions: [
              {
                id: 'example.approve-pr',
                capabilityId: 'example.approve',
                label: 'Approve',
                placements: ['pull-request.primary'],
                entityKinds: ['pull-request'],
              },
            ],
          },
        }),
      ),
    ).toThrow('references undeclared capability example.approve')
  })

  it('requires explicit typed-confirmation identity fields', () => {
    expect(() =>
      validateModuleManifest(
        manifest({
          contributes: { actions: [{ id: 'example.delete', name: 'Delete' }] },
          ui: {
            contextualActions: [
              {
                id: 'example.delete-item',
                capabilityId: 'example.delete',
                label: 'Delete',
                placements: ['work.menu'],
                entityKinds: ['work'],
                confirmation: { level: 'typed' },
              },
            ],
          },
        }),
      ),
    ).toThrow('typed confirmation requires a confirmation field')
  })

  it('accepts query and transform capability declarations', () => {
    expect(
      validateModuleManifest(
        manifest({
          contributes: {
            queries: [{ id: 'inventory.lookup', name: 'Look up inventory' }],
            transforms: [{ id: 'inventory.normalize', name: 'Normalize inventory' }],
          },
        }),
      ),
    ).toMatchObject({
      contributes: {
        queries: [{ id: 'inventory.lookup' }],
        transforms: [{ id: 'inventory.normalize' }],
      },
    })
  })

  it('validates agent declarations', () => {
    expect(() => validateModuleManifest(manifest({ agents: [{ id: 'Not Valid', name: 'Agent' }] }))).toThrow('invalid agent id')
    expect(() =>
      validateModuleManifest(
        manifest({
          agents: [
            { id: 'example', name: 'One' },
            { id: 'example', name: 'Two' },
          ],
        }),
      ),
    ).toThrow('declares agent example more than once')
    expect(() => validateModuleManifest(manifest({ agents: [{ id: 'example', name: 'Agent', accent: 'magenta' as 'blue' }] }))).toThrow(
      'invalid accent',
    )
  })

  it('rejects permissions the platform cannot enforce', () => {
    expect(() => validateModuleManifest(manifest({ permissions: ['database.root' as 'settings.read'] }))).toThrow('unsupported permission')
  })

  it('preserves a precisely typed extension through the authoring helper', () => {
    const extension = defineExtension({ manifest: manifest(), initialize: async () => undefined })
    expect(extension.manifest.id).toBe('example-module')
  })
})
