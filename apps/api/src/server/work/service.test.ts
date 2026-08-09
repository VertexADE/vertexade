import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vite-plus/test'
import { drizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { ensureWorkSchema } from '../database/work-schema.ts'
import { WorkService, projectedWorkState } from './service.ts'

const githubProviders = {
  scm: (repository: { full_name: string }) => ({
    id: 'github',
    repositoryUrl: `https://github.com/${repository.full_name}`,
  }),
  deployment: () => ({ id: 'github-actions' }),
}

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL);
    CREATE TABLE pull_requests (id INTEGER PRIMARY KEY, repo_id INTEGER, number INTEGER, title TEXT, url TEXT, draft INTEGER, review_decision TEXT, head_sha TEXT);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, repo_id INTEGER, pr_number INTEGER DEFAULT 0, worktree_path TEXT, source_job_id INTEGER,
      work_item_id INTEGER, status TEXT, kind TEXT, thread_id TEXT, agent_id TEXT, task_title TEXT, branch_name TEXT, latest_activity TEXT,
      activity_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, input_questions TEXT, linked_pr_number INTEGER, head_sha TEXT,
      diff_files TEXT, diff_additions INTEGER DEFAULT 0, diff_deletions INTEGER DEFAULT 0);
    INSERT INTO repositories (id,full_name) VALUES (1,'example/repo'),(2,'example/other');
  `)
  ensureWorkSchema(db)
  return drizzleDashboardDatabase(db)
}

describe('WorkService', () => {
  it('resolves a Work decision by clearing attention and recording the action', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, githubProviders)
    work.initialize()
    const item = work.create({ title: 'Needs a decision', repositoryId: 1 })!
    db.$client.prepare('UPDATE work_items SET attention=? WHERE id=?').run('Choose a rollout path', item.id)

    expect(work.update(item.id, { resolve_attention: true })?.attention).toBeNull()
    expect(work.get(item.id)?.events).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: 'updated' })]))
  })

  it('exposes linked thread change evidence on the Work item', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, githubProviders)
    work.initialize()
    const item = work.create({ title: 'Ship evidence', repositoryId: 1 })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,agent_id,diff_files,diff_additions,diff_deletions)
      VALUES (11,1,?,'completed','task','codex',?,12,4)`)
      .run(item.id, JSON.stringify([{ path: 'src/example.ts' }]))
    expect(work.get(item.id)?.threads[0]).toMatchObject({
      id: 11,
      diff_files: '[{"path":"src/example.ts"}]',
      diff_additions: 12,
      diff_deletions: 4,
    })
  })

  it('lists compact board summaries without event history or raw diff payloads', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, githubProviders)
    work.initialize()
    const item = work.create({ title: 'Fast board', repositoryId: 1 })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,agent_id,diff_files,diff_additions,diff_deletions)
      VALUES (12,1,?,'completed','task','codex',?,7,2)`)
      .run(item.id, JSON.stringify([{ path: 'src/large.ts' }]))
    db.$client
      .prepare(`INSERT INTO work_events (work_item_id,event_type,summary,payload)
      VALUES (?,'job_finished','Finished','{}')`)
      .run(item.id)

    const [summary] = work.listSummaries()

    expect(summary).toMatchObject({
      id: item.id,
      title: 'Fast board',
      repository_names: ['example/repo'],
      events: [],
      relations: [],
      context_transfers: [],
    })
    expect(summary.threads[0]).toMatchObject({ id: 12, diff_additions: 7, diff_deletions: 2 })
    expect(summary.threads[0]).not.toHaveProperty('diff_files')
    expect(work.get(item.id)?.events.length).toBeGreaterThan(0)
  })

  it('reduces job activity to a bounded plain-text preview in board summaries', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, githubProviders)
    work.initialize()
    const item = work.create({ title: 'Compact activity', repositoryId: 1 })!
    const activity = `## Review summary\n\n[Useful context](https://example.com)\n\n\`\`\`ts\n${'const value = true\\n'.repeat(100)}\`\`\`\n${'Long result '.repeat(100)}`
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,agent_id,latest_activity)
      VALUES (13,1,?,'completed','review','codex',?)`)
      .run(item.id, activity)

    const [summary] = work.listSummaries()

    expect(summary.threads[0].latest_activity).toMatch(/^Useful context Code change Long result/)
    expect(summary.threads[0].latest_activity.length).toBeLessThanOrEqual(360)
    expect(work.get(item.id)?.threads[0].latest_activity).toBe(activity)
  })

  it('allows one pull request to be linked as separate implementation and review work', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, githubProviders)
    work.initialize()
    const repo = { id: 1, full_name: 'example/repo' }
    const pr = {
      number: 42,
      title: 'feat: example',
      url: 'https://github.com/example/repo/pull/42',
      draft: 0,
      review_decision: null,
      head_sha: 'abc',
    }
    const implementation = work.create({ title: 'Build example', repositoryId: 1 })!
    work.ensurePullRequestDelivery(implementation.id, repo, pr)
    const review = work.ensurePullRequestReview(repo, pr)
    expect(review.id).not.toBe(implementation.id)
    expect(work.get(implementation.id)?.resources[0].role).toBe('delivery')
    expect(work.get(review.id)?.resources[0].role).toBe('review_subject')
  })

  it('projects review work from backlog through active and review', () => {
    const item = { kind: 'pr_review', state: 'backlog', state_override: null }
    expect(projectedWorkState(item, [], [{ kind: 'pull_request', state: 'open' }])).toBe('backlog')
    expect(projectedWorkState(item, [{ status: 'running', kind: 'review' }], [])).toBe('active')
    expect(projectedWorkState(item, [{ status: 'completed', kind: 'review' }], [])).toBe('review')
  })

  it('uses the least advanced directly linked pull request for review completion', () => {
    const item = { kind: 'pr_review', state: 'review', state_override: null }
    const reviewed = [{ status: 'completed', kind: 'review' }]
    const approved = { kind: 'pull_request', role: 'review_subject', state: 'approved' }
    const open = { kind: 'pull_request', role: 'review_subject', state: 'open' }

    expect(projectedWorkState(item, reviewed, [approved, open])).toBe('review')
    expect(projectedWorkState(item, reviewed, [approved, { ...open, state: 'merged' }])).toBe('done')
  })

  it('does not let contextual pull requests hold back direct delivery', () => {
    const item = { kind: 'implementation', state: 'review', state_override: null }
    const direct = { kind: 'pull_request', role: 'delivery', state: 'merged' }
    const context = { kind: 'pull_request', role: 'context', state: 'open' }

    expect(projectedWorkState(item, [], [direct, context])).toBe('done')
  })

  it('reopens a completed review when the pull request head changes', () => {
    const item = { kind: 'pr_review', state: 'done', state_override: null }
    const jobs = [{ status: 'completed', kind: 'review', head_sha: 'old' }]
    const resources = [{ kind: 'pull_request', state: 'approved', metadata: { headSha: 'new' } }]
    expect(projectedWorkState(item, jobs, resources)).toBe('review')
  })

  it('finishes merged implementation work unless a tracked deployment is still running', () => {
    const item = { kind: 'implementation', state: 'deploy', state_override: null }
    const pullRequest = { kind: 'pull_request', state: 'merged' }
    expect(projectedWorkState(item, [], [pullRequest])).toBe('done')
    expect(projectedWorkState(item, [], [pullRequest, { kind: 'deployment', state: 'waiting' }])).toBe('deploy')
    expect(projectedWorkState(item, [], [pullRequest, { kind: 'deployment', state: 'deployed' }])).toBe('done')
  })

  it('waits for every scoped repository before completing a shared outcome', () => {
    const item = { kind: 'implementation', state: 'review', state_override: null }
    const scopes = [
      { kind: 'repository', repository_id: 1 },
      { kind: 'repository', repository_id: 2 },
    ]
    const firstMerged = { kind: 'pull_request', repository_id: 1, state: 'merged' }
    expect(projectedWorkState(item, [], [...scopes, firstMerged])).toBe('review')
    const secondOpen = { kind: 'pull_request', repository_id: 2, state: 'open' }
    expect(projectedWorkState(item, [], [...scopes, firstMerged, secondOpen])).toBe('review')
    const secondMerged = { ...secondOpen, state: 'merged' }
    expect(projectedWorkState(item, [], [...scopes, firstMerged, secondMerged])).toBe('done')
    expect(
      projectedWorkState(item, [], [...scopes, firstMerged, secondMerged, { kind: 'deployment', repository_id: 1, state: 'deployed' }]),
    ).toBe('done')
    expect(
      projectedWorkState(
        item,
        [],
        [
          ...scopes,
          firstMerged,
          secondMerged,
          { kind: 'deployment', repository_id: 1, state: 'deployed' },
          { kind: 'deployment', repository_id: 2, state: 'deployed' },
        ],
      ),
    ).toBe('done')
  })

  it('tracks multiple repositories on one Work item', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const item = work.create({ title: 'Cross-repository change' })!
    work.linkRepository(item.id, { id: 1, full_name: 'example/repo' })
    work.linkRepository(item.id, { id: 2, full_name: 'example/other' })
    expect(work.get(item.id)?.primary_repository_id).toBe(1)
    expect(work.get(item.id)?.repository_names).toEqual(['example/repo', 'example/other'])
  })

  it('stores repository, pull-request, and deployment resources under selected providers', () => {
    const db = database()
    const work = new WorkService(db as any, undefined, {
      scm: (repository) => ({
        id: 'gitlab',
        repositoryUrl: `https://gitlab.example/${repository.full_name}`,
      }),
      deployment: () => ({ id: 'buildkite' }),
    })
    work.initialize()
    const repository = { id: 1, full_name: 'example/repo' }
    const item = work.create({ title: 'Provider-neutral delivery', repositoryId: repository.id })!
    work.linkRepository(item.id, repository)
    work.ensurePullRequestDelivery(item.id, repository, {
      number: 42,
      title: 'Provider-neutral PR',
      url: 'https://gitlab.example/example/repo/-/merge_requests/42',
      head_sha: 'abc',
      merged_at: '2026-07-21',
      merge_sha: 'merged-abc',
    })
    work.syncPullRequest(repository, {
      number: 42,
      title: 'Provider-neutral PR',
      url: 'https://gitlab.example/example/repo/-/merge_requests/42',
      head_sha: 'abc',
      merged_at: '2026-07-21',
      merge_sha: 'merged-abc',
    })
    work.syncDeploymentOverview(repository.full_name, [
      {
        name: 'web',
        runs: [
          {
            sha: 'merged-abc',
            run_id: 9,
            url: 'https://buildkite.example/builds/9',
            stages: { prd: { conclusion: 'success' } },
          },
        ],
      },
    ])

    expect(work.get(item.id)?.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'gitlab',
          kind: 'repository',
          url: 'https://gitlab.example/example/repo',
        }),
        expect.objectContaining({ provider: 'gitlab', kind: 'pull_request' }),
        expect.objectContaining({ provider: 'buildkite', kind: 'deployment', state: 'deployed' }),
      ]),
    )
  })

  it('clears manual board overrides when every delivery pull request merges', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const repository = { id: 1, full_name: 'example/repo' }
    const item = work.create({ title: 'Finish after merge', repositoryId: repository.id })!
    work.linkRepository(item.id, repository)
    work.update(item.id, { state: 'review', reason: 'Moved on the board' })
    work.ensurePullRequestDelivery(item.id, repository, {
      number: 42,
      title: 'Delivery',
      url: 'https://github.com/example/repo/pull/42',
      head_sha: 'abc',
    })

    work.syncPullRequest(repository, {
      number: 42,
      title: 'Delivery',
      url: 'https://github.com/example/repo/pull/42',
      head_sha: 'abc',
      merged_at: '2026-07-29',
      merge_sha: 'merged-abc',
    })

    expect(work.raw(item.id)).toMatchObject({
      state: 'done',
      state_override: null,
      state_override_reason: null,
    })
  })

  it('keeps merged work in delivery until its tracked deployment succeeds', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const repository = { id: 1, full_name: 'example/repo' }
    const item = work.create({ title: 'Track delivery', repositoryId: repository.id })!
    work.linkRepository(item.id, repository)
    work.ensurePullRequestDelivery(item.id, repository, {
      number: 42,
      title: 'Delivery',
      url: 'https://github.com/example/repo/pull/42',
      head_sha: 'abc',
    })
    work.linkResource(item.id, {
      provider: 'github',
      kind: 'deployment',
      externalId: 'example/repo:web:abc',
      role: 'delivery',
      label: 'web deployment',
      repositoryId: repository.id,
      state: 'waiting',
    })

    work.syncPullRequest(repository, {
      number: 42,
      title: 'Delivery',
      url: 'https://github.com/example/repo/pull/42',
      head_sha: 'abc',
      merged_at: '2026-08-03',
      merge_sha: 'merged-abc',
    })

    expect(work.raw(item.id)).toMatchObject({ state: 'deploy', state_override: null })
    work.linkResource(item.id, {
      provider: 'github',
      kind: 'deployment',
      externalId: 'example/repo:web:abc',
      role: 'delivery',
      label: 'web deployment',
      repositoryId: repository.id,
      state: 'deployed',
    })
    expect(work.get(item.id)?.state).toBe('done')
  })

  it('exposes whether a linked worktree has been removed', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const item = work.create({ title: 'Preview repository', repositoryId: 1 })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,worktree_removed_at)
      VALUES (31,1,?,'completed','task','2026-07-21 12:00:00')`)
      .run(item.id)

    expect(work.get(item.id)?.threads[0].worktree_removed_at).toBe('2026-07-21 12:00:00')
  })

  it('persists the sequential execution preference on a Work item', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const ordered = work.create({ title: 'Ordered work', sequentialExecution: true })!
    const direct = work.create({ title: 'Direct work' })!
    expect(ordered.sequential_execution).toBe(true)
    expect(direct.sequential_execution).toBe(false)
    expect(db.$client.prepare('SELECT sequential_execution FROM work_items WHERE id=?').get(ordered.id)).toEqual({
      sequential_execution: 1,
    })
  })

  it('keeps manual state overrides explicit', () => {
    expect(projectedWorkState({ kind: 'implementation', state: 'active', state_override: 'done' }, [{ status: 'running' }], [])).toBe(
      'done',
    )
  })

  it('keeps upfront reviews outside the delivery lifecycle', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const item = work.create({ title: 'Review before implementation' })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,thread_id,worktree_path)
      VALUES (30,1,?,'running','work_review','thread-review','/tmp/review')`)
      .run(item.id)

    work.attachUpfrontReviewJob(item.id, 30, 'example/repo')

    expect(work.get(item.id)?.state).toBe('backlog')
    expect(work.get(item.id)?.events[0]).toMatchObject({
      event_type: 'upfront_review_started',
      summary: 'Started upfront review for example/repo',
    })
  })

  it('tracks a cross-worktree child independently from its destination job', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    const source = work.create({ title: 'Source investigation', repositoryId: 1 })!
    const destination = work.create({ title: 'Destination implementation', repositoryId: 2 })!
    const child = work.create({ title: 'Apply source findings', state: 'active', repositoryId: 2 })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,work_item_id,status,kind,thread_id,worktree_path)
      VALUES (10,1,?,'completed','task','source-thread','/tmp/source'),(20,2,?,'completed','task','destination-thread','/tmp/destination')`)
      .run(source.id, destination.id)
    const transfer = work.createContextTransfer({
      workItemId: child.id,
      sourceWorkItemId: source.id,
      destinationWorkItemId: destination.id,
      sourceJobId: 10,
      destinationJobId: 20,
      instruction: 'Apply the findings',
      contextSnapshot: 'Source output',
    })!
    work.startContextTransfer(transfer.id)
    expect(work.get(child.id)?.context_transfers[0]).toMatchObject({
      status: 'running',
      source_job_id: 10,
      destination_job_id: 20,
    })
    expect(db.$client.prepare('SELECT work_item_id FROM jobs WHERE id=20').get()).toEqual({
      work_item_id: destination.id,
    })

    expect(work.finishContextTransfers(20, true, 'Destination outcome')).toBe(1)
    expect(work.get(child.id)).toMatchObject({ state: 'done', attention: null })
    expect(work.contextTransfer(transfer.id)).toMatchObject({
      status: 'completed',
      output_snapshot: 'Destination outcome',
    })
    expect(work.get(child.id)?.events[0]).toMatchObject({
      event_type: 'context_transfer_completed',
    })
  })

  it('deletes the Work graph without deleting repository or pull-request records', () => {
    const db = database()
    const work = new WorkService(db as any)
    work.initialize()
    db.$client
      .prepare(`INSERT INTO pull_requests (id,repo_id,number,title,url,draft,head_sha)
      VALUES (1,1,42,'Preserved PR','https://github.com/example/repo/pull/42',0,'abc')`)
      .run()
    const item = work.create({ title: 'Disposable coordination record', repositoryId: 1 })!
    work.ensurePullRequestDelivery(
      item.id,
      { id: 1, full_name: 'example/repo' },
      {
        number: 42,
        title: 'Preserved PR',
        url: 'https://github.com/example/repo/pull/42',
        head_sha: 'abc',
      },
    )
    expect(work.permanentlyDelete(item.id)).toBe(true)
    expect(work.raw(item.id)).toBeNull()
    expect(db.$client.prepare('SELECT COUNT(*) AS count FROM work_events WHERE work_item_id=?').get(item.id)).toEqual({
      count: 0,
    })
    expect(db.$client.prepare('SELECT title FROM pull_requests WHERE id=1').get()).toEqual({
      title: 'Preserved PR',
    })
    expect(db.$client.prepare('SELECT full_name FROM repositories WHERE id=1').get()).toEqual({
      full_name: 'example/repo',
    })
  })
})
