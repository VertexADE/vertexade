import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  appearanceStorageKey,
  applyAppearancePreferences,
  defaultAppearancePreferences,
  readAppearancePreferences,
  saveAppearancePreferences,
} from './appearance-preferences'

describe('appearance preferences', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads defaults when stored data is invalid', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{' } })
    expect(readAppearancePreferences()).toEqual(defaultAppearancePreferences)
  })

  it('persists and applies a safe custom font stack', () => {
    const setItem = vi.fn()
    const setProperty = vi.fn()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { localStorage: { setItem }, dispatchEvent })
    vi.stubGlobal('document', {
      documentElement: { dataset: {}, style: { setProperty } },
    })
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(
          public type: string,
          public init: unknown,
        ) {}
      },
    )
    const value = {
      ...defaultAppearancePreferences,
      themePreset: 'ocean' as const,
      interfaceFont: 'custom' as const,
      customInterfaceFont: 'Inter; color: red',
    }

    saveAppearancePreferences(value)

    expect(setItem).toHaveBeenCalledWith(appearanceStorageKey, JSON.stringify(value))
    expect(setProperty).toHaveBeenCalledWith('--font-interface', 'Inter color: red')
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })

  it('applies independent interface and code font presets', () => {
    const setProperty = vi.fn()
    const dataset = {} as Record<string, string>
    vi.stubGlobal('document', {
      documentElement: { dataset, style: { setProperty } },
    })

    applyAppearancePreferences({
      ...defaultAppearancePreferences,
      themePreset: 'black',
      messageBubblePreset: 'graphite',
      interfaceFont: 'serif',
      codeFont: 'system',
      threadFont: 'custom',
      customThreadFont: 'Avenir; color: red',
      threadFontSize: 'large',
    })

    expect(dataset.themePreset).toBe('black')
    expect(dataset.messageBubblePreset).toBe('graphite')
    expect(setProperty).toHaveBeenCalledWith('--font-interface', expect.stringContaining('Charter'))
    expect(setProperty).toHaveBeenCalledWith('--font-code', expect.stringContaining('Segoe UI'))
    expect(setProperty).toHaveBeenCalledWith('--thread-font-family', 'Avenir color: red')
    expect(setProperty).toHaveBeenCalledWith('--thread-font-size', '0.9375rem')
  })
})
