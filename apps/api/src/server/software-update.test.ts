import { describe, expect, it } from 'vite-plus/test'
import { serverUpdateInfo } from './software-update.ts'

describe('server update guidance', () => {
  it('returns a read-only npm upgrade command for packaged servers', () => {
    expect(serverUpdateInfo({ VERTEXADE_INSTALLATION: 'npm', VERTEXADE_VERSION: '0.0.33' })).toEqual(
      expect.objectContaining({ installation: 'npm', currentVersion: '0.0.33', command: 'npm install --global vertexade@latest' }),
    )
  })

  it('uses source guidance without executing or guessing a service manager', () => {
    const result = serverUpdateInfo({}, false)
    expect(result.installation).toBe('source')
    expect(result.command).toContain('git pull --ff-only')
    expect(result.restartNote).toContain('Restart')
  })

  it('detects container installations and provides Compose instructions', () => {
    expect(serverUpdateInfo({}, true)).toEqual(
      expect.objectContaining({ installation: 'container', command: 'docker compose pull && docker compose up -d' }),
    )
  })
})
