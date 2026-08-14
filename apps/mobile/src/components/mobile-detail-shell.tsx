import { createContext, useContext, useEffect, useRef, type MutableRefObject, type ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileGlass } from './mobile-glass'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'

type MobileDetailTab<Tab extends string> = { id: Tab; label: string }
const DetailLoadEarlierContext = createContext<MutableRefObject<(() => void) | null> | null>(null)

export function useDetailLoadEarlier(handler: () => void, enabled: boolean) {
  const loadEarlier = useContext(DetailLoadEarlierContext)
  useEffect(() => {
    if (!loadEarlier || !enabled) return
    loadEarlier.current = handler
    return () => { if (loadEarlier.current === handler) loadEarlier.current = null }
  }, [enabled, handler, loadEarlier])
}

type MobileDetailShellProps<Tab extends string> = {
  eyebrow: string
  title: string
  subtitle: string
  tabs: Array<MobileDetailTab<Tab>>
  activeTab: Tab
  loading: boolean
  error: string
  visible?: boolean
  compactHeader?: boolean
  headerContent?: ReactNode
  headerAction?: ReactNode
  initialScrollToEnd?: boolean
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
    <Modal
      allowSwipeDismissal
      testID="workspace-detail-native-modal"
      animationType="slide"
      presentationStyle="pageSheet"
      visible={props.visible ?? true}
      onDismiss={props.onDismiss}
      onRequestClose={props.onClose}
    >
      <MobileModalSafeArea testID="workspace-detail-modal" style={styles.modal}>
        <MobileDetailHeader {...props} />
        {props.banner}
        <MobileDetailBody {...props} />
      </MobileModalSafeArea>
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
  headerAction,
  onTab,
  onBack,
  onClose,
  compactHeader,
}: MobileDetailShellProps<Tab>) {
  return (
    <MobileGlass style={[styles.header, compactHeader && styles.headerCompact]}>
      <MobileSheetHeader title={title} subtitle={compactHeader ? undefined : subtitle || eyebrow} leadingLabel={onBack ? 'Back' : undefined} trailingLabel="Done" trailingAccessory={headerAction} leadingTestID="workspace-detail-back" trailingTestID="workspace-detail-close" onLeading={onBack} onTrailing={onClose} />
      {headerContent}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((tab) => <DetailTab key={tab.id} tab={tab} active={activeTab === tab.id} onTab={onTab} />)}
      </ScrollView>
    </MobileGlass>
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

function MobileDetailBody<Tab extends string>({ loading, error, footer, children, initialScrollToEnd, onRetry }: MobileDetailShellProps<Tab>) {
  const ready = !loading && !error
  return (
    <View style={styles.detailBody}>
      <MobileDetailContent loading={loading} error={error} initialScrollToEnd={initialScrollToEnd} onRetry={onRetry}>{children}</MobileDetailContent>
      {ready ? footer : null}
    </View>
  )
}

function MobileDetailContent({
  loading,
  error,
  children,
  initialScrollToEnd,
  onRetry,
}: Pick<MobileDetailShellProps<string>, 'loading' | 'error' | 'children' | 'initialScrollToEnd' | 'onRetry'>) {
  const scroll = useRef<ScrollView>(null)
  const openingAtEnd = useRef(Boolean(initialScrollToEnd))
  const loadEarlier = useRef<(() => void) | null>(null)
  const lastOffset = useRef(0)
  const topLoadTriggered = useRef(false)
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.nativeEvent.contentOffset.y)
    const scrollingUp = offset < lastOffset.current
    if (scrollingUp && offset <= 120 && !topLoadTriggered.current) {
      topLoadTriggered.current = true
      loadEarlier.current?.()
    } else if (offset > 240) topLoadTriggered.current = false
    lastOffset.current = offset
  }
  if (loading) return <DetailState loading title="Loading details…" text="Reading the owning VertexADE server." />
  if (error) return <DetailState title="Details unavailable" text={error} action="Retry" onAction={onRetry} />
  return (
    <DetailLoadEarlierContext.Provider value={loadEarlier}>
      <ScrollView
        ref={scroll}
        testID="detail-scroll-view"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onContentSizeChange={() => { if (openingAtEnd.current) scroll.current?.scrollToEnd({ animated: false }) }}
        onScroll={onScroll}
        onScrollBeginDrag={() => { openingAtEnd.current = false }}
      >
        {children}
      </ScrollView>
    </DetailLoadEarlierContext.Provider>
  )
}

export function DetailSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <MobileGlass style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      {children}
    </MobileGlass>
  )
}

export function DetailMetric({ label, value, onPress }: { label: string; value: string | number; onPress?: () => void }) {
  const content = (
    <>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </>
  )
  if (onPress) return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label.toLowerCase()}`} onPress={onPress} style={({ pressed }) => [styles.metric, styles.metricInteractive, pressed && styles.pressed]}>{content}</Pressable>
  return <View style={styles.metric}>{content}</View>
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
