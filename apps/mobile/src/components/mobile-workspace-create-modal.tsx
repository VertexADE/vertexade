import { useState, type ReactNode } from 'react'
import type { SFSymbol } from 'expo-symbols'
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import type { MobileBackend } from '@/platform-service'
import { browseMobileDirectories, type MobileDirectoryListing, type MobileWorkItem, type MobileWorkspace } from '@/mobile-workspace-service'
import { colors } from '@/theme'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'
import { MobileAgentOptions } from './mobile-agent-options'
import { MobileAgentResourcePicker } from './mobile-agent-resource-picker'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'
import { useMobileWorkspaceCreation, type MobileCreateMode } from './use-mobile-workspace-creation'
import { MobileRepositorySearch } from './mobile-repository-search'
import { MobileSymbol } from './mobile-symbol'
import { MobileSingleSelect } from './mobile-single-select'

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
  const [contextOpen, setContextOpen] = useState(props.mode !== 'work')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [quick, setQuick] = useState(true)
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
        <ScrollView contentContainerStyle={styles.modalContent} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <OptionGroup options={[{ id: 'guided', label: 'Guided' }, { id: 'quick', label: 'Quick start' }]} selectedId={quick ? 'quick' : 'guided'} testIdPrefix="create-mode" onSelect={(id) => setQuick(id === 'quick')} />
          {!quick ? <OptionGroup options={['Intent', 'Context', 'Agent'].map((label, index) => ({ id: String(index), label }))} selectedId={String(step)} testIdPrefix="create-step" onSelect={(id) => Number(id) < step && setStep(Number(id))} /> : null}
          {props.backends.length > 1 ? <DisclosureSection
            icon="network"
            title="Server"
            summary={creation.selectedBackend?.label || 'Choose where this work lives'}
          >
            <OptionGroup
              options={props.backends.map((backend) => ({
                id: `${backend.serviceUrl || ''}::${backend.id}`,
                label: backend.label,
                meta: backend.connected === false ? 'Offline' : 'Owns the filesystem, agents, extensions, and threads',
              }))}
              selectedId={creation.backendId}
              testIdPrefix="create-server"
              onSelect={creation.chooseBackend}
            />
          </DisclosureSection> : null}
          {step === 0 || quick ? <CreationTarget mode={props.mode} creation={creation} /> : null}
          {step === 1 || quick ? <RepositoryTarget mode={props.mode} creation={creation} serviceUrl={props.serviceUrl} single={quick} /> : null}
          {step === 1 || quick ? <DisclosureSection
            collapsible
            icon="doc.text"
            open={contextOpen}
            title={props.mode === 'work' ? 'Context' : 'Agent prompt'}
            summary={creation.prompt.trim() ? 'Context added' : props.mode === 'work' ? 'Optional · constraints, references, and success criteria' : 'Required · describe the outcome and constraints'}
            onToggle={() => setContextOpen((value) => !value)}
          >
            <PromptInput mode={props.mode} value={creation.prompt} onChange={creation.setPrompt} />
          </DisclosureSection> : null}
          {step === 2 || quick ? <DisclosureSection
            collapsible
            icon="slider.horizontal.3"
            open={quick || optionsOpen}
            title="More options"
            summary="Agent configuration · model, reasoning, resources, and delivery"
            onToggle={() => setOptionsOpen((value) => !value)}
          >
            {props.mode === 'work' ? <StartAgentSwitch value={creation.startAgent} onChange={creation.setStartAgent} /> : null}
            {creation.selectedBackend && (props.mode !== 'work' || creation.startAgent) ? (
              <MobileAgentOptions
                serviceUrl={creation.selectedBackend.serviceUrl || props.serviceUrl}
                backendId={creation.selectedBackend.id}
                value={creation.agentOptions}
                onChange={creation.setAgentOptions}
              />
            ) : null}
            {creation.selectedBackend && (props.mode !== 'work' || creation.startAgent) ? (
              <MobileAgentResourcePicker
                serviceUrl={creation.selectedBackend.serviceUrl || props.serviceUrl}
                backendId={creation.selectedBackend.id}
                workItemId={props.mode === 'thread' ? creation.selectedWorkItem?.id : undefined}
                value={creation.resourceSelection}
                onChange={creation.setResourceSelection}
              />
            ) : null}
            {props.mode === 'thread' ? (
              <DraftPullRequestSwitch
                available={creation.supportsPullRequests}
                value={creation.createPullRequest}
                onChange={creation.setCreatePullRequest}
              />
            ) : null}
          </DisclosureSection> : null}
          {creation.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {creation.error}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.modalFooter}>
          <Text numberOfLines={1} style={styles.modalFooterSummary}>{creationSummary(props.mode, creation)}</Text>
          <View style={styles.actions}>
          {!quick && step > 0 ? <Pressable accessibilityRole="button" testID="create-back" onPress={() => setStep((value) => value - 1)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Back</Text></Pressable> : null}
          {!quick && step < 2 ? <Pressable accessibilityRole="button" testID="create-continue" accessibilityState={{ disabled: step === 0 && !creation.title.trim() }} disabled={step === 0 && !creation.title.trim()} onPress={() => setStep((value) => value + 1)} style={[styles.modalPrimary, step === 0 && !creation.title.trim() && styles.disabled]}><Text style={styles.createButtonText}>Continue</Text></Pressable> : <Pressable
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
          </Pressable>}
          </View>
        </View>
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
      <View style={styles.creationSection}>
        <Text style={styles.inputLabel}>{mode === 'pullRequest' ? 'What should the pull request deliver?' : 'What should be different when this is done?'}</Text>
        <TextInput
          testID="create-title"
          accessibilityLabel={mode === 'pullRequest' ? 'Outcome and pull request title' : 'Work title'}
          maxLength={200}
          multiline
          placeholder="Describe the outcome in one sentence"
          placeholderTextColor={colors.muted}
          style={[styles.search, styles.textArea]}
          value={creation.title}
          onChangeText={creation.setTitle}
        />
      </View>
    )
  }
  return (
    <View style={styles.creationSection}>
      <OptionGroup
        label="Related Work"
        options={[
          { id: 'new', label: 'New Work item', meta: 'Creates Work and starts its first thread' },
          ...creation.workItems.map((item) => ({
            id: String(item.id),
            label: `${item.key} · ${item.title}`,
            meta: `${item.state} · ${item.repositoryNames.join(', ') || 'No repository'}`,
          })),
        ]}
        selectedId={creation.workItemId === null ? 'new' : String(creation.workItemId)}
        testIdPrefix="create-work-item"
        onSelect={(id) => {
          if (id === 'new') creation.chooseNewWorkItem()
          else {
            const item = creation.workItems.find((candidate) => candidate.id === Number(id))
            if (item) creation.chooseWorkItem(item)
          }
        }}
      />
      {!creation.selectedWorkItem ? (
        <>
          <Text style={styles.inputLabel}>What should be different when this is done?</Text>
          <TextInput
            testID="create-title"
            accessibilityLabel="New Work title"
            maxLength={200}
            multiline
            placeholder="Describe the outcome in one sentence"
            placeholderTextColor={colors.muted}
            style={[styles.search, styles.textArea]}
            value={creation.title}
            onChangeText={creation.setTitle}
          />
        </>
      ) : null}
    </View>
  )
}

function RepositoryTarget({ mode, creation, serviceUrl, single = false }: { mode: MobileCreateMode; creation: CreationModel; serviceUrl: string; single?: boolean }) {
  const repositories = mode === 'pullRequest'
    ? creation.repositories.filter((repository) => repository.sourceKind === 'git')
    : creation.repositories
  return (
    <View style={styles.creationSection}>
      <OptionGroup
      label={mode === 'pullRequest' ? 'Git repository' : 'Workspace'}
      hint={mode === 'pullRequest'
        ? single ? 'Choose one Git repository.' : 'Choose up to 8 Git repositories. One agent works from their combined Work-item folder.'
        : single ? 'Choose one project source or General workspace.' : 'Choose up to 8 project sources, or use an isolated general workspace.'}
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
      {...(single
        ? { selectedId: creation.selectedRepositories[0] ? String(creation.selectedRepositories[0].id) : mode === 'pullRequest' ? '' : 'general' }
        : {
            selectedIds: creation.selectedRepositories.length
              ? creation.selectedRepositories.map((repository) => String(repository.id))
              : mode !== 'pullRequest'
                ? ['general']
                : [],
          })}
      testIdPrefix="create-repository"
      onSelect={(id) => id === 'general' ? creation.clearRepositories() : single ? creation.selectSingleRepository(Number(id)) : creation.toggleRepository(Number(id))}
      />
      {creation.selectedBackend ? (
        <>
          <MobileRepositorySearch
            serviceUrl={serviceUrl}
            backend={creation.selectedBackend}
            added={creation.repositories.map((repository) => repository.fullName)}
            onSelect={async (repository) => {
              const added = await creation.addRepository(repository.id)
              if (single) creation.selectSingleRepository(added.id)
            }}
          />
          {mode !== 'pullRequest' ? (
            <MobileLocalFolderPicker
              serviceUrl={creation.selectedBackend.serviceUrl || serviceUrl}
              backendId={creation.selectedBackend.id}
              onAdd={async (input) => {
                const added = await creation.addLocalFolder(input)
                if (single) creation.selectSingleRepository(added.id)
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function MobileLocalFolderPicker({ serviceUrl, backendId, onAdd }: {
  serviceUrl: string
  backendId: string
  onAdd(input: { localPath: string; name?: string; workspaceStrategy: 'direct' | 'copy' }): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [listing, setListing] = useState<MobileDirectoryListing | null>(null)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState<'direct' | 'copy'>('direct')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function browse(nextPath?: string) {
    setBusy(true)
    setError('')
    try {
      const next = await browseMobileDirectories(serviceUrl, backendId, nextPath)
      setListing(next)
      setPath(next.path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Folder could not be opened')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <Pressable accessibilityRole="button" testID="create-local-folder-open" onPress={() => { setOpen(true); void browse() }} style={styles.localFolderButton}>
      <MobileSymbol name="folder.badge.plus" fallback="+" color={colors.accent} size={18} />
      <Text style={styles.localFolderButtonText}>Add local folder</Text>
    </Pressable>
  }

  return <View style={styles.localFolderPicker}>
    <View style={styles.localFolderHeader}>
      <Text style={styles.inputLabel}>Local folder on this server</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)}><Text style={styles.linkText}>Close</Text></Pressable>
    </View>
    <TextInput
      testID="create-local-folder-path"
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="/absolute/path"
      placeholderTextColor={colors.muted}
      style={[styles.search, styles.monospaceInput]}
      value={path}
      onChangeText={setPath}
      onSubmitEditing={() => void browse(path)}
    />
    <View style={styles.folderActions}>
      {listing?.parent ? <Pressable accessibilityRole="button" testID="create-local-folder-up" onPress={() => void browse(listing.parent!)} style={styles.compactButton}>
        <Text style={styles.compactButtonText}>Up</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" testID="create-local-folder-browse" onPress={() => void browse(path)} style={styles.compactButton}>
        <Text style={styles.compactButtonText}>Open path</Text>
      </Pressable>
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
    </View>
    {listing ? <ScrollView nestedScrollEnabled style={styles.folderList}>
      {listing.entries.map((entry) => <Pressable
        accessibilityRole="button"
        key={entry.path}
        testID={`create-local-folder-entry-${entry.name}`}
        onPress={() => void browse(entry.path)}
        style={styles.folderRow}
      >
        <MobileSymbol name="folder.fill" fallback="▸" color={colors.accent} size={17} />
        <Text numberOfLines={1} style={styles.folderRowText}>{entry.name}</Text>
        <MobileSymbol name="chevron.right" fallback="›" color={colors.muted} size={14} />
      </Pressable>)}
    </ScrollView> : null}
    <Text style={styles.inputLabel}>Display name</Text>
    <TextInput testID="create-local-folder-name" placeholder="Optional" placeholderTextColor={colors.muted} style={styles.search} value={name} onChangeText={setName} />
    <OptionGroup
      label="Workspace behavior"
      options={[
        { id: 'direct', label: 'Direct · live', meta: 'Edits immediately change the original folder' },
        { id: 'copy', label: 'Copy · approve and paste back', meta: 'Review changes first, then paste approved changes into the original folder' },
      ]}
      selectedId={strategy}
      testIdPrefix="create-local-folder-strategy"
      onSelect={(value) => setStrategy(value as typeof strategy)}
    />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || !path.trim() }}
      testID="create-local-folder-add"
      disabled={busy || !path.trim()}
      onPress={() => void (async () => {
        setBusy(true)
        setError('')
        try {
          await onAdd({ localPath: path, name, workspaceStrategy: strategy })
          setOpen(false)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Local folder could not be added')
        } finally {
          setBusy(false)
        }
      })()}
      style={[styles.modalPrimary, (busy || !path.trim()) && styles.disabled]}
    >
      <Text style={styles.createButtonText}>Use this folder</Text>
    </Pressable>
  </View>
}

function PromptInput({ mode, value, onChange }: { mode: MobileCreateMode; value: string; onChange(value: string): void }) {
  const workOnly = mode === 'work'
  return (
    <View style={styles.disclosureBody}>
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

function StartAgentSwitch({ value, onChange }: { value: boolean; onChange(value: boolean): void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchCopy}>
        <Text style={styles.inputLabel}>Start agent now</Text>
        <Text style={styles.inputHint}>Create the Work item and immediately start its first configured session.</Text>
      </View>
      <Switch
        accessibilityLabel="Start agent now"
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accentSoft }}
        thumbColor={value ? colors.accent : colors.muted}
      />
    </View>
  )
}

function OptionGroup({ label, hint, empty, options, selectedId, selectedIds, testIdPrefix, onSelect }: {
  label?: string
  hint?: string
  empty?: string
  options: Array<{ id: string; label: string; meta?: string }>
  selectedId?: string
  selectedIds?: string[]
  testIdPrefix: string
  onSelect(id: string): void
}) {
  if (!selectedIds) {
    return options.length ? (
      <MobileSingleSelect
        label={label}
        hint={hint}
        options={options}
        value={selectedId || ''}
        placeholder={empty || `Choose ${label?.toLowerCase() || 'an option'}`}
        testID={testIdPrefix}
        onChange={onSelect}
      />
    ) : (
      <Text style={styles.inputHint}>{empty}</Text>
    )
  }
  return (
    <View style={styles.inputGroup}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      {hint ? <Text style={styles.inputHint}>{hint}</Text> : null}
      {options.length ? (
        <View style={styles.options}>
          {options.map((option) => (
            <CreationOption
              key={option.id}
              option={option}
              selected={selectedIds ? selectedIds.includes(option.id) : option.id === selectedId}
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
    if (repository.workspaceStrategy === 'move') return 'Local directory · isolated, replace on apply'
    if (repository.workspaceStrategy === 'copy') return 'Local directory · isolated, merge on apply'
    if (repository.workspaceStrategy === 'direct') return 'Local directory · live edits'
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
      <View style={styles.optionAccessory}>
        {selected ? <MobileSymbol name="checkmark.circle.fill" fallback="✓" color={colors.accent} size={20} /> : <MobileSymbol name="circle" fallback="○" color={colors.muted} size={20} />}
      </View>
    </Pressable>
  )
}

function DisclosureSection({ icon, title, summary, open = true, collapsible = false, onToggle, children }: {
  icon: SFSymbol
  title: string
  summary: string
  open?: boolean
  collapsible?: boolean
  onToggle?(): void
  children: ReactNode
}) {
  return <View style={styles.disclosure}>
    <Pressable accessibilityRole={collapsible ? 'button' : undefined} disabled={!collapsible} onPress={onToggle} style={styles.disclosureHeader}>
      <View style={styles.disclosureIcon}><MobileSymbol name={icon} fallback="•" color={colors.accent} size={17} /></View>
      <View style={styles.disclosureCopy}>
        <Text style={styles.disclosureTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.disclosureSummary}>{summary}</Text>
      </View>
      {collapsible ? <MobileSymbol name={open ? 'chevron.up' : 'chevron.down'} fallback={open ? '⌃' : '⌄'} color={colors.muted} size={15} /> : null}
    </Pressable>
    {open ? <View style={styles.disclosureContent}>{children}</View> : null}
  </View>
}

function creationSummary(mode: MobileCreateMode, creation: CreationModel) {
  const workspace = creation.selectedRepositories.length
    ? creation.selectedRepositories.length === 1
      ? creation.selectedRepositories[0]!.fullName
      : `${creation.selectedRepositories.length} projects`
    : mode === 'pullRequest' ? 'Choose Git repositories' : 'General workspace'
  if (mode === 'work') return workspace
  return `${creation.selectedBackend?.label || 'Server'} · ${workspace}`
}
