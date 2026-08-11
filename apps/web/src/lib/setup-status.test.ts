import { describe, expect, it } from 'vite-plus/test'
import { parseSetupStatus, setupMilestones, type SetupStatus } from './setup-status'

function statusFixture(): SetupStatus {
  return {
    ready: false,
    runtime: { nodeVersion: 'v22.13.0', production: true },
    tools: [
      { id: 'git', name: 'Git', ready: true, required: true, detail: 'git 2.50', install: 'Install Git' },
      { id: 'pnpm', name: 'pnpm', ready: false, required: true, detail: 'Unavailable', install: 'Install pnpm' },
    ],
    scm: { id: 'github', name: 'GitHub', ready: true, source: 'gh', connected: true, error: '' },
    agents: [{ id: 'codex', name: 'Codex', enabled: true, ready: false, tool: null }],
    extensions: { ready: 1, total: 2, modules: [] },
    operations: null,
  }
}

describe('setup milestones', () => {
  it('uses required tools, source control, and an enabled ready agent as first-run gates', () => {
    expect(setupMilestones(statusFixture())).toEqual([
      { id: 'application', label: 'Application running', ready: true },
      { id: 'tools', label: 'Core tools', ready: false },
      { id: 'scm', label: 'GitHub connected', ready: true },
      { id: 'agent', label: 'Execution agent', ready: false },
    ])
    expect(setupMilestones(statusFixture(), 'Desktop runtime')[0].label).toBe('Desktop runtime')
  })

  it('rejects malformed setup responses at the browser boundary', () => {
    expect(() => parseSetupStatus({ ready: true })).toThrow('Invalid setup status: runtime')
  })
})
