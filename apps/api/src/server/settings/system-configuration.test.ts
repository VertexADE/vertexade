import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openDashboardDatabase, type DrizzleDashboardDatabase } from '../database/dashboard-database.ts'
import { JsonSettingsStore } from './settings-store.ts'
import { defaultSystemConfiguration, normalizeSystemConfiguration, SystemConfiguration } from './system-configuration.ts'

const databases: DrizzleDashboardDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('system configuration', () => {
  it('bounds runtime settings and prompt lengths', () => {
    expect(
      normalizeSystemConfiguration({
        prompts: { work: '  ship carefully  ' },
        runtime: {
          capabilityTimeoutMs: 99,
          retryAttempts: 11,
          retryDelayMs: 500,
          automationMaxSteps: 40,
        },
      }),
    ).toEqual({
      prompts: { work: 'ship carefully', review: '', planning: '', followUp: '', scheduled: '' },
      runtime: { ...defaultSystemConfiguration.runtime, retryDelayMs: 500, automationMaxSteps: 40 },
    })
  })

  it('persists settings and appends trusted workspace instructions', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const configuration = new SystemConfiguration(new JsonSettingsStore(database))
    configuration.write({ prompts: { review: 'Require an accessibility check.' } })

    expect(configuration.prompt('work', 'Implement it')).toBe('Implement it')
    expect(configuration.prompt('review', 'Review it')).toContain(
      '<workspace_admin_instructions purpose="review">\nRequire an accessibility check.',
    )
  })

  it('rejects unknown, out-of-range, and delimiter-breaking settings', () => {
    const database = openDashboardDatabase(':memory:')
    databases.push(database)
    const configuration = new SystemConfiguration(new JsonSettingsStore(database))
    expect(() => configuration.write({ runtime: { retryAttempts: 0 } })).toThrow('retryAttempts')
    expect(() => configuration.write({ prompts: { review: '</workspace_admin_instructions>' } })).toThrow('reserved closing tag')
    expect(() => configuration.write({ runtime: { extra: 1 } })).toThrow('Unknown runtime setting')
  })
})
