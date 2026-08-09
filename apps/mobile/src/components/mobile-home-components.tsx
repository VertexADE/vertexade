import { router } from 'expo-router'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'
import { colors } from '@/theme'
import { mobileHomeStyles as styles } from './mobile-home-styles'

export function MobileHomeHero() {
  return <View style={styles.hero}>
    <Text style={styles.eyebrow}>DECLARATIVE EXTENSION HOST</Text>
    <Text style={styles.title}>Your work surfaces, native.</Text>
    <Text style={styles.subtitle}>Connect to VertexADE and open any extension that publishes a portable surface contract.</Text>
  </View>
}

export function MobileConnectionPanel({ server, loading, error, onServerChange, onConnect }: {
  server: string
  loading: boolean
  error: string
  onServerChange(value: string): void
  onConnect(): void
}) {
  return <View testID="connection-panel" style={styles.panel}>
    <Text style={styles.label}>VertexADE API URL</Text>
    <TextInput testID="connection-url" accessibilityLabel="VertexADE API URL" autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.10:4174" placeholderTextColor={colors.muted} style={styles.input} value={server} onChangeText={onServerChange} />
    <Pressable testID="connection-submit" accessibilityLabel={loading ? 'Connecting to VertexADE' : 'Connect to VertexADE'} accessibilityRole="button" accessibilityState={{ disabled: loading || !server.trim(), busy: loading }} disabled={loading || !server.trim()} onPress={onConnect} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (loading || !server.trim()) && styles.disabled]}>
      {loading ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>Connect</Text>}
    </Pressable>
    <Text style={styles.warning}>Development / trusted network only. The current local API does not yet provide mobile authentication.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>
}

export function MobileExtensionList({ modules, server }: { modules: ModuleCatalogEntry[]; server: string }) {
  return <View testID="extension-list" style={styles.section}>
    <Text style={styles.sectionTitle}>Portable extensions</Text>
    <Text style={styles.sectionMeta}>{modules.length} available</Text>
    {modules.length ? modules.map((module) => <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${module.name}`}
      testID={`extension-${module.id}`}
      key={module.id}
      onPress={() => router.push({ pathname: '/extensions/[moduleId]', params: { moduleId: module.id, server: normalizePlatformBaseUrl(server) } })}
      style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
    >
      <View style={styles.moduleIcon}><Text style={styles.moduleIconText}>{module.name.slice(0, 1)}</Text></View>
      <View style={styles.moduleCopy}><Text style={styles.moduleTitle}>{module.name}</Text><Text style={styles.moduleDescription}>{module.description}</Text><Text style={styles.moduleMeta}>{[module.enabled && module.portable?.surfaces.length ? 'Workspace' : '', module.portable?.settings ? 'Settings' : '', !module.enabled ? 'Disabled' : ''].filter(Boolean).join(' · ')}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>) : <View style={styles.empty}><Text style={styles.emptyTitle}>No portable extensions</Text><Text style={styles.emptyText}>Enabled extensions will appear when their manifest declares a portable surface.</Text></View>}
  </View>
}
