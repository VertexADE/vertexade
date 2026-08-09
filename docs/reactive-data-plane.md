# Reactive data plane

Server workflows use Effect while browser reactivity remains split between
RxJS and RxDB. See [Effect on the API](./effect-runtime.md) for the ownership
boundary, typed error model, and incremental migration rules.

VertexADE keeps SQLite and its service integrations as the source of truth. RxJS
is the delivery and invalidation layer; RxDB is a disposable browser projection,
not a second authoritative database.

## Data paths

- One typed `/api/events` stream is shared by the application. The envelope has
  a process-local sequence, topic, entity identity, operation, timestamp, and
  compatibility fields for existing consumers.
- Compact `repositories`, `pullRequests`, `jobs`, `dashboardMeta`, `workItems`,
  and `threads` projections are pulled through `/api/read-model`.
- A server-instance checkpoint forces a replacement after API restarts, so a
  stale browser cannot retain documents deleted while the server was down.
- Collection updates become visible only after the global sync checkpoint is
  committed. The local-storage bootstrap manifest is also committed last.
- Inbox, notifications, module catalogs, and automation state use coalesced
  memory-only reactive queries. These short-lived or sensitive results are not
  added to offline storage.

## Projection policy and security

Every persistent projection has a `ReactiveProjectionPolicy`. Offline writes are
disabled. Run projections deliberately omit prompts, result text, review
details, logs, and raw diff payloads; Work summaries omit event history,
relations, context transfers, raw diffs, and full job output. Board job activity
is a bounded plain-text preview; detail screens still fetch authoritative data
on demand.

The browser database is an optimization and can be deleted at any time. A sign
out or future account switch must close and remove the account-scoped database.
Do not add credentials, provider tokens, raw agent conversations, or extension
secrets to a persistent projection.

## Native/mobile boundary

`ReactiveStorageAdapter` is the provider-neutral boundary for a future native
implementation. A React Native renderer can use an RxDB-compatible SQLite
storage adapter while sharing checkpoints and projection documents. Native
persistence must not ship until authenticated API access, secure credential
storage, account-scoped database names, logout deletion, and device-level data
protection are implemented. The current contract intentionally provides no DOM
or `HTMLElement` dependency.

## Operations

`GET /api/read-model/status` reports the instance, version, refresh count,
duration, changed collections, and last error. Client synchronization retries
with bounded exponential backoff and rechecks after reconnect and foregrounding.
High-volume invalidations are coalesced before network reads.

## Provider-owned two-way synchronization

Extension boards own their external synchronization boundary. Outbound actions
write through the provider client, invalidate only that extension's cache, and
emit an extension-prefixed event. Inbound provider webhooks must verify the
provider-supported authentication against a bounded raw request body, enforce a
short replay window when the authenticated payload supplies a delivery
timestamp, normalize the payload to an extension-owned reason, and invalidate
the same scoped cache.

The work-management and records extensions use the same contract with
provider-specific adapters:

| Provider     | Inbound verification                                                  | Scope                                                               | Event prefix |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| Linear       | HMAC-SHA256 over the raw body plus the millisecond `webhookTimestamp` | Selected teams and Issue events                                     | `linear_`    |
| Azure DevOps | Dedicated HTTPS Basic Auth credentials                                | Configured project and work-item lifecycle events                   | `azure_`     |
| Airtable     | `X-Airtable-Content-MAC` using the API-issued binary MAC secret       | Managed webhook registration bound to the configured base and table | `airtable_`  |

Each adapter invalidates only its `board` and `references` tags. Its portable
surface accepts only the matching event prefix, and the shared RxJS
subscription coalesces bursts before reloading the authoritative board.
Airtable webhook registration is created, replaced, and removed by the
extension so its one-time MAC secret never has to enter the browser.

Webhook payloads and signing secrets must never enter SSE events, RxDB, browser
projections, or logs. Delivery processing is intentionally idempotent: retries
may repeat cache invalidation, but they do not write provider or host records.

### The five-step extension lifecycle

Every provider follows the same small sequence:

1. **Read** the authoritative provider through its client.
2. **Cache** boards and references with `loadExtensionData`.
3. **Mutate** the provider through an explicit extension action.
4. **Publish** the result with `publishExtensionChange`, which invalidates the
   `board` and `references` tags before emitting the provider-prefixed event.
5. **Refresh** only portable surfaces whose declared event prefix matches.

Inbound changes join the sequence at step 4 after their webhook has completed
raw-body authentication and provider-specific normalization. The shared
`acknowledgeWebhookChange` function deliberately accepts only a normalized
reason; raw provider payloads cannot leak into events by accident.

The implementation is organized by responsibility:

- `platform-server/extension-data.ts` owns the cache policy and mutation side
  effects.
- `platform-server/webhooks.ts` owns authentication and acknowledgement.
- `extensions/<provider>/server/client.ts` owns external API calls.
- `extensions/<provider>/server/config.ts` owns stored configuration when the
  provider has a managed lifecycle such as Airtable webhooks.
- `extensions/<provider>/server/api.ts` contains named route operations and a
  short route registration table.
- `extensions/<provider>/server/webhook.ts` authenticates and normalizes inbound
  provider notifications.
