# Portable extension authoring

Portable declarations are the only interactive extension UI contract. An extension declares collections, actions, details, and settings once; web and Expo render them with host-native components and call the same scoped API.

```text
extension shared declarations
          │
          ├── portable collections ──┬── web renderer
          │                          └── Expo renderer
          └── portable settings ─────┬── web renderer
                                     └── Expo renderer
```

Shared declarations are JSON-safe data. They never import React, React Native, browser APIs, application routes, or vendor SDKs. There is no DOM mount, Module Federation entrypoint, or web-only fallback.

## Create a package

From the repository root:

```bash
pnpm create:extension --release-notes "Release Notes"
```

The generated package contains:

```text
packages/extensions/release-notes/
  package.json
  tsconfig.json
  src/
    server/
      extension.ts
    shared/
      surfaces.ts
      settings.ts
```

The starter includes one collection and one persisted settings example, both immediately visible on web and Expo. Remove either declaration when it is not part of the extension. Use `--server-only` only for a provider, trigger, or background capability with no user-facing workspace or settings.

## Declare a collection once

```ts
import { definePortableCollection } from '@vertexade/platform-extension-sdk'

export const releases = definePortableCollection({
  id: 'releases',
  title: 'Release notes',
  source: {
    path: '/items',
    configuredPath: 'configured',
    itemsPath: 'items',
  },
  item: {
    idPath: 'id',
    titlePath: 'title',
    subtitlePath: 'summary',
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
  setup: {
    message: 'Connect the release service first.',
    settingsSurfaceId: 'settings',
  },
  refresh: {
    eventPrefixes: ['release_'],
  },
})
```

Publish it in the manifest:

```ts
portable: {
  surfaces: [releases],
}
```

`definePortableCollection` adds the current contract version, validates scoped routes and dotted response paths, and retains exact TypeScript inference.

The source route is extension-relative:

```ts
registration.routes.register({
  method: 'GET',
  path: '/items',
  handler: () =>
    Response.json({
      configured: true,
      items: [
        {
          id: 'release-42',
          title: 'Version 4.2',
          summary: 'Ready to publish',
          fields: [
            {
              name: 'Status',
              value: 'Ready',
              style: 'badge',
              placement: 'card',
            },
          ],
        },
      ],
      group_fields: [{ name: 'Status' }],
    }),
})
```

Both clients call `/api/extensions/release-notes/items`. Field styles are `text`, `badge`, `date`, `person`, and `links`; placement is `card` or `detail`. Link relations expose only a stable `id`, `title`, and optional HTTP(S) `url`.

## Declare settings once

```ts
import { definePortableSettings } from '@vertexade/platform-extension-sdk'

export const releaseSettings = definePortableSettings({
  id: 'settings',
  title: 'Release service',
  description: 'Connect a service and choose projects.',
  source: {
    path: '/settings',
    configuredPath: 'configured',
  },
  fields: [
    {
      name: 'url',
      label: 'Server URL',
      type: 'text',
      required: true,
    },
    {
      name: 'token',
      label: 'API token',
      type: 'password',
      required: true,
      storedPath: 'has_token',
    },
    {
      name: 'projectIds',
      valuePath: 'project_ids',
      label: 'Projects',
      type: 'multiselect',
      optionsAction: 'discover',
      optionsPath: 'projects',
      optionValuePath: 'id',
      optionLabelPath: 'name',
    },
  ],
  submit: {
    method: 'POST',
    path: '/settings',
    label: 'Save connection',
    successMessage: 'Connection saved.',
  },
  actions: [
    {
      id: 'discover',
      label: 'Discover projects',
      method: 'POST',
      path: '/discover',
      intent: 'discover',
      includeFields: ['url', 'token'],
    },
    {
      id: 'reset',
      label: 'Remove connection',
      method: 'DELETE',
      path: '/settings',
      intent: 'reset',
      confirm: {
        title: 'Remove this connection?',
        description: 'The encrypted credentials and selections will be deleted.',
        confirmLabel: 'Remove connection',
        destructive: true,
      },
    },
  ],
})
```

Publish workspace and settings together:

```ts
portable: {
  surfaces: [releases],
  settings: releaseSettings,
}
```

Settings-only extensions use `surfaces: []`. They still appear in both hosts.

Supported settings fields are:

- `text`, `textarea`, `password`, `number`, `boolean`, and `hidden`;
- `select` and `multiselect`, using static or discovered options;
- `string-list`, for repeatable scalar values;
- `object-list`, for repeatable nested objects such as mappings, harnesses, or environment variables.

Use `sections` to group top-level fields. `object-list` supports nested `fields`, item limits, add labels, and reordering. `visibleWhen` handles simple conditional fields. `optionsFilterInput` and `optionsFilterPath` implement dependent choices.

`valuePath` maps a public response field to a canonical submitted name. For example, the server may return `project_ids` while the SDK submits `projectIds`.

Set `required`, `minItems`, and `maxItems` in the declaration rather than duplicating validation in a host. The shared validator applies the same required, stored-secret, numeric, nested-field, and list-limit rules before web or Expo submits; the extension endpoint must still validate every request as the security boundary.

### Secret contract

Secret values are write-only:

1. Store them through extension-scoped encrypted settings.
2. Never return a token, key, PAT, or environment value from `GET /settings`.
3. Return a boolean such as `has_token`.
4. Set `storedPath: 'has_token'` on the declaration.
5. Treat an empty submitted secret as “keep the existing value”.

Both renderers then show a stored placeholder and satisfy `required` without receiving the secret. Expo does not retain vendor credentials; it sends user-entered values directly to the extension backend over the configured platform connection.

Agent packages should use the shared factory:

```ts
import { defineAgentEnvironmentSettings } from '@vertexade/platform-extension-sdk'

export const settings = defineAgentEnvironmentSettings('Example Agent')
```

It declares the same encrypted repeatable environment editor used by web and Expo.

## Actions and dynamic forms

Item actions and collection actions declare their inputs:

```ts
actions: [
  {
    id: 'publish',
    label: 'Publish',
    method: 'POST',
    path: '/items/{id}/publish',
    inputs: [
      {
        name: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        optionsPath: 'environments',
        optionValuePath: 'id',
        optionLabelPath: 'name',
      },
      {
        name: 'notify',
        label: 'Notify subscribers',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  },
]
```

Inputs support static or response-backed options, conditional visibility, dependent choices, item/source defaults, nested `bodyPath` mapping, omission of empty create values, and explicit `null` clearing.

Use `collectionActions` for create/import/prepare operations. An API may return provider-driven actions through `collectionActionsPath` or `itemActionsPath`; Airtable uses this to derive native forms from a live schema.

Set `intent: 'launch-work'` for actions that start an agent. The host supplies its standard agent/model headers, while the extension uses the host task service and defaults to the combined Work-key workspace.

## Source controls, facets, hierarchy, and details

- `sourceControls` map a host-native selector to a source query parameter.
- `facets` filter projected fields identically on both hosts.
- `views.hierarchy.parentIdPath` enables guarded parent-child indentation.
- `detail.source.path` loads full provider context on demand.
- `detail.sections` or response-backed `sectionsPath` render text, Markdown, code, lists, timelines, and JSON.
- `refresh.eventPrefixes` enables source synchronization: web and mobile force
  a source refresh when the board opens, poll every 60 seconds while visible,
  and refresh immediately when the app becomes active again. Source routes
  should honor `force_refresh=1` by bypassing their cached read model.

Keep list responses shallow. Keep secrets out of all collection and detail responses.

## Long-running workflows

An action can declare a `job`:

```ts
job: {
  idPath: 'id',
  statusPath: '/prepare/{jobId}',
  statusValuePath: 'job.status',
  resultPath: 'drafts',
  errorPath: 'error',
  completedValues: ['completed'],
  failedValues: ['failed', 'cancelled'],
  refineAction: {
    id: 'refine',
    label: 'Refine',
    method: 'POST',
    path: '/prepare/{jobId}/refine',
    inputs: [{ name: 'prompt', label: 'Refinement', type: 'textarea' }],
  },
  resultBodyPath: ['stories'],
  completeAction: {
    id: 'create',
    label: 'Create selected stories',
    method: 'POST',
    path: '/drafts',
  },
}
```

Both renderers poll, display the result, allow refinement, and submit the approved result. The server remains responsible for authorization, state transitions, idempotency, and result validation.

## Use the unified client

```ts
const extension = client.extension(module.id)

const source = await extension.loadSurface(surface)
await extension.executeAction(action, item, values)

const publicSettings = await extension.loadSettings(settings)
await extension.saveSettings(settings, values)
await extension.executeSettingsAction(settings, action, values)
```

The client scopes paths, encodes identifiers, serializes canonical settings bodies, and produces the same typed errors in web, Expo, and tests.

## Persisted configuration migrations

Runtime readers consume one canonical shape only. If a released extension changes its stored shape, add a positive, ordered extension migration:

```ts
migrations: [
  {
    version: 2,
    name: 'canonical-project-selection',
    migrate() {
      if (!host.settings.has('config')) return
      const previous = host.settings.read<Record<string, unknown>>('config', {})
      host.settings.write('config', toCanonicalConfig(previous))
    },
  },
]
```

Migrations run once before registration and are recorded in SQLite. Do not keep alternate key names or fallback shape readers in request-time code. Preserve encrypted secret values during migration, and delete obsolete extension-owned keys only after the canonical value is written.

## Validate

```bash
pnpm check
pnpm test
pnpm build
pnpm build:mobile
```

The repository layout tests reject DOM workspace contracts, web settings modules, and settings loaders. Extension integration tests validate that declarations survive catalog discovery and that workspace/settings endpoints conform to the shared client.

The current mobile host must be used only on a trusted network until authenticated mobile sessions and production network policy are implemented.
