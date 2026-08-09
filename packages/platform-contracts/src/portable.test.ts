import { describe, expect, it } from 'vite-plus/test'
import { PLATFORM_API_VERSION, validateModuleManifest, type PortableCollectionSurface, type PortableSwimlaneOption } from './index.ts'
import {
  orderPortableHierarchy,
  orderPortableGroups,
  portableActionBody,
  portableActionPath,
  portableHierarchyLanes,
  portableSettingsBody,
  portableSettingsFieldStored,
  portableSettingsOptions,
  portableSettingsValidationErrors,
  portableSettingsValues,
  projectPortableCollection,
  projectPortableSwimlanes,
  readPortablePath,
} from './portable.ts'

const surface = {
  contractVersion: 1,
  id: 'records',
  kind: 'collection',
  title: 'Records',
  source: { path: '/board', configuredPath: 'configured', itemsPath: 'records' },
  item: {
    idPath: 'id',
    titlePath: 'title',
    fieldsPath: 'card_fields',
    fieldNamePath: 'name',
    fieldValuePath: 'value',
    fieldStylePath: 'style',
    fieldPlacementPath: 'placement',
    fieldImagePath: 'image_url',
    relationItemsPath: 'relation.items',
    relationIdPath: 'id',
    relationTitlePath: 'title',
    relationUrlPath: 'url',
    relationImagePath: 'image_url',
  },
  views: { list: true },
  actions: [{ id: 'start-work', label: 'Start Work', method: 'POST', path: '/records/{id}/thread' }],
} satisfies PortableCollectionSurface

describe('portable collection projection', () => {
  it('projects dynamic fields and shallow relations without extension code', () => {
    const [item] = projectPortableCollection(
      {
        configured: true,
        records: [
          {
            id: 'rec/one',
            title: 'Ship mobile host',
            card_fields: [
              {
                name: 'Status',
                value: 'Ready',
                style: 'badge',
                placement: 'card',
                image_url: 'javascript:alert(1)',
                relation: null,
              },
              {
                name: 'Owner',
                value: 'Ada',
                style: 'person',
                placement: 'card',
                image_url: '/api/extensions/records/avatar?user=ada',
                relation: null,
              },
              {
                name: 'Parent',
                value: 'Roadmap',
                style: 'links',
                placement: 'detail',
                relation: {
                  items: [
                    {
                      id: 'rec-parent',
                      title: 'Roadmap',
                      url: 'https://example.test/roadmap',
                      image_url: 'https://images.example.test/roadmap.png',
                    },
                    {
                      id: 'rec-unsafe',
                      title: 'Unsafe',
                      url: 'javascript:alert(1)',
                      image_url: 'data:image/png;base64,unsafe',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      surface,
    )

    expect(item).toMatchObject({
      id: 'rec/one',
      title: 'Ship mobile host',
      fields: [
        { name: 'Status', value: 'Ready', style: 'badge', placement: 'card', relations: [] },
        {
          name: 'Owner',
          value: 'Ada',
          style: 'person',
          placement: 'card',
          imageUrl: '/api/extensions/records/avatar?user=ada',
          relations: [],
        },
        {
          name: 'Parent',
          style: 'links',
          placement: 'detail',
          relations: [
            {
              id: 'rec-parent',
              title: 'Roadmap',
              url: 'https://example.test/roadmap',
              imageUrl: 'https://images.example.test/roadmap.png',
            },
            { id: 'rec-unsafe', title: 'Unsafe' },
          ],
        },
      ],
    })
  })

  it('reads only declarative dotted paths and escapes action identifiers', () => {
    const [item] = projectPortableCollection({ records: [{ id: 'rec/one', title: 'One', card_fields: [] }] }, surface)
    expect(readPortablePath({ relation: { items: ['a'] } }, 'relation.items')).toEqual(['a'])
    expect(portableActionPath(surface.actions[0], item)).toBe('/records/rec%2Fone/thread')
  })

  it('orders portable board columns by provider order, then persistent user preferences', () => {
    expect(orderPortableGroups(['Removed', 'Active', 'New', 'Closed'], ['New', 'Active', 'Closed', 'Removed'])).toEqual([
      'New',
      'Active',
      'Closed',
      'Removed',
    ])
    expect(
      orderPortableGroups(
        ['Removed', 'Active', 'New', 'Closed', 'Ready'],
        ['New', 'Active', 'Closed', 'Removed'],
        ['Active', 'New'],
        ['Removed'],
      ),
    ).toEqual(['Active', 'New', 'Closed', 'Ready'])
    expect(orderPortableGroups(['New'], ['New'], ['New'], ['New'])).toEqual(['New'])
  })

  it('accepts the portable contract as part of a module manifest', () => {
    expect(
      validateModuleManifest({
        id: 'records-test',
        name: 'Records test',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'records',
        portable: { surfaces: [surface] },
      }).portable?.surfaces,
    ).toEqual([surface])
  })

  it('accepts item-scoped select options for provider-specific workflows', () => {
    expect(
      validateModuleManifest({
        id: 'workflow-test',
        name: 'Workflow test',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'work-management',
        portable: {
          surfaces: [
            {
              ...surface,
              actions: [
                {
                  id: 'change-state',
                  label: 'Change state',
                  method: 'PATCH',
                  path: '/items/{id}/state',
                  inputs: [
                    {
                      name: 'state',
                      label: 'State',
                      type: 'select',
                      required: true,
                      optionsSource: 'item',
                      optionsPath: 'state_options',
                      optionValuePath: 'id',
                      optionLabelPath: 'name',
                    },
                  ],
                },
              ],
            },
          ],
        },
      }).portable?.surfaces[0]?.actions?.[0]?.inputs?.[0],
    ).toMatchObject({
      optionsSource: 'item',
      optionsPath: 'state_options',
    })
  })

  it('projects hierarchy and builds nested provider request bodies', () => {
    const hierarchical = {
      ...surface,
      views: { list: true, hierarchy: { parentIdPath: 'parent_id' } },
    } satisfies PortableCollectionSurface
    const items = projectPortableCollection(
      {
        records: [
          { id: 'parent', title: 'Parent', card_fields: [] },
          { id: 'child', parent_id: 'parent', title: 'Child', card_fields: [] },
        ],
      },
      hierarchical,
    )
    expect(items.map(({ id, depth }) => ({ id, depth }))).toEqual([
      { id: 'parent', depth: 0 },
      { id: 'child', depth: 1 },
    ])
    expect(
      portableActionBody(
        [
          { name: 'title', label: 'Title', type: 'text', bodyPath: ['fields', 'Title'] },
          { name: 'empty', label: 'Optional', type: 'text', omitWhenEmpty: true },
          {
            name: 'estimate',
            label: 'Estimate',
            type: 'number',
            bodyPath: ['fields', 'Estimate'],
            emptyValue: 'null',
          },
        ],
        { title: 'Ship it', empty: '', estimate: '' },
      ),
    ).toEqual({ fields: { Title: 'Ship it', Estimate: null } })
  })

  it('keeps parent, child, and grandchild work together in nested swimlanes', () => {
    const hierarchical = {
      ...surface,
      views: { list: true, hierarchy: { parentIdPath: 'parent_id' } },
    } satisfies PortableCollectionSurface
    const projected = projectPortableCollection(
      {
        records: [
          { id: 'task-b', parent_id: 'story', title: 'B task', card_fields: [] },
          { id: 'independent', title: 'Independent', card_fields: [] },
          { id: 'story', parent_id: 'feature', title: 'Story', card_fields: [] },
          { id: 'task-a', parent_id: 'story', title: 'A task', card_fields: [] },
          { id: 'feature', title: 'Feature', card_fields: [] },
        ],
      },
      hierarchical,
    )
    const ordered = orderPortableHierarchy(projected, (left, right) => left.title.localeCompare(right.title))
    expect(ordered.map(({ id, depth }) => ({ id, depth }))).toEqual([
      { id: 'feature', depth: 0 },
      { id: 'story', depth: 1 },
      { id: 'task-a', depth: 2 },
      { id: 'task-b', depth: 2 },
      { id: 'independent', depth: 0 },
    ])
    expect(
      portableHierarchyLanes(ordered).map((lane) => ({
        id: lane.id,
        items: lane.items.map((item) => item.id),
      })),
    ).toEqual([
      { id: 'feature', items: ['feature', 'story', 'task-a', 'task-b'] },
      { id: 'independent', items: ['independent'] },
    ])
  })

  it('projects configurable feature, story, field, and nested swimlanes', () => {
    const hierarchical = {
      ...surface,
      views: { list: true, hierarchy: { parentIdPath: 'parent_id' } },
    } satisfies PortableCollectionSurface
    const cardFields = (type: string, assigned = '') => [
      { name: 'Type', value: type },
      { name: 'Assigned', value: assigned },
    ]
    const items = projectPortableCollection(
      {
        records: [
          { id: 'feature', title: 'Feature', card_fields: cardFields('Feature', 'Maria') },
          {
            id: 'story-a',
            parent_id: 'feature',
            title: 'Story A',
            card_fields: cardFields('User Story', 'Maria'),
          },
          {
            id: 'task-a',
            parent_id: 'story-a',
            title: 'Task A',
            card_fields: cardFields('Task', 'Alex'),
          },
          {
            id: 'story-b',
            parent_id: 'feature',
            title: 'Story B',
            card_fields: cardFields('User Story'),
          },
          {
            id: 'task-b',
            parent_id: 'story-b',
            title: 'Task B',
            card_fields: cardFields('Task', 'Alex'),
          },
          { id: 'orphan', title: 'Orphan', card_fields: cardFields('Task') },
        ],
      },
      hierarchical,
    )
    const feature = {
      id: 'feature',
      label: 'Feature',
      kind: 'hierarchy',
      field: 'Type',
      anchorValues: ['Feature'],
      nestedAnchorValues: ['User Story'],
    } satisfies PortableSwimlaneOption

    expect(
      projectPortableSwimlanes(items, feature, true).map((lane) => ({
        label: lane.label,
        depth: lane.depth,
        items: lane.items.map((item) => item.id),
      })),
    ).toEqual([
      { label: 'Feature', depth: 0, items: ['feature'] },
      { label: 'Story A', depth: 1, items: ['story-a', 'task-a'] },
      { label: 'Story B', depth: 1, items: ['story-b', 'task-b'] },
      { label: 'Other work', depth: 0, items: ['orphan'] },
    ])
    expect(projectPortableSwimlanes(items, feature, false).map((lane) => lane.items.map((item) => item.id))).toEqual([
      ['feature', 'story-a', 'task-a', 'story-b', 'task-b'],
      ['orphan'],
    ])
    expect(
      projectPortableSwimlanes(
        items,
        {
          id: 'story',
          label: 'Story',
          kind: 'hierarchy',
          field: 'Type',
          anchorValues: ['User Story'],
          nestedLabel: 'Subtasks',
        },
        true,
      ).map((lane) => lane.items.map((item) => item.id)),
    ).toEqual([['story-a'], ['task-a'], ['story-b'], ['task-b'], ['feature', 'orphan']])
    expect(
      projectPortableSwimlanes(
        items,
        {
          id: 'assignee',
          label: 'Assignee',
          kind: 'field',
          field: 'Assigned',
        },
        false,
      ).map((lane) => [lane.label, lane.items.map((item) => item.id)]),
    ).toEqual([
      ['Alex', ['task-a', 'task-b']],
      ['Maria', ['feature', 'story-a']],
      ['Unassigned', ['story-b', 'orphan']],
    ])
  })

  it('accepts collection forms, source controls, facets, details, and workflow jobs', () => {
    const advanced = {
      ...surface,
      views: {
        list: true,
        default: 'kanban' as const,
        pagination: { enabled: false },
        hierarchy: { parentIdPath: 'parent_id' },
        kanban: {
          enabled: true,
          groupFieldsPath: 'groups',
          groupFieldNamePath: 'field',
          defaultField: 'Status',
          groupOrder: ['Ready', 'Doing', 'Done'],
          groupOrderPath: 'states',
          groupOrderValuePath: 'name',
          groupOrderEntriesPath: 'group_orders',
          groupOrderEntryFieldPath: 'field',
          groupOrderEntryValuePath: 'value',
          swimlanes: {
            defaultOption: 'story',
            nestedByDefault: true,
            options: [
              { id: 'none', label: 'No swimlanes', kind: 'none' as const },
              {
                id: 'story',
                label: 'Story',
                kind: 'hierarchy' as const,
                field: 'Type',
                anchorValues: ['Story'],
                nestedLabel: 'Subtasks',
              },
            ],
          },
        },
      },
      sourceControls: [
        {
          id: 'sprint',
          label: 'Sprint',
          queryParameter: 'iteration',
          optionsPath: 'iterations',
          optionValuePath: 'path',
          optionLabelPath: 'name',
        },
      ],
      facets: [{ id: 'state', label: 'States', field: 'State' }],
      detail: { source: { path: '/records/{id}' } },
      collectionActions: [
        {
          id: 'prepare',
          label: 'Prepare',
          method: 'POST' as const,
          path: '/prepare',
          inputs: [{ name: 'prompt', label: 'Prompt', type: 'textarea' as const }],
          job: {
            idPath: 'id',
            statusPath: '/prepare/{jobId}',
            statusValuePath: 'job.status',
            completedValues: ['completed'],
            failedValues: ['failed'],
          },
        },
      ],
    } satisfies PortableCollectionSurface
    expect(
      validateModuleManifest({
        id: 'advanced-portable',
        name: 'Advanced portable',
        version: '1.0.0',
        platformApi: PLATFORM_API_VERSION,
        kind: 'other',
        portable: { surfaces: [advanced] },
      }).portable?.surfaces[0],
    ).toMatchObject({
      views: {
        default: 'kanban',
        pagination: { enabled: false },
        kanban: {
          defaultField: 'Status',
          groupOrder: ['Ready', 'Doing', 'Done'],
          groupOrderPath: 'states',
          groupOrderEntriesPath: 'group_orders',
          swimlanes: { defaultOption: 'story', nestedByDefault: true },
        },
      },
      facets: [{ id: 'state' }],
      collectionActions: [{ id: 'prepare' }],
    })
  })
})

describe('portable settings projection', () => {
  const fields = [
    { name: 'token', label: 'Token', type: 'password' as const, storedPath: 'has_token' },
    {
      name: 'projectIds',
      label: 'Projects',
      type: 'multiselect' as const,
      valuePath: 'project_ids',
      optionsPath: 'projects',
      optionValuePath: 'id',
      optionLabelPath: 'name',
    },
    {
      name: 'variables',
      label: 'Variables',
      type: 'object-list' as const,
      valuePath: 'agent.variables',
      fields: [
        { name: 'name', label: 'Name', type: 'text' as const },
        { name: 'value', label: 'Value', type: 'password' as const, storedPath: 'has_value' },
      ],
    },
  ]

  it('projects public values without reading secrets and serializes canonical names', () => {
    const source = {
      has_token: true,
      project_ids: [7, 'project-2'],
      projects: [{ id: '7', name: 'Seven' }],
      agent: { variables: [{ name: 'TOKEN', has_value: true }] },
    }
    const values = portableSettingsValues(source, fields)
    expect(values).toEqual({
      token: '',
      projectIds: ['7', 'project-2'],
      variables: [{ name: 'TOKEN', value: '' }],
    })
    expect(portableSettingsFieldStored(fields[0]!, source)).toBe(true)
    expect(portableSettingsFieldStored(fields[2]!.fields![1]!, source.agent.variables[0]!)).toBe(true)
    expect(portableSettingsBody(fields, values)).toEqual({
      token: '',
      projectIds: ['7', 'project-2'],
      variables: [{ name: 'TOKEN', value: '' }],
    })
    expect(portableSettingsOptions(fields[1]!, source)).toEqual([{ value: '7', label: 'Seven' }])
  })

  it('validates required, stored-secret, nested, and item-limit rules identically for every renderer', () => {
    const validationFields = [
      {
        name: 'token',
        label: 'Token',
        type: 'password' as const,
        required: true,
        storedPath: 'has_token',
      },
      {
        name: 'projects',
        label: 'Projects',
        type: 'multiselect' as const,
        required: true,
        maxItems: 2,
        options: [{ value: 'one', label: 'One' }],
      },
      {
        name: 'variables',
        label: 'Variables',
        type: 'object-list' as const,
        fields: [{ name: 'name', label: 'Variable name', type: 'text' as const, required: true }],
      },
    ]
    expect(
      portableSettingsValidationErrors(
        validationFields,
        {
          token: '',
          projects: ['one', 'two', 'three'],
          variables: [{ name: '' }],
        },
        { has_token: true },
      ),
    ).toEqual(['Projects allows at most 2 items.', 'Variable name is required.'])
    expect(
      portableSettingsValidationErrors(validationFields, {
        token: '',
        projects: [],
        variables: [],
      }),
    ).toEqual(['Token is required.', 'Projects is required.'])
  })
})
