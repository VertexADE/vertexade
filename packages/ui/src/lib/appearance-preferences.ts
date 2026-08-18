export const appearanceStorageKey = 'vertexade:appearance:v1'

export type ColorMode = 'system' | 'light' | 'dark'
export type ThemePreset =
  | 'default'
  | 'black'
  | 'graphite'
  | 'slate'
  | 'violet'
  | 'ocean'
  | 'teal'
  | 'forest'
  | 'lime'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'fuchsia'
export type MessageBubblePreset = 'theme' | ThemePreset
export type FontPreset = 'system' | 'humanist' | 'geometric' | 'serif' | 'mono' | 'custom'
export type ThreadFontPreset = 'interface' | FontPreset
export type ThreadFontSize = 'small' | 'medium' | 'large'

export interface AppearancePreferences {
  colorMode: ColorMode
  themePreset: ThemePreset
  messageBubblePreset: MessageBubblePreset
  interfaceFont: FontPreset
  customInterfaceFont: string
  codeFont: FontPreset
  customCodeFont: string
  threadFont: ThreadFontPreset
  customThreadFont: string
  threadFontSize: ThreadFontSize
}

export const defaultAppearancePreferences: AppearancePreferences = {
  colorMode: 'dark',
  themePreset: 'default',
  messageBubblePreset: 'theme',
  interfaceFont: 'system',
  customInterfaceFont: '',
  codeFont: 'mono',
  customCodeFont: '',
  threadFont: 'interface',
  customThreadFont: '',
  threadFontSize: 'medium',
}

const fontStacks: Record<Exclude<FontPreset, 'custom'>, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
  humanist: "Optima, Candara, 'Noto Sans', sans-serif",
  geometric: "Avenir, Montserrat, 'Century Gothic', sans-serif",
  serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
}

const threadFontSizes: Record<ThreadFontSize, string> = {
  small: '0.75rem',
  medium: '0.8125rem',
  large: '0.9375rem',
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
  const threadFont =
    value.threadFont === 'interface'
      ? 'var(--font-interface)'
      : value.threadFont === 'custom'
        ? safeFontStack(value.customThreadFont)
        : fontStacks[value.threadFont]
  root.dataset.themePreset = value.themePreset
  root.dataset.messageBubblePreset = value.messageBubblePreset
  root.style.setProperty('--font-interface', interfaceFont || fontStacks.system)
  root.style.setProperty('--font-code', codeFont || fontStacks.mono)
  root.style.setProperty('--thread-font-family', threadFont || 'var(--font-interface)')
  root.style.setProperty('--thread-font-size', threadFontSizes[value.threadFontSize])
}

export function saveAppearancePreferences(value: AppearancePreferences) {
  window.localStorage.setItem(appearanceStorageKey, JSON.stringify(value))
  applyAppearancePreferences(value)
  window.dispatchEvent(new CustomEvent('vertexade:appearance-changed', { detail: value }))
}
