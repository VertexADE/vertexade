import { useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@vertexade/ui/components/ui/field'
import { Input } from '@vertexade/ui/components/ui/input'
import { SegmentedControl, SegmentedControlItem } from '@vertexade/ui/components/ui/segmented-control'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import { Skeleton } from '@vertexade/ui/components/ui/skeleton'
import {
  defaultAppearancePreferences,
  readAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
  type ColorMode,
  type FontPreset,
  type MessageBubblePreset,
  type ThemePreset,
  type ThreadFontPreset,
  type ThreadFontSize,
} from '@vertexade/ui/lib/appearance-preferences'
import { cn } from '@vertexade/ui/lib/utils'

const themes: Array<{ id: ThemePreset; label: string; color: string }> = [
  { id: 'default', label: 'Indigo', color: '#8b92ff' },
  { id: 'black', label: 'Black', color: '#171717' },
  { id: 'graphite', label: 'Graphite', color: '#52525b' },
  { id: 'slate', label: 'Slate', color: '#64748b' },
  { id: 'violet', label: 'Violet', color: '#9b87f5' },
  { id: 'ocean', label: 'Ocean', color: '#38b7dc' },
  { id: 'teal', label: 'Teal', color: '#2dd4bf' },
  { id: 'forest', label: 'Forest', color: '#57c77c' },
  { id: 'lime', label: 'Lime', color: '#a3e635' },
  { id: 'amber', label: 'Amber', color: '#e6a23c' },
  { id: 'orange', label: 'Orange', color: '#fb923c' },
  { id: 'rose', label: 'Rose', color: '#ed7799' },
  { id: 'fuchsia', label: 'Fuchsia', color: '#e879f9' },
]

const messageBubbleThemes: Array<{
  id: MessageBubblePreset
  label: string
  color: string
}> = [{ id: 'theme', label: 'Theme', color: 'var(--primary)' }, ...themes]

const fonts: Array<{ id: FontPreset; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'humanist', label: 'Humanist' },
  { id: 'geometric', label: 'Geometric' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
  { id: 'custom', label: 'Custom stack' },
]

const threadFonts: Array<{ id: ThreadFontPreset; label: string }> = [{ id: 'interface', label: 'Follow interface' }, ...fonts]
const threadFontSizes: Array<{ id: ThreadFontSize; label: string }> = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
]

export function AppearanceSettings() {
  const { setTheme } = useTheme()
  const [value, setValue] = useState(defaultAppearancePreferences)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setValue(readAppearancePreferences())
    setMounted(true)
  }, [])

  function update(patch: Partial<AppearancePreferences>) {
    const next = { ...value, ...patch }
    setValue(next)
    saveAppearancePreferences(next)
    if (patch.colorMode) setTheme(patch.colorMode)
  }

  function reset() {
    setValue(defaultAppearancePreferences)
    saveAppearancePreferences(defaultAppearancePreferences)
    setTheme(defaultAppearancePreferences.colorMode)
  }

  if (!mounted) return <Skeleton className="h-64 rounded-lg" />

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <Card layout="divided">
          <CardHeader>
            <CardTitle>Color and theme</CardTitle>
            <CardDescription>Choose how the workspace follows your display and which accent palette it uses.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel id="appearance-color-mode">Display mode</FieldLabel>
                <SegmentedControl className="grid w-full grid-cols-3" aria-labelledby="appearance-color-mode">
                  {(['system', 'light', 'dark'] as ColorMode[]).map((mode) => (
                    <SegmentedControlItem
                      key={mode}
                      active={value.colorMode === mode}
                      className="justify-center capitalize"
                      onClick={() => update({ colorMode: mode })}
                    >
                      {value.colorMode === mode && <Check data-icon="inline-start" />}
                      {mode}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                <FieldDescription>System follows the current operating-system appearance.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel id="appearance-accent-palette">Accent palette</FieldLabel>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {themes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => update({ themePreset: theme.id })}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/35 text-[11px] text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-muted/60',
                        value.themePreset === theme.id &&
                          'border-primary/60 bg-primary/10 text-accent-foreground shadow-sm ring-1 ring-primary/15',
                      )}
                      aria-pressed={value.themePreset === theme.id}
                    >
                      <span className="size-5 rounded-full border border-white/15" style={{ backgroundColor: theme.color }} />
                      {theme.label}
                    </button>
                  ))}
                </div>
                <FieldDescription>Applied immediately to interactive controls, focus states, and accents.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel id="appearance-message-bubbles">Message bubbles</FieldLabel>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {messageBubbleThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => update({ messageBubblePreset: theme.id })}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-background/35 text-[11px] text-muted-foreground transition-all hover:-translate-y-0.5 hover:bg-muted/60',
                        value.messageBubblePreset === theme.id &&
                          'border-primary/60 bg-primary/10 text-accent-foreground shadow-sm ring-1 ring-primary/15',
                      )}
                      aria-pressed={value.messageBubblePreset === theme.id}
                    >
                      <span className="size-5 rounded-full border border-white/15" style={{ backgroundColor: theme.color }} />
                      {theme.label}
                    </button>
                  ))}
                </div>
                <FieldDescription>Choose a message color independently, or keep it matched to the interface theme.</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card layout="divided">
          <CardHeader>
            <CardTitle>Typography</CardTitle>
            <CardDescription>Set interface and code fonts independently. Custom values accept a CSS font-family stack.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="sm:grid-cols-2">
              <FontControl
                label="Interface font"
                value={value.interfaceFont}
                customValue={value.customInterfaceFont}
                onPreset={(interfaceFont) => update({ interfaceFont })}
                onCustom={(customInterfaceFont) => update({ customInterfaceFont })}
              />
              <FontControl
                label="Code font"
                value={value.codeFont}
                customValue={value.customCodeFont}
                onPreset={(codeFont) => update({ codeFont })}
                onCustom={(customCodeFont) => update({ customCodeFont })}
              />
              <ThreadTypographyControl
                font={value.threadFont}
                customFont={value.customThreadFont}
                size={value.threadFontSize}
                onFont={(threadFont) => update({ threadFont })}
                onCustomFont={(customThreadFont) => update({ customThreadFont })}
                onSize={(threadFontSize) => update({ threadFontSize })}
              />
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 xl:sticky xl:top-16 xl:self-start">
        <Card layout="divided">
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Changes apply to this browser immediately.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-base font-semibold">Clear priorities</p>
              <p className="mt-1 text-sm text-muted-foreground">A calm hierarchy keeps the next action visible.</p>
            </div>
            <div className="rounded-md border bg-muted/35 p-3 font-mono text-xs">
              <span className="text-primary">const</span> workspace = {'{'} focused: true {'}'}
            </div>
            <Button size="sm">Primary action</Button>
          </CardContent>
        </Card>
        <Button variant="ghost" size="sm" className="w-full" onClick={reset}>
          <RotateCcw data-icon="inline-start" />
          Restore appearance defaults
        </Button>
      </div>
    </div>
  )
}

function ThreadTypographyControl({
  font,
  customFont,
  size,
  onFont,
  onCustomFont,
  onSize,
}: {
  font: ThreadFontPreset
  customFont: string
  size: ThreadFontSize
  onFont: (value: ThreadFontPreset) => void
  onCustomFont: (value: string) => void
  onSize: (value: ThreadFontSize) => void
}) {
  return (
    <Field className="sm:col-span-2">
      <FieldLabel>Thread messages</FieldLabel>
      <FieldGroup className="grid grid-cols-2 gap-2">
        <Select value={font} onValueChange={(next) => onFont(next as ThreadFontPreset)}>
          <SelectTrigger aria-label="Thread message font">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {threadFonts.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={size} onValueChange={(next) => onSize(next as ThreadFontSize)}>
          <SelectTrigger aria-label="Thread message size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {threadFontSizes.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FieldGroup>
      {font === 'custom' && (
        <Input
          value={customFont}
          onChange={(event) => onCustomFont(event.target.value)}
          placeholder="Inter, Arial, sans-serif"
          aria-label="Thread message custom font stack"
        />
      )}
      <FieldDescription>Shared by user and agent messages; code keeps the code font.</FieldDescription>
    </Field>
  )
}

function FontControl({
  label,
  value,
  customValue,
  onPreset,
  onCustom,
}: {
  label: string
  value: FontPreset
  customValue: string
  onPreset: (value: FontPreset) => void
  onCustom: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => onPreset(next as FontPreset)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {fonts.map((font) => (
              <SelectItem key={font.id} value={font.id}>
                {font.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {value === 'custom' && (
        <Input
          value={customValue}
          onChange={(event) => onCustom(event.target.value)}
          placeholder="Inter, Arial, sans-serif"
          aria-label={`${label} custom stack`}
        />
      )}
      <FieldDescription>
        {value === 'custom' ? 'Stored locally in this browser.' : 'Uses a curated cross-platform font stack.'}
      </FieldDescription>
    </Field>
  )
}
