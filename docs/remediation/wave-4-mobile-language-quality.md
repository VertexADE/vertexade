# Wave 4 — Mobile and language quality

Status: implemented and locally verified. Native Android/iOS promotion evidence is
blocked by the missing device services and Expo credentials recorded below.

Scope: `TF-014`, `TF-011`, and `TF-012`, in that order. This wave starts from
Wave 3 commit `ef2d5d4` on branch `fix/wave-4-mobile-language-quality`.

The wave does not merge or deploy itself. Deployment remains a separate,
explicitly authorized operation.

## Outcome

After this wave:

- Work conversations are called **threads** everywhere a user starts, opens, or
  counts a conversation; **run** is reserved for an execution or turn inside a
  thread;
- the live UI audit targets durable semantic action identifiers instead of
  mutable English labels and must finish with no desktop or mobile failures;
- the Expo workspace owns component and unit tests for its connection,
  navigation, portable settings/actions, agent choices, asynchronous states,
  and destructive confirmations;
- the root verified test command cannot pass while mobile behavior tests fail;
- one fixture-backed Maestro journey covers connection, Work, Agents, pull
  requests, extension navigation, and settings on real Android and iOS builds;
- unit, coverage, Maestro, screenshots, recordings, startup timing, crash scan,
  and bundle comparison results have named artifact locations; and
- production exports compile Hermes bytecode by default. Plain UTF-8 bundles
  remain available only through an explicitly analysis-only command.

## Current environment and evidence policy

The implementation host is ARM64 Linux. At planning time it has no Android SDK,
Android emulator, ADB, iOS simulator, Xcode, or Maestro executable. The Expo app
also has no configured EAS project identifier. Those facts do not prevent the
repository work, component tests, native exports, or deterministic artifact
comparison, but they do prevent claiming that a native device journey, cold
start, or crash scan passed on this host.

The repository will contain the executable device contract and a cloud workflow
for both platforms. If Expo project credentials/configuration are still absent
at verification time, the native-runtime clauses of `TF-011` and `TF-012` will
be reported as **implemented but promotion-blocked pending Android/iOS evidence**.
They will not be replaced with a browser viewport, test renderer, static YAML
validation, or successful export.

The bytecode policy follows Expo's supported production path:

- Hermes is the default engine and production `expo export` generates native
  bytecode bundles;
- `--no-bytecode` exists for bundle analysis and must not be the shipping
  default; and
- bytecode is runtime-version-sensitive, so a React Native/Hermes change must
  also advance the Expo runtime version before an update can be promoted.

References:

- <https://docs.expo.dev/guides/using-hermes/>
- <https://docs.expo.dev/more/expo-cli/>
- <https://docs.expo.dev/eas/workflows/examples/e2e-tests/>

## Safety and quality invariants

1. A thread is a persistent conversation; a run is a bounded execution or turn
   in that conversation. Copy must not use the terms interchangeably.
2. A copy edit cannot silently break the live audit. Audited interactions use a
   stable, unique semantic identifier and still expose an accessible name.
3. Test-only identifiers do not replace roles, labels, state, or other
   accessibility semantics.
4. The root test gate runs the mobile behavioral suite; no exclusion for the
   mobile workspace remains.
5. Native tests use the same portable contracts and platform client boundary as
   the application. Test fixtures do not introduce production-only branches.
6. Destructive behavior is never executed until the confirmation callback
   resolves positively. Dismiss, cancel, and duplicate resolution remain safe.
7. Device smoke tests use a deterministic local fixture API and never mutate a
   developer's real Work, pull request, extension, or settings data.
8. A device journey must run against an installable Android APK or iOS simulator
   application. An Expo export alone is not device evidence.
9. Release export means Hermes bytecode. The no-bytecode command includes
   `analysis` in its name and documentation and is never called by root build or
   release scripts.
10. Performance reports preserve both raw measurements and summarized deltas.
    A missing sample, device crash, launch timeout, or incompatible bytecode is
    a failed comparison, not an omitted row.
11. Generated reports, screenshots, recordings, bundles, and credentials stay
    outside version control.
12. Wave verification records pass, fail, blocked, or not applicable for every
    definition-of-done clause in `TF-014`, `TF-011`, and `TF-012`.

## Phase A — Stabilize Work language and UI auditing (`TF-014`)

### Vocabulary contract

Audit all user-visible Work copy, accessibility labels, dialog titles, tabs,
menus, toasts, empty states, and documentation touched by the current workflow.
Apply this vocabulary:

- **agent thread**: the persistent user/agent conversation created from Work;
- **review thread**: a persistent review conversation over a stopped snapshot;
- **thread**: tab, list, count, open/start/new actions, and conversation metadata;
- **run**: a specific execution status, failure, retry, source/destination
  transfer, or numbered execution inside a thread; and
- **activity**: the chronological contents of a thread.

The immediate known changes are:

- `New agent run` to `New agent thread`;
- `New review run` and `Start review run` to the corresponding thread copy;
- `Start first/next agent run` when it creates a new conversation to thread;
- the Work detail `Runs` tab and summary count to `Threads`; and
- `New work thread` to the product-standard `New agent thread`.

Numbered execution labels such as `run #123`, failure recovery copy, and memory
transfer source/destination run identifiers remain runs.

### Durable interaction selectors

Add a small semantic action contract to audited controls. The DOM representation
will use `data-audit-action="<stable-id>"`; native controls continue to use
`testID`. Stable IDs describe intent, not copy, for example:

- `work.actions.open`
- `work.thread.new-agent`
- `work.thread.new-review`
- `work.delete`
- `work.edit-outcome`

Extend the audit route model to accept an ordered `actionSelectors` array. Each
interaction step:

1. resolves exactly one visible control by selector;
2. rejects missing, hidden, disabled, or ambiguous matches;
3. dispatches the same pointer/click sequence as today;
4. records selector and current accessible label in the report; and
5. waits for the resulting menu/dialog surface before continuing.

Mutable text remains visible in screenshots and accessibility checks, but is no
longer the executable locator. Keep temporary text-locator support only for
routes outside the newly migrated Work interactions, then report remaining
text-coupled routes so a later cleanup cannot be forgotten.

### Tests and acceptance

- add script tests for ordered selector interactions, ambiguity, hidden/disabled
  controls, missing actions, optional interactions, and report serialization;
- add component assertions for the Work action menu and tab vocabulary;
- search the relevant Work surface for prohibited thread-as-run phrases;
- run targeted desktop and 390 px/320 px audits while iterating; and
- run the complete live audit across every discovered route and all seven
  viewports before closing the phase.

Acceptance: the full audit has zero persistent loading, overflow, missing
interaction, unnamed-control, exception, console-error, and HTTP-response
failures. Its Work interactions are selector-driven and the rendered labels use
the vocabulary contract.

## Phase B — Add the mobile behavioral suite (`TF-011`)

### Test runner and root integration

Use Expo's native Jest preset with React Native Testing Library and the React
19.2.3-matched renderer. Pin direct development dependencies in the mobile
workspace and lockfile. The runner configuration will:

- transform Expo/React Native modules with `jest-expo`;
- resolve the existing `@/` source alias;
- restore mocks and fail on leaked handles or unhandled promise work;
- collect source coverage with explicit, realistic thresholds for newly covered
  modules rather than an artificial repository-wide number; and
- write JUnit and coverage output under `artifacts/mobile-tests/` in CI mode.

Add mobile `test` and `test:ci` scripts. Remove the two root
`!@vertexade/mobile` exclusions so both cached and verified root gates execute
the mobile suite. Generated artifacts remain ignored.

### Component and unit coverage matrix

Cover observable behavior, not snapshots of style objects:

| Area                     | Required behavior                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection               | normalized URL input, disabled/working state, successful catalog, failed connection, retry, and error alert                                                    |
| Home/navigation          | portable module filtering, disabled-but-configurable entry, empty state, extension route parameters, and accessible labels                                     |
| Extension chrome         | loading, missing module, unsupported contract, disabled workspace with reachable settings, tab selection, and title                                            |
| Portable settings        | load, failure/retry, field initialization, validation, save/reload, discovery result, reset success/failure, and success/error announcements                   |
| Destructive confirmation | cancel, dismiss, confirm, one resolution only, and no request before confirmation                                                                              |
| Portable actions         | defaults, visibility, required values, option projection, body mapping, agent headers, execute, refine, complete, and failure state                            |
| Agent options            | request, enabled/selectable filtering, server change, default agent, model selection, reasoning selection, empty/error behavior, and stale-response protection |
| Collection states        | loading, error/retry, empty/filter-empty, content, details, action modal, and refresh                                                                          |

Mocks stop at external boundaries: platform-client transport, Expo Router, Alert,
and native linking. Portable contract mapping and component state transitions run
for real.

### Testability improvements allowed by the phase

Small source changes are allowed when they improve both accessibility and
deterministic behavior:

- add roles, labels, live-region/alert semantics, and stable test IDs;
- extract the destructive confirmation promise into a focused utility with
  exactly-once resolution;
- abort or ignore stale agent-option and catalog requests after server/route
  changes; and
- replace swallowed option-loading failures with a compact retryable state.

Do not add production flags, test-only conditionals, alternate navigation, or a
parallel client implementation.

### Acceptance

Targeted mobile tests, mobile type checking, root `npm test`, and root
`npm run test:verified` pass. A deliberately failing mobile test must make the
workspace and root verified commands fail during gate validation, after which
the deliberate failure is reverted. The JUnit and coverage reports are
generated and machine-readable.

## Phase C — Add the real device journey and artifacts (`TF-011`)

### Deterministic fixture API

Add a test-only Node fixture server under `scripts/` using the platform's public
JSON contracts. It binds to loopback by default and serves only the endpoints
needed by the journey:

- module catalog entries for Work, Agents, Pull requests, and one disabled but
  configurable extension;
- portable collection data, detail, actions, settings, and save/reset results;
- agent/model/reasoning choices; and
- deterministic success, empty, loading-delay, and error fixture modes.

The fixture never opens the production database and logs every received request
to the artifact directory for assertion and diagnosis.

### Maestro flow

Add one canonical `.maestro/mobile-smoke.yaml` flow using stable native test IDs.
It will:

1. launch a clean application state;
2. enter the fixture API URL and connect;
3. verify the extension catalog and disabled/settings-only presentation;
4. open Work, start an action, choose agent/model/reasoning, and cancel before a
   real mutation;
5. open Agents and assert its collection/empty behavior;
6. open Pull requests, inspect a record and return;
7. open extension settings, change a non-secret field, save, reload, and reset
   through the destructive confirmation; and
8. return home while capturing milestone screenshots and a recording.

Every step asserts the destination state before proceeding. Text can be asserted
for user value, but navigation and actions use test IDs.

### Native execution and artifact publication

Add an `e2e-test` EAS profile for unsigned Android APK and iOS simulator builds,
plus manual Android and iOS EAS workflows. The workflows build, run the same
Maestro flow, record the screen, and retain:

- Maestro XML/JSON results and command logs;
- fixture request log;
- milestone screenshots;
- screen recording;
- built app identifier, platform, OS/device, commit, runtime version, and
  dependency lock hash; and
- crash and startup reports from Phase D.

Do not add a pull-request trigger until the Expo project is linked and cost/
credential ownership has been explicitly configured. Before that point the
workflow is manual and its missing execution is a release blocker, not an
automatic external side effect of this wave.

Acceptance: the same committed journey passes on at least one supported Android
emulator/device and one supported iOS simulator/device, and both artifact sets
are retained. If this host cannot supply them, record the exact command and
missing external prerequisite.

## Phase D — Make bytecode the release default and measure it (`TF-012`)

### Export contract

Change scripts so:

- mobile `export` and root `build:mobile` use `expo export --platform all`
  with Hermes bytecode;
- `export:analysis` is the only no-bytecode command and includes
  `--no-bytecode --source-maps` for bundle inspection;
- app configuration explicitly states `jsEngine: "hermes"` and a runtime
  version policy compatible with native module/Hermes changes; and
- README/build documentation warns that analysis bundles are not releasable.

Fail verification if a release script contains `--no-bytecode` or delegates to
the analysis command.

### Reproducible bundle comparison

Add a Node script that exports bytecode and analysis variants into isolated
temporary directories with a cold Metro cache, then writes
`artifacts/mobile-performance/bundle-comparison.json`. For iOS and Android it
records:

- command, exit code, duration, Expo/RN/Hermes/runtime versions, host, and commit;
- every bundle/asset path, byte count, SHA-256, and aggregate bytes;
- bytecode format/header detection for the release bundle;
- plain-JavaScript detection for the analysis bundle;
- absolute and percentage size deltas; and
- source-map presence only for the analysis output.

The script fails if platforms are missing, a release bundle is plain JavaScript,
an analysis bundle is bytecode, outputs are empty, or metadata is incomplete.
The comparison describes export size; it does not pretend that compressed APK/
IPA size or runtime memory has been measured.

### Cold start and crash comparison

Add a device probe invoked around both installable comparison variants. It runs
at least ten cold launches after force-stop/terminate, discards one warm-up, and
records raw samples plus median, p90, and spread. It also captures fatal native
and JavaScript exceptions from platform logs from install through the final
journey.

The report identifies device model, OS, ABI, build/runtime, bytecode mode, and
application ID. Android uses package-manager/activity timing and logcat; iOS
uses simulator process/log evidence. A threshold is not invented from one host:
promotion requires the bytecode variant to have no new crash and no statistically
meaningful cold-start regression. The measured baseline and decision stay in
the artifact.

Because plain exports are not installable artifacts, the EAS/native build setup
must deliberately produce the two comparison variants. If Expo tooling cannot
safely produce an installable no-bytecode analysis variant, document that
compatibility blocker, test the bytecode release build on both platforms, and
use Expo's supported guidance plus export comparison as the decision evidence.
Do not patch generated native projects merely to manufacture a favorable test.

### Acceptance

The bytecode export succeeds on this ARM64 host, both native platforms appear in
the bundle report, mobile type checks/tests remain green, and the release script
has no no-bytecode path. Promotion additionally requires retained iOS and
Android cold-start/crash evidence; otherwise `TF-012` is implemented but remains
promotion-blocked.

## Phase E — Documentation and final verification

Update:

- `apps/mobile/README.md` with local tests, analysis export, fixture server,
  Maestro, artifacts, bytecode/runtime compatibility, and device prerequisites;
- root README validation language so mobile is no longer described as excluded;
- `TOFIX.md` with exact commit/evidence status for `TF-014`, `TF-011`, and
  `TF-012`; and
- this plan with commands, counts, measurements, artifact paths, unresolved
  external prerequisites, and final verdicts.

Run, in order:

1. focused terminology/audit script and component tests;
2. mobile unit/component tests and CI artifact mode;
3. mobile TypeScript check;
4. release bytecode export and analysis export;
5. reproducible bundle comparison;
6. fixture and Maestro schema/contract validation;
7. actual Android and iOS Maestro/startup/crash workflows when available;
8. root `npm run check`;
9. root `npm test`;
10. root `npm run test:verified`;
11. root `npm run build` and `npm run build:mobile`;
12. full live UI audit against the served Wave 4 checkout;
13. production and full dependency audits, Expo dependency compatibility, and
    new-only Fallow quality/security review; and
14. clean working-tree, branch ancestry, lockfile, and generated-artifact audit.

## Wave completion criteria

Wave 4 can be marked complete only when:

- `TF-014` is fully closed with a zero-failure live audit;
- `TF-011` component/root-gate work is closed and the native-flow status is
  explicitly pass or promotion-blocked with an executable workflow;
- `TF-012` release bytecode work is closed and native performance status is
  explicitly pass or promotion-blocked with exact missing evidence;
- no new P0/P1 security or correctness issue is introduced;
- the full applicable local gate is green; and
- the branch contains only intended, committed Wave 4 changes.

After this wave, Wave 5 will receive its own committed plan before any `TF-015`
P3 refactor begins. Wave 5 will not inherit unverified assumptions from the
mobile or audit work.

## Verification record — 2026-08-04

### Delivered commits

- `8fc41ee` — Work thread vocabulary and semantic audit actions;
- `d1e5be6` — mobile Jest/component coverage and root-gate integration;
- `3f31250` — deterministic fixture, Maestro journey, and manual Android/iOS EAS
  workflows;
- `ec8827d` — Hermes release export, ARM64 QEMU compiler bridge, export
  comparison, runtime probe, and documentation;
- `3b515d2` — duplicate audit-route protection and advisory-free JUnit reporter;
  and
- `3369017` — explicit Fallow entry points and shared CLI failure handling.

The original Wave 4 plan was committed first as `0e3c71a`; no Wave 4 product
code preceded it.

### Language and live UI audit (`TF-014`)

- Conversation creation/open/count copy now says **thread**; **run** remains for
  numbered executions, execution state, retries, and transfers.
- Work audit interactions resolve unique `data-audit-action` selectors and fail
  on missing, hidden, disabled, or ambiguous targets.
- The production Wave 4 build was served on loopback and audited against the
  live API. All 60 discovered screens/dialog states passed at all seven widths:
  2560, 1920, 1440, 1024, 768, 390, and 320 px.
- Final report: 420 route/viewport combinations, 0 persistent-loading failures,
  0 overflows, 0 missing interactions, 0 unnamed interactive controls, 0
  exceptions, 0 console errors, and 0 failed HTTP responses. Artifact:
  `artifacts/ui-audit-wave4/report.json` (ignored by Git).

Verdict: **pass; `TF-014` closed**.

### Mobile behavior and device journey (`TF-011`)

- Jest/React Native Testing Library covers connection, filtering/navigation,
  extension states, collections, agent/model/reasoning options, portable
  settings/actions, async failure/retry, stale responses, and exactly-once
  destructive confirmation.
- The suite has 12 files and 49 tests. CI mode writes JUnit and Istanbul
  coverage to `artifacts/mobile-tests/`; the last full CI run covered 46.28% of
  statements, 35.77% of branches, 36.36% of functions, and 50.96% of lines.
- Both cached `npm test` and uncached `npm run test:verified` execute the mobile
  suite and passed. A release build cannot exclude mobile behavior anymore.
- `.maestro/mobile-smoke.yaml` covers connection, Work, agent choices/cancel,
  Agents, pull request detail, disabled-extension settings, save, reload, reset,
  and screenshots against the deterministic fixture.
- `.eas/workflows/mobile-e2e.yml` builds installable Android APK and iOS
  simulator artifacts, runs the same journey, records the screen, fixture
  traffic, ten post-warm-up cold starts, and fatal platform logs. It remains
  manual so this wave cannot create external build cost.
- Static workflow/fixture tests pass. `eas workflow:validate` could not perform
  remote validation because this environment has neither an authenticated Expo
  account nor `EXPO_TOKEN`.
- Native execution is blocked on this host: the Android probe records `spawnSync
adb ENOENT`; the iOS probe records `spawnSync xcrun ENOENT`; there is no local
  Maestro executable. Blocker artifacts are under `artifacts/mobile-device/`.

Verdict: **component/root-gate work passes; device flow is implemented but
promotion-blocked pending one retained Android and one retained iOS run**.

### Hermes release and measurement (`TF-012`)

- `build:mobile` now reaches `expo export --platform all` through a release
  wrapper that rejects `--no-bytecode`. Plain bundles exist only as the clearly
  non-releasable `export:analysis` command.
- Expo ships an x64 `hermesc` on Linux. This ARM64 host now verifies and invokes
  that compiler through `qemu-x86_64`; missing emulation fails before export.
  Native x64 Linux and macOS retain Expo's normal compiler path.
- The default release build succeeded for iOS and Android. Bytecode header
  validation passed for both generated `.hbc` files.
- The cold export comparison passed and retained SHA-256/byte metadata and source
  maps in `artifacts/mobile-performance/bundle-comparison.json`. Android was
  2,767,580 bytecode bytes versus 1,847,721 plain-JavaScript bytes (+49.78%);
  iOS was 2,465,489 versus 1,601,632 (+53.94%). This is an uncompressed export
  comparison, not an APK/IPA-size or runtime-memory claim.
- `jsEngine` is explicitly Hermes and Expo runtime version follows app version,
  preventing a native/Hermes change from silently sharing an old update runtime.
- The native workflow runs the committed startup/crash probe, but cold-start and
  crash comparison cannot be promoted until the Android/iOS blockers above are
  resolved. No local result is represented as device evidence.

Verdict: **release bytecode passes; native performance promotion remains blocked
pending retained device evidence**.

### Full local gate

- `npm run check`: pass, 793 formatted files and 720 lint/type-checked files;
- `npm test`: pass, including 12 mobile suites;
- `npm run test:verified`: pass with 0/20 workspace cache hits;
- `npm run build`: pass, including React Compiler and bundle budgets;
- `npm run build:mobile`: pass with Hermes `.hbc` for both platforms;
- `expo install --check`: dependencies current;
- production and full `npm audit --audit-level=high`: 0 high/critical and the
  pre-existing 10 moderate Expo/xcode `uuid` findings; and
- changed-file Fallow security: 15 scanner candidates manually reviewed, with
  no confirmed new vulnerability. Commands are fixed build/device tools and
  package-resolved paths; mobile URLs remain the already documented trusted-
  network boundary blocked on `TF-001`.

Fallow's changed-file maintainability report still attributes ten complexity
findings to touched/new mobile functions (including branch-heavy measurement
CLIs and two pre-existing UI functions whose test-ID edits changed their lines).
They are P3 quality work, not a runtime failure, and are carried explicitly into
Wave 5 rather than hidden with suppressions.
