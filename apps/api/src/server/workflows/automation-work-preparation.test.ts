import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { openDashboardDatabase } from '../database/dashboard-database.ts'
import { WorkService } from '../work/service.ts'
import { createAutomationWorkPreparation } from './automation-work-preparation.ts'

const databases: Array<{ close(): void }> = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))

describe('automation Work preparation', () => {
  it('creates the Work item and applies agent resources before launch', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const work = new WorkService(database)
    work.initialize()
    const inserted = database.$client
      .prepare(
        "INSERT INTO repositories (full_name,clone_url,local_path) VALUES ('acme/api','git@example.test:acme/api.git','/tmp/acme-api')",
      )
      .run()
    const repository = {
      id: Number(inserted.lastInsertRowid),
      full_name: 'acme/api',
      clone_url: 'git@example.test:acme/api.git',
      local_path: '/tmp/acme-api',
    }
    const setSelection = vi.fn()
    const prepare = createAutomationWorkPreparation(database, work, () => ({ setSelection }))
    const selection = { skills: ['review'], mcpServers: ['github'] }

    const result = prepare({ repository, title: 'Automated work', workItemId: null }, { repositoryIds: [], resourceSelection: selection })

    expect(result.workItemId).toEqual(expect.any(Number))
    expect(setSelection).toHaveBeenCalledWith(result.workItemId, selection)
  })
})
