import { useEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { updateAgentTurnLiveActivity } from '@/agent-turn-live-activity-controller'
import type { MobileThreadDetails } from '@/mobile-detail-service'
import { mobileThreadTabs, type MobileThreadTab } from '@/mobile-thread-presentation'
import type { MobileThread } from '@/mobile-workspace-service'
import { MobileThreadRunActions } from './mobile-thread-actions'
import { MobileThreadActivity, MobileThreadInputRequest } from './mobile-thread-activity'
import { MobileThreadComposer } from './mobile-thread-composer'
import { MobileThreadTabContent } from './mobile-thread-content'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileDetailShell } from './mobile-detail-shell'
import { MobileGlass } from './mobile-glass'
import { useMobileThreadController } from './use-mobile-thread-controller'
import { useSessionCompletionHaptic } from './use-session-completion-haptic'

const fallbackTabs = [{ id: 'activity', label: 'Activity' }] satisfies Array<{
  id: MobileThreadTab
  label: string
}>

type MobileThreadDetailProps = {
  serviceUrl: string
  thread: MobileThread
  onBack?: () => void
  onClose(): void
  onDismiss?(): void
  visible?: boolean
  onChanged(message: string): Promise<void>
  onOpenThread?(thread: MobileThread): void
  onOpenWork?(): void
  onOpenThreadId?(threadId: number): void
  onOpenPullRequest?(fullName: string, number: number): void
}

type MobileThreadController = ReturnType<typeof useMobileThreadController>

export function MobileThreadDetail(props: MobileThreadDetailProps) {
  const controller = useMobileThreadController(props)
  const detail = controller.detail.value
  useEffect(() => {
    if (!detail) return
    const state = ['completed', 'failed', 'cancelled'].includes(detail.status) ? 'complete' : detail.inputQuestions.length || detail.status === 'resumable' ? 'idle' : 'working'
    void updateAgentTurnLiveActivity({
      agent: detail.agentName,
      detail: detail.latestActivity || detail.status,
      state,
      threadId: detail.id,
      title: detail.taskTitle || `Thread ${detail.id}`,
    })
  }, [detail?.agentName, detail?.id, detail?.inputQuestions.length, detail?.latestActivity, detail?.status, detail?.taskTitle])
  if (detail?.inputQuestions.length) return <PendingInputThread props={props} detail={detail} controller={controller} />
  return <StandardThread props={props} detail={detail} controller={controller} />
}

function PendingInputThread({ props, detail, controller }: { props: MobileThreadDetailProps; detail: MobileThreadDetails; controller: MobileThreadController }) {
  const questions = detail.inputQuestions
  return (
    <MobileDetailShell<MobileThreadTab>
      eyebrow={`${props.thread.backendName.toUpperCase()} · AGENT RUN`}
      title={questions[0]?.formTitle || 'Agent needs input'}
      subtitle={questions[0]?.formDescription || 'Answer to continue the waiting agent turn.'}
      compactHeader
      tabs={[]}
      activeTab="activity"
      loading={controller.detail.loading}
      error={controller.detail.error}
      onTab={controller.setTab}
      onBack={props.onBack}
      onClose={props.onClose}
      onDismiss={props.onDismiss}
      visible={props.visible}
      onRetry={() => void controller.detail.refresh()}
      headerAction={<Pressable accessibilityRole="button" accessibilityLabel="Cancel form" onPress={controller.actions.cancelForm}><Text style={styles.close}>Cancel</Text></Pressable>}
    >
      <ThreadDetailAlerts notice={controller.notice} error={controller.error} />
      <MobileThreadInputRequest
        questions={questions}
        answers={controller.answers}
        busy={controller.busy}
        onAnswer={(id, answer) => controller.setAnswers((current) => ({ ...current, [id]: answer }))}
        onSubmit={controller.actions.submitAnswers}
      />
    </MobileDetailShell>
  )
}

function StandardThread({ props, detail, controller }: { props: MobileThreadDetailProps; detail: MobileThreadDetails | null; controller: MobileThreadController }) {
  const tabs = threadTabs(detail)
  const activeTab = activeThreadTab(detail, tabs, controller.tab)
  const headerAction = standardHeaderAction(props, detail, controller)
  const footer = detail && <ThreadFooter serviceUrl={props.serviceUrl} detail={detail} controller={controller} />
  const body = detail && <ThreadBody detail={detail} controller={controller} threadKey={`${props.thread.backendId}:${props.thread.id}`} />
  return (
    <MobileDetailShell<MobileThreadTab>
      eyebrow={`${props.thread.backendName.toUpperCase()} · AGENT RUN`}
      title={threadTitle(props.thread, detail)}
      subtitle={threadSubtitle(props.thread, detail)}
      compactHeader
      initialScrollToEnd
      tabs={tabs}
      activeTab={activeTab}
      loading={controller.detail.loading}
      error={controller.detail.error}
      onTab={controller.setTab}
      onBack={props.onBack}
      onClose={props.onClose}
      onDismiss={props.onDismiss}
      visible={props.visible}
      onRetry={() => void controller.detail.refresh()}
      headerAction={headerAction}
      footer={footer}
    >
      <ThreadDetailAlerts notice={controller.notice} error={controller.error} />
      {body}
    </MobileDetailShell>
  )
}

function threadTabs(detail: MobileThreadDetails | null) {
  return detail ? mobileThreadTabs(detail) : fallbackTabs
}

function activeThreadTab(detail: MobileThreadDetails | null, tabs: ReturnType<typeof threadTabs>, selected: MobileThreadTab) {
  return detail && tabs.some((candidate) => candidate.id === selected) ? selected : tabs[0].id
}

function threadTitle(thread: MobileThread, detail: MobileThreadDetails | null) {
  return detail?.taskTitle || thread.taskTitle || `Thread ${thread.id}`
}

function threadSubtitle(thread: MobileThread, detail: MobileThreadDetails | null) {
  return detail?.fullName || `${thread.status} · ${thread.fullName}`
}

function standardHeaderAction(props: MobileThreadDetailProps, detail: MobileThreadDetails | null, controller: MobileThreadController) {
  if (!detail) return undefined
  const sourceJobId = detail.sourceJobId
  const openParent = sourceJobId && props.onOpenThreadId ? () => props.onOpenThreadId?.(sourceJobId) : undefined
  return (
    <ThreadHeaderActions
      thread={props.thread}
      detail={detail}
      controller={controller}
      serviceUrl={props.serviceUrl}
      onOpenWork={props.onOpenWork}
      onOpenParent={openParent}
      onOpenPullRequest={pullRequestOpener(detail, props.onOpenPullRequest)}
    />
  )
}

function SessionCompletionFeedback({ threadKey, events }: { threadKey: string; events: MobileThreadDetails['events'] | undefined }) {
  useSessionCompletionHaptic(threadKey, events)
  return null
}

function ThreadBody({ detail, controller, threadKey }: { detail: MobileThreadDetails; controller: MobileThreadController; threadKey: string }) {
  return (
    <>
      <SessionCompletionFeedback threadKey={threadKey} events={detail.events} />
      <MobileThreadTabContent
        tab={controller.tab}
        detail={detail}
        suggestions={controller.suggestions}
        postingSuggestions={controller.busy}
        onChangeSuggestion={(id, patch) => controller.setSuggestions((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))}
        onPostSuggestions={controller.actions.postSuggestions}
        activity={
          <MobileThreadActivity
            detail={detail}
            queueBusyId={controller.queueBusyId}
            onSteerQueued={(id) => controller.actions.queued(id, 'steer')}
            onCancelQueued={(id) => controller.actions.queued(id, 'cancel')}
            onReorderQueued={controller.actions.reorderQueued}
          />
        }
      />
    </>
  )
}

function ThreadFooter({ serviceUrl, detail, controller }: { serviceUrl: string; detail: MobileThreadDetails; controller: MobileThreadController }) {
  return (
    <MobileGlass tintColor="rgba(8, 10, 14, 0.34)" style={styles.footer}>
      <MobileThreadComposer
        serviceUrl={serviceUrl}
        detail={detail}
        value={controller.message}
        options={controller.agentOptions}
        busy={controller.busy}
        onChange={controller.setMessage}
        onOptionsChange={controller.setAgentOptions}
        onSend={controller.actions.send}
      />
    </MobileGlass>
  )
}

function ThreadHeaderActions({
  serviceUrl,
  thread,
  detail,
  controller,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
}: {
  serviceUrl: string
  thread: MobileThread
  detail: MobileThreadDetails
  controller: MobileThreadController
  onOpenWork?(): void
  onOpenParent?(): void
  onOpenPullRequest?(): void
}) {
  return (
    <MobileThreadRunActions
      serviceUrl={serviceUrl}
      detail={detail}
      busy={controller.busy}
      onInterrupt={controller.actions.interrupt}
      onRetry={controller.actions.retry}
      onReReview={controller.actions.reReview}
      onSaveTasks={controller.actions.saveTasks}
      onFork={controller.actions.fork}
      onTransfer={controller.actions.transfer}
      onOpenWork={thread.workItemId ? onOpenWork : undefined}
      onOpenParent={detail.sourceJobId ? onOpenParent : undefined}
      onOpenPullRequest={onOpenPullRequest}
      onError={controller.setError}
    />
  )
}

function pullRequestOpener(detail: MobileThreadDetails, onOpen?: (fullName: string, number: number) => void) {
  const number = detail.pullRequestNumber
  if (!number || !onOpen) return undefined
  return () => onOpen(detail.fullName, number)
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
