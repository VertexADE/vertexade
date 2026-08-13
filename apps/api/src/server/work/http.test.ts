import { describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { handleWorkApi } from './http.ts'
import { WorkService } from './service.ts'

function setup() {
  const db = openDashboardDatabase(':memory:')
  db.$client
    .prepare(`INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES
    (1,'example/api','ssh://example/api','/tmp/example-api'),
    (2,'example/web','ssh://example/web','/tmp/example-web')`)
    .run()
  const work = new WorkService(db)
  work.initialize()
  return { db, work }
}

describe('Work HTTP API', () => {
  it('launches one Work item agent with every selected repository', async () => {
    const { db, work } = setup()
    const item = work.create({
      title: 'Ship API and web',
      description: 'Implement the shared outcome',
      sequentialExecution: true,
    })!
    const calls: Array<{
      repository: string
      repositories: string[]
      workItemId: number
      workItemKey: string
      workspaceMode: string
      prompt: string
      approvalGated: boolean
      agentId: string
      model: string
      reasoningEffort: string
    }> = []
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${item.id}/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository_ids: [1, 2], prompt: 'Implement the shared outcome' }),
    })
    const handled = await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
      agentContext: () => ({
        agentId: 'custom-agent:reviewer',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      }),
      defaultAgentId: 'codex',
      launchReview: async () => ({}),
      launchRepositoryTask: async (repository, _title, prompt, _createPr, _branchType, _base, options) => {
        calls.push({
          repository: repository.full_name,
          repositories: options.repositories.map((value: any) => value.full_name),
          workItemId: Number(options.workItemId),
          prompt,
          approvalGated: Boolean(options.approvalGated),
          workItemKey: options.workItemKey,
          workspaceMode: options.workspaceMode,
          agentId: options.agentId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
        })
        return { id: 101, repo_id: repository.id }
      },
    } as any)
    expect(handled?.status).toBe(202)
    expect(
      calls.map(({ repository, repositories, workItemId, workItemKey, workspaceMode }) => ({
        repository,
        repositories,
        workItemId,
        workItemKey,
        workspaceMode,
      })),
    ).toEqual([
      {
        repository: 'example/api',
        repositories: ['example/api', 'example/web'],
        workItemId: item.id,
        workItemKey: item.key,
        workspaceMode: 'combined',
      },
    ])
    expect(calls[0].approvalGated).toBe(true)
    expect(calls[0]).toMatchObject({
      agentId: 'custom-agent:reviewer',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    })
    expect(calls[0].prompt).toContain('Your initial turn is planning only')
    expect(calls[0].prompt).toContain('Do not edit files')
    expect(calls[0].prompt).toContain('Begin implementation only after a later user message explicitly approves')
    expect(calls[0].prompt).toContain('exactly one implementation item in progress at a time')
    expect(calls[0].prompt).toContain('Requested outcome:\nImplement the shared outcome')
    expect(response).toMatchObject({
      status: 202,
      value: {
        status: 'started',
        execution_mode: 'sequential',
        threads: [{ id: 101, full_name: 'example/api' }],
        workspace_mode: 'combined',
        errors: [],
      },
    })
    expect(work.get(item.id)?.attention).toBeNull()
    expect(work.get(item.id)?.repository_names).toEqual(['example/api', 'example/web'])
    expect(work.get(item.id)?.events[0]).toMatchObject({
      event_type: 'thread_batch_started',
    })
    expect(work.get(item.id)?.events.find((event: any) => event.event_type === 'sequential_execution_requested')).toMatchObject({
      payload: { repositoryCount: 2, approvalRequired: true },
    })
  })

  it('uses the Work item folder for direct launches when ordered splitting is not selected', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Small fix', sequentialExecution: true })!
    let launchedPrompt = ''
    let approvalGated: unknown
    let workspaceMode: unknown
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${item.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({
        repository_ids: [1],
        prompt: 'Fix the typo',
        split_work_item: false,
      }),
    })
    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
      agentContext: () => ({}),
      defaultAgentId: 'codex',
      launchReview: async () => ({}),
      launchRepositoryTask: async (_repository, _title, prompt, _createPr, _branchType, _base, options) => {
        launchedPrompt = prompt
        approvalGated = options.approvalGated
        workspaceMode = options.workspaceMode
        return { id: 102, repo_id: 1 }
      },
    } as any)
    expect(launchedPrompt).toBe('Fix the typo')
    expect(approvalGated).toBe(false)
    expect(workspaceMode).toBe('combined')
    expect(response).toMatchObject({
      status: 202,
      value: { execution_mode: 'direct', workspace_mode: 'combined' },
    })
    expect(work.get(item.id)?.events.some((event: any) => event.event_type === 'sequential_execution_requested')).toBe(false)
  })

  it('rejects the removed workspace mode field before launching a task', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Invalid workspace mode' })!
    let launched = false
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${item.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({
        repository_ids: [1],
        prompt: 'Do the work',
        workspace_mode: 'repository',
      }),
    })

    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
      agentContext: () => ({}),
      defaultAgentId: 'codex',
      launchReview: async () => ({}),
      launchRepositoryTask: async () => {
        launched = true
        return {}
      },
    } as any)

    expect(response).toEqual({
      status: 400,
      value: { error: 'workspace_mode has been removed; Work threads always use the Work item folder' },
    })
    expect(launched).toBe(false)
  })

  it('saves the sequential preference while creating a Work item', async () => {
    const { db, work } = setup()
    let response: { status: number; value: any } | undefined
    const request = new Request('http://localhost/api/work-items', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Ordered delivery',
        repository_ids: [1],
        split_work_item: true,
      }),
    })
    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
    } as any)
    expect(response).toMatchObject({
      status: 201,
      value: { title: 'Ordered delivery', sequential_execution: true },
    })
  })

  it('adds a pull request to Work once when its review flow opens', async () => {
    const { db, work } = setup()
    db.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,draft,review_decision,head_sha)
      VALUES (1,42,'feat: tracked review','https://example.test/example/api/pull/42',0,NULL,'abc')`)
      .run()
    const request = new Request('http://localhost/api/pulls/1/42/work', {
      method: 'POST',
      body: '{}',
    })
    let response: { status: number; value: any } | undefined
    const dependencies = {
      work,
      db: db as any,
      body: (input: Request) => input.json(),
      json: (status: number, value: any) => {
        response = { status, value }
        return Response.json(value, { status })
      },
    } as any

    await handleWorkApi(request, new URL(request.url), dependencies)
    const firstId = response?.value.id
    await handleWorkApi(request, new URL(request.url), dependencies)

    expect(response).toMatchObject({
      status: 201,
      value: {
        id: firstId,
        kind: 'pr_review',
        archived_at: null,
        resources: [expect.objectContaining({ role: 'review_subject', external_id: 'example/api#42' })],
      },
    })
    expect(work.list()).toHaveLength(1)
  })

  it('rejects an empty sequential launch before adding orchestration instructions', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Missing outcome' })!
    let launched = false
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${item.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({ repository_ids: [1], prompt: '   ', split_work_item: true }),
    })
    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
      agentContext: () => ({}),
      defaultAgentId: 'codex',
      launchReview: async () => ({}),
      launchRepositoryTask: async () => {
        launched = true
        return {}
      },
    } as any)
    expect(response).toMatchObject({
      status: 400,
      value: { error: 'A task prompt is required to start a thread' },
    })
    expect(launched).toBe(false)
  })

  it('reviews only selected implementation worktrees from the Work item', async () => {
    const { db, work } = setup()
    const item = work.create({
      title: 'Harden repository environments',
      description: 'Copy isolated snapshots into worktrees.',
    })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,pr_number,prompt,log_path,work_item_id,status,kind,worktree_path,branch_name,head_sha)
      VALUES (11,1,0,'test','/tmp/11.log',?,'completed','pre_pr','/tmp/api-worktree','feature/api','abc'),
             (12,2,0,'test','/tmp/12.log',?,'resumable','task','/tmp/web-worktree','feature/web','def'),
             (13,1,0,'test','/tmp/13.log',?,'completed','work_review','/tmp/old-review',NULL,'abc')`)
      .run(item.id, item.id, item.id)
    const calls: Array<Record<string, any>> = []
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${item.id}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ source_job_ids: [11, 12], focus: 'Check secret handling.' }),
    })

    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        response = { status, value }
        return Response.json(value, { status })
      },
      agentContext: () => ({ agentId: 'claude-code', model: 'opus', reasoningEffort: 'high' }),
      defaultAgentId: 'codex',
      launchWorktreeReview: async (sourceJobId, options) => {
        calls.push({ sourceJobId, options })
        return { id: 200 + sourceJobId, kind: 'work_review' }
      },
    } as any)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      sourceJobId: 11,
      options: {
        workItemId: item.id,
        focus: 'Check secret handling.',
        agentId: 'claude-code',
        model: 'opus',
        reasoningEffort: 'high',
      },
    })
    expect(response).toMatchObject({
      status: 202,
      value: {
        status: 'started',
        threads: [
          { id: 211, full_name: 'example/api', source_job_id: 11 },
          { id: 212, full_name: 'example/web', source_job_id: 12 },
        ],
        errors: [],
      },
    })
    expect(work.get(item.id)?.events[0]).toMatchObject({
      event_type: 'upfront_review_batch_started',
    })
  })

  it('rejects running, review, and foreign Work item worktrees', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Review implementation' })!
    const other = work.create({ title: 'Other work' })!
    db.$client
      .prepare(`INSERT INTO jobs (id,repo_id,pr_number,prompt,log_path,work_item_id,status,kind,worktree_path)
      VALUES (21,1,0,'test','/tmp/21.log',?,'running','pre_pr','/tmp/running'),
             (22,1,0,'test','/tmp/22.log',?,'completed','work_review','/tmp/review'),
             (23,1,0,'test','/tmp/23.log',?,'completed','pre_pr','/tmp/foreign')`)
      .run(item.id, item.id, other.id)
    const responses: Array<{ status: number; value: any }> = []
    for (const sourceJobId of [21, 22, 23]) {
      const request = new Request(`http://localhost/api/work-items/${item.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ source_job_ids: [sourceJobId] }),
      })
      await handleWorkApi(request, new URL(request.url), {
        work,
        db: db as any,
        body: (input) => input.json(),
        json: (status, value) => {
          responses.push({ status, value })
          return Response.json(value, { status })
        },
      } as any)
    }
    expect(responses).toHaveLength(3)
    for (const response of responses)
      expect(response).toMatchObject({
        status: 400,
        value: { error: 'One or more selected worktrees are not reviewable Work item worktrees' },
      })
  })

  it('previews deletion and requires the exact Work key before cleanup', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Disposable work' })!
    const preview = {
      work_item: { id: item.id, key: item.key, title: item.title },
      threads: { total: 0, active: 0 },
      worktrees: [],
      local_branches: [],
      logs: 0,
      logs_retained: 0,
      preserved_pull_requests: [],
      preserves: { repositories: true, pull_requests: true, remote_branches: true } as const,
    }
    let deleteCalls = 0
    const responses: Array<{ status: number; value: any }> = []
    const dependencies = {
      work,
      db: db as any,
      body: (input: Request) => input.json(),
      json: (status: number, value: any) => {
        responses.push({ status, value })
        return Response.json(value, { status })
      },
      previewWorkDeletion: () => preview,
      deleteWorkItem: async () => {
        deleteCalls += 1
        return { deleted: true, work_item_key: item.key, errors: [] }
      },
    } as any

    const previewRequest = new Request(`http://localhost/api/work-items/${item.key}/delete-preview`)
    expect((await handleWorkApi(previewRequest, new URL(previewRequest.url), dependencies))?.status).toBe(200)
    expect(responses.at(-1)).toMatchObject({
      status: 200,
      value: { work_item: { key: item.key }, preserves: { pull_requests: true } },
    })

    const rejected = new Request(`http://localhost/api/work-items/${item.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: false }),
    })
    await handleWorkApi(rejected, new URL(rejected.url), dependencies)
    expect(responses.at(-1)).toMatchObject({
      status: 400,
      value: { error: 'Confirm permanent Work deletion before continuing' },
    })
    expect(deleteCalls).toBe(0)

    const confirmed = new Request(`http://localhost/api/work-items/${item.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: true }),
    })
    await handleWorkApi(confirmed, new URL(confirmed.url), dependencies)
    expect(responses.at(-1)).toMatchObject({
      status: 200,
      value: { deleted: true, work_item_key: item.key },
    })
    expect(deleteCalls).toBe(1)
  })

  it('requires the Work key before detaching a blocked cleanup artifact', async () => {
    const { db, work } = setup()
    const responses: Array<{ status: number; value: any }> = []
    const detachCleanupArtifact = vi.fn((artifactId: number, workItemKey: string) =>
      artifactId === 42 && workItemKey === 'W-0042' ? { id: artifactId, state: 'detached' } : null,
    )
    const dependencies = {
      work,
      db: db as any,
      body: (input: Request) => input.json(),
      json: (status: number, value: any) => {
        responses.push({ status, value })
        return Response.json(value, { status })
      },
      detachCleanupArtifact,
    } as any

    const missingConfirmation = new Request('http://localhost/api/work-cleanup/artifacts/42', {
      method: 'DELETE',
      body: JSON.stringify({}),
    })
    await handleWorkApi(missingConfirmation, new URL(missingConfirmation.url), dependencies)
    expect(responses.at(-1)).toMatchObject({ status: 400 })
    expect(detachCleanupArtifact).not.toHaveBeenCalled()

    const confirmed = new Request('http://localhost/api/work-cleanup/artifacts/42', {
      method: 'DELETE',
      body: JSON.stringify({ work_item_key: 'W-0042' }),
    })
    await handleWorkApi(confirmed, new URL(confirmed.url), dependencies)
    expect(responses.at(-1)).toMatchObject({ status: 200, value: { detached: true, artifact: { id: 42 } } })
    expect(detachCleanupArtifact).toHaveBeenCalledWith(42, 'W-0042')
  })

  it('previews and permanently deletes a validated batch in selection order', async () => {
    const { db, work } = setup()
    const first = work.create({ title: 'First disposable item' })!
    const second = work.create({ title: 'Second disposable item' })!
    const deletedIds: number[] = []
    const responses: Array<{ status: number; value: any }> = []
    const dependencies = {
      work,
      db: db as any,
      body: (input: Request) => input.json(),
      json: (status: number, value: any) => {
        responses.push({ status, value })
        return Response.json(value, { status })
      },
      previewWorkDeletion: (id: number) => {
        const item = work.raw(id)!
        return {
          work_item: { id, key: item.key, title: item.title },
          threads: { total: 0, active: 0 },
          worktrees: [],
          local_branches: [],
          logs: 0,
          logs_retained: 0,
          memory_file: false,
          preserved_pull_requests: [],
          preserves: { repositories: true, pull_requests: true, remote_branches: true },
        }
      },
      deleteWorkItem: async (id: number) => {
        const item = work.raw(id)!
        deletedIds.push(id)
        return {
          deleted: id === first.id,
          work_item_key: item.key,
          threads_deleted: 0,
          worktrees_removed: 0,
          local_branches_deleted: 0,
          logs_deleted: 0,
          logs_retained: 0,
          provider_threads_retained: 0,
          memory_deleted: false,
          shared_worktrees_retained: 0,
          shared_branches_retained: 0,
          preserved_pull_requests: [],
          errors: id === first.id ? [] : [{ target: item.key, error: 'Still active' }],
        }
      },
    } as any

    const preview = new Request('http://localhost/api/work-items/delete-preview', {
      method: 'POST',
      body: JSON.stringify({ work_item_ids: [second.id, first.id] }),
    })
    await handleWorkApi(preview, new URL(preview.url), dependencies)
    expect(responses.at(-1)).toMatchObject({
      status: 200,
      value: { items: [{ work_item: { key: second.key } }, { work_item: { key: first.key } }] },
    })

    const rejected = new Request('http://localhost/api/work-items', {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: true, work_item_ids: [first.id, 999] }),
    })
    await handleWorkApi(rejected, new URL(rejected.url), dependencies)
    expect(responses.at(-1)).toMatchObject({ status: 409, value: { error: 'Work item #999 was not found' } })
    expect(deletedIds).toEqual([])

    const confirmed = new Request('http://localhost/api/work-items', {
      method: 'DELETE',
      body: JSON.stringify({ confirmed: true, work_item_ids: [second.id, first.id] }),
    })
    await handleWorkApi(confirmed, new URL(confirmed.url), dependencies)
    expect(deletedIds).toEqual([second.id, first.id])
    expect(responses.at(-1)).toMatchObject({
      status: 200,
      value: {
        requested: 2,
        deleted: 1,
        failed: 1,
        results: [
          { work_item_key: second.key, deleted: false },
          { work_item_key: first.key, deleted: true },
        ],
      },
    })
  })

  it('bulk-cleans merged worktrees', async () => {
    const { db, work } = setup()
    const responses: Array<{ status: number; value: any }> = []
    const removeMergedWorktrees = vi.fn(async () => ({
      removed: 2,
      paths: ['/managed/one', '/managed/two'],
      errors: [],
    }))
    const dependencies = {
      work,
      db: db as any,
      body: (request: Request) => request.json(),
      json: (status: number, value: any) => {
        responses.push({ status, value })
        return Response.json(value, { status })
      },
      removeMergedWorktrees,
    } as any

    const cleanup = new Request('http://localhost/api/worktrees/cleanup-merged', { method: 'POST' })
    await handleWorkApi(cleanup, new URL(cleanup.url), dependencies)
    expect(removeMergedWorktrees).toHaveBeenCalledOnce()
    expect(responses.at(-1)).toMatchObject({ status: 200, value: { removed: 2 } })
  })

  it('starts a cross-worktree sub-item from a source work item', async () => {
    const { db, work } = setup()
    const source = work.create({ title: 'Source work' })!
    let received: Record<string, unknown> | undefined
    let expectedSourceWorkItemId: number | null | undefined
    let response: { status: number; value: any } | undefined
    const request = new Request(`http://localhost/api/work-items/${source.key}/sub-items`, {
      method: 'POST',
      body: JSON.stringify({
        source_job_id: 10,
        destination_job_id: 20,
        title: 'Apply findings',
        instruction: 'Use the source output',
      }),
    })
    expect(
      (
        await handleWorkApi(request, new URL(request.url), {
          work,
          db: db as any,
          body: (input) => input.json(),
          json: (status, value) => {
            response = { status, value }
            return Response.json(value, { status })
          },
          followUpInWorktree: async (input, workItemId) => {
            received = input
            expectedSourceWorkItemId = workItemId
            return { workItem: { id: 3 }, destinationJobId: 20, transferId: 1, status: 'running' }
          },
        } as any)
      )?.status,
    ).toBe(202)
    expect(expectedSourceWorkItemId).toBe(source.id)
    expect(received).toEqual({
      sourceJobId: 10,
      destinationJobId: 20,
      title: 'Apply findings',
      instruction: 'Use the source output',
    })
    expect(response).toMatchObject({
      status: 202,
      value: { destinationJobId: 20, status: 'running' },
    })
  })

  it('reads and updates the shared Work memory through the Work route', async () => {
    const { db, work } = setup()
    const item = work.create({ title: 'Remember decisions' })!
    const responses: Array<{ status: number; value: any }> = []
    let maximumBodyBytes: number | undefined
    const memory = {
      read: async () => ({ workItemId: item.id, content: 'current' }),
      write: async (_id: number, content: string) => ({ workItemId: item.id, content }),
    }
    const dependencies = {
      work,
      memory,
      db: db as any,
      body: async (input: Request, maxBytes?: number) => {
        maximumBodyBytes = maxBytes
        return input.json()
      },
      json: (status: number, value: any) => {
        responses.push({ status, value })
        return Response.json(value, { status })
      },
    } as any
    const read = new Request(`http://localhost/api/work-items/${item.key}/memory`)
    await handleWorkApi(read, new URL(read.url), dependencies)
    expect(responses.at(-1)).toMatchObject({ status: 200, value: { content: 'current' } })

    const update = new Request(`http://localhost/api/work-items/${item.id}/memory`, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'new shared context' }),
    })
    await handleWorkApi(update, new URL(update.url), dependencies)
    expect(maximumBodyBytes).toBe(1_300_000)
    expect(responses.at(-1)).toMatchObject({
      status: 200,
      value: { content: 'new shared context' },
    })
  })

  it('persists cross-system references and gives their combined context to launched threads', async () => {
    const { db, work } = setup()
    const references = [
      {
        provider: 'linear',
        kind: 'issue',
        externalId: 'lin-1',
        label: 'ENG-42: Faster checkout',
        url: 'https://linear.app/issue/ENG-42',
        summary: 'Reduce checkout latency',
        metadata: { acceptance: 'Loads in under one second' },
      },
      {
        provider: 'coderabbit',
        kind: 'finding',
        externalId: 'review-8',
        label: 'Review finding',
        state: 'open',
        metadata: { file: 'src/cart.ts', line: 12 },
      },
    ]
    let created: any
    const create = new Request('http://localhost/api/work-items', {
      method: 'POST',
      body: JSON.stringify({ title: 'Checkout outcome', repository_ids: [1], references }),
    })
    await handleWorkApi(create, new URL(create.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => {
        created = value
        return Response.json(value, { status })
      },
    } as any)
    expect(created.resources.find((resource: any) => resource.provider === 'linear')).toMatchObject({
      provider: 'linear',
      external_id: 'lin-1',
      metadata: { acceptance: 'Loads in under one second' },
    })
    expect(created.resources.find((resource: any) => resource.provider === 'coderabbit')).toMatchObject({
      provider: 'coderabbit',
      external_id: 'review-8',
    })

    let launchedPrompt = ''
    const launch = new Request(`http://localhost/api/work-items/${created.id}/threads`, {
      method: 'POST',
      body: JSON.stringify({
        repository_ids: [1],
        prompt: 'Deliver the checkout outcome',
        references: [references[0]],
        replace_context_references: true,
      }),
    })
    await handleWorkApi(launch, new URL(launch.url), {
      work,
      db: db as any,
      body: (input) => input.json(),
      json: (status, value) => Response.json(value, { status }),
      agentContext: () => ({}),
      defaultAgentId: 'codex',
      launchReview: async () => ({}),
      launchRepositoryTask: async (_repository, _title, prompt) => {
        launchedPrompt = prompt
        return { id: 14, repo_id: 1 }
      },
    } as any)
    expect(launchedPrompt).toContain('## Linked context')
    expect(launchedPrompt).toContain('Loads in under one second')
    expect(launchedPrompt).toContain('<untrusted_work_references>')
    expect(launchedPrompt).not.toContain('review-8')
    expect(work.get(created.id)?.resources.filter((resource: any) => resource.role === 'context')).toHaveLength(1)
  })

  it('aggregates available Work reference providers without hiding healthy systems', async () => {
    const { db, work } = setup()
    let response: any
    let forced = false
    const request = new Request('http://localhost/api/work-references?query=checkout&force_refresh=1')
    await handleWorkApi(request, new URL(request.url), {
      work,
      db: db as any,
      json: (status, value) => {
        response = value
        return Response.json(value, { status })
      },
      referenceProviders: () => [
        {
          id: 'linear',
          name: 'Linear',
          references: async (query: string, context?: { forceRefresh?: boolean }) => {
            forced = Boolean(context?.forceRefresh)
            return [{ provider: 'linear', kind: 'issue', externalId: '1', label: String(query) }]
          },
        },
        {
          id: 'coderabbit',
          name: 'CodeRabbit',
          references: async () => {
            throw new Error('GitHub unavailable')
          },
        },
      ],
    } as any)
    expect(response.references).toEqual([
      {
        provider: 'linear',
        providerName: 'Linear',
        kind: 'issue',
        externalId: '1',
        label: 'checkout',
      },
    ])
    expect(response.providers).toEqual([
      { id: 'linear', name: 'Linear', available: true },
      { id: 'coderabbit', name: 'CodeRabbit', available: false, error: 'GitHub unavailable' },
    ])
    expect(forced).toBe(true)
  })
})
