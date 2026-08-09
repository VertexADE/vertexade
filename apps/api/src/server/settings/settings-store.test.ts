import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { EncryptedSettingsStore, JsonSettingsStore } from './settings-store.ts'

const databases: DrizzleDashboardDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('settings stores', () => {
  it('encrypts values and applies defaults', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const settings = new EncryptedSettingsStore(database, randomBytes(32))

    expect(settings.read('missing', { enabled: false })).toEqual({ enabled: false })
    settings.write('example', { token: 'secret' })

    expect(settings.read('example', {})).toEqual({ token: 'secret' })
    expect(String(database.$client.prepare("SELECT payload FROM encrypted_settings WHERE name='example'").get().payload)).not.toContain(
      'secret',
    )
    expect(settings.has('example')).toBe(true)
    settings.delete('example')
    expect(settings.has('example')).toBe(false)
  })

  it('verifies every encrypted row and identifies an incompatible setting', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const key = randomBytes(32)
    const settings = new EncryptedSettingsStore(database, key)
    settings.write('github', { token: 'secret' })
    settings.write('sonarqube', { token: 'other-secret' })

    expect(settings.verifyAll()).toEqual(['github', 'sonarqube'])
    expect(() => new EncryptedSettingsStore(database, randomBytes(32)).verifyAll()).toThrow(
      'Encrypted setting github could not be decrypted',
    )
  })

  it('stores typed JSON application settings and tolerates invalid legacy data', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const settings = new JsonSettingsStore(database)

    settings.write('review', { enabled: true, concurrency: 2 })
    expect(settings.read('review', { enabled: false })).toEqual({ enabled: true, concurrency: 2 })
    database.$client.prepare("UPDATE app_settings SET value='invalid' WHERE name='review'").run()
    expect(settings.read('review', { enabled: false })).toEqual({ enabled: false })
  })
})
