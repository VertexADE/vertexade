import { delimiter } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { desktopServiceEnvironment } from './desktop-environment.ts'

describe('desktop service environment', () => {
  it('adds common macOS package-manager paths without replacing inherited paths', () => {
    const environment = desktopServiceEnvironment({ PATH: '/custom/bin:/usr/bin', TOKEN: 'preserved' }, 'darwin', '/Users/test')
    const paths = environment.PATH?.split(delimiter)

    expect(paths?.slice(0, 2)).toEqual(['/custom/bin', '/usr/bin'])
    expect(paths).toContain('/opt/homebrew/bin')
    expect(paths).toContain('/Users/test/.local/share/mise/shims')
    expect(paths).toContain('/Users/test/.nix-profile/bin')
    expect(environment.TOKEN).toBe('preserved')
  })

  it('does not alter command lookup paths on other platforms', () => {
    expect(desktopServiceEnvironment({ PATH: '/usr/bin' }, 'linux', '/home/test')).toEqual({ PATH: '/usr/bin' })
  })
})
