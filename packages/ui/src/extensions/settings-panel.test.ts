import { describe, expect, it } from 'vite-plus/test'
import { portableSettingsFieldLayoutClassName } from './settings-panel'

describe('portable settings layout', () => {
  it.each(['textarea', 'multiselect', 'string-list', 'object-list'] as const)('gives %s fields the full form width', (type) => {
    expect(portableSettingsFieldLayoutClassName(type)).toBe('col-span-full')
  })

  it.each(['boolean', 'text', 'password', 'number', 'select'] as const)('keeps compact %s fields in the responsive grid', (type) => {
    expect(portableSettingsFieldLayoutClassName(type)).toBeUndefined()
  })
})
