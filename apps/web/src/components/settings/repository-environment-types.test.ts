import { describe, expect, it } from 'vite-plus/test'
import { editableProfile, profilePayload } from './repository-environment-types'

describe('repository environment profile payloads', () => {
  it('never invents or echoes stored secret values', () => {
    const profile = editableProfile({
      scope: 'apps/api',
      snapshotPaths: [],
      variables: [{ name: 'TOKEN', configured: true }],
      envFiles: [{ path: '.env', configured: true }],
      startCommand: '',
      stopCommand: '',
      inheritsFrom: [''],
    })

    expect(profilePayload(profile)).toEqual(
      expect.objectContaining({
        variables: [{ name: 'TOKEN' }],
        envFiles: [{ path: '.env' }],
      }),
    )
  })

  it('includes only values explicitly replaced by the user', () => {
    const profile = editableProfile({
      scope: '',
      snapshotPaths: [],
      variables: [{ name: 'TOKEN', configured: true }],
      envFiles: [],
      startCommand: '',
      stopCommand: '',
      inheritsFrom: [],
    })
    profile.variables[0] = { ...profile.variables[0], value: 'replacement', changed: true }

    expect(profilePayload(profile).variables).toEqual([{ name: 'TOKEN', value: 'replacement' }])
  })
})
