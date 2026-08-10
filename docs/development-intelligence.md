# Development intelligence

VertexADE provides five revision-bound development workflows: change impact, architecture context, test intelligence and repair, pull-request evidence, and migration campaigns. Each repository-scoped artifact belongs to the server that owns the repository. The web client preserves that ownership when the selected server changes and only aggregates compact summaries across linked servers.

## Revision and trust model

Every analysis captures a base and head revision. Pull-request artifacts become stale as soon as the stored provider head changes; stale results remain available for audit but do not satisfy readiness. Unknown, unavailable, blocked, and stale evidence are never converted to success.

Repository documents, analyzer output, test logs, and predicted migration changes are untrusted input. Agent prompts place these values in bounded, named delimiters and retain source citations or digests. Browser requests cannot submit shell strings: validation targets are server-owned records containing an allowlisted executable, an argument array, a repository-relative working directory, a timeout, an environment allowlist, and optional expected artifact paths.

## Change impact

Impact analysis combines the Git diff with workspace manifests, dependency direction, package ownership, declared validation scripts, public-contract paths, database/configuration changes, CI/deployment paths, and extension manifests. Nodes and reason edges are stable for a fixed analyzer version and every transitive result includes its source and explanation. Incomplete or bounded analysis produces warnings.

Available entry points:

- pull-request and Work panels for create, refresh, summary, validation needs, delivery effects, warnings, and reason chains;
- repository comparison API for explicit base/head analysis;
- feedback records for false positives and missing relationships, stored separately from analyzer output.

Primary routes are `POST /api/pulls/:repositoryId/:number/impact-analysis`, `POST /api/work-items/:workItemId/impact-analysis`, and `POST /api/repositories/:repositoryId/impact-analyses`. Detail and feedback routes use the owning repository backend.

## Architecture context

The deterministic architecture index reads source-backed package/service boundaries, APIs, events, datastores, deployments, extensions, architecture documents, and ADRs. It excludes secrets, generated output, dependency directories, ignored files, and other configured exclusions. Conflicting documents remain visible as warnings.

The Architecture screen shows repository boundaries, relations, decisions, citations, and freshness. Pull-request and Work agent launches can build a size-bounded context packet, preview each fact, remove irrelevant facts, and attach the selected packet. The Work history records the packet digest and payload so a later reviewer can see the exact context supplied to the agent.

## Test intelligence and repair

The test catalog discovers package scripts and merges repository-local overrides from Settings. Each recommendation explains its direct-impact, dependency, contract, or policy reason, while omissions and coverage gaps stay explicit.

Validation executes at the immutable captured revision in a disposable detached worktree. Installed dependencies are reused only when package metadata and lockfiles match the repository owner's current checkout; the server never performs an implicit install or runs install scripts. Migration verification may use the completed Work worktree after proving it belongs to the repository, is clean, and is at the captured revision. Output is byte-capped, ANSI-normalized for failure extraction, and stored with exit status, duration, base-revision comparison, fingerprints, and metadata for configured artifact paths.

A failed run can launch one linked repair Work. Its prompt includes bounded change-impact evidence, architecture facts and citations when available, the normalized failures, a log excerpt, and the exact structured rerun target. After the Work is completed and committed, **Verify repair**:

1. analyzes the repair diff;
2. reruns the failed target first;
3. stops on a repeated failure fingerprint or a broader impact set;
4. otherwise runs every target selected by the repaired impact;
5. links each verification run to the original failed run.

The repair agent cannot silently publish a commit or pull request. Provider-side actions remain separately authorized.

**Auto-repair · max 3** is an explicit opt-in durable loop. The server persists its current run and Work job, resumes reconciliation after a restart, and enforces both an attempt limit and a two-hour elapsed limit. It stops immediately on a repeated fingerprint, broader impact, job failure, elapsed limit, cancellation, or success. Cancellation retains every Work item, run, and log.

## Pull-request evidence

The Evidence tab derives a current-head readiness decision from impact, architecture, selected validation, provider checks and approval, contract/database compatibility, and delivery evidence. Entries use `passed`, `failed`, `blocked`, `not_applicable`, `unknown`, or `stale`; a collector that has not run reports unknown.

Readiness rules are configured per server with optional repository overrides in Settings. Waivers are revision-scoped and require an actor and reason, with optional expiry. The queue badge and detail ledger use the same persisted snapshot and policy version.

## Migration campaigns

Migration recipes are immutable, versioned structured transformations. The built-in pilot upgrades `@types/node` to the Node.js 24 type surface and requires typecheck and test validation. A campaign freezes the recipe and repository revisions, then follows this lifecycle:

1. applicability discovery and a non-mutating disposable-worktree dry run;
2. explicit first-write approval;
3. one or more canaries;
4. explicit approval before each larger wave;
5. bounded per-server concurrency and at most three attempts per target;
6. completed-Work verification with a new output revision, impact analysis, required validation runs, and optional PR evidence;
7. completion only after every target succeeds, is not applicable, or is explicitly skipped.

A failed canary pauses the campaign and later waves cannot resume until the target is explicitly retried or skipped. Cancellation only stops future scheduling and retains Work, branches, logs, attempts, and pull requests.

For multiple servers, the browser creates one durable child campaign per owning backend with a shared federation group ID. Each child uses its own repositories, credentials, agents, validation catalog, concurrency, and policy. Partial creation and control results stay labeled by server and can be retried idempotently; no cross-server transaction or shared database is implied.

## Operations and limits

- Impact, architecture, validation, evidence, and migration tables are created only by ordered SQLite migrations.
- Analysis and packet payloads are bounded by file, byte, fact, citation, and warning limits.
- Validation output is capped at 2 MiB per run; expected artifacts store metadata, not file contents.
- Validation timeouts are restricted to 1 second through 30 minutes, with a capability-level upper bound.
- Migration attempt logs are capped at 256 KiB, waves have explicit concurrency, and retries stop after three attempts.
- Entity mutations always route through `/api/backends/:backendId/...` when the owner is remote.

When diagnosing remote behavior, first confirm the entity's `backend_id`, then inspect the owner server's capability execution, validation run, evidence snapshot, or campaign attempt. A global server selector does not retarget an already-open entity.
