import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '@/theme'

export type MobileExtensionMode = 'workspace' | 'settings'

export function MobileExtensionTabs({ mode, onChange }: { mode: MobileExtensionMode; onChange(mode: MobileExtensionMode): void }) {
  return <View style={styles.tabs}>
    <Pressable testID="extension-tab-workspace" accessibilityRole="tab" accessibilityState={{ selected: mode === 'workspace' }} style={[styles.tab, mode === 'workspace' && styles.tabActive]} onPress={() => onChange('workspace')}><Text style={[styles.tabText, mode === 'workspace' && styles.tabTextActive]}>Workspace</Text></Pressable>
    <Pressable testID="extension-tab-settings" accessibilityRole="tab" accessibilityState={{ selected: mode === 'settings' }} style={[styles.tab, mode === 'settings' && styles.tabActive]} onPress={() => onChange('settings')}><Text style={[styles.tabText, mode === 'settings' && styles.tabTextActive]}>Settings</Text></Pressable>
  </View>
}

export function MobileExtensionState({ title, text, loading = false }: { title?: string; text: string; loading?: boolean }) {
  return <View testID={loading ? 'extension-loading' : 'extension-state'} style={styles.state}>{loading ? <ActivityIndicator color={colors.accent} /> : null}{title ? <Text style={styles.stateTitle}>{title}</Text> : null}<Text style={styles.stateText}>{text}</Text></View>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.background, flex: 1 },
  state: { alignItems: 'center', flex: 1, gap: spacing.sm, justifyContent: 'center', padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  tabs: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  tab: { borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tabActive: { backgroundColor: colors.accentSoft },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.accent },
})

export { styles as mobileExtensionStyles }
