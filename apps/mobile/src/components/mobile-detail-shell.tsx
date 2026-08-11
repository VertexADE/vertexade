import type { ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'

export type MobileDetailTab<Tab extends string> = { id: Tab; label: string }

export function MobileDetailShell<Tab extends string>({
  eyebrow,
  title,
  subtitle,
  tabs,
  activeTab,
  loading,
  error,
  children,
  onTab,
  onBack,
  onClose,
  onRetry,
}: {
  eyebrow: string
  title: string
  subtitle: string
  tabs: Array<MobileDetailTab<Tab>>
  activeTab: Tab
  loading: boolean
  error: string
  children: ReactNode
  onTab(tab: Tab): void
  onBack?: () => void
  onClose(): void
  onRetry(): void
}) {
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={onClose}>
      <View testID="workspace-detail-modal" style={styles.modal}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {onBack ? (
              <Pressable testID="workspace-detail-back" accessibilityRole="button" onPress={onBack}>
                <Text style={styles.close}>Back</Text>
              </Pressable>
            ) : null}
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable testID="workspace-detail-close" accessibilityRole="button" onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {tabs.map((tab) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === tab.id }}
                key={tab.id}
                testID={`detail-tab-${tab.id}`}
                onPress={() => onTab(tab.id)}
                style={({ pressed }) => [styles.tab, activeTab === tab.id && styles.tabActive, pressed && styles.pressed]}
              >
                <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        {loading ? (
          <DetailState loading title="Loading details…" text="Reading the owning VertexADE server." />
        ) : error ? (
          <DetailState title="Details unavailable" text={error} action="Retry" onAction={onRetry} />
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

export function DetailSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      {children}
    </View>
  )
}

export function DetailMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  )
}

export function DetailRow({
  title,
  text,
  meta,
  first = false,
  testID,
  onPress,
}: {
  title: string
  text?: ReactNode
  meta?: string
  first?: boolean
  testID?: string
  onPress?: () => void
}) {
  const renderedText = typeof text === 'string' ? text ? <Text style={styles.rowText}>{text}</Text> : null : text
  const content = (
    <>
      <Text style={styles.rowTitle}>{title}</Text>
      {renderedText}
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
    </>
  )
  if (onPress)
    return (
      <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[styles.row, first && styles.rowFirst]}>
        {content}
      </Pressable>
    )
  return (
    <View testID={testID} style={[styles.row, first && styles.rowFirst]}>
      {content}
    </View>
  )
}

function DetailState({
  loading = false,
  title,
  text,
  action,
  onAction,
}: {
  loading?: boolean
  title: string
  text: string
  action?: string
  onAction?: () => void
}) {
  return (
    <View style={styles.state}>
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{text}</Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
