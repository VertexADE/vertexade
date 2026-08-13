import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { colors, radii, spacing } from '@/theme'
import { MobileSymbol } from './mobile-symbol'

export function MobileSearchField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange(value: string): void }) {
  return <View style={styles.field}>
    <MobileSymbol name="magnifyingglass" fallback="⌕" color={colors.muted} size={16} />
    <TextInput accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} clearButtonMode="never" placeholder={placeholder} placeholderTextColor={colors.muted} returnKeyType="search" style={styles.input} value={value} onChangeText={onChange} />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChange('')} style={({ pressed }) => pressed && styles.pressed}>
      <MobileSymbol name="xmark.circle.fill" fallback="×" color={colors.muted} size={16} />
    </Pressable> : null}
  </View>
}

const styles = StyleSheet.create({
  field: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderCurve: 'continuous', borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, minHeight: 36, paddingHorizontal: 10 },
  input: { color: colors.text, flex: 1, fontSize: 17, minWidth: 0, paddingVertical: 7 },
  pressed: { opacity: 0.5 },
})
