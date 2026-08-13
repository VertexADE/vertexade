import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { GestureResponderEvent } from 'react-native'
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native'
import { openMobileHttpUrl } from '@/mobile-linking'
import type {
  MobilePullRequest,
  MobileThread,
  MobileWorkItem,
} from '@/mobile-workspace-service'
import type { MobileSession } from '@/mobile-session'
import type { MobileServerCatalog } from '@/platform-service'
import { colors } from '@/theme'
import { MobileExtensionList } from './mobile-home-components'
import { MobileGlass } from './mobile-glass'
import { MobileSymbol } from './mobile-symbol'
import { MobileSearchField } from './mobile-search-field'
import { MobileServerAgentSettings } from './mobile-server-agent-settings'
import { MobileThreadDetail } from './mobile-thread-detail'
import { MobileWorkspaceCreateModal, type MobileCreateMode } from './mobile-workspace-create-modal'
import {
  MobileWorkspaceDetail,
  type MobileWorkspaceDetailSelection,
} from './mobile-workspace-detail'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'
import { useMobileWorkspace } from './use-mobile-workspace'
import type { MobileConnectionCatalog } from './use-mobile-workspace'
import { useOptionalMobileApp } from './mobile-app-context'
import { defaultMobileVoicePreferences, transcriptLanguages } from '@/mobile-voice-preferences'

export type WorkspaceView = 'focus' | 'pullRequests' | 'work' | 'threads' | 'more'
type WorkspaceRow = MobileWorkspaceDetailSelection | { kind: 'thread'; value: MobileThread }
type CreateRequest = { mode: MobileCreateMode; workItem?: MobileWorkItem }

const viewCopy: Record<WorkspaceView, { title: string; subtitle: string; action?: string }> = {
  focus: { title: 'Focus', subtitle: 'Decisions, active work, and agents that need you.', action: '+ Work' },
  pullRequests: { title: 'Pull requests', subtitle: 'Review state across every paired server.', action: '+ Draft PR' },
  work: { title: 'Work', subtitle: 'Outcomes queued, active, and moving to delivery.', action: '+ Work' },
  threads: { title: 'Threads', subtitle: 'Live agent execution and recent activity.', action: '+ Thread' },
  more: { title: 'More', subtitle: 'Connected servers and portable extensions.' },
}
const createModeByView: Record<WorkspaceView, MobileCreateMode> = {
  focus: 'work',
  pullRequests: 'pullRequest',
  work: 'work',
  threads: 'thread',
  more: 'work',
}
export function MobileWorkspaceScreen({ connections, pairedServers, view = 'focus', workspaceState, onAddServer, onRenameServer }: {
  connections: MobileConnectionCatalog[]
  pairedServers: MobileSession[]
  view?: WorkspaceView
  workspaceState?: ReturnType<typeof useMobileWorkspace>
  onAddServer(): void
  onRenameServer(serviceUrl: string, name: string): Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [activeThread, setActiveThread] = useState<MobileThread | null>(null)
  const detail = useDetailPresentation()
  const localWorkspaceState = useMobileWorkspace(connections, !workspaceState)
  const state = workspaceState || localWorkspaceState
  const related = useRelatedWorkspaceNavigation(state.workspace, state.setNotice, detail, setActiveThread)
  const servers = useMemo(() => connections.flatMap((connection) => connection.servers), [connections])
  const availableServers = useMemo(() => servers.filter((server) => !server.error), [servers])
  const rows = useMemo(() => workspaceRows(view, query, state.workspace), [query, state.workspace, view])
  const copy = viewCopy[view]

  function beginCreate() {
    setCreateRequest({ mode: createModeByView[view] })
  }

  async function completed(message: string) {
    state.setNotice(message)
    await state.refresh()
    setCreateRequest(null)
  }

  async function changed(message: string) {
    state.setNotice(message)
    await state.refresh()
  }

  function startThread(item: MobileWorkItem) {
    detail.clear()
    setCreateRequest({ mode: 'thread', workItem: item })
  }

  function openThread(thread: MobileThread) {
    detail.clear()
    setActiveThread(thread)
  }

  return <View style={styles.screen}>
    <WorkspaceHeader
      view={view}
      copy={copy}
      query={query}
      onCreate={beginCreate}
      onChangeQuery={setQuery}
    />

    <FlatList
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={rowKey}
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void state.refresh()} tintColor={colors.accent} />}
      ListHeaderComponent={<WorkspaceListHeader state={state} view={view} connections={connections} pairedServers={pairedServers} onAddServer={onAddServer} onRenameServer={onRenameServer} />}
      ListEmptyComponent={view === 'more' ? null : <WorkspaceEmpty loading={state.loading} query={query} view={view} />}
      renderItem={({ item }) => <WorkspaceRowCard
        item={item}
        onOpenDetail={detail.open}
        onOpenThread={openThread}
        onStartThread={startThread}
        onError={state.setNotice}
      />}
    />

    <WorkspaceOverlays
      connections={connections}
      availableServers={availableServers}
      state={state}
      detail={detail}
      createRequest={createRequest}
      activeThread={activeThread}
      related={related}
      onCompleted={completed}
      onChanged={changed}
      onOpenThread={openThread}
      onStartThread={startThread}
      onCloseCreate={() => setCreateRequest(null)}
      onCloseThread={() => setActiveThread(null)}
    />
    <WorkspaceCompletionHud
      activeThread={activeThread}
      thread={state.completedThread}
      onDismiss={state.dismissCompletedThread}
      onOpen={openThread}
    />
  </View>
}

function WorkspaceListHeader({ state, view, connections, pairedServers, onAddServer, onRenameServer }: {
  state: ReturnType<typeof useMobileWorkspace>
  view: WorkspaceView
  connections: MobileConnectionCatalog[]
  pairedServers: MobileSession[]
  onAddServer(): void
  onRenameServer(serviceUrl: string, name: string): Promise<void>
}) {
  return <>
    {state.notice ? <MobileGlass style={styles.statusBox}><Text accessibilityRole="alert" style={styles.notice}>{state.notice}</Text></MobileGlass> : null}
    {state.error ? <MobileGlass style={styles.statusBox}><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text><Pressable accessibilityRole="button" onPress={() => void state.refresh()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Retry</Text></Pressable></MobileGlass> : null}
    {view === 'more' ? <MoreContent connections={connections} pairedServers={pairedServers} onAddServer={onAddServer} onRenameServer={onRenameServer} /> : null}
  </>
}

function WorkspaceCompletionHud({ activeThread, thread, onOpen, onDismiss }: { activeThread: MobileThread | null; thread: MobileThread | null; onOpen(thread: MobileThread): void; onDismiss(): void }) {
  useEffect(() => {
    if (thread && activeThread && threadKey(thread) === threadKey(activeThread)) onDismiss()
  }, [activeThread, onDismiss, thread])
  if (!thread || (activeThread && threadKey(thread) === threadKey(activeThread))) return null
  return <CompletedThreadHud thread={thread} onDismiss={onDismiss} onOpen={() => {
    onDismiss()
    onOpen(thread)
  }} />
}

function CompletedThreadHud({ thread, onOpen, onDismiss }: { thread: MobileThread; onOpen(): void; onDismiss(): void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8_000)
    return () => clearTimeout(timer)
  }, [onDismiss])
  return <MobileGlass testID="completed-thread-hud" interactive style={styles.completionHud}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open completed thread ${thread.taskTitle}`} onPress={onOpen} style={styles.completionHudOpen}>
      <MobileSymbol name="checkmark.circle.fill" fallback="✓" color={colors.accent} size={24} />
      <View style={styles.completionHudCopy}>
        <Text style={styles.completionHudLabel}>{thread.backendName} · Session completed</Text>
        <Text numberOfLines={1} style={styles.completionHudTitle}>{thread.taskTitle || thread.latestActivity || `Thread ${thread.id}`}</Text>
      </View>
      <MobileSymbol name="chevron.right" fallback="›" color={colors.muted} size={14} />
    </Pressable>
  </MobileGlass>
}

function threadKey(thread: MobileThread): string {
  return `${thread.serviceUrl || ''}:${thread.backendId}:${thread.id}`
}

function WorkspaceOverlays({ connections, availableServers, state, detail, createRequest, activeThread, related, onCompleted, onChanged, onOpenThread, onStartThread, onCloseCreate, onCloseThread }: {
  connections: MobileConnectionCatalog[]
  availableServers: MobileServerCatalog[]
  state: ReturnType<typeof useMobileWorkspace>
  detail: ReturnType<typeof useDetailPresentation>
  createRequest: CreateRequest | null
  activeThread: MobileThread | null
  related: ReturnType<typeof useRelatedWorkspaceNavigation>
  onCompleted(message: string): Promise<void>
  onChanged(message: string): Promise<void>
  onOpenThread(thread: MobileThread): void
  onStartThread(item: MobileWorkItem): void
  onCloseCreate(): void
  onCloseThread(): void
}) {
  const fallbackServiceUrl = connections.find((connection) => !connection.error)?.serviceUrl || ''
  return <>
    {createRequest ? <MobileWorkspaceCreateModal
      mode={createRequest.mode}
      serviceUrl={createRequest.workItem?.serviceUrl || fallbackServiceUrl}
      backends={availableServers}
      workspace={state.workspace}
      initialWorkItem={createRequest.workItem}
      onClose={onCloseCreate}
      onCompleted={onCompleted}
    /> : null}
    <MobileWorkspaceDetail
      serviceUrl={detail.stack.at(-1)?.value.serviceUrl || fallbackServiceUrl}
      stack={detail.stack}
      onBack={detail.back}
      onClose={detail.close}
      onDismiss={detail.completeDismissal}
      visible={detail.visible}
      onChanged={onChanged}
      onOpenThread={onOpenThread}
      onStartThread={onStartThread}
    />
    <ActiveThreadDetail
      serviceUrl={activeThread?.serviceUrl || fallbackServiceUrl}
      thread={activeThread}
      onClose={onCloseThread}
      onChanged={onChanged}
      onOpenThread={onOpenThread}
      onOpenWork={related.openWorkItem}
      onOpenThreadId={related.openThreadById}
      onOpenPullRequest={related.openPullRequest}
    />
  </>
}

function useRelatedWorkspaceNavigation(
  workspace: ReturnType<typeof useMobileWorkspace>['workspace'],
  setNotice: (message: string) => void,
  detail: ReturnType<typeof useDetailPresentation>,
  setActiveThread: (thread: MobileThread | null) => void,
) {
  function openWorkItem(serviceUrl: string | undefined, backendId: string, workItemId: number) {
    const item = workspace.workItems.find((candidate) => candidate.serviceUrl === serviceUrl && candidate.backendId === backendId && candidate.id === workItemId)
    if (item) detail.open({ kind: 'work', value: item })
    else setNotice('The related Work item is no longer available in this workspace.')
  }
  function openThreadById(serviceUrl: string | undefined, backendId: string, threadId: number) {
    const item = workspace.threads.find((candidate) => candidate.serviceUrl === serviceUrl && candidate.backendId === backendId && candidate.id === threadId)
    if (item) setActiveThread(item)
    else setNotice('The related thread is no longer available in this workspace.')
  }
  function openPullRequest(serviceUrl: string | undefined, backendId: string, fullName: string, number: number) {
    const item = workspace.pullRequests.find((candidate) => candidate.serviceUrl === serviceUrl && candidate.backendId === backendId && candidate.fullName === fullName && candidate.number === number)
    if (item) detail.open({ kind: 'pullRequest', value: item })
    else setNotice('The related pull request is no longer available in this workspace.')
  }
  return { openWorkItem, openThreadById, openPullRequest }
}

function WorkspaceHeader({ view, copy, query, onCreate, onChangeQuery }: {
  view: WorkspaceView
  copy: (typeof viewCopy)[WorkspaceView]
  query: string
  onCreate(): void
  onChangeQuery(query: string): void
}) {
  return <View style={styles.header}>
    <View style={styles.topRow}>
      <View style={styles.heading}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
      {copy.action ? <Pressable
        testID={`create-${view}`}
        accessibilityRole="button"
        accessibilityLabel={copy.action.replace('+ ', 'Create ')}
        onPress={onCreate}
        style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
      ><MobileSymbol name="plus" fallback="+" color={colors.ink} size={18} /><Text style={styles.createButtonText}>{copy.action.replace('+ ', '')}</Text></Pressable> : null}
    </View>
    {view !== 'more' ? <MobileSearchField
      label={`Search ${copy.title}`}
      placeholder={`Search ${copy.title.toLowerCase()}…`}
      value={query}
      onChange={onChangeQuery}
    /> : null}
  </View>
}

function WorkspaceRowCard({ item, onOpenDetail, onOpenThread, onStartThread, onError }: {
  item: WorkspaceRow
  onOpenDetail(selection: MobileWorkspaceDetailSelection): void
  onOpenThread(thread: MobileThread): void
  onStartThread(item: MobileWorkItem): void
  onError(message: string): void
}) {
  if (item.kind === 'pullRequest') return <PullRequestCard item={item.value} onOpen={() => onOpenDetail(item)} onError={onError} />
  if (item.kind === 'work') return <WorkItemCard item={item.value} onOpen={() => onOpenDetail(item)} onStartThread={onStartThread} />
  return <ThreadCard item={item.value} onOpen={() => onOpenThread(item.value)} onError={onError} />
}

function ActiveThreadDetail({ serviceUrl, thread, onClose, onChanged, onOpenThread, onOpenWork, onOpenThreadId, onOpenPullRequest }: {
  serviceUrl: string
  thread: MobileThread | null
  onClose(): void
  onChanged(message: string): Promise<void>
  onOpenThread(thread: MobileThread): void
  onOpenWork(serviceUrl: string | undefined, backendId: string, workItemId: number): void
  onOpenThreadId(serviceUrl: string | undefined, backendId: string, threadId: number): void
  onOpenPullRequest(serviceUrl: string | undefined, backendId: string, fullName: string, number: number): void
}) {
  if (!thread) return null
  const { serviceUrl: sourceServiceUrl, backendId, workItemId } = thread
  return <MobileThreadDetail
    key={`${backendId}:${thread.id}`}
    serviceUrl={serviceUrl}
    thread={thread}
    onClose={onClose}
    onChanged={onChanged}
    onOpenThread={onOpenThread}
    onOpenWork={workItemId ? () => {
      onClose()
      onOpenWork(sourceServiceUrl, backendId, workItemId)
    } : undefined}
    onOpenThreadId={(threadId) => onOpenThreadId(sourceServiceUrl, backendId, threadId)}
    onOpenPullRequest={(fullName, number) => {
      onClose()
      onOpenPullRequest(sourceServiceUrl, backendId, fullName, number)
    }}
  />
}

function useDetailPresentation() {
  const [stack, setStack] = useState<MobileWorkspaceDetailSelection[]>([])
  const [visible, setVisible] = useState(false)
  const pending = useRef<MobileWorkspaceDetailSelection | null>(null)

  function open(selection: MobileWorkspaceDetailSelection) {
    if (!stack.length) {
      setStack([selection])
      setVisible(true)
      return
    }
    pending.current = selection
    setVisible(false)
  }

  function clear() {
    pending.current = null
    setVisible(false)
    setStack([])
  }

  function completeDismissal() {
    const selection = pending.current
    pending.current = null
    if (!selection) {
      setStack([])
      return
    }
    setStack([selection])
    setVisible(true)
  }

  return {
    stack,
    visible,
    open,
    clear,
    close: clear,
    back: () => setStack((current) => current.slice(0, -1)),
    completeDismissal,
  }
}

function PullRequestCard({ item, onOpen, onError }: {
  item: MobilePullRequest
  onOpen(): void
  onError(message: string): void
}) {
  const status = pullRequestStatus(item)
  return <CardShell openTestID={`open-pull-request-${item.backendId}-${item.repoId}-${item.number}`} cardTestID={`pull-request-${item.backendId}-${item.repoId}-${item.number}`} onOpen={onOpen}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.fullName} #{item.number}</Text>
        <Text style={styles.cardTitle}>{item.title}</Text>
      </View>
      <View style={styles.cardAccessory}><Text style={[styles.badge, item.checksFailed > 0 && styles.badgeDanger]}>{status}</Text><CardChevron /></View>
    </View>
    <Text style={styles.cardText}>{item.author ? `By ${item.author} · ` : ''}{item.headRef || 'head'} → {item.baseRef || 'base'}</Text>
    <Text style={styles.metadata}>{pullRequestChecks(item)}{item.updatedAt ? ` · Updated ${relativeDate(item.updatedAt)}` : ''}</Text>
    {item.url ? <CardAction role="link" label="Open web" onPress={() => void openExternalUrl(item.url, onError)} /> : null}
  </CardShell>
}

function WorkItemCard({ item, onOpen, onStartThread }: {
  item: MobileWorkItem
  onOpen(): void
  onStartThread(item: MobileWorkItem): void
}) {
  return <CardShell openTestID={`open-work-item-${item.backendId}-${item.id}`} cardTestID={`work-item-${item.backendId}-${item.id}`} onOpen={onOpen}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.key}</Text>
        <Text style={styles.cardTitle}>{item.title}</Text>
      </View>
      <View style={styles.cardAccessory}><Text style={styles.badge}>{item.state}</Text><CardChevron /></View>
    </View>
    {item.description ? <Text numberOfLines={3} style={styles.cardText}>{item.description}</Text> : null}
    <Text style={styles.metadata}>{item.repositoryNames.join(', ') || 'No repository'} · {item.threadCount} {item.threadCount === 1 ? 'thread' : 'threads'} · {item.priority} priority</Text>
    {item.attention ? <Text style={styles.error}>{item.attention}</Text> : null}
    {item.state !== 'done' ? <CardAction role="button" label="Start thread" onPress={() => onStartThread(item)} /> : null}
  </CardShell>
}

function ThreadCard({ item, onOpen, onError }: {
  item: MobileThread
  onOpen(): void
  onError(message: string): void
}) {
  const title = item.taskTitle || item.latestActivity || `Thread ${item.id}`
  return <CardShell openTestID={`open-thread-${item.backendId}-${item.id}`} cardTestID={`thread-${item.backendId}-${item.id}`} onOpen={onOpen}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.fullName}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.cardAccessory}><Text style={[styles.badge, item.status === 'failed' && styles.badgeDanger]}>{item.status}</Text><CardChevron /></View>
    </View>
    {item.latestActivity && item.latestActivity !== title ? <Text numberOfLines={3} style={styles.cardText}>{item.latestActivity}</Text> : null}
    <Text style={styles.metadata}>{item.agentName}{item.branchName ? ` · ${item.branchName}` : ''}{item.activityAt ? ` · ${relativeDate(item.activityAt)}` : ''}</Text>
    {item.pullRequestUrl ? <CardAction role="link" label={`Open PR #${item.pullRequestNumber}`} onPress={() => void openExternalUrl(item.pullRequestUrl, onError)} /> : null}
  </CardShell>
}

function CardShell({ openTestID, cardTestID, onOpen, children }: { openTestID: string; cardTestID: string; onOpen(): void; children: ReactNode }) {
  return (
    <Pressable testID={openTestID} accessibilityRole="button" onPress={onOpen} style={({ pressed }) => pressed && styles.pressed}>
      <MobileGlass testID={cardTestID} interactive style={styles.card}>{children}</MobileGlass>
    </Pressable>
  )
}

function CardChevron() {
  return <MobileSymbol name="chevron.right" fallback="›" color={colors.muted} size={13} />
}

function CardAction({ role, label, onPress }: { role: 'button' | 'link'; label: string; onPress(): void }) {
  function press(event?: GestureResponderEvent) {
    event?.stopPropagation()
    onPress()
  }
  return (
    <View style={styles.cardActions}>
      <Pressable accessibilityRole={role} onPress={press} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{label}</Text>
      </Pressable>
    </View>
  )
}

function MoreContent({ connections, pairedServers, onAddServer, onRenameServer }: {
  connections: MobileConnectionCatalog[]
  pairedServers: MobileSession[]
  onAddServer(): void
  onRenameServer(serviceUrl: string, name: string): Promise<void>
}) {
  const app = useOptionalMobileApp()
  const voicePreferences = app?.voicePreferences || defaultMobileVoicePreferences
  const [settingsServer, setSettingsServer] = useState<{ backendId: string; name: string; serviceUrl: string } | null>(null)
  return <View style={styles.more}>
    <MobileGlass style={styles.statusBox}>
      <Text style={styles.inputLabel}>Voice and text cleanup</Text>
      <Text style={styles.cardText}>Uses Parakeet auto-detection and the languages available from Apple Intelligence or Gemini Nano on this device.</Text>
      <PreferenceChoices
        label="Cleanup mode"
        options={[['off', 'Off'], ['cleanup', 'Clean up'], ['cleanup-and-edit', 'Clean up + spoken edits']]}
        value={voicePreferences.cleanupMode}
        onChange={(cleanupMode) => void app?.updateVoicePreferences({ ...voicePreferences, cleanupMode })}
      />
      <PreferenceChoices
        label="Language"
        options={transcriptLanguages.map(({ code, label }) => [code, label])}
        value={voicePreferences.language}
        onChange={(language) => void app?.updateVoicePreferences({ ...voicePreferences, language })}
      />
    </MobileGlass>
    <MobileGlass style={styles.statusBox}>
      <Text style={styles.inputLabel}>Servers</Text>
      <Text style={styles.cardText}>Each server is paired directly. Linked servers are never inherited from another connection.</Text>
      {pairedServers.map((session) => {
        const connection = connections.find((candidate) => candidate.serviceUrl === session.serviceUrl)
        const server = connection?.servers[0]
        return <ConnectionNameEditor key={session.serviceUrl} session={session} status={connection?.error || 'Connected · included in unified view'} onSave={onRenameServer} onManage={server ? () => setSettingsServer({ backendId: server.id, name: session.name || server.label, serviceUrl: session.serviceUrl }) : undefined} />
      })}
      <Pressable accessibilityRole="button" onPress={onAddServer} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Add server</Text></Pressable>
    </MobileGlass>
    {connections.map((connection) => <MobileExtensionList
      key={connection.serviceUrl}
      servers={connection.servers.map((server) => ({ ...server, modules: server.modules.filter((module) => module.portable && (module.portable.surfaces.length || module.portable.settings)) }))}
      serviceUrl={connection.serviceUrl}
    />)}
    {settingsServer ? <MobileServerAgentSettings backendId={settingsServer.backendId} serverName={settingsServer.name} serviceUrl={settingsServer.serviceUrl} visible onClose={() => setSettingsServer(null)} /> : null}
  </View>
}

function PreferenceChoices<T extends string>({ label, options, value, onChange }: { label: string; options: Array<[T, string]>; value: T; onChange(value: T): void }) {
  return <View style={styles.option}>
    <Text style={styles.optionText}>{label}</Text>
    <View style={styles.cardActions}>
      {options.map(([id, name]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: id === value }} onPress={() => onChange(id)} style={[styles.secondaryButton, id === value && styles.primaryButton]}>
        <Text style={id === value ? styles.primaryButtonText : styles.secondaryButtonText}>{name}</Text>
      </Pressable>)}
    </View>
  </View>
}

function ConnectionNameEditor({ session, status, onSave, onManage }: { session: MobileSession; status: string; onSave(serviceUrl: string, name: string): Promise<void>; onManage?: () => void }) {
  const [name, setName] = useState(session.name || '')
  const changed = name.trim() !== (session.name || '')
  return <View style={styles.option}>
    <TextInput accessibilityLabel={`Connection name for ${session.name || 'server'}`} autoCapitalize="words" autoCorrect placeholder="Server name" placeholderTextColor={colors.muted} style={styles.connectionNameInput} value={name} onChangeText={setName} />
    <Text style={styles.optionMeta}>{status}</Text>
    <View style={styles.cardActions}>
      {onManage ? <Pressable accessibilityRole="button" onPress={onManage} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Agent resources</Text></Pressable> : null}
      {changed ? <Pressable accessibilityRole="button" onPress={() => void onSave(session.serviceUrl, name)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Save name</Text></Pressable> : null}
    </View>
  </View>
}

function WorkspaceEmpty({ loading, query, view }: { loading: boolean; query: string; view: Exclude<WorkspaceView, 'more'> }) {
  const copy = emptyCopy(loading, Boolean(query), view)
  return <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{copy.title}</Text>
    <Text style={styles.emptyText}>{copy.text}</Text>
  </View>
}

function emptyCopy(loading: boolean, searching: boolean, view: Exclude<WorkspaceView, 'more'>): { title: string; text: string } {
  if (loading) return { title: 'Loading workspace…', text: 'Reading the selected server.' }
  if (searching) return { title: 'No matches', text: 'Try a different search.' }
  if (view === 'focus') return { title: 'Nothing needs attention', text: 'Your active work and decisions will appear here.' }
  if (view === 'pullRequests') return { title: 'No pull requests yet', text: 'Start a draft PR from this screen when you are ready.' }
  if (view === 'work') return { title: 'No work yet', text: 'Create the first outcome from this screen.' }
  return { title: 'No threads yet', text: 'Start a thread from Work or this screen.' }
}

function workspaceRows(view: WorkspaceView, query: string, workspace: ReturnType<typeof useMobileWorkspace>['workspace']): WorkspaceRow[] {
  const search = query.trim().toLowerCase()
  if (view === 'focus') return workspace.workItems
    .filter((item) => !item.archived && item.state !== 'done' && matches(search, item.key, item.title, item.description, item.attention || ''))
    .sort((left, right) => Number(Boolean(right.attention)) - Number(Boolean(left.attention)))
    .map((value) => ({ kind: 'work', value }))
  if (view === 'pullRequests') return workspace.pullRequests
    .filter((item) => matches(search, item.title, item.fullName, item.author, String(item.number), item.backendName))
    .map((value) => ({ kind: 'pullRequest', value }))
  if (view === 'work') return workspace.workItems
    .filter((item) => !item.archived && matches(search, item.key, item.title, item.description, item.repositoryNames.join(' '), item.backendName))
    .map((value) => ({ kind: 'work', value }))
  if (view === 'threads') return workspace.threads
    .filter((item) => !item.archived && matches(search, item.taskTitle, item.latestActivity, item.fullName, item.branchName, item.agentName, item.backendName))
    .map((value) => ({ kind: 'thread', value }))
  return []
}

function matches(query: string, ...values: string[]): boolean {
  return !query || values.some((value) => value.toLowerCase().includes(query))
}

function rowKey(row: WorkspaceRow): string {
  return `${row.kind}:${row.value.serviceUrl || ''}:${row.value.backendId}:${row.value.id}`
}

function pullRequestStatus(item: MobilePullRequest): string {
  if (item.checksFailed) return 'checks failed'
  if (item.reviewDecision === 'CHANGES_REQUESTED') return 'changes requested'
  if (item.reviewDecision === 'APPROVED') return 'approved'
  if (item.draft) return 'draft'
  return 'review'
}

function pullRequestChecks(item: MobilePullRequest): string {
  if (item.checksFailed) return `${item.checksFailed} failed check${item.checksFailed === 1 ? '' : 's'}`
  if (item.checksPending) return `${item.checksPending} pending check${item.checksPending === 1 ? '' : 's'}`
  return 'Checks clear'
}

function relativeDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

async function openExternalUrl(value: string, onError: (message: string) => void): Promise<void> {
  await openMobileHttpUrl(value, onError)
}
