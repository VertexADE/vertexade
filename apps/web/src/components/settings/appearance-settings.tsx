import { useEffect, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@vertexade/ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vertexade/ui/components/ui/card'
import { Input } from '@vertexade/ui/components/ui/input'
import { Label } from '@vertexade/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@vertexade/ui/components/ui/select'
import {
  defaultAppearancePreferences,
  readAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
  type ColorMode,
  type FontPreset,
  type ThemePreset,
} from '@vertexade/ui/lib/appearance-preferences'
import { cn } from '@vertexade/ui/lib/utils'

const themes: Array<{ id: ThemePreset; label: string; color: string }> = [
  { id: 'default', label: 'Indigo', color: '#6672df' },
  { id: 'violet', label: 'Violet', color: '#9b87f5' },
  { id: 'ocean', label: 'Ocean', color: '#38b7dc' },
  { id: 'forest', label: 'Forest', color: '#57c77c' },
  { id: 'amber', label: 'Amber', color: '#e6a23c' },
  { id: 'rose', label: 'Rose', color: '#ed7799' },
]

const fonts: Array<{ id: FontPreset; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'humanist', label: 'Humanist' },
  { id: 'geometric', label: 'Geometric' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
  { id: 'custom', label: 'Custom stack' },
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

  if (!mounted) return <div className="h-64 animate-pulse rounded-lg border bg-card" />

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Color and theme</CardTitle>
            <CardDescription>Choose how the workspace follows your display and which accent palette it uses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {(['system', 'light', 'dark'] as ColorMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={value.colorMode === mode ? 'secondary' : 'outline'}
                  className={cn(
                    'h-10 justify-between capitalize transition-all',
                    value.colorMode === mode && 'border-primary/30 bg-primary/10 text-foreground shadow-sm',
                  )}
                  onClick={() => update({ colorMode: mode })}
                >
                  {mode}
                  {value.colorMode === mode && <Check />}
                </Button>
              ))}
            </div>
            <div>
              <Label className="mb-2 block">Accent palette</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Typography</CardTitle>
            <CardDescription>Set interface and code fonts independently. Custom values accept a CSS font-family stack.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3 xl:sticky xl:top-16 xl:self-start">
        <Card className="overflow-hidden">
          <CardHeader className="border-b pb-3">
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Changes apply to this browser immediately.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
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
          <RotateCcw />
          Restore appearance defaults
        </Button>
      </div>
    </div>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => onPreset(next as FontPreset)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fonts.map((font) => (
            <SelectItem key={font.id} value={font.id}>
              {font.label}
            </SelectItem>
          ))}
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
    </div>
  )
}
