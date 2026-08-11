import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { MobileAgentOptions as MobileAgentLaunchOptions } from '@/mobile-agent-options'
import type { MobileThreadDelivery, MobileThreadDetails } from '@/mobile-detail-service'
import { canComposeThreadMessage, isActive } from '@/mobile-thread-presentation'
import { colors } from '@/theme'
import { MobileAgentOptions } from './mobile-agent-options'
import { mobileDetailStyles as styles } from './mobile-detail-styles'

export function MobileThreadComposer({
  serviceUrl,
  detail,
  value,
  options,
  busy,
  onChange,
  onOptionsChange,
  onSend,
}: {
  serviceUrl: string
  detail: MobileThreadDetails
  value: string
  options: MobileAgentLaunchOptions
  busy: boolean
  onChange(value: string): void
  onOptionsChange(value: MobileAgentLaunchOptions): void
  onSend(delivery: MobileThreadDelivery): void
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  if (!canComposeThreadMessage(detail)) return null
  const active = isActive(detail.status)
  const primaryDelivery: MobileThreadDelivery = active ? 'queue' : 'follow-up'
  const unavailable = busy || !value.trim()
  return (
    <View style={styles.composerFrame}>
      <View style={styles.actionsSpread}>
        <View style={styles.actionOptionCopy}>
          <Text style={styles.rowTitle}>{active ? 'Guide the active thread' : 'Continue this thread'}</Text>
          <Text numberOfLines={1} style={styles.composerMeta}>{executionSummary(detail, options, active)}</Text>
        </View>
        {!active ? (
          <Pressable accessibilityRole="button" onPress={() => setSettingsOpen(true)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Settings</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel="Thread message"
        maxLength={20_000}
        multiline
        placeholder="Ask for a change, clarification, or next step…"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.compactTextarea]}
        value={value}
        onChangeText={onChange}
      />
      <View style={styles.footerActions}>
        {active && detail.canSteer ? (
          <Pressable
            accessibilityRole="button"
            disabled={unavailable}
            onPress={() => onSend('steer')}
            style={[styles.secondaryButton, styles.footerButton, unavailable && styles.disabled]}
          >
            <Text style={styles.secondaryButtonText}>Steer current</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={unavailable}
          onPress={() => onSend(primaryDelivery)}
          style={[styles.primaryButton, styles.footerButton, unavailable && styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>{active ? 'Queue next turn' : 'Send follow-up'}</Text>
        </Pressable>
      </View>
      <AgentSettingsModal
        open={settingsOpen}
        serviceUrl={serviceUrl}
        detail={detail}
        value={options}
        onChange={onOptionsChange}
        onClose={() => setSettingsOpen(false)}
      />
    </View>
  )
}

function AgentSettingsModal({
  open,
  serviceUrl,
  detail,
  value,
  onChange,
  onClose,
}: {
  open: boolean
  serviceUrl: string
  detail: MobileThreadDetails
  value: MobileAgentLaunchOptions
  onChange(value: MobileAgentLaunchOptions): void
  onClose(): void
}) {
  if (!open) return null
  return (
    <Modal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={onClose}>
      <View style={styles.actionModal}>
        <View style={styles.actionModalHeader}>
          <View style={styles.actionOptionCopy}>
            <Text style={styles.eyebrow}>NEXT AGENT TURN</Text>
            <Text style={styles.title}>Execution settings</Text>
            <Text style={styles.subtitle}>Applied when this completed thread starts its next turn.</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.actionModalContent}>
          <MobileAgentOptions
            serviceUrl={serviceUrl}
            backendId={detail.backendId}
            lockedAgentId={detail.agentId}
            value={value}
            onChange={onChange}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}

function executionSummary(detail: MobileThreadDetails, options: MobileAgentLaunchOptions, active: boolean): string {
  if (active) return 'Messages can queue for the next turn or steer the current one.'
  return [detail.agentName, options.model || detail.model || 'default model', options.reasoningEffort || detail.reasoningEffort]
    .filter(Boolean)
    .join(' · ')
}
