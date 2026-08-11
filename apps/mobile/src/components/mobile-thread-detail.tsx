import { Text, View } from 'react-native'
import type { MobileThreadDetails } from '@/mobile-detail-service'
import { mobileThreadOutcome, mobileThreadTabs, type MobileThreadTab } from '@/mobile-thread-presentation'
import type { MobileThread } from '@/mobile-workspace-service'
import { MobileThreadRunActions } from './mobile-thread-actions'
import { MobileThreadActivity, MobileThreadInputRequest } from './mobile-thread-activity'
import { MobileThreadComposer } from './mobile-thread-composer'
import {
  MobileThreadHeaderContext,
  MobileThreadOutcomeBanner,
  MobileThreadTabContent,
} from './mobile-thread-content'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileDetailShell } from './mobile-detail-shell'
import { useMobileThreadController } from './use-mobile-thread-controller'

const fallbackTabs = [{ id: 'activity', label: 'Activity' }] satisfies Array<{ id: MobileThreadTab; label: string }>

type MobileThreadDetailProps = {
  serviceUrl: string
  thread: MobileThread
  onBack?: () => void
  onClose(): void
  onChanged(message: string): Promise<void>
  onOpenThread?(thread: MobileThread): void
  onOpenWork?(): void
  onOpenThreadId?(threadId: number): void
  onOpenPullRequest?(fullName: string, number: number): void
}

type MobileThreadController = ReturnType<typeof useMobileThreadController>

export function MobileThreadDetail(props: MobileThreadDetailProps) {
  const controller = useMobileThreadController(props)
  if (!controller.detail.value) return <PendingThreadDetail {...props} controller={controller} />
  return <ResolvedThreadDetail {...props} detail={controller.detail.value} controller={controller} />
}

function PendingThreadDetail({
  thread,
  onBack,
  onClose,
  controller,
}: Pick<MobileThreadDetailProps, 'thread' | 'onBack' | 'onClose'> & { controller: MobileThreadController }) {
  return (
    <MobileDetailShell<MobileThreadTab>
      eyebrow={`${thread.backendName.toUpperCase()} · AGENT RUN`}
      title={thread.taskTitle || `Thread ${thread.id}`}
      subtitle={`${thread.status} · ${thread.fullName}`}
      tabs={fallbackTabs}
      activeTab="activity"
      loading={controller.detail.loading}
      error={controller.detail.error}
      onTab={controller.setTab}
      onBack={onBack}
      onClose={onClose}
      onRetry={() => void controller.detail.refresh()}
    >
      <ThreadDetailAlerts notice={controller.notice} error={controller.error} />
    </MobileDetailShell>
  )
}

function ResolvedThreadDetail({
  serviceUrl,
  thread,
  onBack,
  onClose,
  onOpenWork,
  onOpenThreadId,
  onOpenPullRequest,
  detail,
  controller,
}: MobileThreadDetailProps & { detail: MobileThreadDetails; controller: MobileThreadController }) {
  const tabs = mobileThreadTabs(detail)
  const activeTab = tabs.some((candidate) => candidate.id === controller.tab) ? controller.tab : tabs[0].id
  const sourceJobId = detail.sourceJobId
  const openParent = sourceJobId && onOpenThreadId ? () => onOpenThreadId(sourceJobId) : undefined
  return (
    <MobileDetailShell<MobileThreadTab>
      eyebrow={`${thread.backendName.toUpperCase()} · AGENT RUN`}
      title={detail.taskTitle || thread.taskTitle || `Thread ${thread.id}`}
      subtitle={detail.fullName}
      headerContent={<MobileThreadHeaderContext detail={detail} />}
      banner={<MobileThreadOutcomeBanner outcome={mobileThreadOutcome(detail)} />}
      tabs={tabs}
      activeTab={activeTab}
      loading={controller.detail.loading}
      error={controller.detail.error}
      onTab={controller.setTab}
      onBack={onBack}
      onClose={onClose}
      onRetry={() => void controller.detail.refresh()}
      footer={(
        <ThreadFooter
          serviceUrl={serviceUrl}
          thread={thread}
          detail={detail}
          controller={controller}
          onOpenWork={onOpenWork}
          onOpenParent={openParent}
          onOpenPullRequest={pullRequestOpener(detail, onOpenPullRequest)}
          onError={controller.setError}
        />
      )}
    >
      <ThreadDetailAlerts notice={controller.notice} error={controller.error} />
      <ThreadBody detail={detail} controller={controller} />
    </MobileDetailShell>
  )
}

function ThreadBody({
  detail,
  controller,
}: {
  detail: MobileThreadDetails
  controller: MobileThreadController
}) {
  return (
    <>
      <MobileThreadInputRequest
        questions={detail.inputQuestions}
        answers={controller.answers}
        busy={controller.busy}
        onAnswer={(id, answer) => controller.setAnswers((current) => ({ ...current, [id]: answer }))}
        onSubmit={controller.actions.submitAnswers}
      />
      <MobileThreadTabContent
        tab={controller.tab}
        detail={detail}
        suggestions={controller.suggestions}
        postingSuggestions={controller.busy}
        onChangeSuggestion={(id, patch) => controller.setSuggestions((current) =>
          current.map((item) => item.id === id ? { ...item, ...patch } : item),
        )}
        onPostSuggestions={controller.actions.postSuggestions}
        activity={(
          <MobileThreadActivity
            detail={detail}
            queueBusyId={controller.queueBusyId}
            onSteerQueued={(id) => controller.actions.queued(id, 'steer')}
            onCancelQueued={(id) => controller.actions.queued(id, 'cancel')}
          />
        )}
      />
    </>
  )
}

function ThreadFooter({
  serviceUrl,
  thread,
  detail,
  controller,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
  onError,
}: {
  serviceUrl: string
  thread: MobileThread
  detail: MobileThreadDetails
  controller: MobileThreadController
  onOpenWork?(): void
  onOpenParent?(): void
  onOpenPullRequest?(): void
  onError(message: string): void
}) {
  return (
    <View style={styles.footer}>
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
        onError={onError}
      />
    </View>
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
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </>
  )
}
