# Effect runtime

VertexADE adopts Effect incrementally at server workflow boundaries. Public
extension contracts and HTTP handlers still return Promises and Responses, so
existing extensions and clients do not need a coordinated migration.

## What each reactive tool owns

| Tool   | Responsibility                                                                            |
| ------ | ----------------------------------------------------------------------------------------- |
| Effect | Server-side workflows, typed failures, cancellation, timeouts, retries, and tracing spans |
| RxJS   | In-memory client event streams and incremental UI coordination                            |
| RxDB   | Durable local read models and cached-first client startup                                 |

Effect does not replace RxJS or RxDB. A provider request runs as an Effect,
publishes a scoped extension event after a successful mutation, and the client
then uses RxJS and RxDB to apply the resulting refresh or patch.

## Shared API boundary

`@vertexade/platform-server/effect` provides the small vocabulary used by
both the core API and extensions:

- `ApiFailure` is the typed error channel. It carries a stable kind, HTTP
  status, readable message, and optional machine-readable code.
- `tryApi` and `tryApiPromise` bring existing synchronous and Promise APIs into
  Effect without losing expected `HttpError` statuses.
- `timeoutApiPromise` adds an interruption-aware deadline to an existing
  Promise API and aborts its scoped signal when the deadline expires.
- `runApiEffect` exits Effect at a Promise boundary.
- `runApiEffectResponse` exits Effect at an HTTP boundary and preserves the
  `{ "error": "..." }` response contract.
- `apiRequestEffect` scopes a `Request` and its `AbortSignal` to one workflow.

The implementation is organized under `packages/platform-server/src/effect/`:

- `failure.ts` owns typed failures and HTTP translation;
- `runtime.ts` owns Promise/Request entry and exit boundaries;
- `http-client.ts` owns resilient provider HTTP execution.

`@vertexade/platform-server/effect` is also the standard external HTTP
boundary. It supplies:

- a 15-second interruption-aware timeout;
- up to three attempts for idempotent reads;
- `Retry-After` support and bounded exponential delays;
- one attempt for writes, preventing duplicate mutations after an ambiguous
  network failure;
- a final raw `Response`, allowing each provider to preserve its own error
  envelope.

## Required server flow

Migrate one complete workflow at a time:

1. Wrap Promise and throwing operations with `tryApiPromise` or `tryApi`.
2. Compose the workflow with `Effect.gen`.
3. Assign a short span name with `Effect.withSpan`.
4. Keep domain validation close to the operation that can fail.
5. Exit once with `runApiEffect` or `runApiEffectResponse`.

All core API requests and extension routes enter an Effect workflow at the
host boundary. The original Promise-based handler receives the scoped request
signal, so client disconnects, route timeouts, and server shutdown can
interrupt provider work without changing the public extension SDK.

All production provider HTTP calls must use `resilientFetch` or
`resilientFetchEffect`. An architecture test scans the API and every extension
to keep direct `fetch()` calls from bypassing timeout, retry, cancellation, and
tracing behavior.

Do not expose `Effect` through platform contracts. The host owns the runtime
boundary; extensions own provider-specific configuration, parsing, and
normalized data.

## Current migration

- Core API: the top-level request boundary, typed routers, system configuration,
  worktree-preview writes, prompt-image storage, and capability execution.
- Core setup: concurrent tool availability inspection.
- Core workspace providers: interruption-aware Inbox and global-search
  deadlines that isolate a slow extension without delaying core results.
- Shared extension data: cached board/reference loading.
- Extension lifecycle: initialization, disposal, registration, and migrations
  use one typed timeout and failure boundary.
- Extension routes: universal cancellation, timeout, error, and tracing
  behavior for every installed extension.
- External providers: ACP, Airtable, Azure DevOps, Claude Code, Linear,
  OpenCode, Sentry, and SonarQube request execution.
- Airtable: managed webhook creation, replacement, rollback, and removal.
- Azure DevOps: cancellation-aware board fan-out, reference loading, and
  work-item batches with a four-request concurrency limit.
- Work references: bounded provider lookups with caller cancellation and
  isolated provider failures.

Long-running child-process lifecycles remain process-owned because they need
OS signal handling rather than an HTTP request scope. Their provider HTTP
calls still use the shared resilient boundary.

## External synchronization

Extension boards remain the source-of-truth view. Entering an extension board
requests a force refresh, while polling keeps its cached extension data current
afterward. Provider mutations run through Effect and publish an extension
change event only after the source accepts the write. RxJS coordinates the
small client refresh or patch, and RxDB persists the resulting read model for a
cached-first next visit.
