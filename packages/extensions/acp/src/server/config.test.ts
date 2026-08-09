import { describe, expect, it } from 'vite-plus/test'
import {
  acpAgentId,
  archiveAcpHarness,
  migrateAcpConfiguration,
  setAcpHarnessActive,
  updateAcpHarness,
  updateAcpHarnessEnvironment,
} from './config.ts'

describe('ACP harness configuration', () => {
  it('migrates the legacy single harness and environment without changing its agent ID', () => {
    const configuration = migrateAcpConfiguration(
      { command: '  gemini  ', args: ['--experimental-acp'], permissionPolicy: 'deny' },
      { GEMINI_API_KEY: 'secret' },
    )
    expect(configuration.harnesses).toEqual([
      expect.objectContaining({
        id: 'default',
        name: 'ACP Agent',
        command: 'gemini',
        args: ['--experimental-acp'],
        permissionPolicy: 'deny',
        active: true,
        environment: { GEMINI_API_KEY: 'secret' },
      }),
    ])
    expect(acpAgentId(configuration.harnesses[0]!.id)).toBe('acp')
  })

  it('adds and independently activates multiple harnesses', () => {
    const first = updateAcpHarness({}, { name: 'Gemini', command: 'gemini', args: ['--acp'] }, 'gemini')
    const second = updateAcpHarness(first, { name: 'Kimi', command: 'kimi', permission_policy: 'deny' }, 'kimi')
    const paused = setAcpHarnessActive(second, 'gemini', false)
    expect(paused.harnesses.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: 'default', active: true },
      { id: 'gemini', active: false },
      { id: 'kimi', active: true },
    ])
    expect(acpAgentId('kimi')).toBe('acp:kimi')
  })

  it('keeps archived harnesses resolvable and preserves encrypted environment values', () => {
    const configured = updateAcpHarness({}, { id: 'default', name: 'Gemini', command: 'gemini' }, 'unused')
    const withEnvironment = updateAcpHarnessEnvironment(configured, 'default', {
      variables: [{ name: 'TOKEN', value: 'secret' }],
    })
    const archived = archiveAcpHarness(withEnvironment, 'default')
    expect(archived.harnesses[0]).toMatchObject({
      id: 'default',
      active: false,
      archived: true,
      environment: { TOKEN: 'secret' },
    })
  })

  it('rejects shell-like multiline executable values and invalid arguments', () => {
    expect(() => updateAcpHarness({}, { name: 'Bad', command: 'agent\nother' }, 'bad')).toThrow('single executable')
    expect(() => updateAcpHarness({}, { name: 'Bad', command: 'agent', args: [7] }, 'bad')).toThrow('Each ACP argument')
  })
})
