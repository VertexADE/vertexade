# TOFIX

Deep codebase audit backlog for VertexADE.

- Audited commit: `f417880`
- Remediation recorded through: `ba3449b` on `refactor/wave-5-characterize-decompose`
- Audit date: 2026-08-04
- Scope: API, web, mobile, persistence, extensions, security, cleanup, automation, build/deploy, accessibility, and responsive behavior
- Rule: this file records source-verified or live-reproduced issues. Scanner candidates that could not be confirmed are not promoted to fixes.

## Priority

- **P0 — release blocker:** a reachable issue can compromise the host or its managed repositories/work.
- **P1 — high:** material security, data-loss, resource-leak, or recovery risk; fix next.
- **P2 — medium:** reliability, quality-gate, performance, or user-friction issue.
- **P3 — debt:** maintainability work that should be scheduled, not mixed into an urgent fix.

## Immediate order

1. `TF-001` authentication, authorization, and network boundary.
2. `TF-002` outbound request policy and SSRF protection.
3. `TF-003` and `TF-004` request/stream resource controls.
4. `TF-005` cleanup durability and `TF-006` bounded caches.
5. `TF-007` recovery proof and `TF-008` dependency remediation.
6. Remaining P2/P3 items.

## Confirmed issues

### TF-001 — P0 — The management API is an unauthenticated network control plane

**Status: partially remediated.** The API and example PM2 deployment now bind to
`127.0.0.1` by default. Authentication, authorization, browser-session CSRF
protection, and adversarial integration coverage remain release blockers.

**Impact**

Any client that can reach the host can read local work and agent data, change settings, enable or disable extensions, start agent work, inspect worktree files, and invoke destructive routes. Browser origins are explicitly allowed by the legacy response helper and preflight handler. This is especially serious because the service manages local repositories, credentials, agent processes, and GitHub operations.

**Evidence**

- `apps/api/src/server/index.ts:6-7,50` defaults to `0.0.0.0:4174`.
- `apps/api/src/server/dashboard/request-handler.ts:48-63,121-127` dispatches core and extension routes without a global authentication or authorization check.
- `apps/api/src/server/dashboard/request-handler.ts:66-77` accepts every preflight origin and advertises mutating methods plus `authorization` and agent-selection headers.
- `apps/api/src/server/dashboard/server-utils.ts:24-35` adds `Access-Control-Allow-Origin: *` to legacy JSON responses.
- `apps/api/src/server/dashboard/system-api.ts:328-346` protects only `POST /api/work-items/from-pull-request` with `VERTEXADE_API_TOKEN`; the rest of the API does not use that token.
- `apps/mobile/README.md:18` independently documents that the API has no mobile authentication boundary and is safe only on a trusted development network.
- Live proof: an unauthenticated `GET /api/modules` returned `200` and 12 modules. An `OPTIONS /api/settings/extensions` request with `Origin: https://attacker.example` returned `204`, `Access-Control-Allow-Origin: *`, and `PATCH`/`DELETE` in allowed methods. Ports 4173, 4174, and 4180 were all listening on `0.0.0.0`.

**Definition of done**

- Default to loopback unless an explicit secure network mode is configured.
- Authenticate every non-health API and SSE connection before routing.
- Enforce server-side authorization for read, configuration, launch, review, cleanup, and destructive capabilities; do not treat the UI as an authorization layer.
- Use an explicit origin allowlist and CSRF protection for browser sessions.
- Do not accept agent/model/subagent control headers from unauthorized callers.
- Add integration tests proving anonymous and cross-origin read/write/delete/stream attempts fail.

### TF-002 — P1 — Configurable integration URLs provide an SSRF primitive

**Status: authentication-independent controls complete in Wave 3 (`79aee4b`, `564257d`, `520cbc9`); final closure is blocked by `TF-001`.** Configurable Sentry and SonarQube traffic now uses a permission-guarded host network service with exact private-origin allowlisting, all-answer address classification, pinned DNS, manual per-hop redirect validation, and cross-origin credential rejection. Authenticated `settings.manage` authorization for discovery/verification remains part of `TF-001`.

Backend-managed server federation validates UI-provided public origins through
the DNS-pinning outbound policy and requires a compatible VertexADE identity
response before persistence. Private, loopback, link-local, metadata, mixed
address, and redirect-based destinations are rejected; authenticated
settings-management authorization remains blocked on `TF-001`.

**Impact**

The API can be made to request loopback or internal-network services. Today this is remotely reachable without authentication because of `TF-001`; even after authentication, a compromised or lower-privilege account could use the server as an internal network probe unless outbound destinations are governed.

**Evidence**

- `packages/extensions/sonarqube/src/server/extension.ts:29-48,57-64` accepts an arbitrary URL and uses it for verification and findings.
- `packages/extensions/sonarqube/src/server/extension.ts:158-173` exposes an installed-state `/projects` action that performs the request before saving configuration.
- `packages/extensions/sonarqube/src/server/client.ts:20-37,47-68` sends an authorization header to the configured origin and follows it with API requests.
- `packages/extensions/sentry/src/server/extension.ts:19-43` has the same unrestricted configurable-origin pattern.
- Live proof: an unauthenticated SonarQube `/projects` request pointed at `http://127.0.0.1:4174`; the response returned the internal API's `Not found` body, proving the server made the loopback request.

**Definition of done**

- Require an authenticated settings-management capability for discovery and verification actions.
- Centralize outbound URL validation and redirect handling.
- Block loopback, link-local, metadata, Unix-socket, and disallowed private destinations by default, including DNS-rebinding and redirect cases.
- Provide a deliberate, auditable allowlist for self-hosted internal integrations.
- Add tests for encoded IPs, IPv6, userinfo, redirects, DNS changes, and credentials not crossing origins.

### TF-003 — P1 — Many JSON routes have no request-body limit

**Status: fixed in Wave 1 (`e6fdb8d`).** Shared and direct JSON routes now use a bounded reader; declared, streamed, malformed-length, and aborted-body coverage passes with `413` preserved.

**Impact**

An attacker or broken client can make the process buffer and parse arbitrarily large JSON bodies, causing memory pressure or process termination. The unauthenticated management boundary makes this directly reachable.

**Evidence**

- `packages/platform-server/src/http.ts:17-25` implements `readJsonObject()` with `request.json()` and no size limit.
- The unbounded helper is used by automation, capability, agent environment, findings, and extension settings/actions across `apps/api/src` and `packages/extensions/*/src/server`.
- `apps/api/src/server/agents/resource-routes.ts:40-56,79-89` and `apps/api/src/server/platform/workspace-routes.ts:271-286` also call `request.json()` directly.
- A bounded implementation already exists at `packages/platform-server/src/http.ts:28-53`, but these routes bypass it.

**Definition of done**

- Make the shared JSON-object reader use the bounded byte reader before parsing.
- Remove direct `request.json()` usage from server routes or require an explicit, reviewed maximum.
- Return `413` for both declared and streamed oversized bodies.
- Add coverage for missing/invalid `Content-Length`, chunked transfer, aborted reads, and boundary-sized payloads.

### TF-004 — P1 — SSE clients and response buffering are unbounded

**Status: authentication-independent controls complete in Wave 3 (`4dc02c2`, `33595de`, `520cbc9`, `a3e82f9`); final closure is blocked by `TF-001`.** SSE now has global/per-IP caps, byte-bounded queues and events, slow-reader eviction, validated heartbeats/write deadlines, trusted transport identity, Node drain backpressure, and deterministic abort/shutdown cleanup. Authenticated subjects and per-user limits remain part of `TF-001`.

**Impact**

Slow or non-reading event clients can consume connections and grow memory. There is no client cap, authentication, idle policy, or backpressure handling.

**Evidence**

- `apps/api/src/server/events/dashboard-events.ts:31-40,60-97` retains every client in a process-wide `Set` and enqueues events without checking `desiredSize` or limiting queued bytes.
- `apps/api/src/server/events/dashboard-events.ts:98-105` exposes the stream with wildcard CORS.
- `apps/api/src/server/index.ts:36-39` ignores the boolean returned by `response.write()`, so it does not wait for the Node response's `drain` event.
- The only stream test, `apps/api/src/server/events/dashboard-events.test.ts:9-30`, covers a cooperative reader and does not cover slow clients, limits, or disconnect pressure.

**Definition of done**

- Authenticate SSE connections and cap connections per user/IP and globally.
- Honor both stream and Node response backpressure; disconnect clients exceeding a bounded queue.
- Add idle/write timeouts and deterministic cleanup on socket close and server shutdown.
- Load-test slow readers and verify stable heap and file-descriptor use.

### TF-005 — P1 — Permanent Work deletion forgets artifacts it failed or refused to delete

**Status: fixed in Wave 2 (`2ee5ebf`, `dc80a7c`, `85bdac4`).** Cleanup ownership is snapshotted before side effects, persists across restarts with bounded retries, blocks Work deletion while owned artifacts remain, safely migrates allowlisted legacy logs, and exposes explicit retry/detach remediation.

**Impact**

Historical logs and provider sessions can be orphaned permanently. The API reports the Work item as deleted and removes its database rows, leaving no durable retry target or ownership record. This can leak remote sessions and leave old logs on disk indefinitely.

**Evidence**

- `apps/api/src/server/work/cleanup.ts:245-257` returns `retained` for a log outside the current logs root.
- `apps/api/src/server/work/cleanup.ts:348-370` counts a failed provider-thread deletion or retained log but still deletes the job row.
- `apps/api/src/server/work/cleanup.ts:404-435` considers deletion successful when no jobs remain and no errors were recorded; retained logs/provider threads are counts, not errors.
- `apps/api/src/server/work/cleanup.test.ts:245-271` explicitly asserts `deleted: true` and a missing Work item while an external log or provider session remains.
- `apps/api/src/server/database/canonical-paths-migration.ts:120-167` moves ownership to Work items but does not canonicalize or migrate stored log paths.

**Definition of done**

- Preserve a cleanup tombstone with Work/run identity, path/provider ID, failure, attempts, and next retry until every owned artifact is deleted or explicitly detached by the user.
- Do not return `deleted: true` while retained owned artifacts have silently lost their tracking row.
- Add a safe one-time migration/copy policy for valid legacy logs into the canonical logs directory; quarantine ambiguous paths instead of forgetting them.
- Make provider deletion idempotent and retryable, and expose remediation in the UI.
- Cover restart-between-steps, partial filesystem failure, provider outage, and legacy-path recovery.

### TF-006 — P1 — PR details and agent transcript caches retain large entries without eviction

**Status: fixed in Wave 1 (`5ac536e`, `2a1f233`).** Both caches now enforce TTL, LRU entry limits, and total byte budgets; transcript state is explicitly invalidated on cleanup and deletion.

**Impact**

Long-running API processes grow with every distinct PR or large log viewed. A PR cache entry contains the full diff and review payload. Each transcript entry can retain up to 8 MB. Expired values are not removed, so TTL checks do not bound memory.

**Evidence**

- `apps/api/src/dashboard-server.ts:196-200` creates process-wide maps, including `prDetailsCache`.
- `apps/api/src/server/dashboard/repository-runtime.ts:640-666` treats PR entries as fresh for 30 seconds but leaves stale entries in the map and stores full details/diffs.
- Deletes at `apps/api/src/server/dashboard/repository-runtime.ts:675-678` and `apps/api/src/server/dashboard/pull-request-api.ts` cover mutations, not normal expiry or capacity.
- `apps/api/src/server/log-files.ts:3-5,38-65` retains transcript lines in a process-wide map keyed by path.
- `apps/api/src/server/log-files.ts:68-81` uses an 8 MB history allowance per log; no path entry is evicted when a run/Work item is deleted or when it becomes inactive.

**Definition of done**

- Replace both maps with bounded LRU/TTL caches with entry-count and total-byte limits.
- Delete stale entries on access and invalidate entries on job, Work item, log, repository, and PR removal.
- Do not cache full diffs by default when a smaller summary satisfies the caller.
- Add heap-focused tests that iterate many unique PRs/logs and prove memory remains bounded.

### TF-007 — P1 — The restore drill does not prove encrypted settings are recoverable

**Status: fixed in Wave 2 (`da92038`, `7edb92d`).** Backup verification now restores the database and existing key into an isolated permission-matched directory, opens the real migrated database/settings stores, proves rolled-back writes and representative reads, and decrypts every encrypted setting before accepting the backup.

**Impact**

A backup can pass verification and the advertised restore drill even though the restored application could not decrypt credentials. Operational recovery is not proven for the complete state needed to restart the service.

**Evidence**

- `apps/api/src/dashboard-server.ts:227-234` requires `settings.key` to decrypt settings from `dashboard.sqlite`.
- `scripts/backup-verified.mjs:43-61` copies only `dashboard.sqlite` into the restore-drill directory and performs schema/integrity checks.
- The drill neither restores the key nor attempts to decrypt every row in `encrypted_settings`.
- `scripts/backup-verified.mjs:82-113` does include the key in backups, but checksum presence is not an application-level recovery test.

**Definition of done**

- Restore the database and settings key into an isolated directory with production-equivalent permissions.
- Start the real database/settings initialization against the restored pair and decrypt every encrypted settings row.
- Verify schema, key compatibility, representative reads, and an application readiness probe without touching live data.
- Document and automate an actual restore procedure, including safe failure when the key is missing.

### TF-008 — P1 — The dependency tree contains known high-severity vulnerabilities

**Status: fixed in Wave 1 (`5c24f26`).** Production and full audits now report zero high or critical findings. Ten moderate Expo SDK 57 toolchain findings remain because npm's proposed remediation is the incompatible Expo 46 downgrade; they remain tracked as upstream exposure.

**2026-08-09 pnpm re-audit:** reopened for upstream remediation. `pnpm audit
--prod --audit-level high` reports two high-severity denial-of-service advisories
in Expo's transitive `image-size@2.0.2` dependency and one moderate finding. The
advisories name `2.0.3` as patched, but the registry does not yet publish that
version, so no installable override is available. Do not add an override until
the patched release exists and the mobile suite/export pass with it.

**Impact**

The current lockfile fails the dependency security gate. Production dependencies include two high-severity advisories; the full tree includes four high and twelve moderate findings.

**Evidence**

- `npm audit --omit=dev` reported 13 findings: 2 high and 11 moderate.
- Production-tree high findings are `brace-expansion@5.0.8` (`GHSA-rgw5-rvv9-x895`) through Expo and `fast-uri@3.1.4` (`GHSA-7p8r-x3mc-p8w7`) through AJV/RxDB.
- Full `npm audit` reported 16 findings: 4 high and 12 moderate, adding high findings in dev-tree `ip-address@10.2.0` and `undici@7.28.0`.
- Additional moderate findings affect Expo tooling, Hono, PostCSS, UUID, and related transitive packages.

**Definition of done**

- Upgrade or override to patched, compatible transitive versions and document exposure decisions.
- Do not use the audit suggestion that downgrades Expo to 46 without compatibility analysis.
- Require `npm audit --omit=dev` to contain no high/critical findings; separately track build/dev-chain findings.
- Re-run web and mobile checks, tests, exports, and dependency provenance review after lockfile changes.

### TF-009 — P2 — GitHub App authentication can block API startup indefinitely

**Status: fixed in Wave 1 (`38c1f1d`).** Token exchange now has a total deadline, caller cancellation, bounded response parsing, and non-blocking initialization with degraded/recovered health states.

**Impact**

A stalled GitHub API connection can prevent a fresh API process from completing module initialization. The same call can leave settings saves hanging indefinitely.

**Evidence**

- `packages/extensions/github/src/server/auth.ts:25-44` uses raw `fetch()` with no timeout or caller abort signal, then buffers JSON without a size cap.
- `packages/extensions/github/src/server/extension.ts:155-168,426-431` awaits that call during extension initialization.
- `apps/api/src/server/index.ts:1-7` statically imports the dashboard runtime before creating/listening on the HTTP server, so a stuck extension initialization prevents health endpoints from coming up.

**Definition of done**

- Use the shared resilient HTTP client with a bounded timeout, cancellation, response-size limit, and actionable error.
- Keep health/liveness available while optional integrations initialize or degrade them without blocking the process.
- Add tests for connect stall, response stall, oversized/invalid JSON, cancellation, and recovery on the refresh timer.

### TF-010 — P2 — Extension enable/disable is not atomic across runtime and persistence

**Status: fixed in Wave 2 (`a7023f1`, `85bdac4`).** Extension transitions now use a durable desired/applied state saga with per-extension serialization, staged trigger swaps, rollback or `repair_required` state, actual-state API/UI responses, and startup reconciliation.

**Impact**

An extension toggle can return an error after its runtime lifecycle has already changed. The persisted state may remain old, so the UI/runtime and post-restart state disagree.

**Evidence**

- `apps/api/src/server/platform/management-routes.ts:193-208` changes runtime state, then resubscribes automations, then persists encrypted state.
- `apps/api/src/server/extensions/registry.ts:293-306` mutates the installed runtime only after lifecycle work succeeds, but the management route has no rollback if later trigger synchronization or settings persistence fails.
- Current tests cover successful toggles and lifecycle failure, but not failures after `setEnabled()` succeeds.

**Definition of done**

- Define one source of truth and implement a transactional/saga-style toggle with rollback or durable pending state.
- Return the actual resulting state on failure and reconcile on startup.
- Add failure-injection tests for lifecycle, trigger subscription/disposal, encrypted persistence, cache invalidation, and notification.

### TF-011 — P2 — Mobile has no behavioral regression suite and is excluded from root tests

**Status: behavioral and root-gate work fixed in Wave 4 (`d1e5be6`, `3f31250`,
`ec8827d`, `3369017`); native promotion evidence blocked.** The repository now
has 49 mobile tests, root-gate participation, CI artifacts, a deterministic
fixture, and one shared Android/iOS Maestro journey with startup/crash probes.
This host has no ADB, Xcode simulator, or Maestro executable, and EAS validation
requires an Expo login/token, so retained device executions remain mandatory
before promotion.

**Impact**

Mobile UI and flows can regress while the required root test command remains green. Type checking and export prove compilation, not user behavior.

**Evidence**

- `apps/mobile/package.json:6-13` defines start/export/check scripts but no test script.
- `package.json:42-43` explicitly excludes `@vertexade/mobile` from both test commands.
- The mobile tree contains 133 TypeScript/TSX files and no `*.test.*` or `*.spec.*` files.
- Fallow found complex, untested mobile action input and extension-detail paths among its highest-priority coverage gaps.

**Definition of done**

- Add component/unit coverage for portable settings/actions, agent options, navigation, loading/error/empty states, and destructive confirmations.
- Add at least one device-level smoke flow covering connection, Work, Agents, PRs, extensions, and settings.
- Include mobile tests in the root verified gate and publish test artifacts.

### TF-012 — P2 — The release mobile export explicitly disables startup bytecode

**Status: release path fixed in Wave 4 (`ec8827d`); native performance promotion
evidence blocked.** Release exports now require Hermes bytecode, including a
verified QEMU compiler bridge on ARM64 Linux; no-bytecode output is named and
documented analysis-only. Android/iOS bytecode headers and the reproducible
bundle comparison pass. Ten cold starts and fatal-log scans are wired into the
manual device workflow but cannot run on this host without ADB/Xcode and Expo
credentials.

**2026-08-09 Expo refresh:** upgraded to Expo and Expo Router `57.0.11`, added
Router's required `expo-constants` and `expo-linking` native peers, removed the
obsolete SDK 57 `jsEngine` configuration, and declared the Hermes compiler used
by the release wrapper. Expo Doctor passes 20/20 checks, `expo install --check`
passes, all 49 mobile tests pass, and Android/iOS analysis exports complete. The
release-bytecode export remains host-blocked because this ARM64 machine does not
provide `qemu-x86_64`; this is the existing promotion constraint, not an SDK
compatibility failure.

**Impact**

The default mobile build takes the slower debug-oriented path. This works against fast startup and adds an avoidable performance cost unless there is a documented compatibility reason.

**Evidence**

- `apps/mobile/package.json:10-11` makes `export` use `expo export --platform all --no-bytecode`; the bytecode variant is a separate script.
- `package.json:30` makes `build:mobile` call the no-bytecode export.
- The current build succeeded but Expo emitted: bytecode makes startup faster and disabling it is highly discouraged/debug-only.

**Definition of done**

- Use bytecode for release exports, or record a measured compatibility blocker and keep no-bytecode restricted to development.
- Compare cold start, bundle size, and crash behavior on supported iOS/Android targets before promotion.

### TF-013 — P2 — CORS behavior differs by router

**Status: authentication-independent controls complete in Wave 3 (`1555b27`, `520cbc9`); final closure is blocked by `TF-001`.** One exact-origin, deny-by-default CORS policy now wraps legacy, core, extension, error, and SSE responses after routing; denied origins and invalid preflights fail before routing, and wildcard headers were removed. Authentication, authorization, and CSRF enforcement remain part of `TF-001`.

**Impact**

Cross-origin clients see a successful permissive preflight and then a browser-blocked response for some endpoints. This is an unreliable API contract independent of the security problem in `TF-001`.

**Evidence**

- `apps/api/src/server/dashboard/request-handler.ts:66-76` returns permissive CORS headers for every preflight.
- Legacy responses produced by `apps/api/src/server/dashboard/server-utils.ts:24-35` include CORS headers.
- Registered core routes such as `apps/api/src/server/platform/management-routes.ts:126-134` return plain `Response.json()` without those headers.
- Live proof: direct `GET /api/modules` returned no `Access-Control-Allow-Origin`, while `GET /api/read-model` returned `*`.

**Definition of done**

- Apply authentication and one centralized restrictive CORS policy after routing to every response, including errors and SSE.
- Add browser-level tests for allowed and denied origins across legacy, core, extension, error, and stream routes.

### TF-014 — P2 — Work terminology and the UI audit have drifted apart

**Status: fixed in Wave 4 (`8fc41ee`, `3b515d2`).** Work conversations now use
thread vocabulary, run is reserved for executions, audited actions use stable
semantic selectors, and the production audit passed all 420 combinations (60
screens/dialog states across seven widths) with zero failures.

**Impact**

Users see `run` and `thread` for the same concept, increasing cognitive load. The live UI audit fails four otherwise-rendered flows, so it can no longer act as a clean release gate.

**Evidence**

- `apps/web/src/components/work/work-action-bar.tsx:162,211,222,308` uses `New agent run` and `New review run`.
- `apps/web/src/components/work/work-thread-list.tsx:163` uses `New review thread` / `New work thread`.
- `apps/web/src/routes/work.$workKey.tsx:284` labels the `threads` tab as `Runs`.
- `scripts/audit-ui-routes.mjs:101-104` expects `New agent thread` and `New review thread`.
- Live desktop/mobile audit: 120 route/viewport combinations had no overflow, unnamed controls, exceptions, console errors, or response failures, but four interactions failed because the expected thread actions are rendered as run actions.

**Definition of done**

- Adopt one user-facing vocabulary (prefer `thread` for the conversation and reserve `run` for an execution/turn) and apply it consistently.
- Give audited actions stable semantic selectors instead of coupling the gate only to mutable copy.
- Require the live desktop/mobile audit to finish with zero failures.

## P3 maintainability backlog

### TF-015 — Split the highest-risk orchestration/UI units after behavior is covered

**Status: scoped highest-risk backlog fixed in Wave 5 (`d965759` through
`ba3449b`).** Characterization now protects thread routes, activity/reply
behavior, portable collection state, pull-request filters/details,
automations, and the GitHub lifecycle. The targeted API/UI composition roots
were decomposed, all ten Wave 4 carry-ins were reduced, and the private unused
AI-element surfaces plus their orphaned dependencies were removed. The final
changed-line Fallow gate reports zero introduced dead-code, complexity,
duplication, or styling findings. Broader repository-wide dead-code and
coverage-gap output remains an inventory for future targeted waves, not an
unverified deletion list.

Fallow reports good overall maintainability (`89.2`) but 323 functions above 60 lines, 205 files without a static test dependency path, and 195 dead-code findings. These are change-amplification risks, not proven runtime defects.

Start with:

- `packages/ui/src/components/thread-panel.tsx` — `ThreadPanel`, 690 lines.
- `apps/api/src/server/dashboard/thread-api.ts` — `handleThreadApi`, 596 lines.
- `packages/ui/src/components/portable-extension-host.tsx` — `PortableCollectionHost`, 590 lines and accelerating churn.
- `packages/extensions/github/src/server/extension.ts` — `createExtension`, 494 lines.
- `apps/web/src/routes/pull-requests.tsx` — `Dashboard`, 491 lines.
- `packages/ui/src/components/automation-recipes.tsx` — `ExtensionAutomations`, 460 lines.
- `packages/ui/src/components/ai-elements/prompt-input-controls.tsx` — 24 unused exports.
- `packages/ui/src/components/ai-elements/message.tsx` — 12 unused exports reported as unused.

Before splitting, add characterization tests around loading, failure, cancellation, retry, cleanup, responsive dialogs, and extension lifecycle paths. Remove dead exports/dependencies in isolated commits only after confirming they are not public extension API.

Wave 4 added coverage-first mobile release tooling and also made ten Fallow
complexity findings attributable to changed/new functions. Wave 5 must triage
those alongside the original list, using actual coverage and source evidence;
it must refactor genuine change-amplification risks and must not hide branch-
complete build/device validation behind blanket suppressions.

## Validation snapshot

### Wave 1 completion — 2026-08-04

- Clean `npm ci` completed from the committed lockfile.
- `npm run check` passed: 761 formatted files and 691 lint/type-checked files.
- `npm test` passed: root scripts plus all selected API/web/package workspaces; the existing two Docker integration tests were explicitly skipped by their suite.
- `npm run build` passed, including React Compiler verification and bundle budgets.
- Mobile typecheck and iOS/Android export passed on Expo `57.0.10`, Expo Router `57.0.10`, and React Native `0.86.2`; `expo install --check` reports dependencies are current.
- `npm audit --omit=dev` and full `npm audit`: 0 high, 0 critical, 10 moderate.
- Focused request/upstream/cache/cleanup suites cover 413 boundaries, aborts, connection and body stalls, oversized responses, recovery, LRU/TTL/byte eviction, truncation, and deletion invalidation.
- `fallow security` reports 35 candidates for manual review; its SSRF candidates remain in `TF-002`, while the previously reviewed scanner-only candidates below remain unchanged.

### Passed

- `npm run check` — 756 files formatted; 688 files with no lint, type, or warning failures.
- `npm test` — all selected root workspaces passed; 2 Docker integration tests were explicitly skipped by their suite.
- `npm run build` — web/SSR build, React Compiler verification, and bundle budgets passed.
- `npm run check --workspace @vertexade/mobile` — passed.
- `npm run build:mobile` — iOS and Android export passed.
- Live UI audit — 120 desktop/mobile route/view combinations rendered without overflow, unnamed interactive controls, runtime exceptions, console errors, or failed HTTP responses. The four non-zero results are the confirmed terminology/audit mismatch in `TF-014`.
- Public/static asset scan found only expected logos/icons; no committed source maps, databases, dumps, PEM keys, or environment files were found.

### Failed or actionable

- `npm audit --omit=dev` — 13 vulnerabilities (2 high, 11 moderate).
- Full `npm audit` — 16 vulnerabilities (4 high, 12 moderate).
- `fallow dead-code --production` — 195 findings; keep as `TF-015` until individual exports are source-verified.
- `fallow health --coverage-gaps` — 205 untested files / 661 untested exports by static dependency analysis; this is not line coverage.
- Live UI audit exit — 4 stale-label interaction failures recorded in `TF-014`.

## Scanner candidates deliberately not promoted

- Mermaid's `dangerouslySetInnerHTML` is fed by Mermaid initialized with `securityLevel: 'strict'` (`packages/ui/src/components/mermaid-diagram.tsx:9-14`), while surrounding Markdown uses `rehype-sanitize` (`packages/ui/src/components/markdown-renderer.tsx:132-146,213`). Keep dependency security current, but the scanned sink alone is not a confirmed XSS.
- `sql.raw()` in `apps/api/src/server/dashboard/job-log-query.ts:5-14` is built from SQLite schema column names filtered by a strict identifier regex, not request input; no injection was confirmed.
- Process spawns use argument arrays with `shell: false` or fixed internal command selection; no command-injection path was confirmed.
- Preview dynamic regular expressions use fixed tool IDs or escaped keys; no attacker-controlled regular expression was confirmed.

## Re-audit checklist

After fixes, rerun:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm --filter @vertexade/mobile check
pnpm build:mobile
pnpm audit --prod --audit-level high
fallow health --hotspots --targets --coverage-gaps --top 80
fallow security
fallow dead-code --production
pnpm audit:ui --viewport desktop --viewport mobile
```

For security fixes, also repeat the anonymous API, disallowed-origin, oversized-body, slow-SSE-client, SSRF, cleanup-restart, and full restore-drill adversarial tests described above.
