# Unified platform client

`@vertexade/platform-client` is the runtime-neutral SDK for calling the VertexADE API from web, Expo, tests, and other JavaScript hosts. It owns transport behavior; `@vertexade/platform-contracts` owns shared data types; the API remains the authoritative implementation.

```text
@vertexade/platform-contracts
         │
         ├── @vertexade/platform-client ── web
         │                 │
         │                 ├────────────── Expo
         │                 └────────────── API conformance tests
         │
         └── @vertexade/platform-extension-sdk ── extension definitions
```

The client does not contain React, React Native, Node-only modules, storage, or a global singleton. Every host supplies its base URL, authentication source, and optional headers.

## Create a client

Browser calls can use same-origin paths:

```ts
import { createPlatformClient } from '@vertexade/platform-client'

export const client = createPlatformClient({
  credentials: 'same-origin',
})

const catalog = await client.modules.list()
```

Expo supplies the device-reachable API origin:

```ts
import { createPlatformClient } from '@vertexade/platform-client'

const client = createPlatformClient({
  baseUrl: 'https://vertexade.example',
  getAccessToken: () => secureSessionStore.accessToken(),
})

const catalog = await client.modules.list({ auth: 'required' })
```

`getAccessToken` may be synchronous or asynchronous. Tokens are read immediately before each request, so refreshing a session does not require rebuilding the client. Vendor credentials are submitted directly to extension backends and never become persistent mobile application state.

The access-token hook makes authenticated clients possible but does not create API sessions. Production mobile support still requires a server-owned login/refresh flow, authorization enforcement across API routes, secure token storage, and a restrictive network/CORS policy.

## Call an extension

Every extension gets a scope that cannot escape `/api/extensions/<module-id>`:

```ts
const airtable = client.extension('airtable')

const data = await airtable.request('/records')
const response = await airtable.fetch('/export')
const url = airtable.resolve('/records/rec-42')
```

Use `request()` for JSON and `fetch()` when an extension deliberately owns non-JSON response handling.

Portable collections have typed conveniences shared by web and Expo:

```ts
const extension = client.extension(module.id)
const data = await extension.loadSurface(surface)

await extension.executeAction(action, item, {
  environment: 'production',
  notify: true,
})
```

The SDK substitutes and encodes item or workflow identifiers, scopes the route, sets the declared HTTP method, and serializes action values. `bodyPath` maps a renderer field into a nested provider body, `omitWhenEmpty` omits optional create values, and `emptyValue: 'null'` supports explicit provider field clearing. The same method handles item and collection actions. A surface may source choices from the source response, static declarations, or the selected item's raw portable data; this remains renderer-independent. The server must still validate the item, body, permissions, and business rules.

Portable settings use the same extension client:

```ts
const settings = module.portable!.settings!
const publicState = await extension.loadSettings(settings)

await extension.saveSettings(settings, values)

const discover = settings.actions!.find((action) => action.id === 'discover')!
const choices = await extension.executeSettingsAction(settings, discover, values)
```

`saveSettings` submits only declared fields under their canonical `name`. `valuePath` affects reading only, so an API can return a presentation-friendly public key while accepting a canonical stored key. Nested object lists and repeatable values are serialized recursively. Discovery actions send only `includeFields`; reset actions send no body.

Secret values are intentionally absent from the loaded response. Renderers use each field’s `storedPath` boolean to distinguish an existing encrypted value from a missing required value. Empty secret submission remains an extension-server instruction to preserve the stored secret.

## Requests and authentication

All calls support standard `RequestInit` fields plus an `auth` policy:

```ts
await client.request('/api/private', {
  method: 'POST',
  body: JSON.stringify({ enabled: true }),
  auth: 'required',
})
```

The policies are:

- `optional` — default; send a token when the host provides one.
- `required` — fail locally before transport when no token exists.
- `none` — do not ask for or send a token.

Static or per-request headers may be supplied by the host. The web shell uses a dynamic header callback for the selected agent, model, and reasoning settings. Call-specific headers win over host defaults.

## Error contract

JSON operations use distinct error classes:

- `PlatformAuthenticationError` — required client authentication is missing.
- `PlatformNetworkError` — the transport could not reach the API.
- `PlatformDecodeError` — a successful response was not valid JSON.
- `PlatformApiError` — the API returned a non-success status.

`PlatformApiError` exposes `status`, `method`, `path`, `body`, and optional `code`, `details`, and `requestId` fields:

```ts
import { isPlatformApiError } from '@vertexade/platform-client'

try {
  await client.modules.clearCache('airtable')
} catch (error) {
  if (isPlatformApiError(error) && error.status === 403) {
    // Render the host-native authorization state.
  }
}
```

The current API error shape `{ "error": "message" }` remains supported. Future routes can add stable `code` and `details` fields without changing the client interface.

## API conformance

API route tests can execute through the same client by injecting a fetch-compatible router adapter:

```ts
const client = createPlatformClient({
  baseUrl: 'http://localhost',
  fetch: async (url, init) => {
    return (await routes.dispatch(new Request(url, init), {})) ?? Response.json({ error: 'Not found' }, { status: 404 })
  },
})

await client.modules.list()
```

This verifies URL, method, headers, parsing, and response compatibility together. Direct router tests remain useful for server-only behavior, but public endpoints should add an SDK conformance case when a typed client operation is introduced.

## Adding public API operations

When a route should become part of the cross-platform public API:

1. Add or reuse its response and input types in `@vertexade/platform-contracts`.
2. Add a focused method to `@vertexade/platform-client`.
3. Keep the generic `request()` escape hatch for routes that are not stable yet.
4. Add client unit tests for URL, method, authentication, body, and errors.
5. Add an API conformance test using the real router.
6. Consume the method from both hosts where the feature is available.

Do not put rendering, device storage, API implementation details, or vendor SDKs in the client package.
