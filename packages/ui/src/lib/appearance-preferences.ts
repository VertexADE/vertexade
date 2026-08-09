export const appearanceStorageKey = 'vertexade:appearance:v1'

export type ColorMode = 'system' | 'light' | 'dark'
export type ThemePreset = 'default' | 'violet' | 'ocean' | 'forest' | 'amber' | 'rose'
export type FontPreset = 'system' | 'humanist' | 'geometric' | 'serif' | 'mono' | 'custom'

export interface AppearancePreferences {
  colorMode: ColorMode
  themePreset: ThemePreset
  interfaceFont: FontPreset
  customInterfaceFont: string
  codeFont: FontPreset
  customCodeFont: string
}

export const defaultAppearancePreferences: AppearancePreferences = {
  colorMode: 'dark',
  themePreset: 'default',
  interfaceFont: 'system',
  customInterfaceFont: '',
  codeFont: 'mono',
  customCodeFont: '',
}

const fontStacks: Record<Exclude<FontPreset, 'custom'>, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
  humanist: "Optima, Candara, 'Noto Sans', sans-serif",
  geometric: "Avenir, Montserrat, 'Century Gothic', sans-serif",
  serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
}

function safeFontStack(value: string) {
  return value.replace(/[;{}]/g, '').trim().slice(0, 180)
}

export function readAppearancePreferences(): AppearancePreferences {
  if (typeof window === 'undefined') return defaultAppearancePreferences
  try {
    const stored = JSON.parse(window.localStorage.getItem(appearanceStorageKey) || '{}') as Partial<AppearancePreferences>
    return { ...defaultAppearancePreferences, ...stored }
  } catch {
    return defaultAppearancePreferences
  }
}

export function hasStoredAppearancePreferences() {
  return typeof window !== 'undefined' && window.localStorage.getItem(appearanceStorageKey) !== null
}

export function applyAppearancePreferences(value: AppearancePreferences) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const interfaceFont = value.interfaceFont === 'custom' ? safeFontStack(value.customInterfaceFont) : fontStacks[value.interfaceFont]
  const codeFont = value.codeFont === 'custom' ? safeFontStack(value.customCodeFont) : fontStacks[value.codeFont]
  root.dataset.themePreset = value.themePreset
  root.style.setProperty('--font-interface', interfaceFont || fontStacks.system)
  root.style.setProperty('--font-code', codeFont || fontStacks.mono)
}

export function saveAppearancePreferences(value: AppearancePreferences) {
  window.localStorage.setItem(appearanceStorageKey, JSON.stringify(value))
  applyAppearancePreferences(value)
  window.dispatchEvent(new CustomEvent('vertexade:appearance-changed', { detail: value }))
}
