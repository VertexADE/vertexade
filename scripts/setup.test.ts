import { describe, expect, it } from 'vite-plus/test'
import { parseVersion, summarizeChecks, versionAtLeast } from './setup.mjs'

describe('guided setup checks', () => {
  it('parses and compares Node versions', () => {
    expect(parseVersion('v22.5.0')).toEqual([22, 5, 0])
    expect(versionAtLeast([22, 13, 0])).toBe(true)
    expect(versionAtLeast([22, 12, 9])).toBe(false)
    expect(versionAtLeast([23, 0, 0])).toBe(true)
  })

  it('separates required blockers from optional advisories', () => {
    const checks = [
      { id: 'node', required: true, state: 'pass' },
      { id: 'git', required: true, state: 'fail' },
      { id: 'agent', required: false, state: 'warn' },
    ]
    expect(summarizeChecks(checks)).toEqual({
      blockers: [checks[1]],
      advisories: [checks[2]],
      ready: false,
    })
  })
})
