import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { ModuleCatalogEntry, PortableSettingsSurface } from '@vertexade/platform-contracts'
import { colors } from '@/theme'
import { PortableSettingsContent } from './portable-settings-content'
import { portableSettingsStyles as styles } from './portable-settings-styles'
import { usePortableSettings } from './use-portable-settings'

export function PortableSettingsScreen({
  module,
  serviceUrl,
  backendId,
  settings,
  onSaved,
}: {
  module: ModuleCatalogEntry
  serviceUrl: string
  backendId: string
  settings: PortableSettingsSurface
  onSaved?(): void
}) {
  const state = usePortableSettings({ module, serviceUrl, backendId, settings, onSaved })
  if (state.loading) return <LoadingSettings />
  if (state.error && !Object.keys(state.values).length) return <FailedSettings error={state.error} retry={state.load} />
  return <PortableSettingsContent module={module} settings={settings} {...state} />
}

function LoadingSettings() {
  return (
    <View style={styles.state}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.description}>Loading settings…</Text>
    </View>
  )
}

function FailedSettings({ error, retry }: { error: string; retry(): Promise<void> }) {
  return (
    <View style={styles.state}>
      <Text style={styles.error}>{error}</Text>
      <Pressable style={styles.secondaryButton} onPress={() => void retry()}>
        <Text style={styles.secondaryButtonText}>Retry</Text>
      </Pressable>
    </View>
  )
}
