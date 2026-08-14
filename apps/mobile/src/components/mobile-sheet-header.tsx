import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '@/theme'
import { MobileSymbol } from './mobile-symbol'

type MobileSheetHeaderProps = {
  title: string
  subtitle?: string
  leadingLabel?: string
  trailingLabel?: string
  busy?: boolean
  leadingTestID?: string
  trailingTestID?: string
  accessory?: ReactNode
  trailingAccessory?: ReactNode
  onLeading?(): void
  onTrailing?(): void
}

export function MobileSheetHeader({ title, subtitle, leadingLabel, trailingLabel, busy, accessory, trailingAccessory, leadingTestID, trailingTestID, onLeading, onTrailing }: MobileSheetHeaderProps) {
  return <View style={styles.container}>
    <View style={styles.bar}>
      <HeaderAction testID={leadingTestID} label={leadingLabel} disabled={busy} side="leading" onPress={onLeading} />
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      {trailingAccessory || <HeaderAction testID={trailingTestID} label={trailingLabel} disabled={busy} side="trailing" onPress={onTrailing} />}
    </View>
    {subtitle || accessory ? <View style={styles.context}>
      {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
      {accessory}
    </View> : null}
  </View>
}

function HeaderAction({ label, disabled, side, testID, onPress }: { label?: string; disabled?: boolean; side: 'leading' | 'trailing'; testID?: string; onPress?: () => void }) {
  if (!label || !onPress) return <View style={styles.actionPlaceholder} />
  const back = side === 'leading' && label === 'Back'
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, side === 'trailing' && styles.actionTrailing, disabled && styles.disabled, pressed && styles.pressed]}>
    {back ? <MobileSymbol name="chevron.left" fallback="‹" color={colors.accent} size={16} /> : null}
    <Text numberOfLines={1} style={[styles.actionText, side === 'trailing' && styles.actionTextStrong]}>{label}</Text>
  </Pressable>
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.glassStrong, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, paddingTop: spacing.xs },
  bar: { alignItems: 'center', flexDirection: 'row', minHeight: 44, paddingHorizontal: spacing.sm },
  title: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  action: { alignItems: 'center', flexDirection: 'row', minHeight: 44, minWidth: 72, paddingHorizontal: spacing.xs },
  actionTrailing: { justifyContent: 'flex-end' },
  actionPlaceholder: { minWidth: 72 },
  actionText: { color: colors.accent, fontSize: 17 },
  actionTextStrong: { fontWeight: '600' },
  context: { gap: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.md },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.55 },
})
