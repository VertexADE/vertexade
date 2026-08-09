# Wave 3 — Network boundary hardening

Status: authentication-independent scope complete and verified. Final closure of
the three findings remains blocked by the explicitly excluded P0 `TF-001`
authentication program.

Scope: the authentication-independent controls in `TF-002`, `TF-013`, and
`TF-004`, in that order. This wave starts from Wave 2 commit `4daaed4` on branch
`fix/wave-3-boundary-hardening`.

The wave does not merge or deploy itself. Deployment remains a separate,
explicitly authorized operation.

## Outcome

After this wave:

- configurable integration URLs cannot reach local, metadata, link-local,
  private, reserved, or Unix-socket destinations unless an operator has
  explicitly allowlisted the exact origin;
- DNS answers are checked and pinned for each outbound request hop, redirects
  are checked manually, and credentials never follow an origin change;
- every API response uses one restrictive CORS policy after routing, regardless
  of whether it came from a legacy handler, a core router, an extension, an
  error path, or SSE;
- SSE has global and per-client-IP connection limits, a byte-bounded queue,
  heartbeat/write deadlines, deterministic cancellation, and complete shutdown
  cleanup;
- the Node HTTP adapter honors response backpressure and does not continue
  pulling an upstream response while its socket buffer is full.

## Explicit `TF-001` dependency

`TF-001` is P0 and was not included in the requested P1–P3 scope. This wave
must not invent a trusted-user model from caller-controlled headers or present
network hardening as authentication.

The following definition-of-done clauses therefore remain blocked on the
separate `TF-001` program:

| Finding  | Delivered here                                                         | Still requires `TF-001`                                                              |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `TF-002` | outbound destination and redirect policy                               | authenticated `settings.manage` authorization for discovery and verification actions |
| `TF-004` | per-IP/global limits, bounded queues, backpressure, deadlines, cleanup | authenticated SSE subject and per-user limits                                        |
| `TF-013` | one restrictive CORS policy on every response                          | authentication/authorization and CSRF policy before routing                          |

At verification time these findings will be recorded as **auth-independent
controls complete; final closure blocked by `TF-001`**, not falsely marked
fully fixed. The interfaces introduced here must accept a future authenticated
subject without being redesigned.

## Safety invariants

1. No outbound request is sent until its scheme, credentials, origin, DNS
   answers, and resolved addresses have passed policy.
2. Every redirect is handled as a new request and re-enters the complete policy.
3. An authorization, cookie, API-key, or proxy-authorization header never
   crosses an origin boundary.
4. An allowlist entry is an exact normalized origin, including scheme and port;
   host globs, URL prefixes, and implicit private ranges are not accepted.
5. A DNS result containing any forbidden address is rejected. Mixed public and
   private answers cannot be used to bypass validation.
6. The network connection uses only the addresses validated for that hop; a
   second unpinned DNS lookup cannot select a different address.
7. A browser origin receives CORS permission only when its normalized origin is
   explicitly configured. No route emits `Access-Control-Allow-Origin: *`.
8. Requests without an `Origin` header continue to work for same-origin proxy,
   CLI, and native mobile clients; absence of `Origin` is not authentication.
9. An SSE client cannot make the server retain more than its configured queue
   budget. A slow client is disconnected instead of growing memory.
10. Server shutdown closes every stream and timer; socket close aborts the web
    request and removes the corresponding event client exactly once.

## Phase A — Govern configurable outbound destinations (`TF-002`)

### Shared policy

Add a Node-only outbound policy module to `@vertexade/platform-server` with
dependency-injected DNS resolution, clock, logger, and transport for tests.
It will expose a guarded fetch compatible with the existing resilient client.

For every initial URL and redirect hop it will:

1. parse with `URL` and accept only `http:` and `https:`;
2. reject userinfo, fragments, empty hostnames, invalid ports, Unix-socket
   schemes, and malformed/ambiguous hosts;
3. normalize integer, hexadecimal, octal, IPv4-mapped IPv6, and bracketed IPv6
   forms before classification;
4. resolve every hostname with all answers and `verbatim: true`;
5. reject unspecified, loopback, private, carrier-grade NAT, link-local,
   metadata, documentation, benchmark, multicast, and reserved address ranges;
6. permit a forbidden address only when the URL's exact normalized origin is in
   `VERTEXADE_OUTBOUND_ALLOW_ORIGINS`;
7. pin the validated addresses into the HTTP transport's lookup function so the
   connection cannot perform an unvalidated DNS lookup;
8. set transport redirects to `manual`, accept only a bounded number of normal
   HTTP redirect statuses, resolve `Location` against the current URL, and
   repeat the full policy for the next hop;
9. reject a credential-bearing cross-origin redirect before sending the next
   request; and
10. preserve the caller's abort signal, timeout, retry policy, and bounded
    response parsing.

The pinned transport will use a direct, lockfile-pinned Node dependency only if
the existing runtime cannot supply a supported dispatcher/lookup hook. Any new
dependency must pass provenance, license, engine, lockfile, and audit review.

### Configuration and auditability

- `VERTEXADE_OUTBOUND_ALLOW_ORIGINS` is a comma-separated list of exact origins,
  such as `http://sonarqube.internal:9000`.
- Configuration parsing rejects paths, queries, credentials, wildcards, and
  duplicate/non-normalized values at startup instead of silently broadening
  access.
- The server logs the normalized allowed origins at startup and exposes only
  those non-secret origins in system diagnostics.
- Rejections log the provider and reason, but never request headers, tokens,
  query secrets, or userinfo.
- There is no global `allow private networks` switch. Each internal service must
  be named explicitly.

### Integration clients

- SonarQube and Sentry use the guarded transport for verification, project
  discovery, findings, details, pagination, and vendor-derived URLs.
- Known SonarQube Cloud API host selection remains programmatic but enters the
  same policy independently.
- Sentry pagination remains same-origin and is additionally checked by the
  guarded redirect/DNS path.
- Sensitive headers are reconstructed per approved hop; callers cannot smuggle
  `Host`, proxy credentials, or transport dispatcher options.
- The generic resilient HTTP client remains available for fixed, application-
  owned endpoints; configurable origins cannot bypass the guarded wrapper.

### Failure behavior

- Policy rejection occurs before transport and returns a sanitized actionable
  configuration error.
- DNS failure, an empty answer set, mixed safe/unsafe answers, a rebinding
  change, redirect loop, missing `Location`, or exhausted redirect budget fails
  closed.
- Existing self-hosted private SonarQube/Sentry setups require the exact origin
  allowlist before verification or background refresh resumes.
- Existing stored configuration is not rewritten or deleted.

### Tests

- public HTTPS and explicit non-default ports;
- `127.0.0.1`, integer/hex/octal IPv4, `0.0.0.0`, RFC1918, carrier-grade NAT,
  link-local/metadata, benchmark/documentation/reserved/multicast ranges;
- IPv6 loopback, unspecified, ULA, link-local, multicast, scoped addresses, and
  IPv4-mapped IPv6;
- percent encoding, trailing dots, case normalization, Unicode/punycode,
  userinfo, fragments, invalid schemes, and Unix-socket forms;
- DNS with one private answer among public answers, DNS answer changes between
  requests, and proof that the transport receives only validated addresses;
- public-to-private, private-to-public, cross-origin, protocol-changing,
  relative, looping, and over-budget redirects;
- same-origin credential preservation and cross-origin credential rejection;
- exact private-origin allowlist success and near-match/path/wildcard failure;
- SonarQube project discovery and Sentry verification/pagination regression
  tests using injected resolvers and transports.

### Acceptance gate

No configurable integration request can reach an address that was not both
classified and pinned for that exact hop. All bypass cases fail before sending
credentials or application traffic.

## Phase B — Centralize restrictive CORS (`TF-013`)

### Policy

Add one request/response CORS boundary around the complete dashboard dispatcher:

- parse `VERTEXADE_CORS_ALLOW_ORIGINS` as exact normalized HTTP(S) origins;
- default to no cross-origin browser access;
- permit configured methods only for an allowed origin;
- permit only the fixed request-header set required by the platform;
- echo the exact allowed origin and add/merge `Vary: Origin`;
- never emit wildcard origin or wildcard headers;
- reject denied/invalid preflights with `403` before routing;
- return a bounded `204` for a valid preflight; and
- decorate the final response after every route and error path, including SSE.

Remove CORS construction from the legacy JSON helper, SSE implementation, and
the current early preflight response. Registered core routes, legacy routes,
extension routes, not-found responses, validation errors, and unexpected API
errors then share the same contract.

Agent-selection headers may remain in the allow-header set for an explicitly
allowed origin, but this is not authorization. `TF-001` must later reject those
headers unless the authenticated subject has the launch capability.

### Tests

- allowed, denied, malformed, `null`, missing, default-port, and near-match
  origins;
- valid and invalid requested methods/headers;
- legacy JSON, core router, extension, not-found, validation, unexpected error,
  and SSE responses;
- no duplicate or contradictory CORS headers from nested helpers;
- exact `Vary` merging when a response already varies on another header;
- no-Origin same-origin proxy, CLI, and native-client behavior;
- browser-style preflight plus actual request coverage across each route family.

### Acceptance gate

The same request origin produces the same CORS decision for every route and
status. No response path can reintroduce `*` or bypass the centralized policy.

## Phase C — Bound SSE and Node response flow (`TF-004`)

### Connection and queue model

Replace the event bus's set of send functions with explicit client records:

- stable client ID and trusted transport identity (remote IP for this wave);
- controller, abort cleanup, last successful enqueue, queued-byte budget, and
  closed state;
- global default cap of 64 streams and per-IP default cap of 4;
- `ByteLengthQueuingStrategy` with a default 256 KiB high-water mark;
- a maximum single event size so one event cannot exceed the queue budget; and
- observable counters for connected, rejected, slow-disconnected, and closed
  clients without recording event payloads.

All limits are configurable through validated `VERTEXADE_SSE_*` environment
values with conservative hard ceilings. Invalid values fail startup rather than
silently disabling a bound.

`stream` will accept a trusted identity supplied by the Node adapter, enforce
caps before constructing a response, and return `429` with `Retry-After` when
full. Until `TF-001`, the identity is remote IP; the future authenticated
subject can replace/augment it without changing the event bus.

Before enqueueing, encode once and compare byte length with the stream
controller's `desiredSize`. If the payload does not fit, close and remove that
client. Heartbeats use the same queue and failure path. Abort, reader cancel,
slow-client eviction, event-bus disposal, and server shutdown share one
idempotent close routine.

### Node HTTP backpressure and deadlines

Extract a tested response-body pump from `server/index.ts`:

- if `response.write()` returns `false`, stop reading the web stream and await
  `drain`;
- race `drain` with socket close, request abort, and a bounded write timeout;
- abort/cancel the source reader on close or timeout;
- attach a server-owned abort controller to the Fetch `Request`, overriding any
  caller attempt to spoof the trusted client-IP header;
- remove listeners in `finally`; and
- call `end()` only for a still-writable response.

Heartbeats provide the idle liveness probe. A heartbeat that cannot clear the
Node write buffer within the deadline terminates the stream. Normal long-lived
SSE connections are not closed merely for having no application events.

### Tests

- connection event, later event, heartbeat, cancellation, and disposal;
- global and per-IP caps, `429`, retry hint, and capacity recovery after close;
- exact queue boundary, oversized event, repeated emits to a non-reader, and
  bounded retained bytes;
- slow and throwing controllers cannot prevent delivery to healthy clients;
- `write(false)` pauses source reads until `drain`;
- drain success, socket close, request abort, write timeout, body error, and
  header-only response cleanup;
- a real local-server load test with cooperative and non-reading sockets proving
  client count, heap delta, and open sockets remain bounded;
- shutdown closes all streams/timers and leaves no active client records.

### Acceptance gate

A slow reader consumes at most one configured stream queue and one socket. The
server never pulls more response data while Node is backpressured, and every
termination path releases the event client and listeners deterministically.

## Implementation order and commit boundaries

1. Shared outbound policy, configuration parser, pinned transport, and unit
   tests.
2. SonarQube/Sentry adoption plus discovery, redirect, and credential tests.
3. Central CORS policy and cross-router integration tests.
4. Event-client limits and byte-bounded queue tests.
5. Node response pump, trusted transport identity, timeout/shutdown behavior,
   and local load tests.
6. Documentation/configuration examples and `TOFIX.md` evidence.
7. A separate verification record after all gates pass.

Each boundary is independently revertible. No implementation commit may mix
outbound policy, CORS, and stream transport unless a shared test fixture makes
that unavoidable.

## Wave verification

After all three phases:

1. run focused platform HTTP/outbound-policy, SonarQube, Sentry, dispatcher,
   events, Node adapter, and browser-contract tests after each commit;
2. run `npm run check`;
3. run the full root test suite;
4. run `npm run build`;
5. run production and full dependency audits, including provenance/license
   inspection if a transport dependency is added;
6. run mobile type checking because the shared client/contracts must remain
   compatible;
7. run Fallow new-only audit and security analysis, manually classifying every
   new network candidate;
8. execute the local slow-reader/load probe with explicit heap, connection, and
   cleanup assertions; and
9. update `TOFIX.md` with the auth-independent completion and the exact
   remaining `TF-001` blockers, then commit verification separately.

### Verification record

- `npm run check` passed formatting, lint, and TypeScript checks across 718
  files after the final implementation.
- `npm test` passed the root scripts suite and every included API, web, package,
  and extension workspace suite after the host-network injection and quality
  refactors.
- `npm run build` passed the production web/API build and bundle-budget checks.
- `npm run check --workspace @vertexade/mobile` passed; the shared platform
  contracts remain mobile-compatible.
- `npm run probe:sse` opened real local HTTP connections and reported eight
  accepted streams, 24 capped with `429`, eight slow-reader disconnections,
  3,953,544 bytes of heap growth, and a final descriptor delta of `-3`.
- `fallow audit --base 4daaed4 --format json` passed the new-only gate with zero
  introduced dead-code, complexity, duplication, or styling findings. It
  reports two inherited dead-code findings and 12 inherited complexity
  findings in changed files.
- `fallow security --changed-since 4daaed4 --format json` reported 14 candidates.
  The new response-header candidate was manually cleared: header names/values
  come through the Fetch `Headers` implementation before Node `writeHead`,
  which rejects invalid names and newline-bearing values. The other candidates
  are pre-existing sinks made reachable by the changed dashboard entry graph;
  none add an outbound-policy bypass.
- Both production and full npm audits report zero high or critical findings and
  the same ten moderate Expo toolchain findings retained from Wave 1.
- The only new dependency is `undici@8.10.0`, pinned exactly. The installed
  package and registry metadata agree on version, MIT license, Node.js project
  repository, Node `>=22.19.0` engine requirement, and lockfile integrity
  `sha512-HvltHd7avK13QIw/oLe4qoOLyoVSoafqJ2jYOrtMRBkbYT31eiBQ8O0ehRKZiEZCMEyLFQNIADpgCWC5fALvYQ==`.
- Implementation commits are `79aee4b`, `1555b27`, `4dc02c2`, `33595de`,
  `030cd43`, `564257d`, `520cbc9`, and `a3e82f9`.

## Rollout and compatibility

- No persistence migration is required.
- Cross-origin browser deployments must configure exact CORS origins before
  promotion; same-origin proxy deployments need no allowlist.
- Internal self-hosted SonarQube/Sentry deployments must configure their exact
  outbound origins before background refresh is enabled.
- Native mobile requests without `Origin` remain transport-compatible, but
  production mobile remains blocked by `TF-001` authentication.
- The API bind default and remote authentication model are intentionally not
  changed in this wave.

## Rollback

The outbound wrapper, centralized CORS middleware, event client registry, and
Node response pump are code-only changes. Rollback does not alter stored
integration settings or database state. Operator allowlists can be retained for
a forward retry. A rollback must restore the previous clients as a unit; it
must not leave CORS headers split between nested routers or use a guarded client
without its pinned transport lifecycle.
