import { router } from 'expo-router'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import type { ModuleCatalogEntry } from '@vertexade/platform-contracts'
import { normalizePlatformBaseUrl } from '@vertexade/platform-client'
import type { MobileServerCatalog } from '@/platform-service'
import type { MobileSession } from '@/mobile-session'
import { colors } from '@/theme'
import { mobileHomeStyles as styles } from './mobile-home-styles'
import { MobileGlass } from './mobile-glass'

export function MobileHomeHero() {
  return <View style={styles.hero}>
    <Text style={styles.eyebrow}>VERTEXADE MOBILE</Text>
    <Text style={styles.title}>PRs, Work, and agent threads.</Text>
    <Text style={styles.subtitle}>Pair each VertexADE server directly, then move between Focus, Work, PRs, and agent threads.</Text>
  </View>
}

export function MobileConnectionPanel({ serviceUrl, connectionName, pairedServers = [], loading, error, onServiceUrlChange, onConnectionNameChange, onConnect, onSelectServer }: {
  serviceUrl: string
  connectionName: string
  pairedServers?: MobileSession[]
  loading: boolean
  error: string
  onServiceUrlChange(value: string): void
  onConnectionNameChange(value: string): void
  onConnect(): void
  onSelectServer?(serviceUrl: string): void
}) {
  return <MobileGlass testID="connection-panel" style={styles.panel}>
    {pairedServers.length ? <View style={styles.serverGroup}>
      <Text style={styles.label}>Paired servers</Text>
      {pairedServers.map((session) => <Pressable
        key={session.serviceUrl}
        accessibilityRole="button"
        disabled={loading}
        onPress={() => onSelectServer?.(session.serviceUrl)}
        style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
      >
        <View style={styles.moduleCopy}><Text style={styles.moduleTitle}>{session.name || session.serviceUrl}</Text><Text style={styles.moduleMeta}>Open server</Text></View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>)}
    </View> : null}
    <Text style={styles.label}>Desktop pair link</Text>
    <TextInput testID="connection-name" accessibilityLabel="Connection name" accessibilityState={{ disabled: loading }} autoCapitalize="words" autoCorrect editable={!loading} placeholder="Connection name (optional)" placeholderTextColor={colors.muted} returnKeyType="next" style={styles.input} value={connectionName} onChangeText={onConnectionNameChange} />
    <TextInput testID="connection-url" accessibilityLabel="VertexADE pair link or service URL" accessibilityState={{ disabled: loading }} autoCapitalize="none" autoCorrect={false} editable={!loading} keyboardType="url" placeholder="http://100.101.138.108:3773/pair#token=…" placeholderTextColor={colors.muted} style={styles.input} value={serviceUrl} onChangeText={onServiceUrlChange} />
    <Pressable testID="connection-submit" accessibilityLabel={loading ? 'Pairing with VertexADE Desktop' : 'Pair and connect'} accessibilityRole="button" accessibilityState={{ disabled: loading || !serviceUrl.trim(), busy: loading }} disabled={loading || !serviceUrl.trim()} onPress={onConnect} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (loading || !serviceUrl.trim()) && styles.disabled]}>
      {loading ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryButtonText}>Pair and connect</Text>}
    </Pressable>
    <Text style={styles.warning}>Generate a one-time link in VertexADE Desktop → Settings → Connectivity. Pair every server separately; links configured by another server are not imported.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </MobileGlass>
}

export function MobileExtensionList({ servers, serviceUrl }: { servers: MobileServerCatalog[]; serviceUrl: string }) {
  const connected = servers.filter((server) => !server.error).length
  const moduleCount = servers.reduce((total, server) => total + server.modules.length, 0)
  return <View testID="extension-list" style={styles.section}>
    <Text style={styles.sectionTitle}>Extensions</Text>
    <Text style={styles.sectionMeta}>{connected}/{servers.length} direct {servers.length === 1 ? 'server' : 'servers'} live · {moduleCount} portable {moduleCount === 1 ? 'extension' : 'extensions'}</Text>
    {servers.map((server) => <MobileGlass key={server.id} testID={`server-${server.id}`} style={styles.serverGroup}>
      <View style={styles.serverHeading}>
        <Text style={styles.serverName}>{server.label}</Text>
        <Text style={[styles.serverState, server.error && styles.serverStateError]}>{server.error ? 'Unavailable' : `${server.modules.length} available`}</Text>
      </View>
      {server.error ? <Text accessibilityRole="alert" style={styles.error}>{server.error}</Text>
        : server.modules.length ? server.modules.map((module) => <ModuleCard key={`${server.id}:${module.id}`} backendId={server.id} module={module} serviceUrl={serviceUrl} serverLabel={server.label} isDefaultServer={server.isDefault} />)
          : <View style={styles.empty}><Text style={styles.emptyTitle}>No portable extensions</Text><Text style={styles.emptyText}>This server has no extension with a portable surface.</Text></View>}
    </MobileGlass>)}
  </View>
}

function ModuleCard({ backendId, module, serviceUrl, serverLabel, isDefaultServer }: {
  backendId: string
  module: ModuleCatalogEntry
  serviceUrl: string
  serverLabel: string
  isDefaultServer: boolean
}) {
  return <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${module.name} on ${serverLabel}`}
      testID={isDefaultServer ? `extension-${module.id}` : `extension-${backendId}-${module.id}`}
      onPress={() => router.push({ pathname: '/extensions/[moduleId]', params: { moduleId: module.id, serviceUrl: normalizePlatformBaseUrl(serviceUrl), backendId } })}
      style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
    >
      <View style={styles.moduleIcon}><Text style={styles.moduleIconText}>{module.name.slice(0, 1)}</Text></View>
      <View style={styles.moduleCopy}><Text style={styles.moduleTitle}>{module.name}</Text><Text style={styles.moduleDescription}>{module.description}</Text><Text style={styles.moduleMeta}>{[module.enabled && module.portable?.surfaces.length ? 'Workspace' : '', module.portable?.settings ? 'Settings' : '', !module.enabled ? 'Disabled' : ''].filter(Boolean).join(' · ')}</Text></View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
}
