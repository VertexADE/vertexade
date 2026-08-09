# Wave 2 — Recovery and lifecycle durability

Status: complete and verified on branch `fix/wave-2-recovery-lifecycle`.

Scope: `TF-007`, `TF-005`, and `TF-010`, in that order. This wave starts from
Wave 1 commit `442bd42` on branch `fix/wave-2-recovery-lifecycle`.

## Outcome

After this wave:

- a backup is accepted only after its database and encryption key have been
  restored together and every encrypted setting can be decrypted;
- permanent Work deletion never loses the identity of an artifact that still
  needs cleanup, including across restarts;
- extension enable/disable has a durable desired state, reports the actual
  runtime state, and converges after any lifecycle or follow-on failure.

The wave does not merge or deploy itself. Deployment remains a separate,
explicitly authorized operation.

## Safety invariants

1. Restore verification never reads or writes the live database or live key.
2. Restore verification never starts agents, automation recovery, preview
   reconciliation, provider calls, or any other operational side effect.
3. A cleanup record is committed before the first destructive side effect.
4. No job or Work row is the sole remaining owner record for an undeleted
   artifact.
5. Cleanup retries are idempotent; an already absent artifact is complete.
6. An ambiguous legacy path is quarantined for explicit remediation, never
   followed or deleted speculatively.
7. Extension state has one durable source of truth. UI responses distinguish
   desired, applied, pending, and failed states.
8. A failed extension transition either restores the prior runtime state or
   records the observed runtime state and a durable reconciliation task.

## Phase A — Prove complete backup recovery (`TF-007`)

### Design

Add a restore verifier that uses the same storage primitives as the API while
remaining side-effect-free:

- export `readExistingEncryptionKey(path)` from `encrypted-settings.ts`. Unlike
  `ensureEncryptionKey`, it must fail if the key is missing and must never
  create recovery material;
- add `EncryptedSettingsStore.verifyAll()` to enumerate encrypted setting rows,
  decrypt each payload with the restored key, and return the verified names;
- add a restore-readiness module/CLI that opens the copied database through
  `openDashboardDatabase`, checks the current schema and SQLite integrity,
  instantiates the real settings stores, decrypts every encrypted row, performs
  representative read-only Work/repository/settings queries, and emits a
  machine-readable readiness result;
- make `backup-verified.mjs` copy both `dashboard.sqlite` and the manifest-named
  settings key into a mode-`0700` temporary directory, set both files to
  mode `0600`, invoke the restore-readiness CLI against those copies, and always
  remove the temporary directory;
- keep the existing rolled-back write probe on the restored database copy so
  filesystem/database writability is checked without persistent mutation.

This is an isolated dashboard **state-readiness instance**, not a normal
dashboard process. Starting the normal process against a restored production
snapshot would recover queued jobs, automations, provider sessions, and preview
resources, causing external side effects. The verifier therefore reuses the
real database, migration, settings, and read-model storage paths but exposes
only an in-process readiness probe.

### Failure behavior

- Missing, wrong-length, or wrong settings keys fail the drill.
- Any undecryptable encrypted row identifies its setting name without printing
  ciphertext or secret material.
- A corrupt database, outdated/failed migration, failed integrity check, or
  unreadable representative record fails the drill.
- A backup containing no encrypted rows still proves key presence and format.
- The source backup and live data remain byte-for-byte untouched.

### Tests

- correct database/key pair with multiple encrypted rows;
- missing key, invalid-length key, wrong key, and corrupt encrypted payload;
- zero encrypted rows;
- current schema/readiness output and representative Work/repository reads;
- production-equivalent directory/file permissions;
- failed verification removes its temporary directory and does not modify the
  backup source;
- `npm run backup:verify` and `npm run backup:restore-drill` exercise the same
  manifest/key resolution rules.

### Acceptance gate

The restore drill must fail for every incompatible database/key case and pass
for a valid pair while reporting schema version, decrypted-setting count, and
readiness status.

## Phase B — Durable Work cleanup (`TF-005`)

### Data model

Add schema migration 29 with two additive tables:

`work_cleanup_tombstones`

- stable tombstone ID;
- original Work ID, key, title, and deletion-request timestamp;
- state: `pending`, `retrying`, `blocked`, or `complete`;
- aggregate attempt count, next retry time, last error, and completion time.

`work_cleanup_artifacts`

- stable artifact ID and parent tombstone ID;
- original run ID where applicable;
- kind: `log`, `provider_thread`, `worktree`, `branch`, `memory`, or
  `workspace_root`;
- canonical target plus provider/agent identity where applicable;
- state: `pending`, `retrying`, `blocked`, `detached`, or `complete`;
- attempt count, next retry time, last error, and timestamps.

The tables deliberately do not cascade from Work/jobs: tombstones must survive
the rows whose removal they track. Index pending artifacts by next retry time.

### Deletion sequence

1. Preview remains read-only.
2. On confirmation, open an immediate database transaction and snapshot the
   Work, every owned job, and every owned cleanup target into a tombstone and
   artifact rows. Reusing an existing non-complete tombstone is idempotent.
3. Commit the snapshot before stopping a process or touching the filesystem,
   Git, memory, or a provider.
4. Attempt artifacts one at a time and persist each outcome immediately.
5. A job row may be removed only after all of its targets either completed or
   are durably represented by the tombstone. Source-job references are detached
   in the same database transaction as job removal.
6. A Work row may be removed after its jobs are removed because its identity is
   retained by the tombstone. The response reports `work_item_removed`
   separately from `cleanup_complete`.
7. `deleted` remains `false` until every owned artifact is `complete` or was
   explicitly `detached`; pending/blocked cleanup is never presented as fully
   deleted.

Extend `WorkDeletionResult` with tombstone ID, `work_item_removed`,
`cleanup_complete`, pending count, and next retry time. Batch counts use
`cleanup_complete`, while the UI can immediately remove a Work row that is
already represented by a tombstone.

### Retry lifecycle

- Add a cleanup service that owns snapshot, execution, retry, query, detach,
  and manual retry operations.
- Recover due tombstones on startup without blocking health and run a bounded,
  unref'd retry interval.
- Use capped exponential backoff with jitter and a maximum number of artifacts
  per pass.
- Retry provider deletion and filesystem operations idempotently: not-found is
  success; timeouts and provider outages remain retryable.
- Stop the retry worker during graceful shutdown.
- Emit dashboard events after each material state change.

### Legacy log policy

For an existing log outside the canonical logs root:

1. Resolve without following a path outside an allowlisted historical
   dashboard data root.
2. Accept only a regular file whose stored run identity matches the owning job.
3. Copy it with exclusive creation into a deterministic `logs/legacy/` target,
   verify size and SHA-256, then delete the source and track only the canonical
   target.
4. If the source is missing, mark it complete.
5. If ownership, root, type, or identity is ambiguous, mark the artifact
   `blocked`; do not read, copy, or delete it.

No arbitrary external path becomes an allowed delete target merely because it
was stored in the database.

### API and UI

- Add cleanup-status endpoints to list tombstones, retry a tombstone, and
  explicitly detach a blocked artifact after a confirmation that includes its
  Work key.
- Show pending cleanup in the Work deletion result and in one compact
  remediation surface with Work key, artifact kind, safe display target,
  attempts, error, and next retry.
- Keep single and batch deletion flows usable: successful Work-row removal
  closes the dialog, while a concise notification links to remaining cleanup.
- Never render secrets or provider credentials in cleanup errors/targets.

### Tests

- restart immediately after snapshot, after one artifact, and before Work-row
  removal;
- provider outage, timeout, not-found, eventual recovery, and idempotent retry;
- partial filesystem failure and already-missing files/directories;
- canonical log, valid legacy log migration, wrong-root path, symlink, device,
  mismatched identity, and checksum/copy failure;
- database failure before snapshot (no side effects) and after snapshot
  (recoverable on restart);
- single and batch result semantics and UI pending/remediation states;
- explicit detach confirmation and auditability;
- bounded retry selection and graceful shutdown.

### Acceptance gate

Kill-and-restart tests at every destructive boundary must converge without an
orphan, and the API must never report `deleted: true` while a pending or blocked
owned artifact lacks an explicit detach decision.

## Phase C — Atomic extension lifecycle (`TF-010`)

### Source of truth

Add schema migration 30 with `extension_states`:

- extension ID primary key;
- desired enabled state;
- applied enabled state;
- phase: `stable`, `applying`, or `repair_required`;
- operation ID, attempt count, last error, and timestamps.

The encrypted legacy `extensions` map is migrated once into this table, then is
read only as a compatibility fallback during migration. Extension booleans are
not secrets, so the transactional SQLite table is the appropriate source of
truth.

### Coordinator

Introduce an `ExtensionStateCoordinator` outside the HTTP route:

1. serialize transitions per extension;
2. transactionally persist desired state and `applying` before lifecycle work;
3. apply `registry.setEnabled`;
4. resynchronize automation triggers with a staged subscription swap: build
   new subscriptions first, dispose old subscriptions only after all new
   subscriptions succeed;
5. invalidate the extension cache when disabling;
6. persist applied state and `stable`, then notify clients;
7. return desired, applied, pending, and error fields.

If a post-lifecycle step fails, attempt to restore the prior registry and
trigger state. Keep the requested desired state durable. Record the observed
applied state and `repair_required` so startup reconciliation can retry. The UI
must show the observed state, not optimistically claim the requested state.

Startup loads desired states before provider selection, reconciles all
non-stable/different rows, and only then starts normal trigger subscriptions.
Reconciliation is bounded and leaves a degraded extension diagnostic instead
of preventing API liveness.

### API and UI

- Module catalog entries expose transition metadata (`desiredEnabled`,
  `pending`, and sanitized `stateError`).
- `PATCH /api/settings/extensions` returns the actual applied result. A durable
  pending repair uses a non-success status but still includes the state body.
- Disable toggle controls while that extension is applying.
- Show `Applying…` or `Retry needed`; refresh from the catalog after both
  success and failure.
- Keep the active default agent protection as a precondition.

### Tests

Inject failures at:

- initialize and dispose lifecycle;
- new trigger subscribe, old trigger dispose, and staged swap;
- state write before lifecycle and final state write;
- cache invalidation;
- notification;
- process restart after desired-state commit and after runtime mutation.

For each case assert persisted desired/applied state, registry state, trigger
subscriptions, response body/status, diagnostics, and startup convergence. Add
concurrent and duplicate toggle tests to prove per-extension serialization and
idempotence.

### Acceptance gate

Every injected boundary must either finish in the requested stable state or in
a durable `repair_required` state whose reported applied value matches the
runtime and converges on startup.

## Wave verification

After all three phases:

1. install from the lockfile in the isolated worktree;
2. run focused migration, restore, cleanup, extension, route, contract, and UI
   tests after each phase;
3. run `npm run check`;
4. run the full root test suite;
5. run `npm run build`;
6. run production and full dependency audits to ensure Wave 1 gates stay green;
7. run the existing Fallow/security review and manually classify new findings;
8. update `TOFIX.md` only with verified evidence and commit the verification
   record separately.

### Verification record

- `npm run check` passed formatting, lint, and TypeScript checks across 705 files.
- `npm test` passed the root scripts suite and every included API, web, package,
  and extension workspace suite; the repository module-size guard also passed.
- `npm run build` passed the production web/API build and bundle-budget checks.
- Focused restore, cleanup, extension lifecycle, route, contract, and UI tests
  are included in the passing root suite, including restart and injected-failure
  cases.
- `fallow audit --base 442bd42 --format json` passed the new-only gate with zero
  introduced dead-code, complexity, duplication, or styling findings. It still
  reports six inherited dead-code findings, 23 inherited complexity findings,
  and nine inherited duplication groups; none were introduced by this wave.
- Both `npm audit --omit=dev --json` and `npm audit --json` report zero high or
  critical vulnerabilities. The ten moderate Expo toolchain findings recorded
  by Wave 1 remain.
- Wave implementation commits are `da92038`, `2ee5ebf`, `7edb92d`, `dc80a7c`,
  `a7023f1`, `bcd5ae6`, `fc807f0`, and `85bdac4`.

## Rollback

Both migrations are additive. Old Work/job and encrypted extension-state data
remain readable during the rollout. A code rollback may ignore the new tables;
it must not drop them. Cleanup artifacts already snapshotted remain preserved
for the forward fix. Restore verification changes affect only backup acceptance
and can be rolled back without changing backup contents.
