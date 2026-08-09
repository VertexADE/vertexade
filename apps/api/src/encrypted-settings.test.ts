import { describe, expect, it } from 'vite-plus/test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptSettings, encryptSettings, ensureEncryptionKey } from './encrypted-settings.ts'

describe('encrypted settings', () => {
  it('round trips configuration without storing plaintext', () => {
    const key = randomBytes(32)
    const settings = { url: 'https://dev.azure.com/acme', project: 'Portal', pat: 'very-secret' }
    const encrypted = encryptSettings(settings, key)
    expect(encrypted).not.toContain('very-secret')
    expect(decryptSettings(encrypted, key)).toEqual(settings)
  })

  it('rejects decryption with a different key', () => {
    const encrypted = encryptSettings({ pat: 'secret' }, randomBytes(32))
    expect(() => decryptSettings(encrypted, randomBytes(32))).toThrow()
  })

  it('uses the shared key for encrypted agent environments', () => {
    const key = randomBytes(32)
    const settings = {
      agent_environments: {
        codex: { OPENAI_API_KEY: 'codex-secret' },
        'claude-code': { ANTHROPIC_API_KEY: 'claude-secret' },
      },
    }
    const encrypted = encryptSettings(settings, key)
    expect(encrypted).not.toContain('codex-secret')
    expect(encrypted).not.toContain('claude-secret')
    expect(decryptSettings(encrypted, key)).toEqual(settings)
  })

  it('creates a generic 32-byte settings key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vertexade-key-'))
    const settingsPath = join(directory, 'settings.key')

    const key = await ensureEncryptionKey(settingsPath)

    expect(key).toHaveLength(32)
    expect(await readFile(settingsPath)).toEqual(key)
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
  })
})
