import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { CapabilityExecutionService } from './capability-execution.ts'
import { AutomationRecipeService } from './automation-recipes.ts'
import type { TriggerEvent } from '@vertexade/platform-contracts'
import type { AutomationThreadLaunchResult } from './automation-thread-launcher.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

type ThreadLauncher = (
  action: 'work' | 'review' | 'improve',
  prompt: string,
  trigger?: TriggerEvent,
) => Promise<AutomationThreadLaunchResult>

function fixture(maximumSteps = 20, providedLauncher?: ThreadLauncher, maximumConcurrentRuns = 4) {
  const database = openDashboardDatabase(':memory:')
  databases.push(database)
  const launchThread =
    providedLauncher ||
    vi.fn<ThreadLauncher>(async () => {
      database.$client
        .prepare('INSERT OR IGNORE INTO repositories (id,full_name,clone_url,local_path) VALUES (1,?,?,?)')
        .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api')
      database.$client
        .prepare(`INSERT OR IGNORE INTO work_items (id,key,title,kind,state,primary_repository_id)
      VALUES (7,'W-0007','Automation target','implementation','active',1)`)
        .run()
      database.$client
        .prepare(`INSERT OR IGNORE INTO jobs (id,repo_id,work_item_id,pr_number,prompt,worktree_path,log_path,status,kind)
      VALUES (42,1,7,0,'Flow','/tmp/work','/tmp/run.log','running','pre_pr')`)
        .run()
      return { jobId: 42 }
    })
  const registries = new PlatformCapabilityRegistries()
  const notify = vi.fn()
  const queuePrompt = vi.fn()
  const executions = new CapabilityExecutionService(database, registries, notify)
  return {
    database,
    registries,
    notify,
    launchThread,
    queuePrompt,
    recipes: new AutomationRecipeService(
      database,
      registries,
      executions,
      notify,
      () => maximumSteps,
      () => maximumConcurrentRuns,
      launchThread,
      queuePrompt,
    ),
  }
}

describe('automation recipes', () => {
  it('runs ordered queries, transforms, gates, actions, and evidence', async () => {
    const { registries, recipes } = fixture()
    const order: string[] = []
    registries.forModule('inventory').queries.register({
      id: 'inventory.lookup',
      name: 'Lookup',
      query: async () => {
        order.push('query')
        return { sku: ' abc ' }
      },
    })
    registries.forModule('inventory').transforms.register({
      id: 'inventory.normalize',
      name: 'Normalize',
      transform: async (input: { sku: string }) => {
        order.push(`transform:${input.sku}`)
        return { sku: input.sku.trim().toUpperCase() }
      },
    })
    registries.forModule('quality').gates.register({
      id: 'quality.ready',
      name: 'Ready',
      evaluate: async () => {
        order.push('gate')
        return { passed: true, summary: 'Ready' }
      },
    })
    registries.forModule('delivery').actions.register({
      id: 'delivery.run',
      name: 'Run',
      execute: async () => {
        order.push('action')
        return { launched: true }
      },
    })
    registries.forModule('delivery').actions.register({
      id: 'delivery.skip',
      name: 'Skip',
      execute: async () => {
        order.push('should-not-run')
        return null
      },
    })
    registries.forModule('quality').evidence.register({
      id: 'quality.proof',
      name: 'Proof',
      collect: async () => {
        order.push('evidence')
        return { status: 'passed', summary: 'Verified' }
      },
    })
    const saved = recipes.save({
      name: 'Ship safely',
      steps: [
        { kind: 'query', capabilityId: 'inventory.lookup' },
        {
          kind: 'transform',
          capabilityId: 'inventory.normalize',
          inputSource: 'previous',
          conditions: [{ field: 'previous.sku', operator: 'contains', value: 'abc' }],
        },
        { kind: 'gate', capabilityId: 'quality.ready' },
        {
          kind: 'action',
          capabilityId: 'delivery.skip',
          conditions: [{ field: 'previous.passed', operator: 'equals', value: false }],
        },
        { kind: 'action', capabilityId: 'delivery.run' },
        { kind: 'evidence', capabilityId: 'quality.proof' },
      ],
    })!

    await expect(recipes.run(saved.id)).resolves.toMatchObject({ lastStatus: 'succeeded' })
    expect(order).toEqual(['query', 'transform: abc ', 'gate', 'action', 'evidence'])
  })

  it('stops when a gate does not pass', async () => {
    const { registries, recipes } = fixture()
    const action = vi.fn(async () => null)
    registries.forModule('quality').gates.register({
      id: 'quality.ready',
      name: 'Ready',
      evaluate: async () => ({ passed: false, summary: 'Approval required' }),
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    const saved = recipes.save({
      name: 'Ship safely',
      steps: [
        { kind: 'gate', capabilityId: 'quality.ready' },
        { kind: 'action', capabilityId: 'delivery.run' },
      ],
    })!

    await expect(recipes.run(saved.id)).resolves.toMatchObject({
      lastStatus: 'failed',
      lastError: 'Approval required',
    })
    expect(action).not.toHaveBeenCalled()
  })

  it('subscribes enabled recipes to extension triggers', async () => {
    const { registries, recipes } = fixture()
    let emit: ((event: { id: string }) => void) | undefined
    const action = vi.fn(async () => ({ ok: true }))
    registries.forModule('source').triggers.register({
      id: 'source.changed',
      name: 'Changed',
      subscribe: (listener) => {
        emit = listener
      },
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    recipes.save({
      name: 'React to source',
      triggerId: 'source.changed',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })

    await recipes.syncTriggers()
    emit?.({ id: 'event-1' })
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ id: 'event-1' }, expect.objectContaining({ workflowInstanceId: 1 })))
  })

  it('keeps the previous trigger subscription when staging a replacement fails', async () => {
    const { registries, recipes } = fixture()
    let emit: ((event: { id: string }) => void) | undefined
    let subscriptions = 0
    const dispose = vi.fn()
    const action = vi.fn(async () => ({ ok: true }))
    registries.forModule('source').triggers.register({
      id: 'source.changed',
      name: 'Changed',
      subscribe: (listener) => {
        subscriptions += 1
        if (subscriptions === 2) throw new Error('replacement subscription failed')
        emit = listener
        return dispose
      },
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    recipes.save({
      name: 'Keep the existing trigger',
      triggerId: 'source.changed',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })

    await recipes.syncTriggers()
    await expect(recipes.syncTriggers()).rejects.toThrow('replacement subscription failed')
    expect(dispose).not.toHaveBeenCalled()
    emit?.({ id: 'event-after-failure' })
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ id: 'event-after-failure' }, expect.anything()))
  })

  it('keeps recipes with unavailable extension triggers dormant', async () => {
    const { recipes, registries } = fixture()
    registries.forModule('delivery').actions.register({
      id: 'delivery.run',
      name: 'Run',
      execute: async () => ({ ok: true }),
    })
    registries.forModule('optional').triggers.register({
      id: 'optional.changed',
      name: 'Changed',
      subscribe: () => undefined,
    })
    const saved = recipes.save({
      name: 'Optional extension trigger',
      triggerId: 'optional.changed',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })
    registries.removeModule('optional')

    await expect(recipes.syncTriggers()).resolves.toBeUndefined()
    expect(recipes.get(saved!.id)).toMatchObject({ triggerId: 'optional.changed', enabled: true })
  })

  it('launches a triggered automation only once for the same durable event', async () => {
    const { database, registries, recipes } = fixture()
    let emit: ((event: { id: string; data: { revision: string } }) => void) | undefined
    const action = vi.fn(async () => ({ ok: true }))
    registries.forModule('source').triggers.register({
      id: 'source.changed',
      name: 'Changed',
      subscribe: (listener) => {
        emit = listener as typeof emit
      },
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    recipes.save({
      name: 'React once',
      triggerId: 'source.changed',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })
    await recipes.syncTriggers()

    emit?.({ id: 'event-1', data: { revision: 'abc' } })
    emit?.({ id: 'event-1', data: { revision: 'abc' } })

    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(database.$client.prepare('SELECT COUNT(*) AS count FROM automation_flow_runs').get()).toEqual({
      count: 1,
    })
    expect(recipes.getRun(1)).toMatchObject({
      idempotencyKey: 'event:event-1',
      status: 'succeeded',
    })
    expect(recipes.listAuditEvents()).toEqual([
      expect.objectContaining({
        automationRunId: 1,
        recipeId: 1,
        eventType: 'flow_started',
        details: expect.objectContaining({ origin: 'trigger', triggerId: 'source.changed' }),
      }),
    ])
  })

  it('runs triggered recipes only when all conditions match', async () => {
    const { registries, recipes } = fixture()
    let emit:
      | ((event: { id: string; subject: string; data: { reason: string; entity: { priority: string; labels: string[] } } }) => void)
      | undefined
    const action = vi.fn(async () => ({ ok: true }))
    registries.forModule('core').triggers.register({
      id: 'core.work-item-changed',
      name: 'Work changed',
      subscribe: (listener) => {
        emit = listener as typeof emit
      },
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    recipes.save({
      name: 'Urgent backend work',
      triggerId: 'core.work-item-changed',
      conditionMode: 'all',
      conditions: [
        { field: 'data.entity.priority', operator: 'equals', value: 'urgent' },
        { field: 'data.entity.labels', operator: 'contains', value: 'backend' },
      ],
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })
    await recipes.syncTriggers()

    emit?.({
      id: 'event-1',
      subject: 'work-item:1',
      data: { reason: 'work_item_updated', entity: { priority: 'normal', labels: ['backend'] } },
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(action).not.toHaveBeenCalled()

    emit?.({
      id: 'event-2',
      subject: 'work-item:1',
      data: { reason: 'work_item_updated', entity: { priority: 'urgent', labels: ['backend'] } },
    })
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1))
  })

  it('supports any-match conditions and validates condition input', async () => {
    const { registries, recipes } = fixture()
    let emit: ((event: { data: { reason: string } }) => void) | undefined
    const action = vi.fn(async () => ({ ok: true }))
    registries.forModule('core').triggers.register({
      id: 'core.platform-event',
      name: 'Platform event',
      subscribe: (listener) => {
        emit = listener as typeof emit
      },
    })
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: action })
    recipes.save({
      name: 'Review or failure',
      triggerId: 'core.platform-event',
      conditionMode: 'any',
      conditions: [
        { field: 'data.reason', operator: 'equals', value: 'review_batch_completed' },
        { field: 'data.reason', operator: 'ends_with', value: '_failed' },
      ],
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })
    await recipes.syncTriggers()
    emit?.({ data: { reason: 'job_failed' } })
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1))

    expect(() =>
      recipes.save({
        name: 'Unsafe field',
        triggerId: 'core.platform-event',
        conditions: [{ field: 'data.__proto__.polluted', operator: 'exists' }],
        steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
      }),
    ).toThrow('Condition fields must start')
  })

  it('enforces the configured maximum recipe size', () => {
    const { registries, recipes } = fixture(1)
    registries.forModule('delivery').actions.register({ id: 'delivery.run', name: 'Run', execute: async () => null })
    expect(() =>
      recipes.save({
        name: 'Too large',
        steps: [
          { kind: 'action', capabilityId: 'delivery.run' },
          { kind: 'action', capabilityId: 'delivery.run' },
        ],
      }),
    ).toThrow('up to 1 capability steps')
  })

  it('starts a defined thread outcome with the trigger context and custom prompt', async () => {
    const { registries, recipes, launchThread } = fixture()
    let emit: ((event: { id: string; subject: string; data: { reason: string; entityType: string; entityId: number } }) => void) | undefined
    registries.forModule('core').triggers.register({
      id: 'core.work-item-created',
      name: 'Work created',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['work-item'] } },
      },
      subscribe: (listener) => {
        emit = listener as typeof emit
      },
    })
    const saved = recipes.save({
      name: 'Implement urgent work',
      triggerId: 'core.work-item-created',
      threadAction: 'work',
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      promptSteps: [{ name: 'Work', prompt: 'Implement the item and verify the result.' }],
      steps: [],
    })!

    await recipes.syncTriggers()
    const event = {
      id: 'event-1',
      subject: 'work-item:7',
      data: { reason: 'work_item_created', entityType: 'work-item', entityId: 7 },
    }
    emit?.(event)

    await vi.waitFor(() =>
      expect(launchThread).toHaveBeenCalledWith('work', expect.stringContaining('Implement the item and verify the result.'), event, {
        agentId: 'codex',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        serviceTier: null,
      }),
    )
    expect(recipes.get(saved.id)).toMatchObject({
      threadAction: 'work',
      agentId: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      promptSteps: [{ name: 'Work', prompt: 'Implement the item and verify the result.' }],
      lastStatus: 'running',
    })
  })

  it('stores schedules on automation recipes and launches one Work thread per repository', async () => {
    const { database, registries, recipes, launchThread } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.scheduled',
      name: 'Scheduled',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['repository'] } },
      },
      subscribe: () => undefined,
    })
    database.$client
      .prepare('INSERT INTO repositories (id,full_name,clone_url,local_path) VALUES (1,?,?,?),(2,?,?,?)')
      .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api', 'acme/web', 'git@example.test:acme/web.git', '/tmp/acme-web')

    const saved = recipes.save({
      name: 'Dependency maintenance',
      triggerId: 'core.scheduled',
      threadAction: 'work',
      promptSteps: [{ name: 'Work', prompt: 'Update safe dependencies and verify the result.' }],
      steps: [],
      schedule: {
        repositoryIds: [1, 2],
        branchType: 'chore',
        scheduleMode: 'simple',
        simpleSchedule: 'weekly',
        timezone: 'UTC',
        agentId: 'codex',
        model: 'gpt-5',
        reasoningEffort: 'high',
        allowSubagents: true,
      },
    })!

    expect(saved.schedule).toMatchObject({
      repositoryIds: [1, 2],
      branchType: 'chore',
      cronExpression: '0 9 * * 1',
      allowSubagents: true,
    })
    await expect(recipes.run(saved.id)).resolves.toMatchObject({ started: 2, errors: [] })
    expect(launchThread).toHaveBeenCalledTimes(2)
    expect(vi.mocked(launchThread).mock.calls.map((call) => call[2]?.subject)).toEqual(['repository:1', 'repository:2'])
  })

  it('records a guarded Review as skipped without running bound actions', async () => {
    const launchThread = vi.fn<ThreadLauncher>(async () => ({
      skippedReason: 'Watch for updates is off for this pull request',
    }))
    const { database, registries, recipes } = fixture(20, launchThread)
    registries.forModule('core').triggers.register({
      id: 'core.pull-request-changed',
      name: 'Pull request changed',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['pull-request'] } },
      },
      subscribe: () => undefined,
    })
    const publish = vi.fn(async () => ({ posted: true }))
    registries.forModule('core').actions.register({ id: 'core.publish-review', name: 'Publish review', execute: publish })
    const saved = recipes.save({
      name: 'Review changed pull requests',
      triggerId: 'core.pull-request-changed',
      threadAction: 'review',
      promptSteps: [{ name: 'Review', prompt: 'Review the pull request.' }],
      boundActions: [{ capabilityId: 'core.publish-review', conditions: [], conditionMode: 'all' }],
      steps: [],
    })!

    await recipes.run(saved.id, {
      id: 'event-1',
      data: { entityType: 'pull-request', entityId: 42, entity: { repo_id: 1 } },
    })

    expect(recipes.getRun(1)).toMatchObject({
      status: 'succeeded',
      threadJobId: null,
      currentPhase: 1,
      lastError: null,
    })
    expect(recipes.listAuditEvents()).toEqual([
      expect.objectContaining({
        eventType: 'thread_skipped',
        details: { reason: 'Watch for updates is off for this pull request' },
      }),
      expect.objectContaining({ eventType: 'flow_started' }),
    ])
    expect(publish).not.toHaveBeenCalled()
    expect(database.$client.prepare('SELECT COUNT(*) AS count FROM jobs').get()).toEqual({ count: 0 })
  })

  it('queues ordered prompts into one thread and runs bound actions only after the final phase', async () => {
    const { database, registries, recipes, launchThread, queuePrompt } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.work-item-created',
      name: 'Work created',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['work-item'] } },
      },
      subscribe: () => undefined,
    })
    const publish = vi.fn(async () => ({ url: 'https://example.test/pr/42' }))
    registries.forModule('core').actions.register({ id: 'core.publish', name: 'Publish', execute: publish })
    const saved = recipes.save({
      name: 'Repair and publish',
      triggerId: 'core.work-item-created',
      threadAction: 'work',
      promptSteps: [
        { name: 'Understand', prompt: 'Understand the desired outcome.' },
        { name: 'Implement', prompt: 'Implement and validate the fix.' },
      ],
      boundActions: [
        {
          capabilityId: 'core.publish',
          conditionMode: 'all',
          conditions: [{ field: 'thread.status', operator: 'equals', value: 'completed' }],
        },
      ],
      steps: [],
    })!
    const event = { id: 'event-1', data: { entityType: 'work-item', entityId: 7 } }

    await recipes.run(saved.id, event)

    expect(launchThread).toHaveBeenCalledWith('work', expect.stringContaining('Phase 1 of 2: Understand'), event, expect.any(Object))
    expect(queuePrompt).toHaveBeenCalledWith(42, expect.stringContaining('Phase 2 of 2: Implement'), {
      automationRunId: 1,
      automationPhase: 2,
    })
    expect(publish).not.toHaveBeenCalled()

    database.$client.prepare("UPDATE jobs SET status='completed',exit_code=0 WHERE id=42").run()
    database.$client
      .prepare(`INSERT INTO job_follow_up_queue
      (job_id,prompt,status,automation_run_id,automation_phase,finished_at)
      VALUES (42,'phase two','completed',1,2,CURRENT_TIMESTAMP)`)
      .run()
    await recipes.handleJobTurnFinished(42, true)

    expect(recipes.getRun(1)?.lastError).toBeNull()
    expect(recipes.getRun(1)).toMatchObject({
      status: 'succeeded',
      currentPhase: 2,
      threadJobId: 42,
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(recipes.get(saved.id)).toMatchObject({ lastStatus: 'succeeded' })
    expect(recipes.listAuditEvents().map((event) => event.eventType)).toEqual([
      'external_action_succeeded',
      'external_action_started',
      'flow_started',
    ])
  })

  it('pauses Improve flows for itemized approval and applies only selected items in the same thread', async () => {
    const { database, registries, recipes, launchThread, queuePrompt } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.work-item-created',
      name: 'Work created',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['work-item'] } },
      },
      subscribe: () => undefined,
    })
    const saved = recipes.save({
      name: 'Improve delivery',
      triggerId: 'core.work-item-created',
      threadAction: 'improve',
      promptSteps: [{ name: 'Review and plan', prompt: 'Find the highest-value maintainability improvements.' }],
      steps: [],
    })!
    const event = { id: 'event-1', data: { entityType: 'work-item', entityId: 7 } }

    await recipes.run(saved.id, event)

    expect(launchThread).toHaveBeenCalledWith(
      'improve',
      expect.stringMatching(/do not edit files[\s\S]*AUTOMATION_IMPROVEMENTS_JSON/i),
      event,
      expect.any(Object),
    )
    expect(database.$client.prepare('SELECT thread_action,flow_mode FROM automation_recipes WHERE id=?').get(saved.id)).toEqual({
      thread_action: 'work',
      flow_mode: 'improve',
    })
    database.$client.prepare(`UPDATE jobs SET status='completed',exit_code=0,result_text=? WHERE id=42`).run(`## Improvement plan
<!-- AUTOMATION_IMPROVEMENTS_JSON
[
  {"title":"Extract parser","description":"Move parsing into a focused module and add tests.","priority":"P1","files":["src/parser.ts"]},
  {"title":"Improve errors","description":"Make validation failures actionable and verify the API response.","priority":"P2","files":["src/api.ts"]}
]
-->`)

    await recipes.handleJobTurnFinished(42, true)

    expect(queuePrompt).not.toHaveBeenCalled()
    expect(recipes.getRun(1)).toMatchObject({
      status: 'running',
      currentPhase: 1,
      phaseCount: 2,
      improvementApprovalStatus: 'pending',
      improvementItems: [
        expect.objectContaining({ id: 'improvement-1', title: 'Extract parser', priority: 'P1' }),
        expect.objectContaining({ id: 'improvement-2', title: 'Improve errors', priority: 'P2' }),
      ],
    })

    recipes.resolveImprovements(1, ['improvement-2'])

    expect(queuePrompt).toHaveBeenCalledWith(42, expect.stringMatching(/Improve errors(?![\s\S]*Extract parser)/), {
      automationRunId: 1,
      automationPhase: 2,
    })
    expect(recipes.getRun(1)).toMatchObject({
      status: 'running',
      improvementApprovalStatus: 'approved',
      selectedImprovementIds: ['improvement-2'],
    })
    expect(recipes.listAuditEvents().map((event) => event.eventType)).toEqual(['approval_granted', 'approval_requested', 'flow_started'])
    database.$client
      .prepare(`INSERT INTO job_follow_up_queue
      (job_id,prompt,status,automation_run_id,automation_phase,finished_at)
      VALUES (42,'approved fixes','completed',1,2,CURRENT_TIMESTAMP)`)
      .run()
    await recipes.handleJobTurnFinished(42, true)

    expect(recipes.getRun(1)).toMatchObject({ status: 'succeeded', currentPhase: 2 })
    expect(recipes.get(saved.id)).toMatchObject({ lastStatus: 'succeeded' })
  })

  it('cancels an Improve flow without executing when no items are approved', async () => {
    const { database, registries, recipes, queuePrompt } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.work-item-created',
      name: 'Work created',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['work-item'] } },
      },
      subscribe: () => undefined,
    })
    const saved = recipes.save({
      name: 'Optional cleanup',
      triggerId: 'core.work-item-created',
      threadAction: 'improve',
      promptSteps: [{ name: 'Review and plan', prompt: 'Find cleanup opportunities.' }],
      steps: [],
    })!
    await recipes.run(saved.id, { data: { entityType: 'work-item', entityId: 7 } })
    database.$client.prepare(`UPDATE jobs SET status='completed',exit_code=0,result_text=? WHERE id=42`)
      .run(`<!-- AUTOMATION_IMPROVEMENTS_JSON
[{"title":"Rename helper","description":"Use a clearer name and update focused tests.","priority":"P3","files":[]}]
-->`)
    await recipes.handleJobTurnFinished(42, true)

    expect(recipes.resolveImprovements(1, [])).toMatchObject({
      status: 'cancelled',
      improvementApprovalStatus: 'declined',
      selectedImprovementIds: [],
    })
    expect(recipes.get(saved.id)).toMatchObject({ lastStatus: 'cancelled' })
    expect(queuePrompt).not.toHaveBeenCalled()
  })

  it('requires trigger context and a prompt for thread outcomes', () => {
    const { registries, recipes } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.agent-thread-completed',
      name: 'Run completed',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['agent-thread'] } },
      },
      subscribe: () => undefined,
    })
    expect(() =>
      recipes.save({
        name: 'No target',
        threadAction: 'review',
        promptSteps: [{ name: 'Review', prompt: 'Review it' }],
        steps: [],
      }),
    ).toThrow('require an event trigger')
    expect(() =>
      recipes.save({
        name: 'No prompt',
        triggerId: 'core.agent-thread-completed',
        threadAction: 'review',
        steps: [],
      }),
    ).toThrow('require at least one prompt phase')
    expect(() =>
      recipes.save({
        name: 'Too many Improve briefs',
        triggerId: 'core.agent-thread-completed',
        threadAction: 'improve',
        promptSteps: [
          { name: 'One', prompt: 'Review it' },
          { name: 'Two', prompt: 'Review it again' },
        ],
        steps: [],
      }),
    ).toThrow('exactly one review brief')
    expect(() => recipes.save({ name: 'No outcome', steps: [] })).toThrow('Choose a thread flow')
    expect(() =>
      recipes.save({
        name: 'Invalid dataflow',
        steps: [{ kind: 'query', capabilityId: 'missing.query', inputSource: 'previous' }],
      }),
    ).toThrow('first automation step cannot use previous-step output')
  })

  it('durably pauses new flows and records control changes', async () => {
    const { database, registries, recipes } = fixture()
    registries.forModule('delivery').actions.register({
      id: 'delivery.run',
      name: 'Run',
      execute: async () => ({ launched: true }),
    })
    const saved = recipes.save({
      name: 'Ship safely',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })!

    expect(recipes.setPaused(true, 'Incident response')).toMatchObject({
      paused: true,
      reason: 'Incident response',
    })
    await expect(recipes.run(saved.id)).rejects.toThrow('Automation runtime is paused: Incident response')
    expect(database.$client.prepare('SELECT paused,reason FROM automation_control_events').all()).toEqual([
      { paused: 1, reason: 'Incident response' },
    ])

    recipes.setPaused(false)
    await expect(recipes.run(saved.id)).resolves.toMatchObject({ lastStatus: 'succeeded' })
  })

  it('enforces the configured active-flow ceiling', async () => {
    const { registries, recipes } = fixture(20, undefined, 1)
    registries.forModule('core').triggers.register({
      id: 'core.work-item-created',
      name: 'Work created',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['work-item'] } },
      },
      subscribe: () => undefined,
    })
    const saved = recipes.save({
      name: 'Review work',
      triggerId: 'core.work-item-created',
      threadAction: 'work',
      promptSteps: [{ name: 'Review', prompt: 'Review it' }],
      steps: [],
    })!

    await recipes.run(saved.id, { id: 'event-1', data: { entityType: 'work-item', entityId: 1 } })
    expect(recipes.runtimeStatus()).toMatchObject({ activeRuns: 1, maximumConcurrentRuns: 1 })
    await expect(recipes.run(saved.id, { id: 'event-2', data: { entityType: 'work-item', entityId: 2 } })).rejects.toThrow(
      'concurrent flow limit (1)',
    )
  })

  it('reconciles stale orphaned flows without failing active work or approval waits', async () => {
    const { database, registries, recipes } = fixture()
    registries.forModule('delivery').actions.register({
      id: 'delivery.run',
      name: 'Run',
      execute: async () => ({ launched: true }),
    })
    const saved = recipes.save({
      name: 'Ship safely',
      steps: [{ kind: 'action', capabilityId: 'delivery.run' }],
    })!
    const insertRun = database.$client.prepare(`INSERT INTO automation_flow_runs
      (recipe_id,status,improvement_approval_status,updated_at) VALUES (?,'running',?,'2000-01-01 00:00:00')`)
    insertRun.run(saved.id, 'not-required')
    insertRun.run(saved.id, 'pending')
    insertRun.run(saved.id, 'not-required')
    database.$client
      .prepare(`INSERT INTO capability_executions
      (capability_kind,capability_id,module_id,status,workflow_instance_id,input,max_attempts)
      VALUES ('action','delivery.run','delivery','running',3,'null',1)`)
      .run()

    await expect(recipes.recoverRuns('2001-01-01T00:00:00.000Z')).resolves.toEqual({
      inspected: 3,
      recovered: 0,
      failed: 1,
    })
    expect(recipes.getRun(1)).toMatchObject({
      status: 'failed',
      lastError: 'Automation flow was interrupted before its thread started',
    })
    expect(recipes.getRun(2)).toMatchObject({
      status: 'running',
      improvementApprovalStatus: 'pending',
    })
    expect(recipes.getRun(3)).toMatchObject({ status: 'running' })
  })

  it('rejects thread outcomes for triggers without a compatible target', () => {
    const { registries, recipes } = fixture()
    registries.forModule('core').triggers.register({
      id: 'core.schedule-finished',
      name: 'Schedule finished',
      outputSchema: {
        type: 'object',
        properties: { entityType: { type: 'string', enum: ['schedule'] } },
      },
      subscribe: () => undefined,
    })

    expect(() =>
      recipes.save({
        name: 'Review schedule',
        triggerId: 'core.schedule-finished',
        threadAction: 'review',
        promptSteps: [{ name: 'Review', prompt: 'Review it' }],
        steps: [],
      }),
    ).toThrow('does not provide a target for a Review thread')
  })
})
