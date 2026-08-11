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
  repositories: [{ id: 1, fullName: 'dovo/local', backendId: 'local', backendName: 'Local' }],
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
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen serviceUrl="http://fixture:4173" servers={[{ id: 'local', label: 'Local', isDefault: true, modules: [], error: '' }]} onChangeService={jest.fn()} />)

    expect(screen.getByText('Make mobile primary')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-tab-work'))
    expect(screen.getByText('Native workspace')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-tab-threads'))
    expect(screen.getByText('Building mobile cards')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-tab-more'))
    expect(screen.getByText('Connected service')).toBeOnTheScreen()
    expect(screen.getByText('No portable extensions')).toBeOnTheScreen()
  })

  test('starts the thread flow from a Work card with that item preselected', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen serviceUrl="http://fixture:4173" servers={[{ id: 'local', label: 'Local', isDefault: true, modules: [], error: '' }]} onChangeService={jest.fn()} />)

    fireEvent.press(screen.getByTestId('workspace-tab-work'))
    fireEvent.press(screen.getByText('Start thread'))
    expect(screen.getByTestId('workspace-create-modal')).toBeOnTheScreen()
    expect(screen.getByTestId('create-work-item-2')).toHaveProp('accessibilityState', { selected: true })
  })

  test('opens native full details from each primary workspace card', () => {
    jest.mocked(useMobileWorkspace).mockReturnValue({
      workspace,
      loading: false,
      error: '',
      notice: '',
      setNotice: jest.fn(),
      refresh: jest.fn().mockResolvedValue(undefined),
    })
    render(<MobileWorkspaceScreen serviceUrl="http://fixture:4173" servers={[{ id: 'local', label: 'Local', isDefault: true, modules: [], error: '' }]} onChangeService={jest.fn()} />)

    fireEvent.press(screen.getByTestId('open-pull-request-local-1-42'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-detail-close'))
    fireEvent.press(screen.getByTestId('workspace-tab-work'))
    fireEvent.press(screen.getByTestId('open-work-item-local-2'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('workspace-detail-close'))
    fireEvent.press(screen.getByTestId('workspace-tab-threads'))
    fireEvent.press(screen.getByTestId('open-thread-local-3'))
    expect(screen.getByTestId('workspace-detail-modal')).toBeOnTheScreen()
  })
})
