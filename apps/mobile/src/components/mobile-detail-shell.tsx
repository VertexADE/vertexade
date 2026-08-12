import type { ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'

export type MobileDetailTab<Tab extends string> = { id: Tab; label: string }

type MobileDetailShellProps<Tab extends string> = {
  eyebrow: string
  title: string
  subtitle: string
  tabs: Array<MobileDetailTab<Tab>>
  activeTab: Tab
  loading: boolean
  error: string
  visible?: boolean
  headerContent?: ReactNode
  banner?: ReactNode
  footer?: ReactNode
  children: ReactNode
  onTab(tab: Tab): void
  onBack?: () => void
  onClose(): void
  onDismiss?(): void
  onRetry(): void
}

export function MobileDetailShell<Tab extends string>(props: MobileDetailShellProps<Tab>) {
  return (
    <Modal testID="workspace-detail-native-modal" animationType="slide" presentationStyle="pageSheet" visible={props.visible ?? true} onDismiss={props.onDismiss} onRequestClose={props.onClose}>
      <View testID="workspace-detail-modal" style={styles.modal}>
        <MobileDetailHeader {...props} />
        {props.banner}
        <MobileDetailBody {...props} />
      </View>
    </Modal>
  )
}

function MobileDetailHeader<Tab extends string>({
  eyebrow,
  title,
  subtitle,
  tabs,
  activeTab,
  headerContent,
  onTab,
  onBack,
  onClose,
}: MobileDetailShellProps<Tab>) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <DetailBackButton onBack={onBack} />
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {headerContent}
        </View>
        <Pressable testID="workspace-detail-close" accessibilityRole="button" onPress={onClose}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((tab) => <DetailTab key={tab.id} tab={tab} active={activeTab === tab.id} onTab={onTab} />)}
      </ScrollView>
    </View>
  )
}

function DetailBackButton({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <Pressable testID="workspace-detail-back" accessibilityRole="button" onPress={onBack}>
      <Text style={styles.close}>Back</Text>
    </Pressable>
  )
}

function DetailTab<Tab extends string>({
  tab,
  active,
  onTab,
}: {
  tab: MobileDetailTab<Tab>
  active: boolean
  onTab(tab: Tab): void
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      testID={`detail-tab-${tab.id}`}
      onPress={() => onTab(tab.id)}
      style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
    </Pressable>
  )
}

function MobileDetailBody<Tab extends string>({ loading, error, footer, children, onRetry }: MobileDetailShellProps<Tab>) {
  const ready = !loading && !error
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.detailBody}>
      <MobileDetailContent loading={loading} error={error} onRetry={onRetry}>{children}</MobileDetailContent>
      {ready ? footer : null}
    </KeyboardAvoidingView>
  )
}

function MobileDetailContent({
  loading,
  error,
  children,
  onRetry,
}: Pick<MobileDetailShellProps<string>, 'loading' | 'error' | 'children' | 'onRetry'>) {
  if (loading) return <DetailState loading title="Loading details…" text="Reading the owning VertexADE server." />
  if (error) return <DetailState title="Details unavailable" text={error} action="Retry" onAction={onRetry} />
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
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
