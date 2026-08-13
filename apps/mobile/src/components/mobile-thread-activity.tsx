import { useCallback, useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { MobileDiffFile, MobileInputQuestion, MobileQueuedFollowUp, MobileThreadDetails } from '@/mobile-detail-service'
import { colors } from '@/theme'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailSection, useDetailLoadEarlier } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'
import { MobileSymbol } from './mobile-symbol'

const INITIAL_MESSAGE_COUNT = 60
const MESSAGE_PAGE_SIZE = 40
const MAX_TRANSCRIPT_CHARACTERS = 24_000

export function MobileThreadActivity({
  detail,
  queueBusyId,
  onSteerQueued,
  onCancelQueued,
  onReorderQueued,
}: {
  detail: MobileThreadDetails
  queueBusyId: number | null
  onSteerQueued(id: number): void
  onCancelQueued(id: number): void
  onReorderQueued(ids: number[]): void
}) {
  const sessions = useMemo(() => threadWorkSessions(detail), [detail])
  const messageCount = sessions.reduce((total, session) => total + session.messages.length, 0)
  const [visibleCount, setVisibleCount] = useState(() => Math.min(messageCount, INITIAL_MESSAGE_COUNT))
  const hiddenCount = Math.max(0, messageCount - visibleCount)
  const loadEarlier = useCallback(() => setVisibleCount((count) => Math.min(messageCount, count + MESSAGE_PAGE_SIZE)), [messageCount])
  useDetailLoadEarlier(loadEarlier, hiddenCount > 0)
  const visibleIds = new Set(
    sessions
      .flatMap((session) => session.messages)
      .slice(hiddenCount)
      .map((message) => message.id),
  )
  const visibleSessions = sessions
    .map((session) => ({
      ...session,
      messages: session.messages.filter((message) => visibleIds.has(message.id)),
    }))
    .filter((session) => session.messages.length)
  return (
    <>
      <View accessibilityRole="list" style={styles.chatTimeline}>
        {visibleSessions.length ? (
          <View testID="thread-markdown-transcript">
            {visibleSessions.map((session) => (
              <WorkSession key={session.id} session={session} />
            ))}
          </View>
        ) : (
          <View style={styles.chatEmpty}>
            <Text style={styles.muted}>{detail.latestActivity || 'No conversation yet.'}</Text>
          </View>
        )}
      </View>
      <QueuedThreadMessages
        messages={detail.queuedFollowUps}
        canSteer={detail.canSteer}
        busyId={queueBusyId}
        onSteer={onSteerQueued}
        onCancel={onCancelQueued}
        onReorder={onReorderQueued}
      />
    </>
  )
}

type ThreadMessageRole = 'user' | 'assistant' | 'system'
type ThreadMessage = {
  id: string
  role: ThreadMessageRole
  title: string
  text: string
  meta: string
  time: string
  tool: boolean
  files: MobileDiffFile[]
  additions: number
  deletions: number
}
type ThreadWorkSession = {
  id: string
  complete: boolean
  messages: ThreadMessage[]
}

function threadWorkSessions(detail: MobileThreadDetails): ThreadWorkSession[] {
  const sessions: ThreadWorkSession[] = []
  let current = newWorkSession(sessions.length, initialPrompt(detail))
  for (const event of detail.events) {
    if (isSessionTrigger(event)) {
      closeWorkSession(sessions, current)
      current = newWorkSession(sessions.length)
    }
    const message = threadMessage(event, detail.agentName)
    if (message) current.messages.push(message)
    if (isSessionCompletion(event)) {
      closeWorkSession(sessions, current)
      current = newWorkSession(sessions.length)
    }
  }
  if (current.messages.length) sessions.push(current)
  if (!['starting', 'running'].includes(detail.status) && sessions.length) sessions[sessions.length - 1].complete = true
  return sessions
}

function initialPrompt(detail: MobileThreadDetails): ThreadMessage[] {
  const shownInEvents = detail.events.some((event) => event.text.trim() === detail.prompt.trim())
  return detail.prompt && !shownInEvents
    ? [
        {
          id: 'prompt',
          role: 'user',
          title: 'You',
          text: detail.prompt,
          meta: '',
          time: detail.createdAt,
          tool: false,
          files: [],
          additions: 0,
          deletions: 0,
        },
      ]
    : []
}

function newWorkSession(index: number, messages: ThreadMessage[] = []): ThreadWorkSession {
  return { id: `session-${index + 1}`, complete: false, messages }
}

function closeWorkSession(sessions: ThreadWorkSession[], session: ThreadWorkSession) {
  session.complete = true
  if (session.messages.length) sessions.push(session)
}

function isSessionTrigger(event: MobileThreadDetails['events'][number]): boolean {
  return event.event.toLowerCase().replaceAll('-', '_') === 'follow_up_started'
}

function isSessionCompletion(event: MobileThreadDetails['events'][number]): boolean {
  return event.event.toLowerCase().replaceAll('-', '_') === 'turn_completed'
}

function threadMessage(event: MobileThreadDetails['events'][number], agentName: string): ThreadMessage | null {
  if (!shouldShowThreadEvent(event)) return null
  return {
    id: event.id,
    role: eventRole(event.kind),
    title: eventTitle(event.kind, event.title, agentName),
    text: event.text,
    meta: [event.status, formatDate(event.time)].filter(Boolean).join(' · '),
    time: event.time,
    tool: isToolEvent(event),
    files: event.files || [],
    additions: event.additions || 0,
    deletions: event.deletions || 0,
  }
}

function WorkSession({ session }: { session: ThreadWorkSession }) {
  const [expanded, setExpanded] = useState(!session.complete)
  const presentation = workSessionPresentation(session)
  return (
    <View style={styles.workSessionFlow}>
      <SessionMessage message={presentation.trigger} emptyText="No request content." />
      <View style={styles.workSession}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.workSessionHeader}>
          <View style={styles.workSessionCopy}>
            <Text style={styles.workSessionTitle}>{presentation.title}</Text>
            <Text style={styles.workSessionMeta}>
              {presentation.activity.length} update
              {presentation.activity.length === 1 ? '' : 's'}
              {presentation.tools ? ` · ${presentation.tools} tools` : ''}
            </Text>
          </View>
          <MobileSymbol name={expanded ? 'chevron.down' : 'chevron.right'} fallback={expanded ? '⌄' : '›'} color={colors.muted} size={13} />
        </Pressable>
        <SessionActivity expanded={expanded} messages={presentation.activity} />
      </View>
      <SessionMessage message={presentation.finalMessage} emptyText="No final response." />
      <TurnChanges message={presentation.changes} />
    </View>
  )
}

function workSessionPresentation(session: ThreadWorkSession) {
  const triggerIndex = session.messages.findIndex((message) => message.role === 'user' && message.text.trim())
  const finalIndex = session.complete ? findFinalAssistantIndex(session.messages) : -1
  const trigger = triggerIndex >= 0 ? session.messages[triggerIndex] : undefined
  const finalMessage = finalIndex >= 0 ? session.messages[finalIndex] : undefined
  const changes = session.messages.findLast((message) => message.files.length > 0)
  const activity = session.messages.filter((message, index) => index !== triggerIndex && index !== finalIndex && !message.files.length)
  const tools = activity.filter((message) => message.tool).length
  return {
    activity,
    finalMessage,
    changes,
    title: session.complete ? `Worked for ${workDuration(session.messages)}` : 'Agent is working',
    tools,
    trigger,
  }
}

function TurnChanges({ message }: { message?: ThreadMessage }) {
  const [expanded, setExpanded] = useState(false)
  if (!message?.files.length) return null
  return (
    <View style={styles.turnChanges}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.turnChangesHeader}
      >
        <MobileSymbol name="doc.on.doc" fallback="▤" color={colors.accent} size={14} />
        <Text style={styles.turnChangesTitle}>{message.files.length} changed {message.files.length === 1 ? 'file' : 'files'}</Text>
        <Text style={styles.turnChangesAdditions}>+{message.additions}</Text>
        <Text style={styles.turnChangesDeletions}>−{message.deletions}</Text>
        <MobileSymbol name={expanded ? 'chevron.down' : 'chevron.right'} fallback={expanded ? '⌄' : '›'} color={colors.muted} size={12} />
      </Pressable>
      {expanded ? (
        <View style={styles.turnChangesFiles}>
          <Text style={styles.turnChangesSummary}>{message.text}</Text>
          {message.files.map((file) => (
            <View key={`${file.status}:${file.path}`} style={styles.turnChangesFile}>
              <MobileSymbol name="doc.text" fallback="·" color={colors.muted} size={12} />
              <Text numberOfLines={2} style={styles.turnChangesPath}>{file.path}</Text>
              <Text style={styles.turnChangesAdditions}>+{file.additions}</Text>
              <Text style={styles.turnChangesDeletions}>−{file.deletions}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function SessionMessage({ message, emptyText }: { message?: ThreadMessage; emptyText: string }) {
  if (!message) return null
  const user = message.role === 'user'
  const copy = () => Clipboard.setStringAsync(message.text)
  return (
    <View testID={`thread-${message.role}-message`} style={[styles.chatMessageRow, user && styles.chatMessageRowUser]}>
      <Pressable
        accessibilityHint="Copies this message"
        onLongPress={() => void copy()}
        testID={`thread-${message.role}-bubble`}
        style={user ? [styles.chatMessage, styles.chatMessageUser] : styles.chatAssistantMessage}
      >
        <MobileMarkdown content={message.text.trim() || 'No message content.'} emptyText={emptyText} tone={user ? 'onAccent' : 'default'} />
      </Pressable>
      <View style={[styles.chatMessageActions, user && styles.chatMessageActionsUser]}>
        <Text style={styles.chatMessageTime}>{formatTime(message.time)}</Text>
        <MessageCopyButton label={`Copy ${user ? 'your' : 'agent'} message`} onCopy={copy} />
      </View>
    </View>
  )
}

function MessageCopyButton({ label, onCopy }: { label: string; onCopy(): Promise<boolean> }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1_500)
  }
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={8} onPress={() => void copy()} style={styles.chatMessageCopy}>
      <MobileSymbol name={copied ? 'checkmark' : 'doc.on.doc'} fallback={copied ? '✓' : 'Copy'} color={copied ? colors.accent : colors.muted} size={12} />
    </Pressable>
  )
}

function SessionActivity({ expanded, messages }: { expanded: boolean; messages: ThreadMessage[] }) {
  if (!expanded || !messages.length) return null
  return (
    <View style={styles.workSessionContent}>
      {boundedTimelineItems(messages).map((item) =>
        item.kind === 'tool' ? (
          <CompactToolCall key={item.message.id} message={item.message} />
        ) : (
          <MobileMarkdown key={item.id} content={markdownTranscript(item.messages)} emptyText="No activity yet." />
        ),
      )}
    </View>
  )
}

function findFinalAssistantIndex(messages: ThreadMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (messages[index].role === 'assistant' && !messages[index].tool && messages[index].text.trim()) return index
  return -1
}

function workDuration(messages: ThreadMessage[]): string {
  const times = messages.map((message) => Date.parse(message.time)).filter(Number.isFinite)
  if (times.length < 2) return 'a moment'
  const seconds = Math.max(0, Math.round((Math.max(...times) - Math.min(...times)) / 1000))
  if (seconds < 60) return seconds < 5 ? 'a moment' : `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function isToolEvent(event: MobileThreadDetails['events'][number]): boolean {
  const identity = `${event.kind} ${event.event}`.toLowerCase().replaceAll('-', '_')
  return ['action', 'tool', 'command', 'function_call'].some((value) => identity.includes(value))
}

function shouldShowThreadEvent(event: MobileThreadDetails['events'][number]): boolean {
  const eventName = event.event.toLowerCase().replaceAll('-', '_')
  const kind = event.kind.toLowerCase().replaceAll('-', '_')
  const title = event.title.trim().toLowerCase()
  const text = event.text.trim()
  if (!text && ['user', 'user_message', 'usermessage'].includes(kind)) return false
  if (['turn_completed', 'steer_accepted'].includes(eventName)) return false
  if (['turn completed', 'steer accepted'].includes(title)) return false
  return Boolean(text)
}

function markdownTranscript(messages: ThreadMessage[]): string {
  return messages
    .map((message) => {
      const author = message.role === 'assistant' ? '' : message.role === 'user' ? `**${message.title}**` : `### ${message.title}`
      const meta = message.meta ? `\n_${message.meta}_` : ''
      return `${author}${meta}\n\n${message.text.trim() || 'No message content.'}`.trim()
    })
    .join('\n\n---\n\n')
}

type TimelineItem = { kind: 'tool'; message: ThreadMessage } | { kind: 'messages'; id: string; messages: ThreadMessage[] }

function boundedTimelineItems(messages: ThreadMessage[]): TimelineItem[] {
  const selected: ThreadMessage[] = []
  let remaining = MAX_TRANSCRIPT_CHARACTERS
  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = messages[index]
    const text = message.text.length > remaining ? `…\n\n${message.text.slice(-remaining)}` : message.text
    selected.unshift({ ...message, text })
    remaining -= Math.min(message.text.length, remaining)
  }
  return selected.reduce<TimelineItem[]>((items, message) => {
    if (message.tool) return [...items, { kind: 'tool', message }]
    const previous = items.at(-1)
    if (previous?.kind === 'messages') {
      previous.messages.push(message)
      return items
    }
    return [...items, { kind: 'messages', id: `messages:${message.id}`, messages: [message] }]
  }, [])
}

function CompactToolCall({ message }: { message: ThreadMessage }) {
  const failed = message.meta.toLowerCase().includes('fail') || message.meta.toLowerCase().includes('error')
  return (
    <View accessibilityRole="summary" style={styles.toolCall}>
      <MobileSymbol
        name={failed ? 'exclamationmark.circle.fill' : 'wrench.and.screwdriver'}
        fallback={failed ? '!' : '⌁'}
        color={failed ? colors.danger : colors.muted}
        size={14}
      />
      <Text numberOfLines={1} style={styles.toolCallTitle}>
        {message.title || 'Tool call'}
      </Text>
      {message.meta ? (
        <Text numberOfLines={1} style={[styles.toolCallMeta, failed && styles.error]}>
          {message.meta}
        </Text>
      ) : null}
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
  onReorder,
}: {
  messages: MobileQueuedFollowUp[]
  canSteer: boolean
  busyId: number | null
  onSteer(id: number): void
  onCancel(id: number): void
  onReorder(ids: number[]): void
}) {
  if (!messages.length) return null
  return (
    <DetailSection title="Queued messages" meta={`${messages.length}`}>
      {messages.map((queued, index) => (
        <QueuedMessageCard
          key={queued.id}
          queued={queued}
          index={index}
          messages={messages}
          canSteer={canSteer}
          busy={busyId === queued.id}
          onSteer={onSteer}
          onCancel={onCancel}
          onReorder={onReorder}
        />
      ))}
    </DetailSection>
  )
}

function QueuedMessageCard({
  queued,
  index,
  messages,
  canSteer,
  busy,
  onSteer,
  onCancel,
  onReorder,
}: {
  queued: MobileQueuedFollowUp
  index: number
  messages: MobileQueuedFollowUp[]
  canSteer: boolean
  busy: boolean
  onSteer(id: number): void
  onCancel(id: number): void
  onReorder(ids: number[]): void
}) {
  return (
    <View style={styles.queueCard}>
      <View style={styles.actionsSpread}>
        <Text style={styles.rowTitle}>Next turn · position {index + 1}</Text>
        <Text style={styles.rowMeta}>{formatDate(queued.queuedAt)}</Text>
      </View>
      <MobileMarkdown content={queued.prompt} emptyText="Empty queued message." />
      {queued.model || queued.reasoningEffort ? (
        <Text style={styles.inputHint}>{[queued.model, queued.reasoningEffort].filter(Boolean).join(' · ')}</Text>
      ) : null}
      <View style={styles.actions}>
        <QueueMoveButton direction="up" disabled={busy || index === 0} onPress={() => onReorder(moveQueued(messages, index, -1))} />
        <QueueMoveButton direction="down" disabled={busy || index === messages.length - 1} onPress={() => onReorder(moveQueued(messages, index, 1))} />
        <QueueSteerButton visible={canSteer} busy={busy} id={queued.id} onSteer={onSteer} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => onCancel(queued.id)} style={[styles.secondaryButton, busy && styles.disabled]}>
          <Text style={styles.secondaryButtonText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  )
}

function QueueMoveButton({ direction, disabled, onPress }: { direction: 'up' | 'down'; disabled: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityLabel={`Move queued message ${direction}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondaryButton, disabled && styles.disabled]}
    >
      <MobileSymbol name={`chevron.${direction}`} fallback={direction === 'up' ? '↑' : '↓'} color={colors.text} size={13} />
    </Pressable>
  )
}

function QueueSteerButton({ visible, busy, id, onSteer }: { visible: boolean; busy: boolean; id: number; onSteer(id: number): void }) {
  if (!visible) return null
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onSteer(id)} style={[styles.primaryButton, busy && styles.disabled]}>
      <Text style={styles.primaryButtonText}>Use to steer now</Text>
    </Pressable>
  )
}

function moveQueued(messages: MobileQueuedFollowUp[], index: number, offset: -1 | 1): number[] {
  const ids = messages.map((message) => message.id)
  const target = index + offset
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  return ids
}

export function MobileThreadInputRequest({
  questions,
  answers,
  busy,
  onAnswer,
  onSubmit,
  onCancel,
}: {
  questions: MobileInputQuestion[]
  answers: Record<string, string[]>
  busy: boolean
  onAnswer(id: string, answer: string[]): void
  onSubmit(): void
  onCancel?(): void
}) {
  if (!questions.length) return null
  const complete = questions.every((question) => question.required === false || Boolean(answers[question.id]?.length))
  return (
    <DetailSection
      title={questions[0]?.formTitle || 'Agent needs input'}
      meta={`${questions.length} question${questions.length === 1 ? '' : 's'}`}
    >
      <Text style={styles.inputHint}>{questions[0]?.formDescription || 'Your response is sent directly to the waiting agent turn.'}</Text>
      {questions.map((question) => (
        <View key={question.id} style={styles.row}>
          <Text style={styles.rowTitle}>{question.formTitle ? question.question : question.header || question.question}</Text>
          {!question.formTitle && question.header ? <Text style={styles.rowText}>{question.question}</Text> : null}
          {question.description ? <Text style={styles.rowText}>{question.description}</Text> : null}
          {question.options.length ? (
            <>
              <View style={styles.actionList}>
                {question.options.map((option) => {
                  const selected = answers[question.id]?.includes(option.value) || false
                  return (
                    <Pressable
                      accessibilityRole={question.type === 'checkbox' ? 'checkbox' : 'radio'}
                      accessibilityState={{ selected }}
                      key={option.label}
                      onPress={() =>
                        onAnswer(
                          question.id,
                          question.type === 'checkbox'
                            ? selected
                              ? (answers[question.id] || []).filter((value) => value !== option.value)
                              : [...(answers[question.id] || []), option.value]
                            : [option.value],
                        )
                      }
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
              {question.type === 'select' && !question.formTitle ? (
                <TextInput
                  accessibilityLabel={`Custom answer for ${question.question}`}
                  secureTextEntry={question.secret}
                  placeholder="Other — enter a custom answer"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  value={question.options.some((option) => option.value === answers[question.id]?.[0]) ? '' : answers[question.id]?.[0] || ''}
                  onChangeText={(answer) => onAnswer(question.id, [answer])}
                />
              ) : null}
            </>
          ) : (
            <TextInput
              accessibilityLabel={question.question}
              secureTextEntry={question.secret}
              placeholder="Answer…"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={answers[question.id]?.[0] || ''}
              onChangeText={(answer) => onAnswer(question.id, [answer])}
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
      {onCancel ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.secondaryButton, busy && styles.disabled]}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      ) : null}
    </DetailSection>
  )
}

function formatDate(value: string): string {
  return formatTime(value)
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : value
}
