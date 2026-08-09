# Product UX overhaul

## Executive assessment

VertexADE had strong underlying capabilities but exposed too much of its implementation model. The largest sources of friction were duplicated destinations, competing terms for the same concept, oversized dashboard chrome, hidden maintenance actions, multi-step creation flows, non-durable navigation state, and desktop-first interaction patterns.

The redesign uses a simpler product model:

- **Focus** answers “what needs me now?”
- **Work** holds durable outcomes.
- **Pull requests** is the code-review queue.
- **Runs** shows agent execution and conversation history.
- **Delivery** shows releases and environments.
- **Automations** contains every automation surface.
- **Extensions** contains integrations and their setup.
- **System health** contains readiness, runtime status, repair, and cleanup.
- **Settings** contains workspace defaults.

The implementation on `feature/product-ux-overhaul` applies the high-impact changes directly and establishes shared interaction rules for the remaining product.

## Design principles

1. Lead with the user’s outcome, not the system object.
2. Give every capability one canonical home.
3. Put state in the URL when it changes what the user is looking at.
4. Keep primary tasks visible; progressively disclose expert controls.
5. Use **run** for agent execution and reserve **thread** for actual GitHub review conversations.
6. Never make opening a notification, modal, or page imply completion.
7. Make destructive actions explicit, accessible, and consistent.
8. Prefer responsive cards over compressed desktop tables.
9. Explain why an action is unavailable.
10. Preserve work in progress for returning users.

## Screen-by-screen review and resolution

### Focus

**Problems**

- Focus and Inbox represented the same mental model in two locations.
- The default list silently truncated the queue.
- Opening notifications marked everything read, conflating viewing with completion.
- Setup failures could leave a first-time user on an empty-looking dashboard.
- Full-page navigation was used for simple filter and creation actions.

**Resolution**

- Inbox now redirects to the canonical Focus queue.
- Focus has summary and complete-queue modes with a shareable severity filter.
- Notifications require an explicit “Mark read” action.
- First-time setup guidance appears directly in Focus.
- Loading failures show recovery actions instead of a false empty state.
- Internal actions use client-side navigation.

**Expected impact:** One starting point, fewer missed items, clearer recovery, and faster navigation.

### Work

**Problems**

- Creating Work required a five-step wizard before users understood what was essential.
- Advanced execution choices competed with the outcome itself.
- Draft input was easy to lose.
- “Thread” and “run” were used interchangeably.
- Mobile cards and metadata were overly dense.

**Resolution**

- Creation is now one screen: outcome, optional context, and repository.
- Agent settings, references, sequential splitting, and pull-request creation live under Advanced options.
- Drafts persist locally.
- Starting immediately is an explicit choice with clear repository consequences.
- User-facing execution language is standardized on “run.”
- Card metadata and actions use a clearer hierarchy and larger targets.

**Expected impact:** A first Work item can be created with one decision, while expert controls remain available.

### Work detail

**Problems**

- Two competing “recommended action” modules repeated the same decision.
- Delivery status used a wide table that collapsed poorly on mobile.
- Work runs and review runs were not clearly differentiated.
- Some secondary actions were more prominent than the next useful step.

**Resolution**

- One recommended-next-step treatment remains.
- Delivery uses mobile repository cards and a desktop table.
- Runs are grouped and explained by purpose.
- Review runs are described as private snapshots; work runs are described as editable worktrees.
- Primary actions use consistent language and hierarchy.

**Expected impact:** Faster orientation and fewer accidental launches into the wrong run type.

### Pull requests

**Problems**

- A large promotional hero and metric wall displaced the actual review queue.
- View selection was local state and could not be shared or restored.
- Maintenance appeared as a peer to review workflows.
- Repository search links landed on a destination that did not understand them.

**Resolution**

- The queue now begins with a compact workspace header.
- Needs attention, Mine, All, and Stacks are URL-backed views.
- Maintenance moved to System health.
- Search results deep-link into a filtered repository view.
- “Needs review” is expressed as the broader and more accurate “Needs attention.”

**Expected impact:** More pull requests above the fold and reliable shared links.

### Runs

**Problems**

- “Agents,” “threads,” and “runs” competed as labels.
- On smaller screens, selection could create an unusable master-detail layout.
- Follow-up, queue, steer, fork, and handoff actions lacked one stable vocabulary.

**Resolution**

- The workspace is named Runs throughout navigation and visible UI.
- Selecting a run below the desktop breakpoint opens a focused dialog.
- Queue, steer, follow-up, fork, and worktree-transfer actions now describe their effect.
- Icon controls and copy actions have accessible names.

**Expected impact:** Clearer execution management and a usable mobile flow.

### Delivery

**Problems**

- The screen implied complete deployment coverage even when only one repository supplied workflow data.
- Service filtering was transient and hard to share.
- The information hierarchy emphasized decoration over environment state.

**Resolution**

- Coverage is explicit: connected workflows and unconfigured repositories are reported separately.
- Service query and status filters are URL-backed.
- The header leads with actual coverage and workflow health.

**Expected impact:** Higher trust in deployment data and easier incident handoff.

### Automations

**Problems**

- Recipes, schedules, automatic reviews, approvals, and history were split between Automations and Settings.
- The builder disabled creation without explaining what was incomplete.
- Users had to understand the entire capability model before getting started.
- Configuration did not produce a plain-language preview.

**Resolution**

- One Automation workspace contains every recipe; scheduling is configured as a recipe trigger beside manual and event triggers, with shared approvals and history.
- Tabs are deep-linkable.
- Templates provide proven review, improve, and delivery flows.
- Disabled submission has a specific inline reason.
- A flow preview explains the trigger, run behavior, phases, and guarded actions.
- Approval and execution history are distinct views.

**Expected impact:** Better discoverability, fewer invalid recipes, and a shorter path to the first useful automation.

### Extensions

**Problems**

- “Installed,” “enabled,” “ready,” “configured,” and lifecycle labels overlapped.
- Setup-required integrations could look successfully installed.
- Source-to-Work dialogs used inconsistent bottom-fixed overlays.

**Resolution**

- Lifecycle language is consolidated into Available, Needs configuration, Needs attention, Active, and Unavailable.
- Tabs reflect Active and Available states.
- Source-to-Work actions use accessible dialogs and the same “Create Work and start” pattern.

**Expected impact:** More accurate setup expectations and consistent cross-extension behavior.

### Settings

**Problems**

- Settings search claimed broader capability than it provided.
- Automation configuration was duplicated here.
- Section selection was not durable.
- A global “changes save automatically” claim was inaccurate for explicit-save forms.

**Resolution**

- Search is labeled as a section filter.
- Automation settings link to the canonical Automation workspace.
- The selected section is URL-backed.
- The misleading autosave message is removed.
- Destructive settings actions use one confirmation system.

**Expected impact:** Less hunting, fewer contradictory save expectations, and better deep linking.

### System health

**Problems**

- Setup continued to dominate after the workspace was ready.
- Runtime status, repair instructions, and local cleanup were fragmented.
- The documented Node requirement did not match the repository engine.

**Resolution**

- Ready workspaces lead with operational status.
- Install and repair guidance collapses after setup.
- Closed pull-request worktree cleanup lives here with explicit history-preservation choices.
- The Node requirement is corrected to 22.13+.

**Expected impact:** The screen works for both first-time setup and returning maintenance without forcing either audience through the other flow.

## Interaction-system review

| Area          | Friction                                                   | Resolution                                                                                     |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Buttons       | Small targets and inconsistent icon labels                 | Shared sizes now meet stronger desktop/mobile targets; icon-only actions have accessible names |
| Forms         | Expert controls competed with essentials                   | Progressive disclosure, clearer required/optional language, persistent Work drafts             |
| Dialogs       | Browser confirms and fixed pseudo-modals were inconsistent | Shared accessible confirmation provider and Radix dialogs                                      |
| Tables        | Dense delivery data did not adapt                          | Card representation on mobile, table retained for desktop scanning                             |
| Navigation    | Duplicate destinations and full reloads                    | Canonical IA, client navigation, URL-backed views                                              |
| Search        | Dead or incorrect destinations                             | Repository-aware PR deep links and deduplicated global results                                 |
| Filters       | State disappeared on refresh                               | URL-backed Focus, PR, Delivery, Settings, and Automation state                                 |
| Empty states  | Often described absence without next action                | Contextual guidance and recovery actions                                                       |
| Loading       | Some screens looked empty during failure                   | Explicit loading and failure treatments on the primary Focus path                              |
| Errors        | Toast-only recovery                                        | Important page failures also provide persistent retry or System-health actions                 |
| Success       | Completion language varied                                 | Consistent run, Work, and confirmation copy                                                    |
| Notifications | Opening implied read                                       | Explicit read state; approvals, automations, Work, and runs deep-link correctly                |

## Design-system direction

- Semantic color tokens now include success, warning, and information roles in both themes.
- Focus-visible styling is global and motion respects `prefers-reduced-motion`.
- Minimum mobile targets are 44px; shared button sizes are larger at every tier.
- Product headings use the primary interface typeface; monospace is reserved for identifiers, branches, paths, and commands.
- “Run” is the system term for agent execution. “Thread” remains only for GitHub inline review discussions and internal API contracts.
- Confirmation language describes the object, permanence, and preserved data.
- Radius, shadow, and surface treatments reuse the shared card and workspace primitives.

## Mobile and responsive behavior

- The bottom action dock keeps the four highest-frequency destinations: Focus, Work, PRs, and Runs.
- Secondary destinations remain available through More.
- Run selection opens a full focused surface below the wide desktop breakpoint.
- Work delivery data becomes repository cards.
- Creation and extension dialogs use viewport-bounded, scrollable content.
- Toolbar tabs and filters scroll horizontally rather than compressing below readable widths.
- Button and interactive control targets meet the 44px mobile minimum.
- Fixed bottom pseudo-modals were removed to prevent viewport and keyboard collisions.

## Benchmarking

- **Linear:** The simplified Work creator follows Linear’s bias toward one primary field and immediate creation, with detail added later.
- **Notion:** Advanced controls use progressive disclosure and preserve drafts rather than forcing setup before expression.
- **Raycast:** Global navigation is command-first, searchable, deduplicated, and includes direct creation.
- **GitHub:** Pull-request review threads retain GitHub’s established terminology while agent execution uses a separate model.
- **Vercel:** Delivery emphasizes environment and workflow truth over decorative totals.
- **Stripe Dashboard:** System status and setup are explicit, persistent, and recovery-oriented.
- **Figma:** Selection moves into a focused detail surface on constrained viewports instead of shrinking a multi-pane desktop UI.
- **Apple:** Destructive actions explain their consequence and separate the default safe action from irreversible history deletion.
- **Airbnb:** Empty and setup states explain the next useful outcome, not just the missing data.

## Prioritized roadmap

### 🔴 High impact / low effort

| Problem                              | Why it hurts                                | Solution                                      | Expected impact             | Complexity | Status      |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------- | --------------------------- | ---------- | ----------- |
| Duplicate Focus and Inbox            | Users must decide where attention lives     | Make Focus canonical and redirect Inbox       | One reliable starting point | Low        | Implemented |
| Mixed run/thread terminology         | Users cannot predict what opens or persists | Standardize agent execution on Runs           | Lower cognitive load        | Low        | Implemented |
| Opening notifications marks all read | Viewing is mistaken for completion          | Require explicit Mark read                    | Fewer missed actions        | Low        | Implemented |
| Browser confirms                     | Inconsistent, inaccessible, context-poor    | Shared confirmation dialog                    | Safer destructive actions   | Low        | Implemented |
| Small targets and text               | Hard to scan and tap                        | Raise shared sizes and minimum targets        | Better accessibility        | Low        | Implemented |
| Dead search destinations             | Search breaks trust                         | Deep-link to filtered canonical screens       | Higher search success       | Low        | Implemented |
| Hidden complete Focus queue          | Users cannot verify what is omitted         | Add View all and severity filters             | Complete triage visibility  | Low        | Implemented |
| Setup dominates ready users          | Returning users repeat onboarding           | Lead with operational status, collapse repair | Faster maintenance          | Low        | Implemented |

### 🟡 Medium impact

| Problem                        | Why it hurts                            | Solution                                         | Expected impact           | Complexity | Status      |
| ------------------------------ | --------------------------------------- | ------------------------------------------------ | ------------------------- | ---------- | ----------- |
| Five-step Work wizard          | Too many decisions before value         | Single-screen quick create with Advanced options | Faster creation           | Medium     | Implemented |
| Fragmented automations         | Related work requires context switching | One tabbed Automation workspace                  | Better discoverability    | Medium     | Implemented |
| Opaque automation validation   | Disabled actions look broken            | Inline reasons, templates, flow preview          | Higher completion rate    | Medium     | Implemented |
| PR dashboard chrome            | Queue starts below the fold             | Compact header and URL-backed views              | Faster review scanning    | Medium     | Implemented |
| Desktop-first run detail       | Mobile selection is cramped             | Open focused detail dialog on smaller screens    | Usable mobile run control | Medium     | Implemented |
| Delivery coverage ambiguity    | Users over-trust partial data           | Report connected and unconfigured coverage       | Higher operational trust  | Medium     | Implemented |
| Maintenance under PRs          | Wrong mental model                      | Move worktree cleanup to System health           | Better discoverability    | Medium     | Implemented |
| Extension lifecycle vocabulary | Setup state is ambiguous                | Consolidate lifecycle labels                     | Fewer setup errors        | Medium     | Implemented |

### 🟢 Long-term opportunities

| Problem                                                       | Why it hurts                                         | Solution                                                     | Expected impact                      | Complexity | Status  |
| ------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ | ---------- | ------- |
| Focus items lack durable triage state across all source types | Large queues cannot be organized into now/later/done | Add backend-owned save, snooze, assign, and complete states  | Focus becomes a true operating queue | High       | Planned |
| Views are filterable but not nameable                         | Teams repeat complex filter setup                    | Saved and shared views with workspace defaults               | Faster recurring workflows           | High       | Planned |
| Automation preview is descriptive, not executable             | Users cannot verify side effects before enabling     | Add event-fixture simulation and capability dry runs         | Safer automation adoption            | High       | Planned |
| Personalization is limited to extension pins                  | Different roles see the same hierarchy               | Role-aware defaults and configurable Focus sections          | Better relevance by role             | High       | Planned |
| No cross-workspace undo model                                 | Some successful mutations remain costly to reverse   | Add recoverable archive/undo patterns and activity log links | More confident use                   | High       | Planned |

## Verification criteria

- All workspace checks, TypeScript compatibility suites, tests, and production build pass.
- Focus, Work, PRs, Runs, Delivery, Automations, Extensions, Settings, and System health return successfully from the running application.
- Dialogs remain viewport-bounded at mobile widths.
- Icon-only controls have an accessible name.
- Reduced-motion users do not receive nonessential animation.
- Existing pull requests and run history are preserved by default during local cleanup.
