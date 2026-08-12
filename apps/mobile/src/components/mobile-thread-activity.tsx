import { Pressable, Text, TextInput, View } from 'react-native'
import type { MobileInputQuestion, MobileQueuedFollowUp, MobileThreadDetails } from '@/mobile-detail-service'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailSection } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'

export function MobileThreadActivity({
  detail,
  queueBusyId,
  onSteerQueued,
  onCancelQueued,
}: {
  detail: MobileThreadDetails
  queueBusyId: number | null
  onSteerQueued(id: number): void
  onCancelQueued(id: number): void
}) {
  const showsPrompt = detail.prompt && !detail.events.some((event) => event.text.trim() === detail.prompt.trim())
  return (
    <>
      <View accessibilityRole="list" style={styles.chatTimeline}>
        {showsPrompt ? <ThreadMessage role="user" title="You" text={detail.prompt} /> : null}
        {detail.events.map((event) => (
          <ThreadMessage
            key={event.id}
            role={eventRole(event.kind)}
            title={eventTitle(event.kind, event.title, detail.agentName)}
            text={event.text}
            meta={[event.status, formatDate(event.time)].filter(Boolean).join(' · ')}
          />
        ))}
        {!showsPrompt && !detail.events.length ? (
          <View style={styles.chatEmpty}>
            <Text style={styles.muted}>{detail.latestActivity || 'No conversation yet.'}</Text>
          </View>
        ) : null}
      </View>
      <QueuedThreadMessages
        messages={detail.queuedFollowUps}
        canSteer={detail.canSteer}
        busyId={queueBusyId}
        onSteer={onSteerQueued}
        onCancel={onCancelQueued}
      />
    </>
  )
}

type ThreadMessageRole = 'user' | 'assistant' | 'system'

function ThreadMessage({ role, title, text, meta = '' }: { role: ThreadMessageRole; title: string; text: string; meta?: string }) {
  const user = role === 'user'
  const system = role === 'system'
  return (
    <View accessibilityRole="listitem" style={[styles.chatMessageRow, user && styles.chatMessageRowUser]}>
      <View style={[styles.chatMessage, user && styles.chatMessageUser, system && styles.chatMessageSystem]}>
        <View style={styles.chatMessageHeader}>
          <Text style={[styles.chatMessageAuthor, user && styles.chatMessageAuthorUser]}>{title}</Text>
          {meta ? <Text style={styles.chatMessageMeta}>{meta}</Text> : null}
        </View>
        <MobileMarkdown content={text} emptyText="No message content." />
      </View>
    </View>
  )
}

function eventRole(kind: string): ThreadMessageRole {
  const normalized = kind.toLowerCase()
  if (['user', 'human', 'prompt', 'input'].some((value) => normalized.includes(value))) return 'user'
  if (['assistant', 'agent', 'message', 'response'].some((value) => normalized.includes(value))) return 'assistant'
  return 'system'
}

function eventTitle(kind: string, title: string, agentName: string): string {
  const role = eventRole(kind)
  if (role === 'user') return 'You'
  if (role === 'assistant') return agentName
  return title || readableKind(kind)
}

function readableKind(kind: string): string {
  const value = kind.replaceAll('_', ' ').trim()
  return value ? value[0].toUpperCase() + value.slice(1) : 'Thread update'
}

function QueuedThreadMessages({
  messages,
  canSteer,
  busyId,
  onSteer,
  onCancel,
}: {
  messages: MobileQueuedFollowUp[]
  canSteer: boolean
  busyId: number | null
  onSteer(id: number): void
  onCancel(id: number): void
}) {
  if (!messages.length) return null
  return (
    <DetailSection title="Queued messages" meta={`${messages.length}`}>
      {messages.map((queued, index) => {
        const busy = busyId === queued.id
        return (
          <View key={queued.id} style={styles.queueCard}>
            <View style={styles.actionsSpread}>
              <Text style={styles.rowTitle}>Next turn · position {index + 1}</Text>
              <Text style={styles.rowMeta}>{formatDate(queued.queuedAt)}</Text>
            </View>
            <MobileMarkdown content={queued.prompt} emptyText="Empty queued message." />
            {queued.model || queued.reasoningEffort ? (
              <Text style={styles.inputHint}>{[queued.model, queued.reasoningEffort].filter(Boolean).join(' · ')}</Text>
            ) : null}
            <View style={styles.actions}>
              {canSteer ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => onSteer(queued.id)}
                  style={[styles.primaryButton, busy && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>Use to steer now</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onCancel(queued.id)}
                style={[styles.secondaryButton, busy && styles.disabled]}
              >
                <Text style={styles.secondaryButtonText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )
      })}
    </DetailSection>
  )
}

export function MobileThreadInputRequest({
  questions,
  answers,
  busy,
  onAnswer,
  onSubmit,
}: {
  questions: MobileInputQuestion[]
  answers: Record<string, string>
  busy: boolean
  onAnswer(id: string, answer: string): void
  onSubmit(): void
}) {
  if (!questions.length) return null
  const complete = questions.every((question) => Boolean(answers[question.id]?.trim()))
  return (
    <DetailSection title="Agent needs input" meta={`${questions.length} question${questions.length === 1 ? '' : 's'}`}>
      <Text style={styles.inputHint}>Your response is sent directly to the waiting agent turn.</Text>
      {questions.map((question) => (
        <View key={question.id} style={styles.row}>
          <Text style={styles.rowTitle}>{question.header || question.question}</Text>
          {question.header ? <Text style={styles.rowText}>{question.question}</Text> : null}
          {question.options.length ? (
            <>
              <View style={styles.actionList}>
                {question.options.map((option) => {
                  const selected = answers[question.id] === option.label
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      key={option.label}
                      onPress={() => onAnswer(question.id, option.label)}
                      style={[styles.actionOption, selected && styles.optionSelected]}
                    >
                      <View style={styles.actionOptionCopy}>
                        <Text style={styles.actionOptionTitle}>{option.label}</Text>
                        {option.description ? <Text style={styles.actionOptionText}>{option.description}</Text> : null}
                      </View>
                      <Text style={selected ? styles.notice : styles.muted}>{selected ? 'Selected' : 'Choose'}</Text>
                    </Pressable>
                  )
                })}
              </View>
              <TextInput
                accessibilityLabel={`Custom answer for ${question.question}`}
                secureTextEntry={question.secret}
                placeholder="Other — enter a custom answer"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={question.options.some((option) => option.label === answers[question.id]) ? '' : answers[question.id] || ''}
                onChangeText={(answer) => onAnswer(question.id, answer)}
              />
            </>
          ) : (
            <TextInput
              accessibilityLabel={question.question}
              secureTextEntry={question.secret}
              placeholder="Answer…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={answers[question.id] || ''}
              onChangeText={(answer) => onAnswer(question.id, answer)}
            />
          )}
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !complete}
        onPress={onSubmit}
        style={[styles.primaryButton, (busy || !complete) && styles.disabled]}
      >
        <Text style={styles.primaryButtonText}>{busy ? 'Submitting…' : 'Submit answers'}</Text>
      </Pressable>
    </DetailSection>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
