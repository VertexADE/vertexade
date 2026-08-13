import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import {
  loadMobileAgentResourceSelection,
  type MobileAgentResourceSelection,
  type MobileAgentResourceSelectionCatalog,
  type MobileSelectableAgentResource,
} from '@/mobile-workspace-service'
import { colors } from '@/theme'
import { CollectionChip } from './portable-collection-presentation'
import { portableCollectionStyles as styles } from './portable-collection-styles'

const emptyCatalog: MobileAgentResourceSelectionCatalog = { skills: [], mcpServers: [] }

export function MobileAgentResourcePicker({ serviceUrl, backendId, workItemId, value, onChange }: {
  serviceUrl: string
  backendId: string
  workItemId?: number
  value: MobileAgentResourceSelection | null
  onChange(value: MobileAgentResourceSelection): void
}) {
  const [catalog, setCatalog] = useState(emptyCatalog)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void loadMobileAgentResourceSelection(serviceUrl, backendId, workItemId)
      .then((result) => {
        if (!active) return
        setCatalog(result)
        onChange({ skills: enabledIds(result.skills), mcpServers: enabledIds(result.mcpServers) })
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Skills and MCP servers could not be loaded')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [backendId, serviceUrl, workItemId])

  if (loading) return <ActivityIndicator accessibilityLabel="Loading skills and MCP servers" color={colors.accent} />
  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
  if (!catalog.skills.length && !catalog.mcpServers.length) return <Text style={styles.subtitle}>No skills or MCP servers are configured on this server.</Text>
  const selected = value || { skills: [], mcpServers: [] }
  return <View testID="agent-resources" style={styles.inputGroup}>
    <ResourceGroup title="Skills" items={catalog.skills} selected={selected.skills} onChange={(skills) => onChange({ ...selected, skills })} />
    <ResourceGroup title="MCP servers" items={catalog.mcpServers} selected={selected.mcpServers} onChange={(mcpServers) => onChange({ ...selected, mcpServers })} />
  </View>
}

function enabledIds(items: MobileSelectableAgentResource[]) {
  return items.filter((item) => item.enabled).map((item) => item.id)
}

function ResourceGroup({ title, items, selected, onChange }: {
  title: string
  items: MobileSelectableAgentResource[]
  selected: string[]
  onChange(value: string[]): void
}) {
  if (!items.length) return null
  return <View style={styles.inputGroup}>
    <Text style={styles.inputLabel}>{title}</Text>
    <View style={styles.chips}>{items.map((item) => <CollectionChip
      active={selected.includes(item.id)}
      key={item.id}
      label={`${item.name}${item.defaultEnabled ? ' · default' : ''}`}
      onPress={() => onChange(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id])}
    />)}</View>
  </View>
}
