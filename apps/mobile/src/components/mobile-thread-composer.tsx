import { useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { MobileAgentOptions as MobileAgentLaunchOptions } from '@/mobile-agent-options'
import type { MobileThreadDelivery, MobileThreadDetails } from '@/mobile-detail-service'
import { canComposeThreadMessage, isActive } from '@/mobile-thread-presentation'
import { colors } from '@/theme'
import { MobileAgentOptions } from './mobile-agent-options'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileGlass } from './mobile-glass'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'
import { MobileSymbol } from './mobile-symbol'
import { MobileAttachButton, MobileThreadAttachments, useMobileThreadAttachments } from './mobile-thread-attachments'
import { TextInputWrapper, type PasteEventPayload } from 'expo-paste-input'
import { useMobileVoiceInput } from './use-mobile-voice-input'
import { useMobileTranscriptScrubber } from './use-mobile-transcript-scrubber'
import { useOptionalMobileApp } from './mobile-app-context'
import { defaultMobileVoicePreferences } from '@/mobile-voice-preferences'

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
  const voicePreferences = useOptionalMobileApp()?.voicePreferences || defaultMobileVoicePreferences
  const attachments = useMobileThreadAttachments(serviceUrl, detail.backendId, value, onChange)
  const scrubber = useMobileTranscriptScrubber(onChange, voicePreferences)
  const voice = useMobileVoiceInput((transcript) => scrubber.applyDictation(value, transcript))
  if (!canComposeThreadMessage(detail)) return null
  const active = isActive(detail.status)
  const primaryDelivery: MobileThreadDelivery = active ? 'queue' : 'follow-up'
  const unavailable = composerUnavailable(busy, attachments.uploading, voice.active || scrubber.scrubbing, value)
  return (
    <View style={styles.composerFrame}>
      <MobileThreadAttachments controller={attachments} />
      <ModelPreparationProgress voice={voice} />
      <VoiceFeedback voice={voice} />
      {scrubber.error ? <Text accessibilityRole="alert" style={styles.error}>{scrubber.error}</Text> : null}
      <View testID="thread-composer-row" style={styles.composerRow}>
        <MobileGlass testID="thread-composer-glass" style={styles.composerInputGlass}>
          <TextInputWrapper
            testID="thread-paste-target"
            onPaste={(payload: PasteEventPayload) => payload.type === 'images' && void attachments.addUris(payload.uris)}
            style={styles.composerPasteWrapper}
          >
            <TextInput
              accessibilityLabel="Thread message"
              experimental_acceptDragAndDropTypes={['public.image', 'image/*']}
              maxLength={20_000}
              multiline
              placeholder="Message"
              placeholderTextColor={colors.muted}
              scrollEnabled
              style={[styles.input, styles.composerInput]}
              value={value}
              onChangeText={onChange}
            />
          </TextInputWrapper>
        </MobileGlass>
        {active && detail.canSteer ? (
          <MobileGlass interactive style={styles.composerControlGlass}>
            <Pressable
              accessibilityLabel="Steer current turn"
              accessibilityRole="button"
              disabled={unavailable}
              onPress={() => onSend('steer')}
              style={[styles.composerIconButton, unavailable && styles.disabled]}
            >
              <MobileSymbol name="arrow.turn.up.right" fallback="↗" color={colors.accent} size={18} />
            </Pressable>
          </MobileGlass>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active ? 'Queue next turn' : 'Send follow-up'}
          disabled={unavailable}
          onPress={() => onSend(primaryDelivery)}
          style={[styles.composerSendButton, unavailable && styles.disabled]}
        >
          <MobileSymbol name="arrow.up" fallback="↑" color={colors.ink} size={18} />
        </Pressable>
      </View>
      <View testID="thread-composer-controls" style={styles.composerControlsRow}>
        <MobileAttachButton controller={attachments} />
        <VoiceButton voice={voice} />
        {voicePreferences.cleanupMode !== 'off' ? <TranscriptScrubButton disabled={!value.trim() || voice.active} scrubber={scrubber} value={value} /> : null}
        <MobileGlass interactive style={styles.composerConfigGlass}>
          <Pressable
            testID="thread-settings"
            accessibilityRole="button"
            accessibilityLabel="Execution settings"
            hitSlop={6}
            onPress={() => setSettingsOpen(true)}
            style={({ pressed }) => [styles.composerConfigButton, pressed && styles.pressed]}
          >
            <MobileSymbol name="gearshape" fallback="⚙" color={colors.accent} size={17} />
            <View style={styles.composerConfigCopy}>
              <Text numberOfLines={1} style={styles.composerConfigTitle}>{agentOptionLabel(options)}</Text>
              <Text numberOfLines={1} style={styles.composerConfigMeta}>{agentConfigLabel(options)}</Text>
            </View>
            <MobileSymbol name="chevron.right" fallback="›" color={colors.muted} size={13} />
          </Pressable>
        </MobileGlass>
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

type TranscriptScrubber = ReturnType<typeof useMobileTranscriptScrubber>

function TranscriptScrubButton({ disabled, scrubber, value }: { disabled: boolean; scrubber: TranscriptScrubber; value: string }) {
  return (
    <MobileGlass interactive style={styles.composerControlGlass}>
      <Pressable
        accessibilityLabel="Clean up message"
        accessibilityRole="button"
        disabled={disabled || scrubber.scrubbing}
        onPress={() => void scrubber.scrub(value)}
        style={({ pressed }) => [styles.composerIconButton, (disabled || scrubber.scrubbing) && styles.disabled, pressed && styles.pressed]}
      >
        {scrubber.scrubbing ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <MobileSymbol name="wand.and.sparkles" fallback="✦" color={colors.accent} size={18} />
        )}
      </Pressable>
    </MobileGlass>
  )
}

function agentOptionLabel(options: MobileAgentLaunchOptions) {
  return options.agentId || 'Default agent'
}

function agentConfigLabel(options: MobileAgentLaunchOptions) {
  return [options.model || 'Default model', options.reasoningEffort || 'Default reasoning', options.allowSubagents ? 'Subagents on' : 'Subagents off'].join(' · ')
}

type VoiceController = ReturnType<typeof useMobileVoiceInput>

function ModelPreparationProgress({ voice }: { voice: VoiceController }) {
  const progress = voice.modelProgress
  if (!progress) return null
  const percentage = Math.max(0, Math.min(100, Math.round(progress.progress)))
  const action = progress.status === 'ready' ? 'Voice model ready' : 'Preparing bundled voice model'
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percentage }} style={styles.composerModelProgress}>
      <View style={styles.composerModelProgressHeader}>
        <Text style={styles.composerModelProgressLabel}>{action}</Text>
        <Text style={styles.composerModelProgressValue}>{percentage}%</Text>
      </View>
      <View style={styles.composerModelProgressTrack}>
        <View style={[styles.composerModelProgressFill, { width: `${percentage}%` }]} />
      </View>
      <Text style={styles.composerModelProgressHint}>Optimizing the bundled model for this iPhone. No download is needed.</Text>
    </View>
  )
}

function composerUnavailable(busy: boolean, uploading: boolean, voiceActive: boolean, value: string) {
  return busy || uploading || voiceActive || !value.trim()
}

function VoiceFeedback({ voice }: { voice: VoiceController }) {
  return (
    <>
      {voice.preview ? (
        <Text numberOfLines={2} style={styles.composerVoicePreview}>
          {voice.preview}
        </Text>
      ) : null}
      {voice.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {voice.error}
        </Text>
      ) : null}
    </>
  )
}

function VoiceButton({ voice }: { voice: VoiceController }) {
  const waiting = voice.state === 'preparing' || voice.state === 'finishing'
  const listening = voice.state === 'listening'
  return (
    <MobileGlass interactive style={styles.composerControlGlass}>
      <Pressable
        accessibilityLabel={listening ? 'Stop voice input' : 'Start voice input'}
        accessibilityRole="button"
        accessibilityState={{ selected: voice.active }}
        disabled={waiting}
        onPress={voice.toggle}
        style={({ pressed }) => [styles.composerIconButton, voice.active && styles.composerVoiceActive, pressed && styles.pressed]}
      >
        {waiting ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <MobileSymbol
            name={listening ? 'stop.fill' : 'mic.fill'}
            fallback={listening ? '■' : '●'}
            color={listening ? colors.danger : colors.accent}
            size={18}
          />
        )}
      </Pressable>
    </MobileGlass>
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
    <Modal allowSwipeDismissal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={onClose}>
      <MobileModalSafeArea style={styles.actionModal}>
        <MobileSheetHeader
          title="Execution settings"
          subtitle="Applied to the next message sent from this composer."
          trailingLabel="Done"
          onTrailing={onClose}
        />
        <ScrollView contentContainerStyle={styles.actionModalContent}>
          <MobileAgentOptions serviceUrl={serviceUrl} backendId={detail.backendId} lockedAgentId={detail.agentId} value={value} onChange={onChange} />
        </ScrollView>
      </MobileModalSafeArea>
    </Modal>
  )
}
