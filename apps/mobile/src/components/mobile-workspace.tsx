import { useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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
import type { MobileServerCatalog } from '@/platform-service'
import { colors } from '@/theme'
import { MobileExtensionList } from './mobile-home-components'
import { MobileThreadDetail } from './mobile-thread-detail'
import { MobileWorkspaceCreateModal, type MobileCreateMode } from './mobile-workspace-create-modal'
import {
  MobileWorkspaceDetail,
  type MobileWorkspaceDetailSelection,
} from './mobile-workspace-detail'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'
import { useMobileWorkspace } from './use-mobile-workspace'

type WorkspaceView = 'pullRequests' | 'work' | 'threads' | 'more'
type WorkspaceRow = MobileWorkspaceDetailSelection | { kind: 'thread'; value: MobileThread }
type CreateRequest = { mode: MobileCreateMode; workItem?: MobileWorkItem }

const viewCopy: Record<WorkspaceView, { title: string; subtitle: string; action?: string }> = {
  pullRequests: { title: 'Pull requests', subtitle: 'Review state across every linked server.', action: '+ Draft PR' },
  work: { title: 'Work', subtitle: 'Outcomes queued, active, and moving to delivery.', action: '+ Work' },
  threads: { title: 'Threads', subtitle: 'Live agent execution and recent activity.', action: '+ Thread' },
  more: { title: 'More', subtitle: 'Connected servers and portable extensions.' },
}
const createModeByView: Record<WorkspaceView, MobileCreateMode> = {
  pullRequests: 'pullRequest',
  work: 'work',
  threads: 'thread',
  more: 'work',
}

export function MobileWorkspaceScreen({ serviceUrl, servers, onChangeService }: {
  serviceUrl: string
  servers: MobileServerCatalog[]
  onChangeService(): void
}) {
  const [view, setView] = useState<WorkspaceView>('pullRequests')
  const [query, setQuery] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateRequest | null>(null)
  const [activeThread, setActiveThread] = useState<MobileThread | null>(null)
  const detail = useDetailPresentation()
  const state = useMobileWorkspace(serviceUrl, servers)
  const availableServers = useMemo(() => servers.filter((server) => !server.error), [servers])
  const portableServers = useMemo(
    () => servers.map((server) => ({
      ...server,
      modules: server.modules.filter((module) => module.portable && (module.portable.surfaces.length || module.portable.settings)),
    })),
    [servers],
  )
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

  function openWorkItem(backendId: string, workItemId: number) {
    const item = state.workspace.workItems.find((candidate) => candidate.backendId === backendId && candidate.id === workItemId)
    if (item) detail.open({ kind: 'work', value: item })
    else state.setNotice('The related Work item is no longer available in this workspace.')
  }

  function openThreadById(backendId: string, threadId: number) {
    const item = state.workspace.threads.find((candidate) => candidate.backendId === backendId && candidate.id === threadId)
    if (item) openThread(item)
    else state.setNotice('The related thread is no longer available in this workspace.')
  }

  function openThread(thread: MobileThread) {
    detail.clear()
    setActiveThread(thread)
  }

  function openPullRequest(backendId: string, fullName: string, number: number) {
    const item = state.workspace.pullRequests.find((candidate) =>
      candidate.backendId === backendId && candidate.fullName === fullName && candidate.number === number,
    )
    if (item) detail.open({ kind: 'pullRequest', value: item })
    else state.setNotice('The related pull request is no longer available in this workspace.')
  }

  return <View style={styles.screen}>
    <WorkspaceHeader
      view={view}
      copy={copy}
      query={query}
      workspace={state.workspace}
      onCreate={beginCreate}
      onChangeView={(nextView) => changeView(nextView, setView, setQuery)}
      onChangeQuery={setQuery}
    />

    <FlatList
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={rowKey}
      refreshControl={<RefreshControl refreshing={state.loading} onRefresh={() => void state.refresh()} tintColor={colors.accent} />}
      ListHeaderComponent={<>
        {state.notice ? <View style={styles.statusBox}><Text accessibilityRole="alert" style={styles.notice}>{state.notice}</Text></View> : null}
        {state.error ? <View style={styles.statusBox}><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text><Pressable accessibilityRole="button" onPress={() => void state.refresh()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Retry</Text></Pressable></View> : null}
        {view === 'more' ? <MoreContent serviceUrl={serviceUrl} servers={portableServers} onChangeService={onChangeService} /> : null}
      </>}
      ListEmptyComponent={view === 'more' ? null : <WorkspaceEmpty loading={state.loading} query={query} view={view} />}
      renderItem={({ item }) => <WorkspaceRowCard
        item={item}
        onOpenDetail={detail.open}
        onOpenThread={openThread}
        onStartThread={startThread}
        onError={state.setNotice}
      />}
    />

    {createRequest ? <MobileWorkspaceCreateModal
      mode={createRequest.mode}
      serviceUrl={serviceUrl}
      backends={availableServers}
      workspace={state.workspace}
      initialWorkItem={createRequest.workItem}
      onClose={() => setCreateRequest(null)}
      onCompleted={completed}
    /> : null}
    <MobileWorkspaceDetail
      serviceUrl={serviceUrl}
      stack={detail.stack}
      onBack={detail.back}
      onClose={detail.close}
      onDismiss={detail.completeDismissal}
      visible={detail.visible}
      onChanged={changed}
      onOpenThread={openThread}
      onStartThread={startThread}
    />
    <ActiveThreadDetail
      serviceUrl={serviceUrl}
      thread={activeThread}
      onClose={() => setActiveThread(null)}
      onChanged={changed}
      onOpenThread={openThread}
      onOpenWork={openWorkItem}
      onOpenThreadId={openThreadById}
      onOpenPullRequest={openPullRequest}
    />
  </View>
}

function WorkspaceHeader({ view, copy, query, workspace, onCreate, onChangeView, onChangeQuery }: {
  view: WorkspaceView
  copy: (typeof viewCopy)[WorkspaceView]
  query: string
  workspace: ReturnType<typeof useMobileWorkspace>['workspace']
  onCreate(): void
  onChangeView(view: WorkspaceView): void
  onChangeQuery(query: string): void
}) {
  return <View style={styles.header}>
    <View style={styles.topRow}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>VERTEXADE MOBILE</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
      {copy.action ? <Pressable
        testID={`create-${view}`}
        accessibilityRole="button"
        accessibilityLabel={copy.action.replace('+ ', 'Create ')}
        onPress={onCreate}
        style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
      ><Text style={styles.createButtonText}>{copy.action}</Text></Pressable> : null}
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      <WorkspaceTab count={workspace.pullRequests.length} active={view === 'pullRequests'} label="PRs" testID="workspace-tab-prs" onPress={() => onChangeView('pullRequests')} />
      <WorkspaceTab count={workspace.workItems.filter((item) => !item.archived).length} active={view === 'work'} label="Work" testID="workspace-tab-work" onPress={() => onChangeView('work')} />
      <WorkspaceTab count={workspace.threads.filter((thread) => !thread.archived).length} active={view === 'threads'} label="Threads" testID="workspace-tab-threads" onPress={() => onChangeView('threads')} />
      <WorkspaceTab active={view === 'more'} label="More" testID="workspace-tab-more" onPress={() => onChangeView('more')} />
    </ScrollView>
    {view !== 'more' ? <TextInput
      accessibilityLabel={`Search ${copy.title}`}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder={`Search ${copy.title.toLowerCase()}…`}
      placeholderTextColor={colors.muted}
      style={styles.search}
      value={query}
      onChangeText={onChangeQuery}
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
  onOpenWork(backendId: string, workItemId: number): void
  onOpenThreadId(backendId: string, threadId: number): void
  onOpenPullRequest(backendId: string, fullName: string, number: number): void
}) {
  if (!thread) return null
  const { backendId, workItemId } = thread
  return <MobileThreadDetail
    key={`${backendId}:${thread.id}`}
    serviceUrl={serviceUrl}
    thread={thread}
    onClose={onClose}
    onChanged={onChanged}
    onOpenThread={onOpenThread}
    onOpenWork={workItemId ? () => {
      onClose()
      onOpenWork(backendId, workItemId)
    } : undefined}
    onOpenThreadId={(threadId) => onOpenThreadId(backendId, threadId)}
    onOpenPullRequest={(fullName, number) => {
      onClose()
      onOpenPullRequest(backendId, fullName, number)
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

function WorkspaceTab({ active, count, label, testID, onPress }: {
  active: boolean
  count?: number
  label: string
  testID: string
  onPress(): void
}) {
  return <Pressable
    accessibilityRole="tab"
    accessibilityState={{ selected: active }}
    testID={testID}
    onPress={onPress}
    style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
  >
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    {count !== undefined ? <Text style={styles.tabCount}>{count}</Text> : null}
  </Pressable>
}

function PullRequestCard({ item, onOpen, onError }: {
  item: MobilePullRequest
  onOpen(): void
  onError(message: string): void
}) {
  const status = pullRequestStatus(item)
  return <View testID={`pull-request-${item.backendId}-${item.repoId}-${item.number}`} style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.fullName} #{item.number}</Text>
        <Text style={styles.cardTitle}>{item.title}</Text>
      </View>
      <Text style={[styles.badge, item.checksFailed > 0 && styles.badgeDanger]}>{status}</Text>
    </View>
    <Text style={styles.cardText}>{item.author ? `By ${item.author} · ` : ''}{item.headRef || 'head'} → {item.baseRef || 'base'}</Text>
    <Text style={styles.metadata}>{pullRequestChecks(item)}{item.updatedAt ? ` · Updated ${relativeDate(item.updatedAt)}` : ''}</Text>
    <View style={styles.cardActions}>
      <Pressable testID={`open-pull-request-${item.backendId}-${item.repoId}-${item.number}`} accessibilityRole="button" onPress={onOpen} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Full overview</Text></Pressable>
      {item.url ? <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(item.url, onError)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Open web</Text></Pressable> : null}
    </View>
  </View>
}

function WorkItemCard({ item, onOpen, onStartThread }: {
  item: MobileWorkItem
  onOpen(): void
  onStartThread(item: MobileWorkItem): void
}) {
  return <View testID={`work-item-${item.backendId}-${item.id}`} style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.key}</Text>
        <Text style={styles.cardTitle}>{item.title}</Text>
      </View>
      <Text style={styles.badge}>{item.state}</Text>
    </View>
    {item.description ? <Text numberOfLines={3} style={styles.cardText}>{item.description}</Text> : null}
    <Text style={styles.metadata}>{item.repositoryNames.join(', ') || 'No repository'} · {item.threadCount} {item.threadCount === 1 ? 'thread' : 'threads'} · {item.priority} priority</Text>
    {item.attention ? <Text style={styles.error}>{item.attention}</Text> : null}
    <View style={styles.cardActions}>
      <Pressable testID={`open-work-item-${item.backendId}-${item.id}`} accessibilityRole="button" onPress={onOpen} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Full Work</Text></Pressable>
      {item.state !== 'done' ? <Pressable accessibilityRole="button" onPress={() => onStartThread(item)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Start thread</Text></Pressable> : null}
    </View>
  </View>
}

function ThreadCard({ item, onOpen, onError }: {
  item: MobileThread
  onOpen(): void
  onError(message: string): void
}) {
  const title = item.taskTitle || item.latestActivity || `Thread ${item.id}`
  return <View testID={`thread-${item.backendId}-${item.id}`} style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={styles.cardCopy}>
        <Text style={styles.cardEyebrow}>{item.backendName.toUpperCase()} · {item.fullName}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={[styles.badge, item.status === 'failed' && styles.badgeDanger]}>{item.status}</Text>
    </View>
    {item.latestActivity && item.latestActivity !== title ? <Text numberOfLines={3} style={styles.cardText}>{item.latestActivity}</Text> : null}
    <Text style={styles.metadata}>{item.agentName}{item.branchName ? ` · ${item.branchName}` : ''}{item.activityAt ? ` · ${relativeDate(item.activityAt)}` : ''}</Text>
    <View style={styles.cardActions}>
      <Pressable testID={`open-thread-${item.backendId}-${item.id}`} accessibilityRole="button" onPress={onOpen} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Open chat</Text></Pressable>
      {item.pullRequestUrl ? <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(item.pullRequestUrl, onError)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Open PR #{item.pullRequestNumber}</Text></Pressable> : null}
    </View>
  </View>
}

function MoreContent({ serviceUrl, servers, onChangeService }: {
  serviceUrl: string
  servers: MobileServerCatalog[]
  onChangeService(): void
}) {
  return <View style={styles.more}>
    <View style={styles.statusBox}>
      <Text style={styles.inputLabel}>Connected service</Text>
      <Text selectable style={styles.cardText}>{serviceUrl}</Text>
      <Text style={styles.metadata}>{servers.filter((server) => !server.error).length}/{servers.length} linked servers available</Text>
      <Pressable accessibilityRole="button" onPress={onChangeService} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change service</Text></Pressable>
    </View>
    <MobileExtensionList servers={servers} serviceUrl={serviceUrl} />
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
  if (loading) return { title: 'Loading workspace…', text: 'Reading every linked server.' }
  if (searching) return { title: 'No matches', text: 'Try a different search.' }
  if (view === 'pullRequests') return { title: 'No pull requests yet', text: 'Start a draft PR from this screen when you are ready.' }
  if (view === 'work') return { title: 'No work yet', text: 'Create the first outcome from this screen.' }
  return { title: 'No threads yet', text: 'Start a thread from Work or this screen.' }
}

function workspaceRows(view: WorkspaceView, query: string, workspace: ReturnType<typeof useMobileWorkspace>['workspace']): WorkspaceRow[] {
  const search = query.trim().toLowerCase()
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

function changeView(view: WorkspaceView, setView: (view: WorkspaceView) => void, setQuery: (query: string) => void): void {
  setView(view)
  setQuery('')
}

function rowKey(row: WorkspaceRow): string {
  return `${row.kind}:${row.value.backendId}:${row.value.id}`
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
