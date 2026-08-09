# Wave 1: resource and startup hardening

Status: completed and verified locally on 2026-08-04; not merged or deployed.

Issues: `TF-003`, `TF-006`, `TF-008`, and `TF-009` from [`TOFIX.md`](../../TOFIX.md).

## Outcome

Wave 1 removes the immediately reachable unbounded request, upstream-response, and cache paths; prevents optional GitHub App authentication from delaying API availability; and clears known high-severity dependency findings without changing Expo majors.

This wave is deliberately independent of the `TF-001` authentication program. Authentication remains a release blocker, but these limits provide defense in depth and reduce accidental resource exhaustion for authenticated deployments too.

## Baseline

- Shared request body limit: `100,000` bytes, but `readJsonObject()` and three production route groups bypass it.
- GitHub App token exchange: raw `fetch()` with no total deadline or response-size limit; extension initialization waits for the exchange.
- PR details cache: unbounded `Map` retaining the full response, including diffs.
- transcript cache: unbounded path-keyed `Map`; each path may retain up to 8 MB.
- production dependency audit: 13 findings, including high findings in `brace-expansion@5.0.8` and `fast-uri@3.1.4`.
- full dependency audit: 16 findings, adding high development findings in `ip-address@10.2.0` and `undici@7.28.0`.

## Change set 1: bounded JSON input (`TF-003`)

### Design

1. Make `readJsonObject()` parse bytes returned by `readRequestBody()` instead of using `Request.json()`.
2. Treat a canonical, non-negative decimal `Content-Length` as an early rejection hint. Missing or malformed values do not bypass the streamed byte count.
3. Preserve the existing default of 100,000 bytes. Larger route-specific limits must be explicit at the call site.
4. Replace every production `request.json()` call in API routes with `readJsonObject()`.
5. Preserve typed `HttpError` status codes in the agent-resource router so an oversized request returns `413`, not `400`.
6. Keep the subagent harness on its existing bounded reader; deduplicate it only if error-contract compatibility is maintained.

### Tests

- Exact boundary accepted; boundary plus one rejected.
- Declared oversized payload rejected before consumption.
- Missing, malformed, and misleading `Content-Length` values cannot bypass streamed enforcement.
- Chunked/streamed oversize rejected and reader cancelled.
- Aborted streams reject without hanging.
- Empty, malformed, scalar, and array JSON preserve the current `400` contract.
- Agent-resource and workspace routes return `413` for oversized bodies.

### Rollback

Reverting this change restores the old parsing path and requires no data migration. Route-specific size exceptions can be raised independently without removing the shared limit.

## Change set 2: bounded GitHub App authentication (`TF-009`)

### Design

1. Send token exchanges through the existing resilient HTTP client with one attempt because the operation is a non-idempotent `POST`.
2. Apply a total request deadline to connection, headers, and response-body consumption. Preserve caller cancellation.
3. Add a shared bounded response-body reader and cap the token response at 64 KiB.
4. Parse the response as an object and return actionable errors for timeout, cancellation, oversized content, invalid JSON, GitHub errors, and missing token fields.
5. Start initial GitHub App authentication in the background. Mark the integration as initializing/degraded until it succeeds; do not block extension registry initialization or API listening.
6. Retain the five-minute refresh. A failed refresh updates health without terminating the API; a later successful refresh restores the integration.
7. Keep settings verification synchronous, but subject it to the same deadline and response limit before credentials are persisted.

### Tests

- Successful exchange and request headers.
- Connect stall, response-body stall, caller cancellation, and timeout cleanup.
- Declared and streamed oversized responses.
- Invalid JSON, error JSON, and missing fields.
- Extension initialization resolves before a pending exchange.
- Failed background initialization degrades status; a later refresh can recover it.

### Rollback

The transport change is isolated to GitHub App authentication. Reverting it does not alter stored credentials. Background initialization can be reverted separately if runtime status behavior needs correction.

## Change set 3: byte-bounded caches (`TF-006`)

### Shared cache primitive

Add a small `BoundedTtlCache<K, V>` to `@vertexade/platform-server` with:

- maximum entries, maximum total bytes, TTL, and injected size/clock functions;
- LRU promotion on successful access;
- eager removal of expired entries on access and insertion;
- rejection of a single entry larger than the total cache budget;
- byte re-accounting when an existing value is replaced;
- `get`, `set`, `delete`, `clear`, `keys`, entry count, and retained-byte diagnostics.

### PR details policy

- TTL: 30 seconds.
- Maximum: 32 entries and 32 MiB total.
- Oversized details are returned to the caller but are not cached.
- The full diff remains present only for the details endpoint, whose caller requires it; no background/list cache gains a diff.
- Existing PR mutation and repository-refresh invalidations remain authoritative.

### Transcript policy

- Sliding TTL: 10 minutes.
- Maximum: 32 paths and 32 MiB total.
- Existing per-transcript retained-history limit remains 8 MB.
- Reweigh entries after incremental reads so mutations cannot evade the global byte budget.
- Export explicit path invalidation and invoke it when logs are removed through Work cleanup, individual thread deletion, and closed-worktree cleanup.
- Missing/truncated files invalidate prior state before rebuilding.

### Tests

- LRU order, expiry, replacement accounting, oversize rejection, and entry/byte eviction.
- Hundreds of unique synthetic PR values remain within both budgets.
- Hundreds of unique transcript paths remain within both budgets.
- Mutable transcript growth is reweighed and evicts older entries.
- Truncation and explicit log deletion discard stale transcript state.
- Existing PR mutation and repository invalidation behavior remains covered.

### Rollback

Both caches are process-local and disposable; rollback requires no migration. Limits are named constants so they can be tuned independently after live heap observation.

## Change set 4: dependency remediation (`TF-008`)

### Design

Use compatible patch/minor resolutions rather than the audit tool's unsafe Expo 46 downgrade:

- `brace-expansion` -> `5.0.9`
- `fast-uri` -> `3.1.5`
- `postcss` -> latest compatible `8.5.x`
- development-only `ip-address` -> latest `10.x`
- development-only `undici` -> latest `7.x`
- update Expo packages only within the current SDK 57 line when their declared peer set remains valid

Record any remaining moderate Expo toolchain findings as accepted upstream exposure with package paths; do not claim they are fixed by an incompatible major change.

### Tests

- Clean `npm ci` resolves the intended versions.
- `npm audit --omit=dev` reports zero high or critical findings.
- Full audit reports zero high or critical findings, or a source-verified exception is recorded before completion.
- `npm run check`, `npm test`, and `npm run build` pass.
- Mobile typecheck and both iOS/Android export pass.
- Dependency tree/provenance confirms the overrides affect only compatible consumers.

### Rollback

Dependency changes are isolated in `package.json` and `package-lock.json`. Revert the dependency change set as a unit if build or runtime compatibility fails.

## Implementation order

1. Bounded JSON reader and route migration.
2. Shared response reader and GitHub App transport/startup behavior.
3. Shared bounded cache, then PR and transcript integrations.
4. Dependency resolutions and clean-install verification.
5. Targeted tests after each change set; full gates after all four.

## Wave acceptance gate

Wave 1 is complete only when:

- no production route uses an unbounded JSON parser;
- oversized declared and streamed requests return `413`;
- GitHub App network or body stalls cannot delay API availability indefinitely;
- PR and transcript cache diagnostics never exceed configured entry or byte budgets;
- production dependency audit has no high or critical findings;
- targeted tests, root check/test/build, mobile check/export, and a clean-install run pass;
- `TOFIX.md` records the verification evidence and any residual moderate dependency exposure.

## Deployment gate

No merge or deployment is included in this wave unless separately authorized. If authorized later, deploy through the verified service workflow, verify the served checkout and PM2 `APP_ROOT`, exercise `/healthz` and `/readyz`, send oversized-body probes, and observe API RSS during repeated unique PR/log reads.

## Completion evidence

- Bounded JSON input: `e6fdb8d`
- Bounded GitHub App authentication and non-blocking startup: `38c1f1d`
- Bounded PR/transcript caches and isolated PR policy: `5ac536e`, `2a1f233`
- Compatible dependency remediation: `5c24f26`
- Full-suite compatibility corrections: `158ac1e`
- Clean install, root check, full tests, web build/budgets, mobile typecheck/export, Expo compatibility check, production/full audits, and focused adversarial suites passed.
- Production and full dependency audits both contain 0 high and 0 critical findings. The 10 remaining moderate findings are the Expo SDK 57 `xcode`/`uuid` chain; npm offers only an incompatible SDK 46 downgrade, so they remain documented rather than force-fixed.
