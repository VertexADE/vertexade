import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { MobileWorkspace } from '@/mobile-workspace-service'
import { MobileWorkspaceScreen } from './mobile-workspace'
import { useMobileWorkspace } from './use-mobile-workspace'

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('./use-mobile-workspace', () => ({ useMobileWorkspace: jest.fn() }))
jest.mock('@/mobile-detail-service', () => ({
  loadMobilePullRequestDetails: jest.fn(() => new Promise(() => undefined)),
  loadMobileThreadDetails: jest.fn(() => new Promise(() => undefined)),
  loadMobileWorkItemDetails: jest.fn(() => new Promise(() => undefined)),
}))

const workspace: MobileWorkspace = {
  repositories: [{
    id: 1,
    fullName: 'dovo/local',
    sourceKind: 'git',
    workspaceStrategy: 'worktree',
    backendId: 'local',
    backendName: 'Local',
  }],
  pullRequests: [{
    id: 10,
    workItemId: null,
    repoId: 1,
    number: 42,
    title: 'Make mobile primary',
    fullName: 'dovo/local',
    author: 'dom',
    url: 'https://example.test/pull/42',
    baseRef: 'main',
    headRef: 'mobile',
    draft: false,
    checksPending: 0,
    checksFailed: 0,
    reviewDecision: 'REVIEW_REQUIRED',
    updatedAt: '2026-08-11T12:00:00Z',
    backendId: 'local',
    backendName: 'Local',
  }],
  workItems: [{
    id: 2,
    key: 'W-0002',
    title: 'Native workspace',
    description: 'Center delivery work',
    kind: 'implementation',
    state: 'active',
    priority: 'high',
    primaryRepositoryId: 1,
    repositoryNames: ['dovo/local'],
    threadCount: 1,
    attention: null,
    archived: false,
    updatedAt: '2026-08-11T12:00:00Z',
    backendId: 'local',
    backendName: 'Local',
  }],
  threads: [{
    id: 3,
    workItemId: 2,
    fullName: 'dovo/local',
    status: 'running',
    agentName: 'Codex',
    taskTitle: 'Native workspace',
    latestActivity: 'Building mobile cards',
    activityAt: '2026-08-11T12:00:00Z',
    branchName: 'feature/mobile',
    pullRequestNumber: null,
    pullRequestUrl: '',
    archived: false,
    backendId: 'local',
    backendName: 'Local',
  }],
}

describe('MobileWorkspaceScreen', () => {
  beforeAll(() => jest.useFakeTimers())
  afterEach(() => act(() => jest.runOnlyPendingTimers()))
  afterAll(() => jest.useRealTimers())

  test('prioritizes PRs, Work, and Threads while keeping extensions under More', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread: null,
      dismissCompletedThread: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    const props = { connections: [{ serviceUrl: 'http://fixture:4173', servers: [{ id: 'local', label: 'Local', isDefault: true, serviceUrl: 'http://fixture:4173', modules: [], error: '' }] }], pairedServers: [], onAddServer: jest.fn(), onRenameServer: jest.fn() }
    const { rerender } = render(<MobileWorkspaceScreen {...props} />)

    expect(screen.getByText('Native workspace')).toBeOnTheScreen()
    rerender(<MobileWorkspaceScreen {...props} view="work" />)
    expect(screen.getByText('Native workspace')).toBeOnTheScreen()
    rerender(<MobileWorkspaceScreen {...props} view="threads" />)
    expect(screen.getByText('Building mobile cards')).toBeOnTheScreen()
    rerender(<MobileWorkspaceScreen {...props} view="more" />)
    expect(screen.getByText('Servers')).toBeOnTheScreen()
    expect(screen.getByText('No portable extensions')).toBeOnTheScreen()
  })

  test('starts the thread flow from a Work card with that item preselected', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread: null,
      dismissCompletedThread: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen view="work" connections={[{ serviceUrl: 'http://fixture:4173', servers: [{ id: 'local', label: 'Local', isDefault: true, serviceUrl: 'http://fixture:4173', modules: [], error: '' }] }]} pairedServers={[]} onAddServer={jest.fn()} onRenameServer={jest.fn()} />)

    fireEvent.press(screen.getByText('Start thread'))
    expect(screen.getByTestId('workspace-create-modal')).toBeOnTheScreen()
    expect(screen.getByTestId('create-work-item-2')).toHaveProp('accessibilityState', { selected: true })
    expect(screen.queryByTestId('workspace-detail-modal')).not.toBeOnTheScreen()
  })

  test('clears the native workspace search without changing the active view', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread: null,
      dismissCompletedThread: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen connections={[]} pairedServers={[]} onAddServer={jest.fn()} onRenameServer={jest.fn()} />)

    fireEvent.changeText(screen.getByLabelText('Search Focus'), 'missing')
    expect(screen.getByText('No matches')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Clear search'))
    expect(screen.getByText('Native workspace')).toBeOnTheScreen()
    expect(screen.getByLabelText('Search Focus')).toHaveProp('value', '')
  })

  test('opens native full details from each primary workspace card', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread: null,
      dismissCompletedThread: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    const props = { connections: [{ serviceUrl: 'http://fixture:4173', servers: [{ id: 'local', label: 'Local', isDefault: true, serviceUrl: 'http://fixture:4173', modules: [], error: '' }] }], pairedServers: [], onAddServer: jest.fn(), onRenameServer: jest.fn() }
    const { rerender } = render(<MobileWorkspaceScreen {...props} view="pullRequests" />)

    fireEvent.press(screen.getByTestId('open-pull-request-local-1-42'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-detail-close'))
    rerender(<MobileWorkspaceScreen {...props} view="work" />)
    fireEvent.press(screen.getByTestId('open-work-item-local-2'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-detail-close'))
    rerender(<MobileWorkspaceScreen {...props} view="threads" />)
    fireEvent.press(screen.getByTestId('open-thread-local-3'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
    expect(screen.getByTestId('detail-tab-activity').props.accessibilityState).toEqual({ selected: true })
  })

  test('renames an existing paired connection from More', () => {
    const onRenameServer = jest.fn().mockResolvedValue(undefined)
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread: null,
      dismissCompletedThread: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen
      connections={[{ serviceUrl: 'http://fixture:4173', servers: [{ id: 'local', label: 'Local', isDefault: true, serviceUrl: 'http://fixture:4173', modules: [], error: '' }] }]}
      pairedServers={[{ serviceUrl: 'http://fixture:4173', sessionToken: 'token', expiresAt: '2099-01-01T00:00:00.000Z', name: 'Office' }]}
      view="more"
      onAddServer={jest.fn()}
      onRenameServer={onRenameServer}
    />)

    expect(screen.getByDisplayValue('Office')).toBeOnTheScreen()
    expect(screen.getByText('Agent resources')).toBeOnTheScreen()
    expect(screen.queryByText('http://fixture:4173')).not.toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Connection name for Office'), 'Home Mac')
    fireEvent.press(screen.getByText('Save name'))
    expect(onRenameServer).toHaveBeenCalledWith('http://fixture:4173', 'Home Mac')
  })

  test('opens another completed thread from the completion HUD', () => {
    const dismissCompletedThread = jest.fn()
    const completedThread = { ...workspace.threads[0], status: 'completed', id: 9, taskTitle: 'Review native tabs' }
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace: { ...workspace, threads: [...workspace.threads, completedThread] },
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      completedThread,
      dismissCompletedThread,
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen connections={[]} pairedServers={[]} onAddServer={jest.fn()} onRenameServer={jest.fn()} />)

    expect(screen.getByTestId('completed-thread-hud')).toBeOnTheScreen()
    fireEvent.press(screen.getByLabelText('Open completed thread Review native tabs'))
    expect(dismissCompletedThread).toHaveBeenCalled()
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
  })

})
