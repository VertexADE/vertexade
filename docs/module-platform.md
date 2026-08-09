# Module platform

VertexADE extensions are backend packages with validated, host-neutral declarations. The API owns discovery, lifecycle, security boundaries, persistence, orchestration, and route scoping. Web and Expo own rendering, navigation, accessibility, and device behavior.

An extension may contribute:

- providers and execution agents;
- queries, transforms, actions, gates, evidence, triggers, and custom primitives;
- scoped API routes;
- portable collection workspaces;
- portable settings;
- catalog, navigation, and presentation metadata.

There is no extension-owned React runtime. Workspace and settings UI are both declarative.

## Package boundary

```text
packages/extensions/<module-id>/
  package.json
  tsconfig.json
  assets/
  src/
    server/
      extension.ts
      client.ts
      api.ts
    shared/
      surfaces.ts
      settings.ts
```

The package exports its server entrypoint:

```json
{
  "name": "@vertexade/extension-example",
  "exports": {
    ".": "./src/server/extension.ts",
    "./server": "./src/server/extension.ts"
  }
}
```

The server entrypoint is trusted process code. Shared declarations may import only `@vertexade/platform-contracts` and `@vertexade/platform-extension-sdk`.

## Manifest and lifecycle

```ts
import { PLATFORM_API_VERSION, type DashboardExtension } from '@vertexade/platform-contracts'

export function createExtension({ host }): DashboardExtension {
  return {
    manifest: {
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      platformApi: PLATFORM_API_VERSION,
      kind: 'other',
      permissions: ['settings.read', 'settings.write'],
      portable: {
        surfaces: [itemsSurface],
        settings: exampleSettings,
      },
    },
    status: () => ({ configured: true, healthy: true }),
    register(registration) {
      registration.routes.register({
        method: 'GET',
        path: '/items',
        handler: () => Response.json({ items: [] }),
      })
    },
  }
}
```

Discovery validates identity, API version, permissions, declarations, dependencies, portable paths, provider registration, and catalog metadata. The lifecycle is:

1. discover and validate;
2. run unapplied extension migrations;
3. register scoped contributions and routes;
4. initialize enabled extensions;
5. expose normalized catalog status;
6. dispose cleanly on shutdown.

Failures are isolated to the owning extension and reported as typed catalog diagnostics. Lifecycle operations and routes have host-side timeouts.

`status()` contributes `configured`, `healthy`, `message`, and `checkedAt`. The registry derives `disabled`, `setup-required`, `degraded`, `ready`, or `failed`.

## Discovery and installation

Bundled packages are discovered below `packages/extensions`. Additional administrator-controlled roots can be supplied through `VERTEXADE_EXTENSION_DIRS`; local packages use the same layout and contract. Duplicate IDs never replace a bundled extension.

Installed extensions are enabled on first discovery. Enablement is then persisted in SQLite. Disabled extensions:

- remain installed and visible in the store;
- retain catalog metadata and portable settings;
- allow routes marked `availability: 'installed'`;
- reject operational routes and do not expose active providers, agents, or navigation.

## Scoped host services

Extensions receive only declared services. Important boundaries are:

- encrypted settings are namespaced per extension;
- routes can only exist below `/api/extensions/<module-id>`;
- repositories are read through a narrow registry;
- agent work starts through the host task service;
- events and caches are module-scoped;
- process execution and SCM authentication require declared permissions.

Configuration routes use `availability: 'installed'`. Operational routes default to `enabled`.

```ts
registration.routes.register({
  method: 'GET',
  path: '/settings',
  availability: 'installed',
  handler: () => Response.json(publicConfig()),
})
```

Provider webhook routes are operational routes owned by the receiving extension.
They must use the shared `@vertexade/platform-server/webhooks` verification
primitives against a bounded raw body, enforce the provider's replay window
when an authenticated timestamp exists, and acknowledge irrelevant events
without broad host invalidation.
Signing secrets stay in encrypted extension settings. Normalized events contain
only the extension prefix and operation; raw provider payloads never enter SSE
or browser storage.

Provider adapters currently cover Linear HMAC signatures, Azure DevOps
service-hook Basic Authentication over HTTPS, and Airtable content MACs. The
Airtable extension also owns the external registration lifecycle because the
MAC secret is returned only when the webhook is created.

Use `loadExtensionData` and `publishExtensionChange` from
`@vertexade/platform-server/extension-data` instead of repeating cache TTLs,
tags, or invalidate-then-emit ordering in provider code.

Use `resilientFetch` from `@vertexade/platform-server/effect` for provider HTTP calls. It
applies the host's Effect policy for cancellation, timeouts, and safe
idempotent retries while leaving provider-specific response parsing inside the
extension. See [Effect on the API](./effect-runtime.md) for the typed error boundary
and incremental adoption recipe.

## Portable UI

`manifest.portable` contains:

```ts
portable: {
  surfaces: PortableSurface[],
  settings?: PortableSettingsSurface,
}
```

An interactive extension must declare at least one collection or settings surface. Settings-only agents use an empty `surfaces` array.

Collection declarations map extension API responses into a shared model for:

- list, Kanban, hierarchy, facets, and source controls;
- shallow cards and complete details;
- item and collection actions;
- dynamic provider-backed forms;
- long-running jobs with poll, refine, and complete operations;
- standard Work launches.

Settings declarations cover:

- scalar, secret, select, and repeatable fields;
- nested object lists;
- conditional visibility and dependent options;
- discovery and reset actions;
- canonical request serialization;
- secret-presence indicators without returning secrets.

Web and Expo consume exactly the same manifest and scoped routes through `@vertexade/platform-client`. There is no DOM mount contract, remote frontend entry, Module Federation loader, or platform-specific extension bundle.

See [Portable extension authoring](portable-extension-authoring.md).

## Provider contracts

Provider declarations must exactly match registered implementations.

| Kind               | Responsibility                                                                  | Current implementation        |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------- |
| `scm`              | Repository, pull-request, review, label, reviewer, merge, and branch operations | GitHub                        |
| `work-management`  | Work-item configuration and clients                                             | Azure DevOps, Linear          |
| `records`          | Flexible records client and schema discovery                                    | Airtable                      |
| `findings`         | Connection verification, normalized findings, remediation prompts               | CodeRabbit, Sentry, SonarQube |
| `deployment`       | Deployment history, environments, and workflow reruns                           | GitHub Actions                |
| `work-reference`   | Searchable external resources linked to Work                                    | Multiple extensions           |
| `inbox` / `search` | Host-wide finding and search projections                                        | Multiple extensions           |

Known kinds have typed registries. Custom kebab-case kinds use `providers.register(kind, implementation)` and retain the same ownership and enablement rules.

Provider selection is contextual, not a global active-provider switch. Core workflows prefer an explicit continuation identity, linked Work resources, repository host hints, then deterministic registration order.

## Agent extensions

Agent implementations use the same package and lifecycle:

```ts
manifest: {
  id: 'example-agent',
  kind: 'ai',
  agents: [{ id: 'example-agent', name: 'Example agent' }],
  portable: {
    surfaces: [],
    settings: defineAgentEnvironmentSettings('Example Agent'),
  },
},
register({ agents }) {
  agents.register(exampleAgent)
}
```

An agent owns launch, resume/fork semantics, event normalization, model options, completion lookup, thread deletion, and optional encrypted environment. The host owns Work state, combined/repository workspace creation, process supervision, prompt boundaries, and selection.

ACP can register multiple harnesses from one extension. Each active harness becomes an independent agent while one portable settings declaration configures registry selection, commands, arguments, permission policy, activation, and encrypted environment.

## Capabilities and automation

Queries, transforms, actions, gates, evidence, and triggers are executable contracts with optional JSON schemas, timeout, and retry policy. The capability execution service:

- validates input and output;
- records durable attempts and results;
- enforces bounded retries and timeouts;
- supports cancellation and idempotency keys;
- emits engineering-inbox events.

Automation recipes compose these capabilities with explicit dataflow from a trigger, previous output, or literal JSON. Disabling an extension prevents further resolution of its capabilities.

Extensions can introduce custom primitives:

```ts
manifest: {
  primitives: [{ id: 'rank', name: 'Ranking' }],
}
```

Consumers declare required primitives, capabilities, or providers through `requires.parts`. Discovery orders owners before consumers and rejects missing dependencies and cycles.

## Catalog and presentation

`catalog` belongs to the extension:

```ts
catalog: {
  tagline: 'Turn findings into traceable work',
  category: 'quality',
  publisher: { name: 'Example', url: 'https://example.com' },
  icon: { asset: 'assets/icon.svg' },
  accent: 'cyan',
  tags: ['Findings', 'Remediation'],
  featured: true,
  highlights: ['Browse findings', 'Inspect evidence', 'Launch work'],
  links: { homepage: 'https://example.com' },
}
```

The loader validates package-relative assets and serves them below the extension namespace. Hosts do not maintain an ID-to-icon/name registry.

## Settings and secret safety

The extension backend owns vendor authentication. `GET /settings` returns public values and booleans such as `has_token`; it never returns a stored token, private key, PAT, or environment value. `POST /settings` verifies the connection, preserves an existing secret when the submitted value is empty, then writes the canonical configuration to the extension’s encrypted namespace.

Both web and mobile render `portable.settings`. Mobile does not store provider secrets. Production mobile use still requires authenticated platform sessions, secure session-token storage, and restrictive network policy.

## Persisted configuration

Request-time code reads a single canonical shape. Released shape changes are handled by versioned `extension.migrations`, not indefinite aliases:

```ts
migrations: [
  {
    version: 1,
    name: 'canonical-configuration',
    migrate() {
      if (!host.settings.has('config')) return
      host.settings.write('config', migrateConfig(host.settings.read('config', {})))
    },
  },
]
```

Migrations are positive, unique, ordered, run once before registration, and are recorded in `extension_migrations`. A failure disables only that extension. Current one-time migrations cover earlier Airtable mappings, SonarQube single-project keys, ACP’s single harness/environment layout, and centralized agent environment maps.

Database schema migrations that moved old top-level encrypted-setting names into extension namespaces remain in the SQLite migration history. They are historical upgrade steps, not runtime fallback readers.

## Compatibility guarantees

- Platform API versions must match.
- `platformFeatures` requirements are validated before registration.
- Module, provider, catalog, and primitive identifiers use kebab case.
- Capability IDs use dot or kebab case and are globally unique.
- Routes are always extension-scoped.
- Permissions come from the supported permission set.
- Provider declarations must match runtime registration.
- Extension migrations run once and in ascending order.
- Disabled extensions retain installed-only settings access and reject operations.
- Bundled extensions win ID collisions with local roots.
- Shared UI declarations are versioned and validated before either host renders them.

## Validation

```bash
pnpm check
pnpm test
pnpm build
pnpm build:mobile
```

Repository tests enforce package boundaries, absence of legacy frontend hosts/loaders, manifest conformance, route scoping, migration behavior, and web/Expo compilation.
