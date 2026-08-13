import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  agentProcessEnvironment,
  applySubagentInstructions,
  migrateAgentEnvironmentsV1,
  normalizeAgentEnvironments,
  publicAgentEnvironment,
  trustWorkspaceMiseConfigs,
  updateAgentEnvironment,
} from './agents.ts'

const directories: string[] = []

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe('agent platform helpers', () => {
  it('keeps sub-agent instructions before the final user request', () => {
    const prompt = applySubagentInstructions('Trusted context\n\n<user_request>\nBuild it\n</user_request>', true)

    expect(prompt.indexOf('<subagent_orchestration>')).toBeLessThan(prompt.indexOf('<user_request>'))
    expect(prompt).toMatch(/<user_request>\nBuild it\n<\/user_request>$/)
  })

  it('removes inherited Node IPC settings while preserving agent tooling', () => {
    expect(
      agentProcessEnvironment(
        {
          PATH: '/tools',
          GH_TOKEN: 'test-token',
          NODE_CHANNEL_FD: '3',
          NODE_CHANNEL_SERIALIZATION_MODE: 'json',
        },
        { OPENCODE_PERMISSION: 'allow' },
      ),
    ).toEqual({ PATH: '/tools', GH_TOKEN: 'test-token', OPENCODE_PERMISSION: 'allow' })
  })

  it('applies encrypted custom values before agent-owned launch overrides', () => {
    expect(agentProcessEnvironment({ SHARED: 'parent' }, { SECRET: 'decrypted', SHARED: 'custom' }, { SHARED: 'agent' })).toEqual({
      SECRET: 'decrypted',
      SHARED: 'agent',
    })
  })

  it('returns variable names without exposing decrypted values', () => {
    expect(publicAgentEnvironment({ API_TOKEN: 'secret', REGION: 'eu' })).toEqual([
      { name: 'API_TOKEN', has_value: true },
      { name: 'REGION', has_value: true },
    ])
  })

  it('adds, replaces, renames, preserves, and removes variables', () => {
    expect(
      updateAgentEnvironment(
        { KEEP: 'old', RENAME_ME: 'renamed', REMOVE_ME: 'gone' },
        {
          variables: [
            { name: 'KEEP', previous_name: 'KEEP', value: 'replacement' },
            { name: 'RENAMED', previous_name: 'RENAME_ME', value: '' },
            { name: 'NEW_VALUE', value: 'new' },
          ],
        },
      ),
    ).toEqual({ KEEP: 'replacement', RENAMED: 'renamed', NEW_VALUE: 'new' })
  })

  it('rejects invalid names, duplicates, missing values, and reserved runtime variables', () => {
    expect(() => updateAgentEnvironment({}, { variables: [{ name: 'BAD-NAME', value: 'x' }] })).toThrow('Invalid')
    expect(() =>
      updateAgentEnvironment(
        {},
        {
          variables: [
            { name: 'SAME', value: 'x' },
            { name: 'SAME', value: 'y' },
          ],
        },
      ),
    ).toThrow('Duplicate')
    expect(() => updateAgentEnvironment({}, { variables: [{ name: 'EMPTY', value: '' }] })).toThrow('requires a value')
    expect(() => updateAgentEnvironment({}, { variables: [{ name: 'NODE_CHANNEL_FD', value: '3' }] })).toThrow('reserved')
  })

  it('drops malformed persisted entries at the decryption boundary', () => {
    expect(
      normalizeAgentEnvironments({
        codex: { GOOD: 'value', 'BAD-NAME': 'no', NUMBER: 1 },
        broken: null,
      }),
    ).toEqual({ codex: { GOOD: 'value' } })
  })

  it('moves legacy environments into extension-owned settings without overwriting newer values', () => {
    const stored = new Map<string, unknown>([['extension:codex:environment', { KEEP: 'new' }]])
    const migrated = migrateAgentEnvironmentsV1(
      {
        has: (name) => stored.has(name),
        write: (name, value) => {
          stored.set(name, value)
        },
      },
      {
        codex: { KEEP: 'old' },
        'claude-code': { ANTHROPIC_API_KEY: 'secret' },
      },
    )
    expect(migrated).toEqual(['claude-code'])
    expect(stored.get('extension:codex:environment')).toEqual({ KEEP: 'new' })
    expect(stored.get('extension:claude-code:environment')).toEqual({ ANTHROPIC_API_KEY: 'secret' })
  })
})

describe('trustWorkspaceMiseConfigs', () => {
  it('trusts every root mise configuration explicitly', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'vertexade-mise-'))
    directories.push(worktree)
    await writeFile(join(worktree, 'mise.toml'), '[tools]\nnode = "22"\n')
    await writeFile(join(worktree, '.mise.toml'), '[env]\nEXAMPLE = "yes"\n')
    const run = vi.fn(async () => undefined)

    await trustWorkspaceMiseConfigs(run, worktree)

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledWith('mise', ['trust', '--yes', join(worktree, 'mise.toml')])
    expect(run).toHaveBeenCalledWith('mise', ['trust', '--yes', join(worktree, '.mise.toml')])
  })

  it('does not hide a failed mise trust command', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'vertexade-mise-'))
    directories.push(worktree)
    await writeFile(join(worktree, 'mise.toml'), '[tools]\nnode = "22"\n')

    await expect(
      trustWorkspaceMiseConfigs(async () => {
        throw new Error('trust denied')
      }, worktree),
    ).rejects.toThrow('trust denied')
  })
})
