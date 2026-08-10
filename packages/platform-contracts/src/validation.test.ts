import { describe, expect, it } from 'vite-plus/test'
import { PLATFORM_API_VERSION } from './core.ts'
import type { ModuleManifest } from './extension.ts'
import { validateModuleManifest } from './validation.ts'

const manifest = {
  id: 'security-test',
  name: 'Security test',
  version: '1.0.0',
  platformApi: PLATFORM_API_VERSION,
  kind: 'other',
} satisfies ModuleManifest

describe('module route validation', () => {
  it('accepts same-application routes', () => {
    expect(
      validateModuleManifest({
        ...manifest,
        navigation: { to: '/extensions/security-test', label: 'Security test' },
        ui: {
          commands: [{ id: 'open', label: 'Open', to: '/extensions/security-test?view=all#top' }],
          notifications: [{ kind: 'ready', label: 'Ready', to: '/work', actionLabel: 'View' }],
        },
      }),
    ).toBeDefined()
  })

  it.each([
    ['navigation', { navigation: { to: '//attacker.example/path', label: 'Unsafe' } }],
    ['command', { ui: { commands: [{ id: 'unsafe', label: 'Unsafe', to: '//attacker.example/path' }] } }],
    ['notification', { ui: { notifications: [{ kind: 'unsafe', label: 'Unsafe', to: '/\\attacker.example/path', actionLabel: 'View' }] } }],
  ] satisfies ReadonlyArray<readonly [string, Partial<ModuleManifest>]>)(
    'rejects cross-origin %s routes',
    (_label: string, contribution: Partial<ModuleManifest>) => {
      expect(() => validateModuleManifest({ ...manifest, ...contribution })).toThrow(/absolute route/)
    },
  )
})
