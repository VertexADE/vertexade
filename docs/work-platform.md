# Work platform

Work is the dashboard's durable coordination layer. A Work item represents an outcome; agent jobs are execution attempts that belong to that outcome. Pull requests, branches, deployments, schedules, external work items, and findings attach as typed resources instead of becoming vendor-specific columns on the core record.

One Work item may scope up to eight repositories. Starting it launches an independent agent thread, branch, and worktree for every selected repository concurrently. The threads share the Work item and intended outcome, while their execution and Git state remain isolated.

## Domain model

- `work_items` owns the title, description, kind, priority, workflow phase, owner, attention state, and archive state.
- `jobs.work_item_id` associates any number of agent threads with one outcome.
- `work_resources` stores provider-neutral resource identities using `provider + kind + external_id`.
- `work_item_resources` attaches a resource to one or more Work items under a role such as `source`, `review_subject`, `implementation`, or `delivery`.
- `work_item_relations` describes parent, child, blocker, duplicate, and related-work edges.
- `work_events` is the append-only activity and audit history.
- `work_context_transfers` records a child item's source run, destination run, copied input snapshot, destination output snapshot, and independent transfer lifecycle.
- `data/work-memory/<work-key>/memory.md` is the Work item's durable Markdown memory shared across agent providers and worktrees.

A pull request is deliberately not unique to one Work item. It can be the `delivery` resource of an implementation item and the `review_subject` of a contributor-review item at the same time.

For multi-repository delivery, each repository is attached as a `repository` resource with the `scope` role. Partial launch outcomes retain successful threads and record per-repository errors instead of rolling the whole launch back.

## Agent workspace layouts

Implementation threads started from a Work item use one workspace layout. The
host groups the Work item's repository worktrees below one agent-managed parent
and starts every agent session with that parent as its current directory.

The combined layout is provider-specific because every agent owns its managed workspace root:

```text
<agent-workspace-root>/
  work-items/
    W-0042/
      organization--api/
      organization--web/
```

The parent directory is coordination context, not one merged Git checkout. Every child remains an independent Git worktree with its own branch and shared metadata from its canonical repository. Repository paths are stable within the Work item and do not include a run identifier. Starting another independent thread for the same Work item and repository is rejected while that worktree exists; resume or follow up on its existing thread instead. The agent prompt identifies both paths and permits reading sibling worktrees for cross-repository context, but limits writes to the session's assigned repository worktree. This keeps concurrently running repository threads isolated while giving them the same filesystem perspective and shared Work memory.

`workspace_mode` records `combined` on every new thread; `session_cwd` records
the directory used to launch, resume, retry, and reconcile the provider
session. `worktree_path` continues to identify the assigned Git checkout for
diffs, environment snapshots, branch operations, previews, and cleanup. Forked
threads receive a new Work-key parent and worktree. Runtime readers can still
locate historical recorded worktrees, but no launch API creates or accepts the
old repository-scoped layout.

## Lifecycle

The shared phases are `backlog`, `active`, `review`, `deploy`, and `done`. The server projects the phase from durable thread, PR, and deployment evidence. A manual phase override records a reason and can later be cleared to resume automatic projection.

PR-review work remains in Review after a private agent review until the external review outcome is resolved. A new head SHA after a completed agent review adds attention and reopens the review. Implementation work with a merged PR remains in Deploy until linked service deployment evidence reaches production.

Multi-repository implementation work remains in Review until every scoped repository has a merged delivery PR. It reaches Done only when deployment evidence is complete for every merged repository. Manual lifecycle overrides remain available for repositories that intentionally do not produce a PR or deployment.

A cross-worktree follow-up creates a durable child Work item but resumes an existing idle destination thread. The destination job remains owned by its original Work item; the child records parent/related edges and `context_source`/`destination` resources instead of moving that job. Source output is copied as an immutable, explicitly untrusted snapshot. When the destination turn finishes, its final output is snapshotted and the child moves to Done; launch or execution failures leave the child visible with attention.

## Shared agent memory

Every Work item owns one host-managed Markdown memory file. The server creates it for existing and newly created Work items and injects its absolute path into every new, resumed, retried, forked, review, planning, and cross-worktree agent turn. Codex also receives the Work-specific memory directory as an additional runtime and writable root, including workspace-write review turns. Other registered agents receive the same file path through the shared launch prompt.

Agents are explicitly allowed to read and update this file outside their selected repository worktree. They are instructed to re-read before writing, preserve useful existing context, keep durable decisions and constraints concise, and never store credentials. The Work detail screen exposes the same file with refresh and edit controls. Direct agent edits remain immediately visible to other agents through the filesystem; the dashboard refresh action reloads edits made outside its API.

## Retention and deletion

Archive is the normal completion action. It removes a Work item from the open board while retaining its timeline, threads, logs, branches, worktrees, relationships, and resource links for later restoration.

Permanent deletion is an explicit cleanup workflow with an impact preview and Work-key confirmation. It stops active agent processes managed by the dashboard, deletes their provider thread history and local logs, removes exclusively owned worktrees and their combined Work parent, deletes exclusively owned local branches, and then removes the Work item, events, relationships, and resource links. A cleanup failure keeps the Work item and failed runs visible with an attention message so the operation can be retried.

Archive retains shared Work memory. Successful permanent deletion removes its Work-specific memory directory; a memory cleanup failure keeps the Work item visible instead of leaving an unowned context file.

Permanent deletion never deletes repository records, remote branches, cached pull-request records, or pull requests on GitHub. A worktree or local branch that is still referenced by another Work item is retained.

## Extension boundary

Extension task launches accept an optional Work launch context:

```ts
host.tasks.launch(repository, title, prompt, true, 'feature', {
  kind: 'implementation',
  workspaceMode: 'combined',
  source: {
    provider: 'example',
    kind: 'work_item',
    externalId: '123',
    role: 'source',
    label: 'Example #123',
    url: 'https://example.test/items/123',
    primary: true,
  },
})
```

`workspaceMode` is optional and, when supplied, can only be `combined`.
Extension planning and refinement threads use the same Work-key parent and
resume from their recorded session directory. The host also exposes narrow
`work.create`, `work.linkResource`, and `work.relate` operations. Extensions
retain ownership of provider authentication and upstream mutation; the Work
platform owns local identity, links, lifecycle presentation, and audit history.

Extensions with the dedicated `tasks.follow-up` permission can create the same audited handoff without direct database or process access:

```ts
await host.tasks.followUpInWorktree({
  sourceJobId: 42,
  destinationJobId: 77,
  title: 'Apply the confirmed findings',
  instruction: 'Implement and verify the source recommendations that apply here.',
})
```

The source must have completed output. The destination must be an idle, resumable non-review thread in a different existing worktree.

Extensions can access the same file-backed context through `host.work.memory(workItemId)` with `work.read`, and update it through `host.work.writeMemory(workItemId, content)` with `work.write`. The host validates the Work identity, bounds memory to 200 KB, and uses an atomic replacement for API and extension writes.

## Identity rules

- Never correlate resources by title.
- PR identity is the normalized repository plus PR number.
- Branch identity is the normalized repository plus branch name.
- Deployment identity is the repository, service, and merge SHA.
- Ambiguous relationships remain separate until a user links them.
