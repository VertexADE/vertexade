import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import type { MobileBackend } from '@/platform-service'
import type { MobileWorkItem, MobileWorkspace } from '@/mobile-workspace-service'
import { colors } from '@/theme'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'
import { MobileAgentOptions } from './mobile-agent-options'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'
import { useMobileWorkspaceCreation, type MobileCreateMode } from './use-mobile-workspace-creation'
import { MobileRepositorySearch } from './mobile-repository-search'

export type { MobileCreateMode } from './use-mobile-workspace-creation'

type CreateModalProps = {
  mode: MobileCreateMode
  serviceUrl: string
  backends: MobileBackend[]
  workspace: MobileWorkspace
  initialWorkItem?: MobileWorkItem
  onClose(): void
  onCompleted(message: string): Promise<void>
}

const modeCopy: Record<MobileCreateMode, { eyebrow: string; title: string; action: string }> = {
  pullRequest: { eyebrow: 'AGENT DELIVERY', title: 'Create a draft PR', action: 'Start draft PR' },
  work: { eyebrow: 'NEW OUTCOME', title: 'Create Work', action: 'Create Work' },
  thread: { eyebrow: 'AGENT EXECUTION', title: 'Start a thread', action: 'Start thread' },
}

export function MobileWorkspaceCreateModal(props: CreateModalProps) {
  const creation = useMobileWorkspaceCreation(props)
  const copy = modeCopy[props.mode]
  return (
    <Modal
      allowSwipeDismissal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={() => {
        if (!creation.busy) props.onClose()
      }}
    >
      <MobileModalSafeArea testID="workspace-create-modal" style={styles.modal}>
        <CreationHeader mode={props.mode} busy={creation.busy} copy={copy} onClose={props.onClose} />
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <OptionGroup
            label="Server"
            options={props.backends.map((backend) => ({
              id: `${backend.serviceUrl || ''}::${backend.id}`,
              label: backend.label,
              meta: 'Direct server',
            }))}
            selectedId={creation.backendId}
            testIdPrefix="create-server"
            onSelect={creation.chooseBackend}
          />
          <CreationTarget mode={props.mode} creation={creation} />
          <RepositoryTarget mode={props.mode} creation={creation} serviceUrl={props.serviceUrl} />
          <PromptInput mode={props.mode} value={creation.prompt} onChange={creation.setPrompt} />
          {props.mode !== 'work' && creation.selectedBackend ? (
            <MobileAgentOptions
              serviceUrl={creation.selectedBackend.serviceUrl || props.serviceUrl}
              backendId={creation.selectedBackend.id}
              value={creation.agentOptions}
              onChange={creation.setAgentOptions}
            />
          ) : null}
          {props.mode === 'thread' ? (
            <DraftPullRequestSwitch
              available={creation.supportsPullRequests}
              value={creation.createPullRequest}
              onChange={creation.setCreatePullRequest}
            />
          ) : null}
          {creation.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {creation.error}
            </Text>
          ) : null}
        </ScrollView>
        <Pressable
          testID="create-submit"
          accessibilityRole="button"
          accessibilityState={{ busy: creation.busy, disabled: creation.busy || !creation.valid }}
          disabled={creation.busy || !creation.valid}
          onPress={() => void creation.submit()}
          style={[styles.modalPrimary, (creation.busy || !creation.valid) && styles.disabled]}
        >
          {creation.busy ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text style={styles.createButtonText}>{copy.action}</Text>
          )}
        </Pressable>
      </MobileModalSafeArea>
    </Modal>
  )
}

type CreationModel = ReturnType<typeof useMobileWorkspaceCreation>

function CreationHeader({ mode, busy, copy, onClose }: {
  mode: MobileCreateMode
  busy: boolean
  copy: (typeof modeCopy)[MobileCreateMode]
  onClose(): void
}) {
  return <MobileSheetHeader
    title={copy.title}
    subtitle={mode === 'pullRequest' ? 'Creates Work, starts its agent, and asks that agent to publish a draft PR.' : copy.eyebrow}
    leadingLabel="Cancel"
    busy={busy}
    onLeading={onClose}
  />
}

function CreationTarget({ mode, creation }: { mode: MobileCreateMode; creation: CreationModel }) {
  if (mode !== 'thread') {
    return (
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{mode === 'pullRequest' ? 'Outcome / PR title' : 'Work title'}</Text>
        <TextInput
          testID="create-title"
          accessibilityLabel={mode === 'pullRequest' ? 'Outcome and pull request title' : 'Work title'}
          maxLength={200}
          placeholder="What should change?"
          placeholderTextColor={colors.muted}
          style={styles.search}
          value={creation.title}
          onChangeText={creation.setTitle}
        />
      </View>
    )
  }
  return (
    <OptionGroup
      label="Work item"
      empty="No active Work is available on this server. Create Work first."
      options={creation.workItems.map((item) => ({
        id: String(item.id),
        label: `${item.key} · ${item.title}`,
        meta: `${item.state} · ${item.repositoryNames.join(', ') || 'No repository'}`,
      }))}
      selectedId={creation.workItemId === null ? '' : String(creation.workItemId)}
      testIdPrefix="create-work-item"
      onSelect={(id) => {
        const item = creation.workItems.find((candidate) => candidate.id === Number(id))
        if (item) creation.chooseWorkItem(item)
      }}
    />
  )
}

function RepositoryTarget({ mode, creation, serviceUrl }: { mode: MobileCreateMode; creation: CreationModel; serviceUrl: string }) {
  const repositories = mode === 'pullRequest'
    ? creation.repositories.filter((repository) => repository.sourceKind === 'git')
    : creation.repositories
  return (
    <View style={styles.inputGroup}>
      <OptionGroup
      label={mode === 'pullRequest' ? 'Git repository' : 'Workspace'}
      hint={mode === 'pullRequest'
        ? 'Draft PR delivery requires a Git repository.'
        : 'Choose an isolated general workspace or a configured project source.'}
      empty="No compatible Git repositories are available on this server. Add or sync one in VertexADE web first."
      options={[
        ...(mode === 'pullRequest'
          ? []
          : [{ id: 'general', label: 'General workspace', meta: 'Managed · isolated · no repository or Git required' }]),
        ...repositories.map((repository) => ({
          id: String(repository.id),
          label: repository.fullName,
          meta: repositoryDescription(repository),
        })),
      ]}
      selectedId={creation.repositoryId === null && mode !== 'pullRequest' ? 'general' : String(creation.repositoryId || '')}
      testIdPrefix="create-repository"
      onSelect={(id) => creation.setRepositoryId(id === 'general' ? null : Number(id))}
      />
      {creation.selectedBackend ? (
        <MobileRepositorySearch
          serviceUrl={serviceUrl}
          backend={creation.selectedBackend}
          added={creation.repositories.map((repository) => repository.fullName)}
          onSelect={(repository) => creation.addRepository(repository.id)}
        />
      ) : null}
    </View>
  )
}

function PromptInput({ mode, value, onChange }: { mode: MobileCreateMode; value: string; onChange(value: string): void }) {
  const workOnly = mode === 'work'
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{workOnly ? 'Context (optional)' : 'Agent prompt'}</Text>
      <Text style={styles.inputHint}>
        {workOnly
          ? 'Capture enough context to start a thread later.'
          : 'Tell the agent what outcome to deliver and any important constraints.'}
      </Text>
      <TextInput
        testID="create-prompt"
        accessibilityLabel={workOnly ? 'Work context' : 'Agent prompt'}
        maxLength={20_000}
        multiline
        placeholder={workOnly ? 'Background, constraints, and success criteria…' : 'Implement and verify…'}
        placeholderTextColor={colors.muted}
        style={[styles.search, styles.textArea]}
        value={value}
        onChangeText={onChange}
      />
    </View>
  )
}

function DraftPullRequestSwitch({ available, value, onChange }: { available: boolean; value: boolean; onChange(value: boolean): void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchCopy}>
        <Text style={styles.inputLabel}>Publish a draft PR</Text>
        <Text style={styles.inputHint}>
          {available
            ? 'The agent creates the PR after it has an implementation to publish.'
            : 'Available when the selected workspace is a Git repository.'}
        </Text>
      </View>
      <Switch
        accessibilityLabel="Publish a draft pull request"
        accessibilityState={{ disabled: !available }}
        disabled={!available}
        value={available && value}
        onValueChange={onChange}
        trackColor={{ true: colors.accentSoft }}
        thumbColor={value ? colors.accent : colors.muted}
      />
    </View>
  )
}

function OptionGroup({ label, hint, empty, options, selectedId, testIdPrefix, onSelect }: {
  label: string
  hint?: string
  empty?: string
  options: Array<{ id: string; label: string; meta?: string }>
  selectedId: string
  testIdPrefix: string
  onSelect(id: string): void
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
      {options.length ? (
        <View style={styles.options}>
          {options.map((option) => (
            <CreationOption
              key={option.id}
              option={option}
              selected={option.id === selectedId}
              testID={`${testIdPrefix}-${option.id}`}
              onSelect={onSelect}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.inputHint}>{empty}</Text>
      )}
    </View>
  )
}

function repositoryDescription(repository: CreationModel['repositories'][number]) {
  if (repository.sourceKind === 'directory') {
    if (repository.workspaceStrategy === 'move') return 'Local directory · move changes on apply'
    if (repository.workspaceStrategy === 'copy') return 'Local directory · isolated copy'
    return 'Local directory · work directly'
  }
  return repository.workspaceStrategy === 'direct' ? 'Git repository · work directly' : 'Git repository · isolated worktree'
}

function CreationOption({ option, selected, testID, onSelect }: {
  option: { id: string; label: string; meta?: string }
  selected: boolean
  testID: string
  onSelect(id: string): void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={() => onSelect(option.id)}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
      {option.meta ? <Text style={styles.optionMeta}>{option.meta}</Text> : null}
    </Pressable>
  )
}
