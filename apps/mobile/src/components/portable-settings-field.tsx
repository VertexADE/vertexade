import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import type { PortableSettingsField } from '@vertexade/platform-contracts'
import {
  portableRecords,
  portableSettingsFieldStored,
  portableSettingsOptions,
  portableSettingsValues,
  readPortablePath,
} from '@vertexade/platform-contracts/portable'
import { colors } from '@/theme'
import { portableSettingsStyles as styles } from './portable-settings-styles'

type SettingsFieldProps = {
  field: PortableSettingsField
  value: unknown
  source: unknown
  optionSource: unknown
  actionResults: Record<string, unknown>
  onChange(value: unknown): void
}

function fieldIsVisible(field: PortableSettingsField, values: unknown) {
  if (!field.visibleWhen) return true
  const value = readPortablePath(values, field.visibleWhen.input)
  if ('equals' in field.visibleWhen) return value === field.visibleWhen.equals
  if ('notEquals' in field.visibleWhen) return value !== field.visibleWhen.notEquals
  return true
}

export function PortableSettingsFieldEditor({ field, value, source, optionSource, actionResults, onChange }: SettingsFieldProps) {
  if (!fieldIsVisible(field, optionSource) || field.type === 'hidden') return null
  const required = field.required && !portableSettingsFieldStored(field, source)
  const label = <Text style={styles.fieldLabel}>{field.label}{required ? ' *' : ''}</Text>
  const description = field.description ? <Text style={styles.description}>{field.description}</Text> : null

  if (field.type === 'boolean') return <View style={styles.field}>
    <View style={styles.switchRow}>{label}<Switch testID={`settings-field-${field.name}`} accessibilityLabel={field.label} value={Boolean(value)} onValueChange={onChange} trackColor={{ true: colors.accent }} /></View>
    {description}
  </View>

  if (field.type === 'select' || field.type === 'multiselect') {
    const selected = field.type === 'multiselect' ? (Array.isArray(value) ? value.map(String) : []) : [String(value || '')]
    const options = portableSettingsOptions(field, optionSource, actionResults)
    for (const selectedValue of selected.filter(Boolean)) if (!options.some((option) => option.value === selectedValue)) options.push({ value: selectedValue, label: selectedValue })
    return <View style={styles.field}>
      {label}
      <View style={styles.choices}>
        {options.map((option) => {
          const active = selected.includes(option.value)
          const disabled = field.type === 'multiselect' && !active && selected.length >= (field.maxItems || Infinity)
          return <Pressable testID={`settings-field-${field.name}-${option.value}`} accessibilityLabel={`${field.label}: ${option.label}`} key={option.value} disabled={disabled} accessibilityRole={field.type === 'multiselect' ? 'checkbox' : 'radio'} accessibilityState={{ checked: active, disabled }} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]} onPress={() => {
            if (field.type === 'select') onChange(option.value)
            else onChange(active ? selected.filter((item) => item !== option.value) : [...selected, option.value])
          }}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{option.label}</Text></Pressable>
        })}
        {!options.length && <Text style={styles.description}>Use the discovery action to load choices.</Text>}
      </View>
      {description}
    </View>
  }

  if (field.type === 'string-list') {
    const values = Array.isArray(value) ? value.map(String) : []
    return <View style={styles.field}>
      {label}
      {values.map((item, index) => <View key={index} style={styles.row}>
        <TextInput style={[styles.input, styles.flex]} value={item} placeholder={field.placeholder} placeholderTextColor={colors.muted} onChangeText={(text) => onChange(values.map((current, currentIndex) => currentIndex === index ? text : current))} />
        <Pressable style={styles.smallButton} onPress={() => onChange(values.filter((_current, currentIndex) => currentIndex !== index))}><Text style={styles.smallButtonText}>Remove</Text></Pressable>
      </View>)}
      <Pressable disabled={values.length >= (field.maxItems || Infinity)} style={styles.secondaryButton} onPress={() => onChange([...values, ''])}><Text style={styles.secondaryButtonText}>{field.addLabel || 'Add value'}</Text></Pressable>
      {description}
    </View>
  }

  if (field.type === 'object-list') {
    const rows = portableRecords(value)
    const sourceRows = portableRecords(readPortablePath(source, field.valuePath || field.name))
    const nested = field.fields || []
    const update = (index: number, next: Record<string, unknown>) => onChange(rows.map((row, current) => current === index ? next : row))
    return <View style={styles.field}>
      {label}{description}
      {rows.map((row, index) => <View key={index} style={styles.objectCard}>
        {nested.map((child) => <PortableSettingsFieldEditor key={child.name} field={child} value={row[child.name]} source={sourceRows[index] || {}} optionSource={{ ...(optionSource as Record<string, unknown>), ...row }} actionResults={actionResults} onChange={(next) => update(index, { ...row, [child.name]: next })} />)}
        <View style={styles.row}>
          {field.allowReorder && <><Pressable disabled={!index} style={styles.smallButton} onPress={() => { const next = [...rows]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next) }}><Text style={styles.smallButtonText}>Up</Text></Pressable>
          <Pressable disabled={index === rows.length - 1} style={styles.smallButton} onPress={() => { const next = [...rows]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; onChange(next) }}><Text style={styles.smallButtonText}>Down</Text></Pressable></>}
          <Pressable disabled={rows.length <= (field.minItems || 0)} style={styles.smallButton} onPress={() => onChange(rows.filter((_row, current) => current !== index))}><Text style={styles.dangerText}>Remove</Text></Pressable>
        </View>
      </View>)}
      <Pressable disabled={rows.length >= (field.maxItems || Infinity)} style={styles.secondaryButton} onPress={() => onChange([...rows, portableSettingsValues({}, nested)])}><Text style={styles.secondaryButtonText}>{field.addLabel || 'Add item'}</Text></Pressable>
    </View>
  }

  const stored = portableSettingsFieldStored(field, source)
  return <View style={styles.field}>
    {label}
    <TextInput
      testID={`settings-field-${field.name}`}
      accessibilityLabel={field.label}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={field.type === 'number' ? 'numeric' : 'default'}
      multiline={field.type === 'textarea'}
      placeholder={field.placeholder || (stored ? 'Stored securely · leave blank to keep it' : undefined)}
      placeholderTextColor={colors.muted}
      secureTextEntry={field.type === 'password'}
      style={[styles.input, field.type === 'textarea' && styles.textarea]}
      value={String(value ?? '')}
      onChangeText={onChange}
    />
    {description}
  </View>
}
