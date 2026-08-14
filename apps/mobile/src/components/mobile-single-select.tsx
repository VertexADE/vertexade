import { Host, Picker } from '@expo/ui'
import { Text, View } from 'react-native'
import { colors } from '@/theme'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'

export type MobileSelectOption<Value extends string = string> = { id: Value; label: string; meta?: string }

export function MobileSingleSelect<Value extends string>({ label, hint, options, value, placeholder = 'Choose an option', testID, enabled = true, onChange }: {
  label?: string
  hint?: string
  options: Array<MobileSelectOption<Value>>
  value: Value | ''
  placeholder?: string
  testID: string
  enabled?: boolean
  onChange(value: Value): void
}) {
  const selected = options.find((option) => option.id === value)
  const visibleOptions: Array<MobileSelectOption<Value | ''>> = value ? options : [{ id: '', label: placeholder }, ...options]
  if (!options.length) return hint ? <Text style={styles.inputHint}>{hint}</Text> : null
  return (
    <View style={styles.inputGroup}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
      <Host colorScheme="dark" seedColor={colors.accent} style={styles.dropdownHost}>
        <Picker appearance="menu" enabled={enabled} selectedValue={value} testID={testID} onValueChange={(nextValue) => {
          const option = options.find((candidate) => candidate.id === nextValue)
          if (option) onChange(option.id)
        }}>
          {visibleOptions.map((option) => <Picker.Item key={option.id} label={option.label} value={option.id} />)}
        </Picker>
      </Host>
      {selected?.meta ? <Text style={styles.inputHint}>{selected.meta}</Text> : null}
    </View>
  )
}
