import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { PlatformCapabilityRegistries } from '../platform/capability-registry.ts'
import { WorkService } from '../work/service.ts'
import { CoreAutomationTriggers } from './core-automation-triggers.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('core automation triggers', () => {
  it('publishes domain-specific and platform events with entity context', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    database.$client
      .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
      .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api')
    const work = new WorkService(database)
    work.initialize()
    const item = work.create({ title: 'Ship API', repositoryId: 1 })
    database.$client
      .prepare(`INSERT INTO jobs (repo_id,pr_number,prompt,worktree_path,log_path,status,task_title,work_item_id)
      VALUES (1,42,'Ship it','/tmp/worktree','/tmp/job.log','running','Ship API',?)`)
      .run(item.id)
    const registries = new PlatformCapabilityRegistries()
    const triggers = new CoreAutomationTriggers(database, registries)
    triggers.register()
    const completed = vi.fn()
    const everyEvent = vi.fn()
    void registries.triggers.require('core.agent-thread-completed').subscribe(completed)
    void registries.triggers.require('core.platform-event').subscribe(everyEvent)

    triggers.emit('job_finished', 1)

    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'agent-thread:1',
        data: expect.objectContaining({
          reason: 'job_finished',
          entityId: 1,
          entityType: 'agent-thread',
          entity: expect.objectContaining({ repository: 'acme/api', task_title: 'Ship API' }),
        }),
      }),
    )
    expect(everyEvent).toHaveBeenCalledTimes(1)
  })

  it('does not expose workflow lifecycle events through the generic trigger', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const registries = new PlatformCapabilityRegistries()
    const triggers = new CoreAutomationTriggers(database, registries)
    triggers.register()
    const listener = vi.fn()
    void registries.triggers.require('core.platform-event').subscribe(listener)

    triggers.emit('automation_recipe_succeeded', 1)

    expect(listener).not.toHaveBeenCalled()
  })

  it('describes filterable event values and resolves review-watch events to pull requests', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    database.$client
      .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
      .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api')
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,head_ref,head_sha,base_ref)
      VALUES (1,42,'Ship API','https://example.test/pr/42','feature/api','abc','main')`)
      .run()
    const registries = new PlatformCapabilityRegistries()
    const triggers = new CoreAutomationTriggers(database, registries)
    triggers.register()
    const trigger = registries.triggers.require('core.pull-request-changed')
    const listener = vi.fn()
    void trigger.subscribe(listener)

    triggers.emit('review_watch_updated', 42)

    expect(trigger.outputSchema?.properties?.reason?.enum).toContain('review_watch_updated')
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'pull-request:42',
        data: expect.objectContaining({
          entityType: 'pull-request',
          entity: expect.objectContaining({ repo_id: 1, number: 42 }),
        }),
      }),
    )
  })

  it('publishes reviewer assignment events with filter-friendly GitHub usernames', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    database.$client
      .prepare('INSERT INTO repositories (full_name,clone_url,local_path) VALUES (?,?,?)')
      .run('acme/api', 'git@example.test:acme/api.git', '/tmp/acme-api')
    database.$client
      .prepare(`INSERT INTO pull_requests (repo_id,number,title,url,head_ref,head_sha,base_ref,reviewers,labels)
      VALUES (1,42,'Ship API','https://example.test/pr/42','feature/api','abc','main',?,?)`)
      .run(JSON.stringify([{ login: 'octocat' }, { login: 'grace' }]), JSON.stringify([{ name: 'security' }]))
    const registries = new PlatformCapabilityRegistries()
    const triggers = new CoreAutomationTriggers(database, registries)
    triggers.register()
    const trigger = registries.triggers.require('core.pull-request-reviewers-changed')
    const listener = vi.fn()
    void trigger.subscribe(listener)

    triggers.emit('pr_reviewers_changed', 42)

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'pr_reviewers_changed',
          entity: expect.objectContaining({
            reviewer_logins: 'octocat, grace',
            label_names: 'security',
          }),
        }),
      }),
    )
  })
})
