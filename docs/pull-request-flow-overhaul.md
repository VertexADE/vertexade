# Pull request flow overhaul

## Status

**Planned on 2026-08-05. Implementation has not started.**

This plan is based on the latest completed remediation stack at `2c21701`,
which contains live `main` (`f417880`) plus Waves 1 through 5. The remediation
stack must be integrated before this feature can be promoted. Production still
serves `/home/agent/server/pr-management-main` at `f417880`.

The plan itself is the pre-implementation gate. No source behavior, database,
runtime, merge, or deployment changes are part of this planning commit.

## Objective

Turn Pull requests into a calm, ownership-aware decision queue that carries one
piece of work continuously from discovery to human review, agent assistance,
approval, merge, and follow-up.

The finished flow should answer these questions without opening several menus:

1. Why is this pull request in front of me?
2. What is blocking it right now?
3. What is the single best next action for me?
4. What will that action do, and where will it take me?
5. What changed after I acted?

## Product outcomes

- The default queue contains work relevant to the current user, not nearly every
  open pull request.
- Queue grouping, status language, and the recommended action come from one
  tested decision model.
- Desktop and mobile recommend and execute the same action for the same pull
  request state.
- Human review, agent review, and agent implementation remain clearly distinct.
- Cancelling a dialog creates no Work item, run, or external side effect.
- Starting Work or an agent review opens the new agent thread immediately.
- Review submission uses one coherent surface instead of competing approval
  buttons and dialogs.
- Successful mutations update the visible pull request state or show an explicit
  synchronizing state; users do not have to guess whether a toast was enough.
- List view, filter, sort, selected pull request, detail tab, and return location
  survive navigation and refresh.
- Mobile keeps the same capabilities without oversized controls, truncated
  decisions, overlapping docks, or horizontal overflow.

## Current-state scan

### Surfaces inspected

- Pull-request list route and URL/search-state handling.
- Needs attention, Mine, All, and Stacks views.
- Desktop and mobile pull-request cards, assigned people, agent-review state,
  status band, primary action, and overflow menu.
- Search, repository selection, basic filters, advanced filters, and mobile
  filter sheet.
- Desktop in-place details and mobile standalone details.
- Discussion, Changes, Checks, and Commits tabs.
- Inline comment, review-thread reply, and resolve flows.
- Human approval/review actions and their confirmation forms.
- Private single-agent and multi-agent review launch flows.
- Work launch, stacked branch launch, labels, reviewers, readiness, update
  branch, review watch, auto-merge, and review handoff.
- Completed agent-review summary, full review, suggestions, activity, changes,
  and follow-up actions.
- Current API mutation routes, extension-contributed GitHub actions, cache
  invalidation, UI audit coverage, and relevant unit tests.
- Production screenshots at 1,440 px, 390 px, and 320 px, plus the exact Wave 5
  production-build audit across 180 route/view/dialog combinations.

### Live-data baseline

The live read model contained 35 open pull requests during the scan:

| State                        | Count |
| ---------------------------- | ----: |
| Authored by current user     |     7 |
| Assigned to current user     |     6 |
| Draft                        |    12 |
| Failed checks                |    12 |
| Behind base branch           |    11 |
| Approved                     |     2 |
| No completed review decision |    33 |

The current `Needs attention` view includes 34 of the 35 pull requests because
any non-approved PR qualifies. That makes it an inventory, not an attention
queue. Its header separately says `19 blocked`, so the two most prominent
numbers describe different populations without explaining the difference.

### Confirmed flow problems

#### PRF-001 — The attention queue is not selective

`priorityPullRequests()` includes assigned PRs, every unapproved PR, every
pending PR, every failed PR, and every behind PR. Draft and unassigned third-
party changes therefore compete with work the current user can act on.

#### PRF-002 — Ownership is split across unrelated controls

`Mine` means authored by me, while `Reviewer -> Assigned to me` is hidden in
filters. There is no direct view for authored blockers plus assigned reviews,
even though that is the user's natural working set.

#### PRF-003 — Action policy is duplicated and divergent

Queue grouping, card recommendations, mobile approval eligibility, detail
approval eligibility, and the detail next-decision copy are calculated in
different modules. Notable consequences:

- a `REVIEW_REQUIRED` detail can fall through to `Ready to merge`;
- mobile maps a recommended review to opening PR details, while desktop maps
  the same recommendation to launching a private agent review;
- row and detail approval gates do not use the same identity/loading rules;
- drafts can recommend `Mark ready` without considering whether the current
  user can perform that action.

#### PRF-004 — Review launch mutates before confirmation

Opening the private-review dialog first calls `POST /api/pulls/:repo/:number/work`.
Cancelling the dialog can therefore leave a contributor-review Work item behind.
The review runtime already creates or reuses the Work item when a review really
starts, so this client-side pre-creation is redundant.

#### PRF-005 — Work launch breaks continuity

`LaunchDialog` closes after receiving the new run, but does not return the run
to its parent or navigate to it. Agent review correctly opens its run. Starting
implementation work should have the same continuity.

#### PRF-006 — Human review has competing entry points

The detail decision bar can show `Approve` beside `Submit review`; the latter
again offers Approve, Approve with comment, Request changes, and Comment only.
The queue also carries a legacy approval dialog. This makes the safest/default
review path unclear and duplicates validation behavior.

#### PRF-007 — Mutations provide weak visible reconciliation

Several row mutations only show a toast and rely on a later read-model event.
Assign reviewer, watch, readiness, auto-merge, and some label changes do not
consistently expose pending, synchronizing, succeeded, retry, or refreshed
state in the card that initiated the action.

#### PRF-008 — Review and Work are ambiguous verbs

`Start review`, `Review`, `Review with agent`, `Submit review`, `Add as review
task`, and `Fix with agent` are related but materially different operations.
The card's primary action does not always reveal which one will occur.

#### PRF-009 — The mobile decision surface is crowded

On 320 px, checks/review/merge labels truncate, agent actions form a second
row, and the fixed human-review dock competes with bottom navigation. The
information is present, but reading order and action hierarchy are unclear.

#### PRF-010 — Back navigation loses working context

Mobile opens a standalone detail route without carrying the originating view,
filters, or scroll anchor. The Back link targets `/pull-requests` directly, so
the user can return to a different queue state.

#### PRF-011 — Queue ordering does not rank urgency within groups

Grouping uses the current read-model order. It does not deliberately rank
ownership, failed checks, requested changes, stale review, age, or current
agent activity inside a group.

#### PRF-012 — Agent-review setup exposes advanced choices too early

The single/multi-agent selector, agent, model, reasoning, ephemeral mode, and
subagents can all appear before the user gets value. Multi-agent mode selects
all enabled agents by default. A fast safe default and an explicit Advanced
path would reduce choice cost without removing power.

#### PRF-013 — The rendered audit does not prove the journey

The audit proves route rendering, overflow, accessible names, console/runtime
health, and selected dialog opening. It does not yet assert that cancellation
is side-effect free, action recommendations agree across viewports, a launched
run opens, mutation state reconciles, review results lead into a human decision,
or filtered return navigation is preserved.

## Target information architecture

### Queue views

Use four primary queue views and keep Stacks as an adjacent specialized view:

1. **For you** — default after current-user identity resolves. Contains assigned
   reviews, authored PRs with actionable blockers, and completed agent reviews
   awaiting the user's decision.
2. **Needs action** — the team-wide actionable queue. Excludes merely open,
   passive, or externally owned drafts.
3. **Ready** — approved, checks-clear pull requests that can be merged or have
   auto-merge monitored.
4. **All** — complete inventory and advanced filtering.
5. **Stacks** — dependency view, visually separate because its task is topology
   rather than triage.

Keep `view=mine` and `view=attention` as compatibility aliases. Existing links
must continue to open a meaningful view.

### Queue groups

Within For you and Needs action, use these groups in order:

1. **Fix now** — failed checks, requested changes, conflicts, or behind branch
   when the user owns the change.
2. **Review now** — assigned human review, completed current agent review, or a
   ready non-draft review request.
3. **Ready to merge** — approved and checks clear.
4. **Waiting** — checks, branch update, agent review, or auto-merge in progress.

Drafts without a user-actionable ownership relationship belong in All, not in
the default attention queue.

### One canonical decision per pull request

Create a pure, exhaustively tested flow model that receives:

- PR summary state;
- current-user identity state;
- assigned reviewers and authorship;
- agent-run state and review freshness;
- manual readiness and auto-merge state; and
- when available, authoritative detail/check/mergeability state.

It returns:

- ownership relationship;
- actionable reasons in priority order;
- queue view and group membership;
- display status for checks, review, branch, merge, and agent review;
- one recommended action with an explicit intent;
- secondary actions;
- availability and disabled reason; and
- a stable sort score.

The same result drives card copy, card actions, queue grouping, mobile layout,
detail next-decision copy, and tests. The API and extension remain the final
authorization boundary and revalidate the current head/identity before any
external write.

### Action vocabulary

| Intent                            | User-facing action | Result                                                                          |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| Inspect and decide personally     | Review changes     | Opens Changes while preserving queue return state                               |
| Ask an agent for private evidence | Review with agent  | Starts/reuses review Work only on submit, then opens its agent thread           |
| Change implementation             | Fix with agent     | Opens an intent-aware Work form, starts a worktree, then opens its agent thread |
| Submit human verdict              | Submit review      | One surface for approve, approve with comment, request changes, or comment only |
| Bring branch current              | Update branch      | Runs once, shows progress inline, then reconciles the PR                        |
| Publish a draft                   | Mark ready         | Offered only when capability policy allows it                                   |
| Complete approved work            | Enable auto-merge  | Confirms the current head and enables squash auto-merge                         |
| Follow later commits              | Watch new commits  | Explicit secondary agent-review control                                         |

Avoid the standalone verbs `Review` and `Work` when they do not reveal whether
the user, an agent, or GitHub will act.

### Detail journey

Choose the initial detail tab from the canonical decision unless the URL
already specifies a tab:

- failed checks -> Checks;
- requested changes or unresolved discussion -> Discussion;
- human review needed -> Changes;
- approved/merge-ready -> Discussion with merge state prominent.

The detail header keeps identity and branch context. Immediately below it, one
compact decision rail shows the actionable reason, full checks/review/merge
labels, and one primary action. Human review uses one composer. Agent actions
remain secondary and are never visually confused with a human verdict.

On mobile, the decision rail becomes a readable vertical summary. One compact
sticky action bar may remain, but it must not overlap bottom navigation, the
keyboard, or content, and it must not duplicate actions already visible above.

## Implementation waves

Every wave starts with characterization or failing acceptance tests and ends
with its own focused verification. Do not begin a later wave while an earlier
wave has unresolved behavioral regressions.

### Wave 1 — Canonical flow truth

**Purpose:** remove contradictory recommendations before changing presentation.

Work:

1. Add a state-matrix test covering draft, failed, pending, changes requested,
   review required, approved, behind, conflicting, auto-merge, watched review,
   current/outdated agent review, author, assignee, and identity-loading cases.
2. Introduce one pure pull-request flow model in shared UI domain code.
3. Replace queue grouping, attention membership, card recommendation, detail
   next decision, and approval eligibility with adapters over that model.
4. Treat current-user identity as `loading | ready | unavailable`; never infer
   approval capability while identity is unknown.
5. Preserve server/extension revalidation for every write.

Acceptance:

- A state has the same next action in card, desktop detail, and mobile detail.
- `REVIEW_REQUIRED` never renders `Ready to merge`.
- Self-authored PRs never expose approval as enabled.
- Draft actions account for ownership/capability.
- No network request is added per PR card.
- The state matrix includes every action and queue group.

Expected files:

- `apps/web/src/lib/pull-request-action-policy.ts`
- `apps/web/src/components/pull-requests/pull-request-queue-model.ts`
- `apps/web/src/components/pull-requests/use-pr-row.tsx`
- `apps/web/src/components/pull-requests/pull-request-workspaces.tsx`
- `packages/ui/src/components/pr-details-model.ts`
- new shared flow-model tests

### Wave 2 — Ownership-first queue and cards

**Purpose:** make the list a useful daily queue rather than a complete inventory.

Work:

1. Add For you and Ready; refine Needs action; retain compatible old URLs.
2. Rank within groups by user ownership, blocker severity, stale/current agent
   review, update age, and stable repository/PR tie breakers.
3. Rework the card reading order to: why it is here -> title/context -> owner and
   assignees -> blocker/agent evidence -> one primary action -> compact status.
4. Keep one primary action and at most one high-value secondary action visible;
   place administrative actions in a structured overflow menu.
5. Use the same action handler and label at all breakpoints.
6. Keep assigned people visible without letting avatars crowd the title.
7. Keep search and repository filter immediately available; move low-frequency
   filters behind progressive disclosure and show active filters as removable
   chips.
8. Preserve view/filter state in the URL and restore the selected card/scroll
   anchor after closing detail.
9. Keep Stacks available without making topology analysis compete with review
   triage.

Acceptance:

- The live 35-PR baseline no longer places 34 PRs in the default queue.
- Assigned and authored work are both reachable in one click.
- Every visible card explains its queue group.
- Desktop, 390 px, and 320 px show identical primary intent.
- No card or filter causes horizontal overflow.
- Existing `view=mine` and `view=attention` links remain valid.

Expected files:

- `apps/web/src/routes/pull-requests.tsx`
- `apps/web/src/components/pull-requests/pull-request-workspaces.tsx`
- `apps/web/src/components/pull-requests/pull-request-overview.tsx`
- `apps/web/src/components/pull-requests/pull-request-row.tsx`
- `apps/web/src/components/pull-requests/pull-request-row-actions.tsx`
- `apps/web/src/components/pull-requests/pull-request-filters.tsx`
- queue model and responsive tests

### Wave 3 — Detail and human review

**Purpose:** make evidence reading and review submission one continuous task.

Work:

1. Drive the initial tab and decision rail from the canonical flow model.
2. Preserve explicit URL tabs and the originating queue/filter/scroll context.
3. Replace the separate Approve button, legacy approval dialog, and duplicate
   review choices with one Submit review surface.
4. Keep Approve, Approve with comment, Request changes, and Comment only, with
   clear consequence copy and current-head confirmation.
5. Keep inline comments, replies, and resolve/unresolve available in context;
   label immediate-post behavior explicitly.
6. Show unresolved/outdated thread counts in the decision summary.
7. Make checks failures actionable from the Checks tab and show persistent retry
   when detail refresh fails.
8. Reflow the mobile decision summary and sticky action region so full status
   labels remain readable and nothing overlaps bottom navigation.

Acceptance:

- There is one visible entry point for a human verdict.
- Every verdict revalidates author, head SHA, draft, and checks server-side.
- Cancelling the review composer performs no external write.
- Review success refreshes the decision rail and returns a direct link to the
  submitted review/state.
- Keyboard focus returns to the initiating control after cancel or completion.
- Discussion, Changes, Checks, and Commits remain deep-linkable.

Expected files:

- `packages/ui/src/components/pr-details-dialog.tsx`
- `packages/ui/src/components/pr-details-summary.tsx`
- `packages/ui/src/components/contextual-actions.tsx`
- `apps/web/src/routes/pull-requests_.$repoId.$prNumber.tsx`
- `apps/web/src/components/pull-requests/pull-request-approval-dialogs.tsx`
- `packages/extensions/github/src/server/manifest.ts`
- GitHub contextual-action and detail tests

### Wave 4 — Agent and Work continuity

**Purpose:** make agent assistance fast while keeping its side effects explicit.

Work:

1. Remove the pre-dialog `POST .../work`; let successful review launch create or
   reuse review Work atomically in the existing review runtime.
2. Return the started run from Work and review dialogs and navigate directly to
   its agent thread.
3. Pass the recommended intent into the Work form so `Fix failing checks`,
   `Address feedback`, and general implementation start with useful scoped copy
   rather than a generic preset decision.
4. Give private review a fast default: one configured agent and one Start review
   action. Move model, reasoning, ephemeral mode, subagents, and multi-agent
   aggregation into Advanced.
5. In aggregate mode, require explicit agent selection instead of silently
   selecting every provider.
6. On completed agent review, surface freshness, concise result, findings, and
   one next action: submit human review, send findings to a worktree, or re-review.
7. Preserve live steer, queue, follow-up, fork, and handoff behavior after the
   user enters the agent thread.

Acceptance:

- Opening and cancelling agent review creates no Work item or run.
- Successful Work/review launch opens the exact returned thread.
- One-agent review can start with one confirmation after opening the dialog.
- Advanced settings remain available but do not dominate the default path.
- A completed current review can lead directly to a human verdict or a fix run.
- Review Work remains first-class and is not confused with implementation Work.

Expected files:

- `apps/web/src/routes/pull-requests.tsx`
- `apps/web/src/routes/pull-requests_.$repoId.$prNumber.tsx`
- `apps/web/src/components/pull-requests/pull-request-launch-dialogs.tsx`
- `apps/web/src/components/pull-requests/pull-request-private-review-dialog.tsx`
- `apps/web/src/components/pull-requests/review-thread-dialogs.tsx`
- `apps/api/src/server/dashboard/review-runtime.ts`
- `apps/api/src/server/work/service.ts`
- launch lifecycle tests

### Wave 5 — Mutation trust, resilience, and safe batch work

**Purpose:** make repeated management actions predictable and recoverable.

Work:

1. Add shared mutation state: idle, confirming, submitting, synchronizing,
   succeeded, failed, retrying.
2. Disable only the action in flight and show its state in the originating card
   or detail rail.
3. Reconcile labels, reviewers, readiness, branch update, watch, and auto-merge
   against the read model after success; show a persistent retry when sync fails.
4. Preserve error details beyond a disappearing toast for failed external writes.
5. Add conservative batch actions only after the single-item flow is stable:
   Review with agent, Watch new commits, Assign reviewer, and Update branches.
6. Never batch approve, request changes, merge, delete, or publish drafts.
7. Show the exact PR count, excluded items, and per-item results before/after a
   batch operation.

Acceptance:

- Repeated clicks cannot duplicate a mutation or agent launch.
- A successful mutation visibly reaches its accepted state or reports sync
  failure with retry.
- Batch preview excludes ineligible PRs with reasons.
- Partial batch failure preserves successful results and makes failed items
  retryable.
- No destructive or review-verdict operation is available in batch.

Expected files:

- shared mutation hook/component
- PR row, dialogs, and details action adapters
- pull-request API idempotency/error tests
- read-model event and retry tests

### Wave 6 — Full-flow release gate

**Purpose:** prove behavior, accessibility, performance, and responsive quality
before any integration or deployment.

Work:

1. Extend the Chrome audit with stable semantic selectors and journey assertions.
2. Add state fixtures for author, reviewer, draft, failed, behind, pending,
   approved, stale review, disabled extension, provider failure, and slow sync.
3. Exercise queue -> details -> tab -> human review -> accepted state.
4. Exercise queue -> agent review -> thread -> result -> fix/human decision.
5. Exercise queue -> Work -> thread and cancel-without-side-effect paths.
6. Test keyboard-only navigation, focus restore, accessible names, reduced motion,
   long titles/branches/comments, empty/loading/error/offline states, and browser
   back/forward.
7. Measure cached first content, interaction response, request count, route bundle,
   and unexpected full-dashboard refreshes.

Required viewports:

- 320 x 720
- 390 x 844
- 768 x 900
- 1,024 x 768
- 1,440 x 1,000
- 1,920 x 1,200

Required gates:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:verified
pnpm build
pnpm --filter @vertexade/mobile check
pnpm build:mobile
pnpm exec expo install --check
pnpm audit --omit=dev --audit-level=high
pnpm exec fallow audit --base 2c21701
pnpm audit:ui --viewport narrow --viewport mobile --viewport tablet --viewport laptop --viewport desktop --viewport wide
git diff --check
```

Release acceptance:

- Zero introduced Fallow dead-code, complexity, duplication, or styling issues.
- Zero high/critical dependency vulnerabilities introduced.
- Zero UI-audit overflow, unnamed control, console error, runtime exception,
  failed response, persistent loading, or journey failure.
- No new per-card network request and no routine full-dashboard refresh.
- Production build is audited, not only the development server.
- The exact candidate commit is clean and descends from `2c21701`.

Merge and PM2 deployment are a separate authorization gate. If requested after
all release criteria pass, integrate the remediation stack first, fast-forward
this feature through `main`, build the exact main commit, atomically promote the
output, restart both PM2 processes with matching `pm_cwd`/`APP_ROOT`, save PM2,
and verify readiness plus the live pull-request journeys.

## Test design

### Unit state matrix

Use table-driven cases. Each case asserts ownership, queue inclusion, group,
reason order, recommended intent, disabled reason, detail title, and sort score.
Do not snapshot entire components when a semantic assertion is clearer.

### Component behavior

- Same PR fixture at desktop/mobile yields the same primary action intent.
- Active filter chips remove one value without resetting unrelated filters.
- Starting/cancelling dialogs preserves focus and causes the expected number of
  API calls.
- Mutation state remains attached to the initiating PR when lists reorder.
- Human review has exactly one visible trigger per detail surface.

### API/integration behavior

- Review Work is created/reused only inside successful launch.
- Launch response identity is used for navigation.
- Current head and identity are revalidated immediately before review/merge.
- Idempotency protects repeated submit/retry.
- Read-model updates reconcile the correct PR and invalidate detail cache.
- Provider failure is typed and recoverable rather than flattened into a toast.

### Browser journeys

Record API request counts and durable row counts before and after every cancel
and submit. A dialog screenshot alone is not sufficient evidence.

## Performance and UX budgets

- Cached queue content remains useful within 300 ms.
- Card action feedback starts within 100 ms.
- No per-card request fan-out.
- Opening detail performs one authoritative detail request, with bounded cache.
- URL/filter updates do not reset scroll.
- One card shows one visually dominant action.
- Mobile touch targets remain accessible without bulky full-width controls unless
  the control is the single bottom-sheet confirmation action.
- Status text is never color-only and is readable without hover.
- Agent activity and long descriptions load progressively rather than delaying
  the decision summary.

## Risks and controls

| Risk                                              | Control                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Queue reclassification hides expected PRs         | Keep All complete, add compatibility URL aliases, test live-data fixtures         |
| Client recommendation disagrees with provider     | Server/extension revalidates current identity/head/state before writes            |
| Read-model lag makes actions look stuck           | Explicit synchronizing state, bounded wait, retry, and authoritative refresh      |
| Changing default tab surprises deep links         | URL tab always wins; computed default applies only when absent                    |
| Simplifying agent review removes power            | Keep Advanced and aggregate mode, collapse rather than delete                     |
| Batch work causes unintended writes               | Eligibility preview, no verdict/merge/draft batch actions, per-item result ledger |
| Sticky mobile actions overlap navigation/keyboard | Visual-viewport audit at 320/390 px with keyboard and safe-area cases             |
| Extension disabled/unavailable                    | Show disabled reason and safe alternative; never expose a dead primary action     |
| Existing remediation stack is skipped             | Require ancestry from `2c21701` before validation and integration                 |

## Non-goals

- Replacing GitHub/SCM provider contracts.
- Rewriting the Work lifecycle or agent thread UI.
- Posting agent findings automatically without a user-authorized action.
- Automatic bulk approval, merge, request-changes, or draft publication.
- Adding decorative metrics or larger buttons to simulate usability.
- Deploying or merging before the full-flow release gate passes and the user
  explicitly requests integration/deployment.

## Planned commit sequence

1. `docs: plan pull request flow overhaul` — this document only.
2. `test: characterize pull request decision flow`
3. `refactor: centralize pull request flow policy`
4. `feat: make pull request queue ownership first`
5. `feat: unify pull request detail and human review`
6. `fix: preserve pull request agent launch continuity`
7. `feat: add resilient pull request mutation feedback`
8. `test: cover pull request journeys across viewports`
9. `docs: record pull request flow verification`

Commits may be split further to stay atomic, but implementation must not be
squashed ahead of its characterization coverage.

## Definition of done

- The default queue is personally relevant and materially smaller than All.
- Every card has one accurate recommended action and explains why.
- The recommendation is invariant across list, detail, desktop, and mobile.
- Human review, agent review, and implementation are distinct and correctly
  named.
- Cancel is side-effect free; submit is idempotent and visibly reconciled.
- New Work/review runs open immediately and remain steerable/queueable.
- Human review has one entry point and all four supported verdict modes.
- Filter/view/tab/selection/scroll state survives navigation and refresh.
- Safe batch operations have eligibility preview and per-item results.
- All unit, integration, build, audit, responsive, accessibility, performance,
  and production-runtime gates pass on the exact clean candidate commit.
- Merge and deployment occur only through a separately authorized, verified
  integration step.
