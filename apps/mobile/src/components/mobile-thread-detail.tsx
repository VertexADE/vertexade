import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import {
  deliverMobileThreadMessage,
  interruptMobileThread,
  loadMobileThreadDetails,
  retryMobileThread,
  submitMobileThreadInput,
  type MobileInputQuestion,
  type MobileQueuedFollowUp,
  type MobileThreadDelivery,
  type MobileThreadDetails,
} from '@/mobile-detail-service'
import type { MobileThread } from '@/mobile-workspace-service'
import { colors } from '@/theme'
import { MobileDiff } from './mobile-diff'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { DetailMetric, DetailRow, DetailSection, MobileDetailShell } from './mobile-detail-shell'
import { MobileMarkdown } from './mobile-markdown'
import { useMobileDetail } from './use-mobile-detail'

type ThreadDetailTab = 'activity' | 'output' | 'changes' | 'info'
const tabs = [
  { id: 'activity', label: 'Activity' },
  { id: 'output', label: 'Output' },
  { id: 'changes', label: 'Changes' },
  { id: 'info', label: 'Info' },
] satisfies Array<{ id: ThreadDetailTab; label: string }>
const deliverySuccessMessages: Record<MobileThreadDelivery, string> = {
  queue: 'Message queued for the next turn.',
  steer: 'The active turn was steered.',
  'follow-up': 'Follow-up sent.',
}

export function MobileThreadDetail({
  serviceUrl,
  thread,
  onBack,
  onClose,
  onChanged,
}: {
  serviceUrl: string
  thread: MobileThread
  onBack?: () => void
  onClose(): void
  onChanged(message: string): Promise<void>
}) {
  const [tab, setTab] = useState<ThreadDetailTab>('activity')
  const [message, setMessage] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const loader = useCallback(() => loadMobileThreadDetails(serviceUrl, thread), [serviceUrl, thread])
  const detail = useMobileDetail(`thread:${thread.backendId}:${thread.id}`, loader)

  useEffect(() => setAnswers({}), [thread.id])

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true)
    setActionError('')
    try {
      await action()
      setNotice(success)
      setMessage('')
      await detail.refresh()
      await onChanged(success)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not update this thread')
    } finally {
      setBusy(false)
    }
  }

  function send(delivery: MobileThreadDelivery) {
    void runAction(() => deliverMobileThreadMessage(serviceUrl, thread, message, delivery), deliverySuccessMessages[delivery])
  }

  return (
    <MobileDetailShell<ThreadDetailTab>
      eyebrow={`${thread.backendName.toUpperCase()} · ${thread.agentName}`}
      title={detail.value?.taskTitle || thread.taskTitle || `Thread ${thread.id}`}
      subtitle={`${detail.value?.status || thread.status} · ${thread.fullName}`}
      tabs={tabs}
      activeTab={tab}
      loading={detail.loading}
      error={detail.error}
      onTab={setTab}
      onBack={onBack}
      onClose={onClose}
      onRetry={() => void detail.refresh()}
    >
      <ThreadDetailAlerts notice={notice} error={actionError} />
      <ThreadDetailContent
        value={detail.value}
        answers={answers}
        busy={busy}
        message={message}
        onAnswer={(id, answer) => setAnswers((current) => ({ ...current, [id]: answer }))}
        tab={tab}
        onMessage={setMessage}
        onSend={send}
        onSubmit={() => void runAction(() => submitMobileThreadInput(serviceUrl, thread, answers), 'Answers submitted to the agent.')}
        onInterrupt={() => void runAction(() => interruptMobileThread(serviceUrl, thread), 'Interrupt requested.')}
        onRetry={() => void runAction(() => retryMobileThread(serviceUrl, thread), 'Thread retry started.')}
      />
    </MobileDetailShell>
  )
}

function ThreadDetailAlerts({ notice, error }: { notice: string; error: string }) {
  return (
    <>
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </>
  )
}

function ThreadDetailContent({
  value,
  answers,
  busy,
  message,
  tab,
  onAnswer,
  onSubmit,
  onMessage,
  onSend,
  onInterrupt,
  onRetry,
}: {
  value: MobileThreadDetails | null
  answers: Record<string, string>
  busy: boolean
  message: string
  tab: ThreadDetailTab
  onAnswer(id: string, answer: string): void
  onSubmit(): void
  onMessage(message: string): void
  onSend(delivery: MobileThreadDelivery): void
  onInterrupt(): void
  onRetry(): void
}) {
  if (!value) return null
  return (
    <>
      {value.inputQuestions.length ? (
        <ThreadInputQuestions questions={value.inputQuestions} answers={answers} busy={busy} onAnswer={onAnswer} onSubmit={onSubmit} />
      ) : null}
      <ThreadTabContent
        tab={tab}
        detail={value}
        message={message}
        busy={busy}
        onMessage={onMessage}
        onSend={onSend}
        onInterrupt={onInterrupt}
        onRetry={onRetry}
      />
    </>
  )
}

function ThreadTabContent({
  tab,
  detail,
  message,
  busy,
  onMessage,
  onSend,
  onInterrupt,
  onRetry,
}: {
  tab: ThreadDetailTab
  detail: MobileThreadDetails
  message: string
  busy: boolean
  onMessage(message: string): void
  onSend(delivery: MobileThreadDelivery): void
  onInterrupt(): void
  onRetry(): void
}) {
  if (tab === 'output') return <ThreadOutput detail={detail} />
  if (tab === 'changes') return <ThreadChanges detail={detail} />
  if (tab === 'info') return <ThreadInfo detail={detail} busy={busy} onInterrupt={onInterrupt} onRetry={onRetry} />
  return <ThreadActivity detail={detail} message={message} busy={busy} onMessage={onMessage} onSend={onSend} />
}

function ThreadActivity({
  detail,
  message,
  busy,
  onMessage,
  onSend,
}: {
  detail: MobileThreadDetails
  message: string
  busy: boolean
  onMessage(message: string): void
  onSend(delivery: MobileThreadDelivery): void
}) {
  return (
    <>
      <ThreadEventTimeline detail={detail} />
      <QueuedThreadMessages messages={detail.queuedFollowUps} />
      <ThreadMessageComposer detail={detail} message={message} busy={busy} onMessage={onMessage} onSend={onSend} />
    </>
  )
}

function ThreadEventTimeline({ detail }: { detail: MobileThreadDetails }) {
  return (
    <DetailSection title="Agent activity" meta={`${detail.events.length} events`}>
      {detail.events.length ? (
        detail.events.map((event, index) => (
          <DetailRow
            key={event.id}
            first={index === 0}
            title={event.title || event.kind}
            text={<MobileMarkdown content={event.text} emptyText="No event details." />}
            meta={[event.status, formatDate(event.time)].filter(Boolean).join(' · ')}
          />
        ))
      ) : (
        <Text style={styles.muted}>{detail.latestActivity || 'No timeline events yet.'}</Text>
      )}
    </DetailSection>
  )
}

function QueuedThreadMessages({ messages }: { messages: MobileQueuedFollowUp[] }) {
  if (!messages.length) return null
  return (
    <DetailSection title="Queued messages" meta={`${messages.length}`}>
      {messages.map((queued, index) => (
        <DetailRow
          key={queued.id}
          first={index === 0}
          title={`Position ${index + 1}`}
          text={queued.prompt}
          meta={formatDate(queued.queuedAt)}
        />
      ))}
    </DetailSection>
  )
}

function ThreadMessageComposer({
  detail,
  message,
  busy,
  onMessage,
  onSend,
}: {
  detail: MobileThreadDetails
  message: string
  busy: boolean
  onMessage(message: string): void
  onSend(delivery: MobileThreadDelivery): void
}) {
  if (!detail.threadId || detail.inputQuestions.length) return null
  const configuration = threadMessageConfiguration(detail.status)
  const unavailable = busy || !message.trim()
  return (
    <DetailSection title={configuration.title}>
      <TextInput
        accessibilityLabel="Thread message"
        multiline
        placeholder="Ask for a change, clarification, or next step…"
        placeholderTextColor={colors.muted}
        style={[styles.input, styles.textarea]}
        value={message}
        onChangeText={onMessage}
      />
      <View style={styles.actions}>
        <ThreadPrimarySend configuration={configuration} unavailable={unavailable} onSend={onSend} />
        <ThreadSteer visible={configuration.active && detail.canSteer} unavailable={unavailable} onSend={onSend} />
      </View>
    </DetailSection>
  )
}

type ThreadMessageConfiguration = {
  active: boolean
  delivery: MobileThreadDelivery
  label: string
  title: string
}

function threadMessageConfiguration(status: string): ThreadMessageConfiguration {
  const active = ['starting', 'running'].includes(status)
  return active
    ? {
        active,
        delivery: 'queue',
        label: 'Queue next turn',
        title: 'Guide the active thread',
      }
    : {
        active,
        delivery: 'follow-up',
        label: 'Send follow-up',
        title: 'Continue this thread',
      }
}

function ThreadPrimarySend({
  configuration,
  unavailable,
  onSend,
}: {
  configuration: ThreadMessageConfiguration
  unavailable: boolean
  onSend(delivery: MobileThreadDelivery): void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={unavailable}
      onPress={() => onSend(configuration.delivery)}
      style={[styles.primaryButton, unavailable && styles.disabled]}
    >
      <Text style={styles.primaryButtonText}>{configuration.label}</Text>
    </Pressable>
  )
}

function ThreadSteer({
  visible,
  unavailable,
  onSend,
}: {
  visible: boolean
  unavailable: boolean
  onSend(delivery: MobileThreadDelivery): void
}) {
  if (!visible) return null
  return (
    <Pressable
      accessibilityRole="button"
      disabled={unavailable}
      onPress={() => onSend('steer')}
      style={[styles.secondaryButton, unavailable && styles.disabled]}
    >
      <Text style={styles.secondaryButtonText}>Steer current turn</Text>
    </Pressable>
  )
}

function ThreadOutput({ detail }: { detail: MobileThreadDetails }) {
  const output = detail.reviewSummary || detail.resultText || detail.reviewDetails
  return (
    <>
      <DetailSection title="Result">
        <MobileMarkdown content={output} emptyText="No final output has been recorded yet." />
      </DetailSection>
      {detail.reviewSummary && detail.reviewDetails ? (
        <DetailSection title="Detailed findings">
          <MobileMarkdown content={detail.reviewDetails} emptyText="No detailed findings." />
        </DetailSection>
      ) : null}
    </>
  )
}

function ThreadChanges({ detail }: { detail: MobileThreadDetails }) {
  return (
    <>
      <DetailSection title="Change summary" meta={`${detail.files.length} files`}>
        <View style={styles.metrics}>
          <DetailMetric label="FILES" value={detail.files.length} />
          <DetailMetric label="ADDITIONS" value={`+${detail.additions}`} />
          <DetailMetric label="DELETIONS" value={`-${detail.deletions}`} />
        </View>
        {detail.files.map((file) => (
          <View key={file.path} style={styles.fileRow}>
            <Text numberOfLines={2} style={styles.filePath}>
              {file.path}
            </Text>
            <Text style={styles.additions}>+{file.additions}</Text>
            <Text style={styles.deletions}>−{file.deletions}</Text>
          </View>
        ))}
        {detail.diffError ? <Text style={styles.error}>{detail.diffError}</Text> : null}
      </DetailSection>
      {detail.diff ? (
        <DetailSection title="Diff">
          <MobileDiff patch={detail.diff} />
        </DetailSection>
      ) : null}
    </>
  )
}

function ThreadInfo({
  detail,
  busy,
  onInterrupt,
  onRetry,
}: {
  detail: MobileThreadDetails
  busy: boolean
  onInterrupt(): void
  onRetry(): void
}) {
  const active = ['starting', 'running'].includes(detail.status)
  const retryable = ['failed', 'resumable', 'cancelled'].includes(detail.status)
  return (
    <>
      <DetailSection title="Run">
        <View style={styles.metrics}>
          <DetailMetric label="STATUS" value={detail.status} />
          <DetailMetric label="AGENT" value={detail.agentName} />
          <DetailMetric label="FILES" value={detail.files.length} />
        </View>
        <Text style={styles.muted}>
          {detail.fullName}
          {detail.branchName ? ` · ${detail.branchName}` : ''}
          {detail.pullRequestNumber ? ` · PR #${detail.pullRequestNumber}` : ''}
        </Text>
        <View style={styles.actions}>
          {active ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onInterrupt}
              style={[styles.secondaryButton, styles.dangerButton, busy && styles.disabled]}
            >
              <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>Interrupt</Text>
            </Pressable>
          ) : null}
          {retryable ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={onRetry} style={[styles.primaryButton, busy && styles.disabled]}>
              <Text style={styles.primaryButtonText}>Retry thread</Text>
            </Pressable>
          ) : null}
        </View>
      </DetailSection>
      <DetailSection title="Original prompt">
        <MobileMarkdown content={detail.prompt} emptyText="Prompt unavailable." />
      </DetailSection>
      {detail.content ? (
        <DetailSection title="Raw run log">
          <Text selectable numberOfLines={160} style={styles.code}>
            {detail.content}
          </Text>
        </DetailSection>
      ) : null}
    </>
  )
}

function ThreadInputQuestions({
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
  const complete = questions.every((question) => Boolean(answers[question.id]?.trim()))
  return (
    <DetailSection title="Agent needs input" meta={`${questions.length} question${questions.length === 1 ? '' : 's'}`}>
      {questions.map((question) => (
        <View key={question.id} style={styles.row}>
          <Text style={styles.rowTitle}>{question.header || question.question}</Text>
          {question.header ? <Text style={styles.rowText}>{question.question}</Text> : null}
          {question.options.length ? (
            <View style={styles.actions}>
              {question.options.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: answers[question.id] === option.label,
                  }}
                  key={option.label}
                  onPress={() => onAnswer(question.id, option.label)}
                  style={[styles.secondaryButton, answers[question.id] === option.label && styles.disabled]}
                >
                  <Text style={styles.secondaryButtonText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
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
        <Text style={styles.primaryButtonText}>Submit answers</Text>
      </Pressable>
    </DetailSection>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
