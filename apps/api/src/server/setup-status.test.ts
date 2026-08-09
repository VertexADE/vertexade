import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { createSetupStatus, inspectSetupTools, inspectSetupToolsEffect } from './setup-status.ts'

describe('setup status', () => {
  it('reports command availability without exposing multiline command output', async () => {
    const tools = await inspectSetupTools(
      async (command) => {
        if (command === 'git') return 'git version 2.50.0\nextra output'
        throw new Error(`${command} is missing\nprivate details`)
      },
      [
        {
          id: 'example-agent',
          name: 'Example agent',
          command: 'example-agent',
          args: ['--version'],
          install: 'Install it',
        },
      ],
    )
    expect(tools.find((tool) => tool.id === 'git')).toMatchObject({
      ready: true,
      detail: 'git version 2.50.0',
    })
    expect(tools.find((tool) => tool.id === 'pnpm')).toMatchObject({
      ready: false,
      detail: 'pnpm is missing',
    })
    expect(tools.find((tool) => tool.id === 'example-agent')).toMatchObject({
      ready: false,
      detail: 'example-agent is missing',
    })
  })

  it('exposes setup inspection as a composable Effect workflow', async () => {
    const tools = await Effect.runPromise(inspectSetupToolsEffect(async (command) => `${command} 1.0.0`))

    expect(tools.map(({ id, ready }) => ({ id, ready }))).toEqual([
      { id: 'pnpm', ready: true },
      { id: 'git', ready: true },
      { id: 'pm2', ready: true },
    ])
  })

  it('requires core tools, the selected SCM, and one runnable agent', () => {
    const tools = [
      { id: 'pnpm', ready: true, required: true },
      { id: 'git', ready: true, required: true },
      { id: 'github-auth', ready: true, required: false },
      { id: 'codex', ready: true, required: false },
    ].map((tool) => ({ name: tool.id, detail: '', install: '', ...tool }))
    const status = createSetupStatus({
      tools,
      scm: {
        id: 'github',
        name: 'GitHub',
        authentication: { source: 'gh-cli', connected: true, requiredSetupCheckId: 'github-auth' },
      },
      agents: [{ id: 'codex', name: 'Codex', enabled: true, setupCheckIds: ['codex'] }],
      extensions: [{ id: 'github', name: 'GitHub', lifecycle: 'ready' }],
    })
    expect(status).toMatchObject({
      ready: true,
      scm: { id: 'github', name: 'GitHub', ready: true },
      extensions: { ready: 1, total: 1 },
    })
    expect(status.agents[0].ready).toBe(true)
  })

  it('supports an SCM that does not depend on a local CLI', () => {
    const tools = [{ id: 'pnpm', name: 'pnpm', ready: true, required: true, detail: '', install: '' }]
    const status = createSetupStatus({
      tools,
      scm: { id: 'gitlab', name: 'GitLab', authentication: { source: 'oauth', connected: true } },
      agents: [{ id: 'remote-agent', name: 'Remote Agent', enabled: false }],
      extensions: [],
    })
    expect(status.scm).toMatchObject({ id: 'gitlab', ready: true })
  })

  it('does not treat intentionally disabled optional extensions as degraded', () => {
    const status = createSetupStatus({
      tools: [{ id: 'pnpm', name: 'pnpm', ready: true, required: true, detail: '', install: '' }],
      scm: { id: 'gitlab', name: 'GitLab', authentication: { source: 'oauth', connected: true } },
      agents: [{ id: 'remote-agent', name: 'Remote Agent', enabled: true }],
      extensions: [
        { id: 'github', name: 'GitHub', lifecycle: 'ready', enabled: true },
        { id: 'airtable', name: 'Airtable', lifecycle: 'disabled', enabled: false },
      ],
    })
    expect(status.extensions).toMatchObject({ ready: 1, total: 1 })
  })
})
