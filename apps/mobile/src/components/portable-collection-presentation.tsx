import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import type { PortableItemAction } from '@vertexade/platform-contracts'
import type { PortableCollectionItem, PortableField } from '@vertexade/platform-contracts/portable'
import { colors, spacing } from '@/theme'
import { portableCollectionStyles as styles } from './portable-collection-styles'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'

export function CollectionChip({ active, disabled = false, label, onPress, testID }: { active: boolean; disabled?: boolean; label: string; onPress: () => void; testID?: string }) {
  return <Pressable disabled={disabled} testID={testID} accessibilityRole="button" accessibilityState={{ selected: active, disabled }} onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>
}

export function CollectionRecordCard({ item, actions, compact = false, onDetails, onAction }: {
  item: PortableCollectionItem
  actions: PortableItemAction[]
  compact?: boolean
  onDetails: (item: PortableCollectionItem) => void
  onAction: (action: PortableItemAction) => void
}) {
  return <View style={[styles.card, compact && styles.cardCompact, item.depth ? { marginLeft: Math.min(item.depth, 4) * spacing.md } : undefined]}>
    <Text style={styles.cardTitle}>{item.title}</Text>
    <View style={styles.fields}>{item.fields.filter((field) => field.placement === 'card').map((field) => <CollectionFieldValue field={field} key={field.name} />)}</View>
    <View style={styles.cardActions}><Pressable testID={`record-${item.id}-details`} accessibilityRole="button" onPress={() => onDetails(item)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>Details</Text></Pressable>
      {actions.map((action) => <Pressable testID={`record-${item.id}-action-${action.id}`} accessibilityRole="button" key={action.id} onPress={() => onAction(action)} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>{action.label}</Text></Pressable>)}</View>
  </View>
}

function CollectionFieldValue({ field }: { field: PortableField }) {
  const date = field.style === 'date' && !Number.isNaN(Date.parse(field.value)) ? new Date(field.value).toLocaleDateString() : field.value
  return <View style={styles.field}><Text style={styles.fieldName}>{field.name.toUpperCase()}</Text>
    {field.style === 'badge' ? <Text style={styles.badge}>{field.value}</Text>
      : field.style === 'person' ? <View style={styles.person}><CollectionAvatar imageUrl={field.imageUrl} name={field.value} /><Text style={styles.fieldValue}>{field.value}</Text></View>
        : field.style === 'links' && field.relations.length ? <View style={styles.relations}>{field.relations.map((relation) => <Pressable accessibilityRole={relation.url ? 'link' : undefined} key={relation.id} onPress={relation.url ? () => void Linking.openURL(relation.url!) : undefined} style={styles.relation}><CollectionAvatar imageUrl={relation.imageUrl} name={relation.title} /><Text numberOfLines={1} style={styles.relationText}>{relation.title}</Text></Pressable>)}</View>
          : <Text style={styles.fieldValue}>{date}</Text>}
  </View>
}

function CollectionAvatar({ imageUrl, name }: { imageUrl?: string; name: string }) {
  return imageUrl?.startsWith('https://')
    ? <Image source={{ uri: imageUrl }} style={styles.avatarImage} />
    : <Text style={styles.avatar}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</Text>
}

export function CollectionDetailsModal({ item, actions, data, loading, onClose, onAction }: { item: PortableCollectionItem | null; actions: PortableItemAction[]; data: unknown; loading: boolean; onClose: () => void; onAction: (action: PortableItemAction) => void }) {
  return <Modal allowSwipeDismissal animationType="slide" presentationStyle="pageSheet" visible={Boolean(item)} onRequestClose={onClose}>
    <MobileModalSafeArea testID="record-details" style={styles.modal}><MobileSheetHeader title={item?.title || 'Record details'} subtitle="Record details" trailingLabel="Done" trailingTestID="record-details-close" onTrailing={onClose} />
      <ScrollView contentContainerStyle={styles.modalContent}>{item?.fields.map((field) => <CollectionFieldValue field={field} key={field.name} />)}{loading ? <ActivityIndicator color={colors.accent} /> : null}{data !== null ? <CollectionDetailValue value={data} /> : null}</ScrollView>
      {item && actions.length ? <View style={styles.modalActions}>{actions.map((action) => <Pressable key={action.id} onPress={() => onAction(action)} style={styles.modalPrimary}><Text style={styles.primaryButtonText}>{action.label}</Text></Pressable>)}</View> : null}
    </MobileModalSafeArea>
  </Modal>
}

function CollectionDetailValue({ value, label }: { value: unknown; label?: string }) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'object') return <View style={styles.field}>{label ? <Text style={styles.fieldName}>{label.replaceAll('_', ' ').toUpperCase()}</Text> : null}<Text style={styles.fieldValue}>{String(value)}</Text></View>
  if (Array.isArray(value)) return <View style={styles.detailGroup}>{label ? <Text style={styles.inputLabel}>{label.replaceAll('_', ' ')}</Text> : null}{value.map((item, index) => <View key={index} style={styles.detailBox}><CollectionDetailValue value={item} /></View>)}</View>
  return <View style={styles.detailGroup}>{label ? <Text style={styles.inputLabel}>{label.replaceAll('_', ' ')}</Text> : null}{Object.entries(value as Record<string, unknown>).map(([key, item]) => <CollectionDetailValue key={key} label={key} value={item} />)}</View>
}

export function CollectionScreenState({ title, text, loading = false, action, onAction }: { title: string; text: string; loading?: boolean; action?: string; onAction?: () => void }) {
  return <View style={styles.state}>{loading ? <ActivityIndicator color={colors.accent} /> : null}<Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{text}</Text>{action && onAction ? <Pressable onPress={onAction} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{action}</Text></Pressable> : null}</View>
}
