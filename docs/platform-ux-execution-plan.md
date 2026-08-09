# Platform UX execution plan

## Objective

Make VertexADE feel like one coherent, responsive engineering cockpit while
preserving its local-first orchestration model. The finished platform must be
faster to understand, faster to operate, safe during two-way synchronization,
and usable across desktop and mobile without route-specific interaction rules.

## Product contract

The platform uses these canonical surfaces and nouns:

- **Focus** is the ranked attention queue.
- **Work** contains durable engineering outcomes.
- **Agents** contains agent runs and their conversations.
- **Pull requests** is the review queue.
- **Delivery** describes releases and environments.
- **Automations** owns recipes, their manual/event/schedule triggers, approvals, and run history.
- **Extensions** owns integrations and provider boards.
- **System health** owns readiness, runtime health, and remediation.
- **Settings** owns workspace and repository defaults.

Work uses one lifecycle everywhere:

`Backlog -> Active -> Review -> Deploy -> Done`

Reactive reads use the following freshness states:

`cached -> refreshing -> fresh`, with explicit `stale`, `offline`, and
`failed` alternatives.

Mutations use the following synchronization states:

`local -> queued -> synchronizing -> accepted`, with explicit `failed` and
`conflicted` alternatives.

Every workspace has one dominant primary action. Secondary and destructive
actions use overflow menus or mobile action sheets.

## Execution phases

### 0. Baseline and contract

- Record current Git, runtime, route, API payload, and rendered UI baselines.
- Centralize user-facing terminology, state labels, and refresh labels.
- Add regression coverage for the product contract.

### 1. Shared responsive foundation

- Add mobile-safe tabs, action sheets, timelines, async states, freshness
  indicators, URL-backed filters, saved views, and save-status primitives.
- Enforce readable mobile typography and 44 px interactive targets.
- Standardize dialog focus, scrolling, failure, and destructive-action states.

### 2. Reactive data and API foundation

- Make cached RxDB projections the normal first-render path.
- Use RxJS for route-shaped, versioned upsert/delete streams.
- Add Effect services for typed API/provider errors, retries, cancellation,
  timeouts, and tracing.
- Add paginated activity and conversation projections.
- Add an optimistic mutation outbox with visible synchronization and conflict
  states.
- Compress and version read APIs; avoid full-dashboard refreshes.

### 3. Focus and Work

- Rank Focus by urgency, ownership, blocked time, review state, and failures.
- Consolidate Work creation and delegation.
- Use one Work lifecycle and shareable saved views.
- Rebuild mobile Work detail around the next decision, a compact result, and a
  paginated, grouped timeline.
- Preserve one combined worktree per repository and safe merged-PR cleanup.

### 4. Agents

- Load summaries before conversations and never auto-load a large first run.
- Prioritize waiting, active, failed, and resumable runs.
- Paginate and virtualize conversation history.
- Show artifacts, duration, branch, files, commits, tools, and recovery actions.
- Present writable, agent-agnostic subagents beneath their owner run.
- Preserve explicit ephemeral-run and retention behavior.

### 5. Pull requests and Delivery

- Rank review work by actionable reason and show one recommended action.
- Add saved views and batch review operations.
- Join Work, agent review, checks, approvals, and deployment into timelines.
- Add repository, branch, service, and environment scope to Delivery.
- Explain blocked, failed, pending, and environment-behind states.

### 6. Automations

- Rebuild the editor as `When -> If -> Ask agent -> Then -> Approval`.
- Add simple/advanced modes, live validation, flow preview, and sample dry-runs.
- Make failed runs and approvals the primary operational views.
- Keep Automations out of Settings except for workspace-wide defaults.

### 7. Extensions and provider boards

- Standardize setup, connection tests, permissions, freshness, and errors.
- Poll providers in the background and force-refresh when entering a board.
- Reconcile external polling with optimistic outbox mutations.
- Show accepted, failed, and conflicted external writes.
- Improve Azure DevOps presets, terminal-column handling, agent preparation,
  drag feedback, and undo.
- Improve Airtable fields, density, grouping, inline editing, record details,
  and bulk operations.

### 8. Settings, runtime, health, and global navigation

- Make Settings sections and fields searchable and deep-linkable.
- Standardize save behavior and prevent accidental loss.
- Support repository/subfolder environment inheritance, masked secrets,
  placeholders, and containerized start/stop/health commands.
- Make System health incident-first with direct remediation links.
- Reduce notification fatigue and move actionable work into Focus.
- Improve command search, recent objects, breadcrumbs, and onboarding.

### 9. Popup and responsive audit

Exercise creation, editing, launch, review, approval, migration, deletion,
configuration, environment, notification, command, and overflow surfaces.
Validate keyboard behavior, focus restoration, scrolling, long content,
loading, validation, failure, retry, and mobile viewport safety.

### 10. Validation and deployment

- Run focused tests throughout each phase.
- Run lint, TypeScript 6/7 checks, full tests, web build, mobile export, bundle
  budgets, Fallow changed-code audit, and `git diff --check`.
- Render desktop at 1024, 1440, and 1600 px.
- Render mobile/tablet at 320, 390, and 768 px.
- Exercise main routes, detail routes, popups, failures, stale cache, offline
  mode, slow responses, polling, optimistic writes, retries, and conflicts.
- Merge the validated branch to `main`, push it, build the exact pushed state,
  restart and save PM2, and verify live routes, APIs, and readiness.

## Performance budgets

- Cached useful content appears within 300 ms.
- Common interactions respond within 100 ms.
- Locally controlled warm summary APIs target 250 ms.
- Typical live patches remain below 10 KiB.
- Summary lists never download complete agent conversations.
- Routine navigation never requires a one-megabyte dashboard refresh.

## Definition of done

- Canonical terminology and lifecycle state appear across every surface.
- Mobile Work activity exposes the next decision and meaningful activity
  without forcing users through dense system history.
- Main filters and selected entities survive reload and support deep links.
- Agent conversations load incrementally.
- External board writes are visible, reversible, retryable, and conflict-aware.
- Settings and runtime configuration remain safe and readable on mobile.
- Active failures dominate System health.
- RxDB/RxJS provide cached-first rendering and small live updates.
- Effect owns typed API and provider execution boundaries.
- All quality, accessibility, responsive, popup, performance, integration, Git,
  and deployment gates pass on the merged commit.
