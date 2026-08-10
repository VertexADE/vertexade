# Security architecture roadmap

Status: proposed target architecture. The boundary hardening already present in
the repository remains authoritative; this document defines the next security
program without treating partial controls as authentication.

## Current trust model

VertexADE is safe by default only when the management API and preview gateway
are reachable by trusted local clients. The API controls repositories, agent
processes, extension settings, credentials, deployments, and destructive
cleanup, so network reachability is equivalent to administrative access until
`TF-001` is complete.

Current extension permissions constrain host-service calls but do not sandbox
extension code. Administrator-provided local extensions execute with the API
process's Node.js and operating-system authority.

Linked servers are separate administrative domains. A browser credential for
one server must never be replayed to another server, even when the web frontend
presents a federated view.

## Target trust boundaries

### 1. Explicit local and remote deployment modes

`local` mode binds API and preview listeners to loopback and supports the
desktop application without making the control plane remotely reachable.

`remote` mode must fail startup unless all of the following are configured:

- an authenticator and a deny-by-default authorization policy;
- TLS at the process or an explicitly trusted reverse-proxy boundary;
- exact browser origins and CSRF protection for cookie sessions;
- rate limits and security audit persistence; and
- an explicit preview exposure policy.

Private RFC1918, loopback-over-tunnel, and internal-DNS server addresses remain
supported. Supporting them must not mean disabling TLS validation. Each linked
server should allow an operator to configure its exact private origin and,
where required, a specific internal CA or certificate fingerprint.

### 2. One typed authentication and authorization kernel

Authenticate before route dispatch and attach an immutable request context:

```ts
type RequestPrincipal =
  | { kind: 'anonymous' }
  | { kind: 'user'; subject: string; sessionId: string; capabilities: ReadonlySet<Capability> }
  | { kind: 'service'; subject: string; tokenId: string; capabilities: ReadonlySet<Capability> }

type Capability =
  | 'platform.read'
  | 'work.launch'
  | 'work.steer'
  | 'review.write'
  | 'deployment.manage'
  | 'settings.manage'
  | 'extension.manage'
  | 'cleanup.execute'
```

Every core and extension route declares one capability. The central dispatcher
rejects missing declarations and unauthorized principals before reading a
request body or invoking handlers. SSE, WebSockets, extension actions, and
legacy routes use the same kernel. Health and readiness are the only anonymous
routes.

Browser sessions use `HttpOnly`, `Secure`, and `SameSite` cookies plus a CSRF
token on mutations. Native clients and automation use separately revocable,
short-lived bearer credentials. Agent/model/permission headers are inputs to an
already-authorized launch; they never grant authority themselves.

### 3. Per-server federation credentials

The primary server stores a distinct encrypted service credential for every
linked server. Incoming browser cookies, authorization headers, and proxy
credentials are never forwarded across backend origins.

Each remote server independently authorizes the service credential and can
grant narrower scopes than the primary server. Initial federation audit events
record both the authenticated primary user and the remote service identity.
OIDC token exchange or signed delegation can later preserve end-user identity
without sharing user sessions.

Linked-server enrollment should verify:

- exact origin and expected VertexADE instance identity;
- TLS chain or configured private trust anchor;
- API compatibility range;
- granted remote capabilities; and
- a revocable credential identifier, never the credential value.

### 4. Protected preview ingress

Preview hostnames and numeric job identifiers are routing metadata, not
credentials. Externally reachable previews require a short-lived, random,
revocable capability bound to one preview service. The gateway authenticates
HTTP and WebSocket upgrades before proxying and applies connection, header,
body, and request-rate limits.

The default preview listener remains loopback. Remote exposure should happen
through the authenticated VertexADE ingress or an explicitly configured edge,
not by implicitly binding an unauthenticated wildcard gateway.

### 5. Extension trust tiers

Keep two explicit execution classes:

1. **Bundled or administrator-trusted local extensions** may run in process.
   The UI and diagnostics must state that they have host authority.
2. **Installable extensions** run out of process behind a versioned RPC
   contract with an allowlisted environment, resource budgets, lifecycle
   supervision, and explicit filesystem, network, process, settings, and
   credential capabilities.

Worker threads alone are a reliability boundary, not a security sandbox. Code
that is not fully trusted requires an operating-system or container isolation
boundary. Distributable packages also require full-artifact hashes, a locked
dependency graph, compatibility metadata, provenance, and a verified publisher
signature before activation.

### 6. Secrets and audit

Move the settings master key to the operating-system keystore where available,
use versioned envelope encryption for stored secrets, and support rotation
without rewriting unrelated settings. Never put secrets in diagnostics, URLs,
logs, events, or extension-visible environment variables.

Every privileged decision records actor, session or token identifier, target
server, capability, resource, result, correlation/idempotency key, and time.
Audit records are append-only through the application API and have a bounded
retention/export policy.

## Delivery order

1. Inventory every route and extension action, assign a capability, and make
   undeclared routes fail tests.
2. Add the typed principal and authorization middleware with anonymous-denial
   integration tests, while retaining loopback-only defaults.
3. Choose and implement the user authenticator: OIDC is preferred for shared
   deployments; a local account provider can remain an explicit alternative.
4. Add secure browser sessions, CSRF, native/device sessions, service tokens,
   revocation, rate limits, and audit records.
5. Enroll linked servers with per-server credentials and private TLS trust.
6. Add preview capability tokens and authenticated WebSocket upgrades.
7. Introduce the isolated extension host and signed package verification before
   accepting third-party installable code.
8. Migrate the settings key to an operating-system-backed keystore and exercise
   rotation and restore drills.

## Decisions required before implementing authentication

- Is the first shared-server identity provider OIDC-only, local accounts, or
  both?
- Does VertexADE terminate TLS itself or require a trusted reverse proxy in
  remote mode?
- Which capabilities may a linked-server service identity receive, and which
  require delegated end-user identity?
- Are previews private to authenticated VertexADE users, shareable by expiring
  links, or both?
- Which extension publishers are trusted, and what isolation runtimes must be
  supported on macOS, Linux, and Windows?

Until those decisions are explicit, keep the API loopback-first and treat
non-loopback exposure as an administrator-managed trusted-network deployment,
not as a completed security boundary.
