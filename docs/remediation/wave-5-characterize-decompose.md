# Wave 5 — Characterize and decompose high-risk units

Status: completed and verified locally on 2026-08-05; not merged or deployed.

Scope: `TF-015`, including the ten Wave 4 Fallow findings explicitly carried
into this wave. This wave starts from Wave 4 commit `f38ff5b` on branch
`refactor/wave-5-characterize-decompose`.

The wave does not merge or deploy itself. Deployment remains a separate,
explicitly authorized operation.

## Outcome

After this wave:

- the highest-churn API and UI orchestrators coordinate focused route,
  lifecycle, state, projection, action, and presentation modules instead of
  containing each concern inline;
- loading, stale-response, failure, cancellation, retry, cleanup, responsive
  detail/dialog, queue steering, and extension lifecycle behavior is protected
  by characterization tests before the related unit is split;
- public entry points remain stable while internal modules become independently
  testable;
- Fallow suppressions attached to the targeted orchestration functions are
  removed rather than moved to another oversized function;
- reported dead AI-element exports are removed only when repository-wide and
  package-boundary evidence proves they are not public API; and
- each Wave 4 complexity attribution is either reduced with a focused helper or
  retained with an evidence-backed explanation that it is a bounded executable
  entry point, never hidden by a blanket suppression.

## Planning evidence and overlap decision

The current target sizes are 797 lines for `thread-panel.tsx`, 745 for
`thread-api.ts`, 703 for `portable-extension-host.tsx`, 622 for the GitHub
extension, 788 for the pull-request route, and 694 for automation recipes.
Static tests cover only the empty ThreadPanel shell directly; GitHub has useful
action and authentication tests, while the other UI orchestrators rely mostly
on downstream/live coverage.

Commit `813c2ab` already split the original platform monolith and is an ancestor
of this wave. A later route split, commit `aa00620`, exists only on the divergent
`fix/iphone16-mobile-experience` branch; its current-tree diff would remove
subsequent functionality while replacing the present Drizzle/runtime contracts
with stale SQLite access. It is reference material, not a cherry-pick candidate.
This wave extends the current boundaries and assigns every current branch to
one owner.

## Safety and architecture invariants

1. Characterization is committed before its corresponding structural move.
2. Refactoring does not change URLs, methods, statuses, response bodies,
   capability IDs, extension manifest IDs, local-storage keys, query parameter
   names, accessible labels, or mobile/desktop behavior.
3. API route ordering remains deterministic. A focused route returns `null`
   only when it does not own the request; a matched route returns a response.
4. Thread follow-up, queue, steer, queued-steer, cancel, retry, input, fork,
   review handoff, suggestion, log, diff, file, archive, delete, and worktree
   cleanup paths retain their present guards and notifications.
5. A stale log, diff, portable detail, catalog, or automation response cannot
   overwrite state for a newer selection. Abort and cleanup behavior is tested.
6. Thread actions remain available in both compact and desktop layouts and use
   one action model. Activity-only rendering still shows activity plus the
   reply/queue/steer composer, not work-item metadata.
7. Pull-request filters round-trip through the URL and persisted filters;
   malformed storage falls back safely. Mobile detail remains route-backed and
   desktop detail remains dismissible without losing list state.
8. Portable collection preferences preserve module/surface scoping, controlled
   and uncontrolled detail behavior, column/swimlane ordering, filter/group
   fallback, pagination, cached data on refresh failure, and action refresh.
9. GitHub initialization remains non-blocking, permits at most one installation
   token refresh, restores process authentication on disposal, aborts pending
   work, clears timers, and leaves action/route/manifest identifiers unchanged.
10. Automation drafts preserve trigger-derived fields, schedule behavior,
    templates, save/edit/reset, run/toggle/delete, approval, runtime pause, and
    controlled-view callbacks.
11. Extracted modules do not import browser code into the API or Node code into
    the web/mobile bundles. Existing package and architecture boundaries pass.
12. No exported symbol is removed because of a static count alone. Direct
    imports, wildcard re-exports, package exports, dynamic extension use, tests,
    documentation, and type-aware symbol impact are checked first.
13. Generated Fallow or coverage artifacts are diagnostic only and remain out
    of version control.

## Checkpoint A — Characterization harnesses

Add focused tests before structural edits:

- thread API route ownership and representative success/validation/conflict
  responses for control, lifecycle, review, cleanup, and artifact endpoints;
- ThreadPanel state/action characterization for log and diff refresh, abort on
  job change, follow-up mode selection, queue steering/cancellation, retry/stop,
  suggestion publication, and compact/desktop action parity;
- portable projection and preference tests covering sorting/filtering,
  grouping, pagination, hierarchy, storage corruption, detail races, cached
  error state, and action completion;
- pull-request filter parsing, persistence, priority/mine semantics, pagination
  reset, and mobile/desktop detail ownership;
- automation catalog projection, draft transitions, visible run filtering, and
  request lifecycle tests; and
- GitHub refresh concurrency, pending-exchange disposal, failed refresh
  recovery, process-token restoration, settings validation, and registration
  inventory tests.

Tests should target pure models or explicit injected boundaries. DOM tests may
use a small test component where observable focus, responsive actions, or
cleanup cannot be represented as a pure function. Test-only production branches
are forbidden.

Acceptance: the new tests fail when their protected behavior is deliberately
broken, pass on the pre-split implementation, and are committed separately from
the structural changes they protect.

## Checkpoint B — Reinforce thread API route ownership

Keep `handleThreadApi` as the public dispatcher and move current branches into
focused modules under `apps/api/src/server/dashboard/thread-routes/`:

- control: follow-up, queue, steer, queued edits/removal, input, cancel, retry;
- review: stack tasks, PR task state, approval/auto-merge, re-review, handoff,
  and review suggestions;
- lifecycle: fork, archive, delete, and closed-worktree cleanup; and
- artifacts: guarded file preview, log tail/events, and diff preview.

Shared matching and runtime helpers belong in the existing support/runtime
boundaries; route modules must not grow their own copies of database records or
response helpers. Add an inventory assertion so every endpoint has exactly one
owner and the dispatcher order is explicit.

Acceptance: `thread-api.ts` is a small dispatcher, each endpoint's existing
characterization passes, path-safety and lifecycle tests from earlier waves
remain green, and no focused route handler requires a complexity suppression.

## Checkpoint C — Split thread and pull-request UI orchestration

For ThreadPanel:

- extract an abort-aware data hook for selected run, log, diff, SSE refresh,
  review suggestions, and reset behavior;
- extract an action hook for input, follow-up/queue/steer, queued removal,
  retry/stop, re-review, suggestions, fork, handoff, and copy-link behavior;
- render tabs/content through a focused view component; and
- replace duplicated compact/desktop action markup with one action model and
  two intentionally responsive presentations.

For pull requests:

- extract pure URL/storage/filter/priority projection into a tested model;
- extract route-backed dialog/detail state and synchronization into a hook;
- split queue and detail workspaces into focused presentation components; and
- keep the route component responsible only for data/query coordination and
  route composition.

Acceptance: both top-level functions fall below the Fallow complexity threshold
without suppression, tests protect stale/abort and responsive ownership, the
320/390 px and desktop audit routes remain clean, and no accessible action is
lost or duplicated.

## Checkpoint D — Split portable collection and automation orchestration

For portable collections:

- move pure filtering, hierarchy, grouping, lane, count, and pagination
  projection into a model;
- extract board preference hydration/persistence and corrupt-value fallback;
- extract abort-aware detail loading and controlled/uncontrolled selection;
- split controls, results, mobile group navigation, and action dialog into
  presentation units.

For automations:

- move catalog/template/choice/run projections into a pure model;
- extract overview loading and catalog-to-state synchronization;
- extract draft transitions and mutation actions into focused hooks; and
- keep builder, recipes, runs/audit, and execution/audit presentations separate.

Acceptance: current portable and automation entry points remain compatible,
targeted race/error/action tests pass, no stateful hook is duplicated between
mobile and desktop presentations, and the orchestration functions no longer
need complexity suppressions.

## Checkpoint E — Decompose the GitHub extension lifecycle

Split static manifest construction, authentication lifecycle, contextual review
action registration, and settings route registration into server-only modules.
Keep `createExtension` as a thin composition root that owns provider creation,
initialize/status/dispose, and registration ordering.

Authentication state will be represented by one controller with injected clock,
timer, fetch, and host boundaries. Disposal is idempotent and awaits or aborts
pending work without leaking unhandled rejections. Settings mutations use the
same controller instead of duplicating token/cache/event transitions.

Acceptance: all existing GitHub tests plus the new lifecycle/route inventory
tests pass, action and manifest snapshots are unchanged, a pending exchange can
be disposed deterministically, and no timer or environment mutation survives
disposal.

## Checkpoint F — Prove and prune dead AI-element exports

For each reported export in `prompt-input-controls.tsx` and `message.tsx`:

1. trace direct and aliased imports across every workspace;
2. inspect wildcard/barrel and package export surfaces;
3. run Fallow type-aware symbol impact where supported;
4. check extension SDK authoring examples and generated templates; and
5. classify it as used, intentional public API, or private dead code.

Only private dead exports and their newly orphaned imports/dependencies are
removed. Intentional public API stays exported and receives an explicit small
contract test or documented public-surface evidence. This checkpoint is one
isolated commit so it can be reverted independently.

Acceptance: type checking and builds prove all consumers, a production dead-code
scan no longer reports removed symbols, and the commit contains no unrelated UI
or behavior changes.

## Checkpoint G — Resolve Wave 4 Fallow carry-ins

Re-run changed-line attribution and review the ten recorded functions:
`fixtureResponse`, `PortableSettingsScreen`, the device-runtime entry/command,
`validateComparison`, `prepareHermesCompiler`, the comparison entry,
`MobileAgentOptions`, `timed`, and `createArm64LinuxBridge`.

- extract and test reusable parsing, validation, routing, timing, and bridge
  command construction when branches represent independent failure modes;
- preserve short command entry points when their complexity is only sequential
  orchestration over tested helpers;
- use the Wave 4 mobile tests and workflows as behavioral evidence; and
- record any retained entry point with its measured scope and reason in
  `TOFIX.md`, without adding a broad Fallow ignore.

Acceptance: no genuine Wave 4 change-amplification risk remains unaddressed, no
new blanket suppression exists, and Fallow attribution matches the documented
classification.

## Commit and rollback sequence

1. `test: characterize wave five orchestration boundaries`
2. `refactor: split thread api route ownership`
3. `refactor: decompose thread and pull request workspaces`
4. `refactor: decompose portable and automation workspaces`
5. `refactor: isolate github extension lifecycle`
6. `refactor: prune private dead ai element exports`
7. `refactor: reduce mobile validation complexity`
8. `docs: record wave five verification`

Every checkpoint is independently testable and revertible. If a checkpoint
cannot preserve its characterization contract, stop at the previous clean
commit and record the exact blocker; do not weaken the tests to make a split
pass.

## Verification matrix

Run focused tests after every checkpoint and, before closure, run:

- `npm run check`;
- `npm test`;
- `npm run test:verified` with no cache;
- `npm run build` and bundle-budget/compiler verification;
- `npm run check --workspace @vertexade/mobile`;
- mobile unit tests and the production Hermes `npm run build:mobile` export;
- targeted UI audit at 320 px, 390 px, and desktop while iterating, followed by
  the complete production route/view audit;
- Fallow health, complexity attribution, production dead-code, type-aware
  symbol-impact, duplication, and security scans;
- `npm audit --omit=dev` and full `npm audit`; and
- `git diff --check`, intended-file review, branch ancestry, and clean status.

Record every `TF-015` clause and Wave 4 carry-in as pass, fail, blocked, or not
applicable. Native device evidence remains the external promotion dependency
already recorded by Wave 4; this maintainability wave must not claim new device
evidence from static tests or exports.

## Verification record — 2026-08-05

### Delivered checkpoints

- `d965759` characterized the public thread, portable, pull-request,
  automation, and extension boundaries before structural edits;
- `d75baca` assigned each thread endpoint to one explicit control, review,
  lifecycle, or artifact route owner;
- `9075ffd` decomposed thread and pull-request data, actions, projection, and
  presentation;
- `16562b8` decomposed portable collection and automation orchestration;
- `a08eb11` isolated GitHub manifest, authentication, review-action, and
  settings lifecycles;
- `3baf69a` preserved portable projection memoization after the split;
- `748b453` and `ba3449b` removed the source-verified private AI-element
  surface and five orphaned rendering dependencies;
- `03a3a51` reduced all ten Wave 4 mobile complexity carry-ins; and
- `e0efefb` closed the final route, thread-panel, and pull-request complexity
  and duplication findings without suppressions.

The plan itself was committed first in `147bf8b` and corrected with overlap
evidence in `64b6d98`; no Wave 5 implementation preceded it.

### Behavioral and build gates

- `npm run check` passed 828 formatted files and 754 lint/type-checked files.
- `npm test` passed root scripts and every selected API, web, mobile, package,
  and extension workspace; the suite's two Docker-only runtime cases were
  explicitly skipped.
- `npm run test:verified` passed with 0/20 workspace cache hits. The mobile
  contribution is 12 suites and 49 tests; shared UI is 46 suites and 202 tests.
- `npm run build` passed the client, SSR, and Nitro builds. React Compiler
  verification found 610 memo caches across 40 client chunks, and all bundle
  budgets passed.
- The standalone mobile typecheck now declares its Node-based device/release
  test environment directly and passes. `npm run build:mobile` emitted valid
  Hermes bytecode for iOS and Android; `expo install --check` reports current
  dependencies.
- Production and full `npm audit --audit-level=high` both contain zero high or
  critical findings. The inherited ten moderate Expo/xcode `uuid` findings
  still have only npm's incompatible Expo 46 downgrade proposal.

### Maintainability, security, and rendered behavior

- `fallow audit --base f38ff5b --format json` passes with zero introduced
  dead-code, complexity, duplication, or styling findings. Its two remaining
  dependency findings are inherited.
- Focused type-aware symbol impact completed with high confidence and no
  consumers for the removed `Message` surface. Repository/package/template
  searches also found no contract consumer. The production build and shared UI
  suite passed after removing it and its five orphaned dependencies.
- The broader static coverage inventory improved from 205 untested files / 661
  untested exports to 195 / 624. Full production dead-code and duplication
  reports remain diagnostic inventories; no blanket suppressions or unsafe
  bulk deletion were introduced.
- Changed-file security analysis reports seven mobile build/probe candidates.
  Manual review found no new command/module/regex injection path: commands are
  fixed internal tool choices with argument arrays, module paths come from
  package resolution or generated build output, and the runtime-probe pattern
  is escaped before construction.
- The exact production build was served on a separate loopback port and audited
  against the live API at 1440, 390, and 320 px. All 180 discovered
  route/view/dialog combinations passed with zero overflow, missing
  interactions, unnamed interactive controls, persistent loading, exceptions,
  console errors, or failed HTTP responses. A preliminary dev-server run was
  deliberately rejected because its hydration diagnostics are not production
  evidence.

Verdict: **Wave 5 and scoped `TF-015` pass locally.** The P1-P3 code work is
complete except for dependencies explicitly owned by other gates: final
authenticated-subject closure for `TF-002`/`TF-004` depends on P0 `TF-001`, and
native promotion for `TF-011`/`TF-012` still requires retained Android and iOS
executions. This wave does not claim those external results and does not merge
or deploy itself.
