import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { defaultMobileAgentOptions, type MobileAgentOptions as MobileAgentLaunchOptions } from '@/mobile-agent-options'
import {
  loadMobileThreadTransferTargets,
  type MobileForkThreadInput,
  type MobileThreadDetails,
  type MobileThreadTransferTarget,
} from '@/mobile-detail-service'
import { canForkMobileThread, canSaveMobileThreadTasks, canTransferMobileThread, isActive, isRetryable } from '@/mobile-thread-presentation'
import { openMobileHttpUrl } from '@/mobile-linking'
import { colors } from '@/theme'
import { MobileAgentOptions } from './mobile-agent-options'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'
import { MobileSingleSelect } from './mobile-single-select'
import { MobileSymbol } from './mobile-symbol'

type ActionView = 'menu' | 'fork' | 'transfer'

export function MobileThreadRunActions({
  serviceUrl,
  detail,
  busy,
  onInterrupt,
  onRetry,
  onReReview,
  onSaveTasks,
  onFork,
  onTransfer,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
  onError,
}: {
  serviceUrl: string
  detail: MobileThreadDetails
  busy: boolean
  onInterrupt(): void
  onRetry(): void
  onReReview(): void
  onSaveTasks(): void
  onFork(input: MobileForkThreadInput): void
  onTransfer(destinationJobId: number, title: string, instruction: string): void
  onOpenWork?(): void
  onOpenParent?(): void
  onOpenPullRequest?(): void
  onError(message: string): void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable testID="thread-more-actions" accessibilityRole="button" accessibilityLabel="Thread actions" disabled={busy} hitSlop={8} onPress={() => setOpen(true)} style={({ pressed }) => [styles.headerIconButton, busy && styles.disabled, pressed && styles.pressed]}>
        <MobileSymbol name="ellipsis.circle" fallback="•••" color={colors.accent} size={22} />
      </Pressable>
      <ThreadActionsModal
        open={open}
        serviceUrl={serviceUrl}
        detail={detail}
        busy={busy}
        onClose={() => setOpen(false)}
        onInterrupt={onInterrupt}
        onRetry={onRetry}
        onReReview={onReReview}
        onSaveTasks={onSaveTasks}
        onFork={onFork}
        onTransfer={onTransfer}
        onOpenWork={onOpenWork}
        onOpenParent={onOpenParent}
        onOpenPullRequest={onOpenPullRequest}
        onError={onError}
      />
    </>
  )
}

function runPrimaryAction(
  action: NonNullable<ReturnType<typeof primaryAction>>,
  callbacks: Pick<ThreadActionViewProps, 'onInterrupt' | 'onRetry' | 'onReReview'>,
) {
  if (action === 'interrupt') callbacks.onInterrupt()
  else if (action === 'retry') callbacks.onRetry()
  else callbacks.onReReview()
}

function ThreadActionsModal({
  open,
  serviceUrl,
  detail,
  busy,
  onClose,
  onInterrupt,
  onRetry,
  onReReview,
  onSaveTasks,
  onFork,
  onTransfer,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
  onError,
}: {
  open: boolean
  serviceUrl: string
  detail: MobileThreadDetails
  busy: boolean
  onClose(): void
  onInterrupt(): void
  onRetry(): void
  onReReview(): void
  onSaveTasks(): void
  onFork(input: MobileForkThreadInput): void
  onTransfer(destinationJobId: number, title: string, instruction: string): void
  onOpenWork?(): void
  onOpenParent?(): void
  onOpenPullRequest?(): void
  onError(message: string): void
}) {
  const [view, setView] = useState<ActionView>('menu')
  useEffect(() => {
    if (!open) setView('menu')
  }, [open])
  if (!open) return null
  function navigateBack() {
    if (view === 'menu') onClose()
    else setView('menu')
  }
  return (
    <Modal allowSwipeDismissal animationType="slide" presentationStyle="pageSheet" visible onRequestClose={navigateBack}>
      <MobileModalSafeArea style={styles.actionModal}>
        <ThreadActionsHeader view={view} detail={detail} busy={busy} onBack={navigateBack} />
        <ThreadActionView
          view={view}
          serviceUrl={serviceUrl}
          detail={detail}
          busy={busy}
          onView={setView}
          onClose={onClose}
          onInterrupt={onInterrupt}
          onRetry={onRetry}
          onReReview={onReReview}
          onSaveTasks={onSaveTasks}
          onFork={onFork}
          onTransfer={onTransfer}
          onOpenWork={onOpenWork}
          onOpenParent={onOpenParent}
          onOpenPullRequest={onOpenPullRequest}
          onError={onError}
        />
      </MobileModalSafeArea>
    </Modal>
  )
}

function ThreadActionsHeader({
  view,
  detail,
  busy,
  onBack,
}: {
  view: ActionView
  detail: MobileThreadDetails
  busy: boolean
  onBack(): void
}) {
  const menu = view === 'menu'
  const title =
    view === 'fork'
      ? `Fork into a ${detail.repositorySourceKind === 'workspace' ? 'workspace' : 'worktree'}`
      : view === 'transfer'
        ? 'Send to a worktree'
        : 'Thread actions'
  return <MobileSheetHeader
    title={title}
    subtitle={`Run #${detail.id} · ${detail.fullName}`}
    leadingLabel={menu ? undefined : 'Back'}
    trailingLabel={menu ? 'Done' : undefined}
    busy={busy}
    onLeading={menu ? undefined : onBack}
    onTrailing={menu ? onBack : undefined}
  />
}

type ThreadActionViewProps = {
  view: ActionView
  serviceUrl: string
  detail: MobileThreadDetails
  busy: boolean
  onView(view: ActionView): void
  onClose(): void
  onInterrupt(): void
  onRetry(): void
  onReReview(): void
  onSaveTasks(): void
  onFork(input: MobileForkThreadInput): void
  onTransfer(destinationJobId: number, title: string, instruction: string): void
  onOpenWork?(): void
  onOpenParent?(): void
  onOpenPullRequest?(): void
  onError(message: string): void
}

function ThreadActionView(props: ThreadActionViewProps) {
  if (props.view === 'fork') {
    return <ForkThreadForm serviceUrl={props.serviceUrl} detail={props.detail} busy={props.busy} onSubmit={(input) => runAndClose(props.onClose, () => props.onFork(input))} />
  }
  if (props.view === 'transfer') {
    return <TransferThreadForm serviceUrl={props.serviceUrl} detail={props.detail} busy={props.busy} onSubmit={(destination, title, instruction) => runAndClose(props.onClose, () => props.onTransfer(destination, title, instruction))} />
  }
  return (
    <ThreadActionMenu
      detail={props.detail}
      busy={props.busy}
      onView={props.onView}
      onClose={props.onClose}
      onInterrupt={props.onInterrupt}
      onRetry={props.onRetry}
      onReReview={props.onReReview}
      onSaveTasks={props.onSaveTasks}
      onOpenWork={props.onOpenWork}
      onOpenParent={props.onOpenParent}
      onOpenPullRequest={props.onOpenPullRequest}
      onError={props.onError}
    />
  )
}

function ThreadActionMenu({
  detail,
  busy,
  onView,
  onClose,
  onInterrupt,
  onRetry,
  onReReview,
  onSaveTasks,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
  onError,
}: Pick<ThreadActionViewProps, 'detail' | 'busy' | 'onView' | 'onClose' | 'onInterrupt' | 'onRetry' | 'onReReview' | 'onSaveTasks' | 'onOpenWork' | 'onOpenParent' | 'onOpenPullRequest' | 'onError'>) {
  const primary = primaryAction(detail)
  return (
    <ScrollView contentContainerStyle={styles.actionModalContent}>
      {primary ? <ActionOption disabled={busy} title={primaryLabel(primary, detail.status, busy)} text="Run the primary action for this thread." onPress={() => runAndClose(onClose, () => runPrimaryAction(primary, { onInterrupt, onRetry, onReReview }))} /> : null}
      <RelatedThreadActions detail={detail} onClose={onClose} onOpenWork={onOpenWork} onOpenParent={onOpenParent} onOpenPullRequest={onOpenPullRequest} onError={onError} />
      <ThreadWorkflowActions detail={detail} busy={busy} onView={onView} onClose={onClose} onReReview={onReReview} onSaveTasks={onSaveTasks} />
    </ScrollView>
  )
}

function RelatedThreadActions({
  detail,
  onClose,
  onOpenWork,
  onOpenParent,
  onOpenPullRequest,
  onError,
}: Pick<ThreadActionViewProps, 'detail' | 'onClose' | 'onOpenWork' | 'onOpenParent' | 'onOpenPullRequest' | 'onError'>) {
  return (
    <View style={styles.actionList}>
      {onOpenWork ? <ActionOption title={`Open Work W-${String(detail.workItemId).padStart(4, '0')}`} text="Return to the outcome, resources, and related runs." onPress={() => runAndClose(onClose, onOpenWork)} /> : null}
      <RelatedPullRequestAction detail={detail} onClose={onClose} onOpen={onOpenPullRequest} onError={onError} />
      {detail.threadUrl ? <ActionOption title={`Open in ${detail.agentName}`} text="Open the retained provider thread." onPress={() => void openMobileHttpUrl(detail.threadUrl, onError)} /> : null}
      {onOpenParent ? <ActionOption title={`Open parent thread #${detail.sourceJobId}`} text="Follow the run that created this branch." onPress={() => runAndClose(onClose, onOpenParent)} /> : null}
    </View>
  )
}

function RelatedPullRequestAction({
  detail,
  onClose,
  onOpen,
  onError,
}: Pick<ThreadActionViewProps, 'detail' | 'onClose' | 'onError'> & { onOpen?: () => void }) {
  if (!detail.pullRequestNumber || (!onOpen && !detail.pullRequestUrl)) return null
  const action = onOpen
    ? () => runAndClose(onClose, onOpen)
    : () => void openMobileHttpUrl(detail.pullRequestUrl, onError)
  return <ActionOption title={`Open pull request #${detail.pullRequestNumber}`} text="Review the linked pull request’s full overview." onPress={action} />
}

function ThreadWorkflowActions({
  detail,
  busy,
  onView,
  onClose,
  onReReview,
  onSaveTasks,
}: Pick<ThreadActionViewProps, 'detail' | 'busy' | 'onView' | 'onClose' | 'onReReview' | 'onSaveTasks'>) {
  const canReReview = detail.kind === 'review' && detail.status === 'completed'
  return (
    <View style={styles.actionList}>
      {canForkMobileThread(detail) ? (
        <ActionOption
          title={`Fork into a new ${detail.repositorySourceKind === 'workspace' ? 'workspace' : 'worktree'}`}
          text={
            detail.repositorySourceKind === 'workspace'
              ? 'Copy the files and conversation into an isolated workspace.'
              : 'Keep the conversation and continue on a separate branch.'
          }
          onPress={() => onView('fork')}
        />
      ) : null}
      {canTransferMobileThread(detail) ? <ActionOption title="Send output to another worktree" text="Create a durable child Work item and transfer this result." onPress={() => onView('transfer')} /> : null}
      {canSaveMobileThreadTasks(detail) ? <ActionOption disabled={busy} title="Save stack findings as tasks" text="Add the report manifest to the PR action list." onPress={() => runAndClose(onClose, onSaveTasks)} /> : null}
      {canReReview ? <ActionOption disabled={busy} title="Start a fresh re-review" text="Review the pull request’s current head again." onPress={() => runAndClose(onClose, onReReview)} /> : null}
    </View>
  )
}

function runAndClose(onClose: () => void, action: () => void) {
  onClose()
  action()
}

function ActionOption({ title, text, disabled = false, onPress }: { title: string; text: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.actionOption, disabled && styles.disabled]}>
      <View style={styles.actionOptionCopy}>
        <Text style={styles.actionOptionTitle}>{title}</Text>
        <Text style={styles.actionOptionText}>{text}</Text>
      </View>
      <Text style={styles.notice}>›</Text>
    </Pressable>
  )
}

function ForkThreadForm({
  serviceUrl,
  detail,
  busy,
  onSubmit,
}: {
  serviceUrl: string
  detail: MobileThreadDetails
  busy: boolean
  onSubmit(input: MobileForkThreadInput): void
}) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [base, setBase] = useState<'current' | 'main'>('current')
  const [branchType, setBranchType] = useState('feature')
  const [options, setOptions] = useState<MobileAgentLaunchOptions>(() => ({
    ...defaultMobileAgentOptions(detail.agentId),
    model: detail.model,
    reasoningEffort: detail.reasoningEffort,
  }))
  const valid = Boolean(title.trim() && prompt.trim())
  return (
    <ScrollView contentContainerStyle={styles.actionModalContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>
        The fork keeps this completed conversation but works in a separate{' '}
        {detail.repositorySourceKind === 'workspace' ? 'copy of the workspace' : 'branch and worktree'}.
      </Text>
      <ChoiceGroup label="Start from" values={['current', 'main']} value={base} onChange={(value) => setBase(value as typeof base)} />
      <ChoiceGroup label="Branch type" values={['feature', 'fix', 'chore', 'refactor', 'test', 'docs']} value={branchType} onChange={setBranchType} />
      <View style={styles.formGroup}>
        <Text style={styles.inputLabel}>Fork title</Text>
        <TextInput accessibilityLabel="Fork title" maxLength={100} placeholder="Short fork title" placeholderTextColor={colors.muted} style={styles.input} value={title} onChangeText={setTitle} />
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.inputLabel}>Instruction</Text>
        <TextInput accessibilityLabel="Fork instruction" maxLength={20_000} multiline placeholder="What should the forked run work on?" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} value={prompt} onChangeText={setPrompt} />
      </View>
      <MobileAgentOptions serviceUrl={serviceUrl} backendId={detail.backendId} lockedAgentId={detail.agentId} value={options} onChange={setOptions} />
      <Pressable accessibilityRole="button" disabled={busy || !valid} onPress={() => onSubmit({ title, prompt, base, branchType, options })} style={[styles.primaryButton, (busy || !valid) && styles.disabled]}>
        <Text style={styles.primaryButtonText}>{busy ? 'Starting fork…' : 'Fork and start'}</Text>
      </Pressable>
    </ScrollView>
  )
}

function TransferThreadForm({
  serviceUrl,
  detail,
  busy,
  onSubmit,
}: {
  serviceUrl: string
  detail: MobileThreadDetails
  busy: boolean
  onSubmit(destinationJobId: number, title: string, instruction: string): void
}) {
  const [destination, setDestination] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const targetState = useTransferTargets(serviceUrl, detail)
  const valid = validTransfer(destination, title, instruction)
  const disabled = busy || !valid
  return (
    <ScrollView contentContainerStyle={styles.actionModalContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>The destination keeps its branch, worktree, and history. A child Work item records the transfer.</Text>
      <TransferTargetState state={targetState} />
      <TransferTargetList targets={targetState.targets} destination={destination} onDestination={setDestination} />
      <View style={styles.formGroup}>
        <Text style={styles.inputLabel}>Sub-item title</Text>
        <TextInput accessibilityLabel="Transfer title" maxLength={200} placeholder="What outcome should this handoff produce?" placeholderTextColor={colors.muted} style={styles.input} value={title} onChangeText={setTitle} />
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.inputLabel}>Follow-up instruction</Text>
        <TextInput accessibilityLabel="Transfer instruction" maxLength={20_000} multiline placeholder="How should the destination use this output?" placeholderTextColor={colors.muted} style={[styles.input, styles.textarea]} value={instruction} onChangeText={setInstruction} />
      </View>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={() => submitTransfer(destination, title, instruction, onSubmit)} style={[styles.primaryButton, disabled && styles.disabled]}>
        <Text style={styles.primaryButtonText}>{busy ? 'Sending…' : 'Create sub-item and send'}</Text>
      </Pressable>
    </ScrollView>
  )
}

function useTransferTargets(serviceUrl: string, detail: MobileThreadDetails) {
  const [targets, setTargets] = useState<MobileThreadTransferTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    loadMobileThreadTransferTargets(serviceUrl, detail)
      .then((result) => {
        if (active) setTargets(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load destination worktrees')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [detail.id, detail.backendId, serviceUrl])
  return { targets, loading, error }
}

type TransferTargetStateValue = ReturnType<typeof useTransferTargets>

function TransferTargetState({ state }: { state: TransferTargetStateValue }) {
  if (state.loading) return <ActivityIndicator color={colors.accent} />
  if (state.error) return <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
  if (!state.targets.length) return <Text style={styles.muted}>No idle agent runs in another existing worktree are available.</Text>
  return null
}

function TransferTargetList({
  targets,
  destination,
  onDestination,
}: {
  targets: MobileThreadTransferTarget[]
  destination: number | null
  onDestination(id: number): void
}) {
  return (
    <View style={styles.actionList}>
      {targets.map((target) => <TransferTarget key={target.id} target={target} selected={destination === target.id} onPress={() => onDestination(target.id)} />)}
    </View>
  )
}

function TransferTarget({ target, selected, onPress }: { target: MobileThreadTransferTarget; selected: boolean; onPress(): void }) {
  const title = target.taskTitle || target.workItemTitle
  const branch = target.branchName || `run #${target.id}`
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.actionOption, selected && styles.optionSelected]}>
      <View style={styles.actionOptionCopy}>
        <Text style={styles.actionOptionTitle}>{target.workItemKey} · {target.fullName}</Text>
        <Text style={styles.actionOptionText}>{title} · {branch}</Text>
      </View>
    </Pressable>
  )
}

function validTransfer(destination: number | null, title: string, instruction: string): boolean {
  return destination !== null && Boolean(title.trim()) && Boolean(instruction.trim())
}

function submitTransfer(destination: number | null, title: string, instruction: string, onSubmit: (id: number, title: string, instruction: string) => void) {
  if (destination !== null) onSubmit(destination, title, instruction)
}

function ChoiceGroup({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange(value: string): void }) {
  return <MobileSingleSelect
    label={label}
    options={values.map((option) => ({ id: option, label: option.replace(/^./, (character) => character.toUpperCase()) }))}
    value={value}
    testID={`thread-action-${label.toLowerCase().replaceAll(' ', '-')}-select`}
    onChange={onChange}
  />
}

function primaryAction(detail: MobileThreadDetails): 'interrupt' | 'retry' | 're-review' | null {
  if (isActive(detail.status)) return 'interrupt'
  if (isRetryable(detail.status)) return 'retry'
  if (detail.kind === 'review' && detail.status === 'completed') return 're-review'
  return null
}

function primaryLabel(action: NonNullable<ReturnType<typeof primaryAction>>, status: string, busy: boolean): string {
  if (action === 'interrupt') return busy ? 'Interrupting…' : 'Interrupt thread'
  if (action === 're-review') return busy ? 'Starting…' : 'Re-review'
  if (busy) return status === 'resumable' ? 'Resuming…' : 'Retrying…'
  return status === 'resumable' ? 'Resume task' : 'Retry task'
}
