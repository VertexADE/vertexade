import { describe, expect, it } from 'vite-plus/test'
import { agentLogPath } from './server-utils.ts'

describe('dashboard server utilities', () => {
  it('names run logs by their owning Work item before repository context', () => {
    const path = agentLogPath('/data/logs', { key: 'W-0042' }, { full_name: 'acme/example-api' }, 'task')

    expect(path).toMatch(/^\/data\/logs\/W-0042--acme--example-api--task--\d{17}\.log$/)
  })
})
