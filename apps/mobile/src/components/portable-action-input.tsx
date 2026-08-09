
import {
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { PortableActionInput, PortableActionValue } from '@vertexade/platform-contracts'
import { readPortablePath, type PortableCollectionItem } from '@vertexade/platform-contracts/portable'
import { colors } from '@/theme'
import { portableCollectionStyles as styles } from './portable-collection-styles'

import { actionInputOptions, type SourceData } from './portable-action-values'
export function ActionInput({ input, data, item, values, value, onChange }: { input: PortableActionInput; data: SourceData; item: PortableCollectionItem | null; values: Record<string, PortableActionValue>; value: PortableActionValue; onChange: (value: PortableActionValue) => void }) {
  if (input.type === 'hidden') return null
  if (input.type === 'boolean') return <View style={styles.booleanInput}><Text style={styles.inputLabel}>{input.label}</Text><Switch value={Boolean(value)} onValueChange={onChange} trackColor={{ true: colors.accentSoft }} thumbColor={Boolean(value) ? colors.accent : colors.muted} /></View>
  if (input.type === 'select' || input.type === 'multiselect') {
    const options = actionInputOptions(input, data, item).filter((option) => !input.optionsFilterInput || String(readPortablePath(option, input.optionsFilterPath) || ('parentValue' in option ? option.parentValue : '')) === String(values[input.optionsFilterInput] || ''))
    return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{input.label}</Text><View style={styles.optionList}>{options.map((option) => {
      const optionValue = String(readPortablePath(option, input.optionValuePath) || ('value' in option ? option.value : ''))
      const selected = input.type === 'multiselect' ? Array.isArray(value) && value.includes(optionValue) : value === optionValue
      return <Pressable accessibilityRole={input.type === 'multiselect' ? 'checkbox' : 'radio'} accessibilityState={{ selected, checked: selected }} key={optionValue} onPress={() => onChange(input.type === 'multiselect' ? (selected ? (Array.isArray(value) ? value : []).filter((item) => item !== optionValue) : [...(Array.isArray(value) ? value : []), optionValue]) : optionValue)} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{String(readPortablePath(option, input.optionLabelPath) || ('label' in option ? option.label : optionValue))}</Text></Pressable>
    })}</View></View>
  }
  return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{input.label}</Text><TextInput keyboardType={input.type === 'number' ? 'numeric' : 'default'} multiline={input.type === 'textarea'} numberOfLines={input.type === 'textarea' ? 5 : 1} placeholder={input.placeholder} placeholderTextColor={colors.muted} style={[styles.search, input.type === 'textarea' && styles.textarea]} value={String(value)} onChangeText={(next) => onChange(input.type === 'number' ? Number(next) : next)} /></View>
}
