import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { loadMobileThreadTransferTargets, type MobileThreadDetails } from '@/mobile-detail-service'
import { MobileThreadRunActions } from './mobile-thread-actions'

jest.mock('@/mobile-detail-service', () => ({
  loadMobileThreadTransferTargets: jest.fn(),
}))

jest.mock('./mobile-agent-options', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    MobileAgentOptions: () => <ReactNative.Text>Agent settings</ReactNative.Text>,
  }
})

function detail(patch: Partial<MobileThreadDetails> = {}): MobileThreadDetails {
  return {
    id: 7,
    workItemId: 1,
    fullName: 'vertexade/mobile',
    status: 'completed',
    agentName: 'Codex',
    taskTitle: 'Complete mobile threads',
    latestActivity: '',
    activityAt: '2026-08-11T10:00:00Z',
    branchName: 'feature/mobile',
    pullRequestNumber: 42,
    pullRequestUrl: 'https://example.test/pr/42',
    archived: false,
    backendId: 'team',
    backendName: 'Team',
    threadId: 'thread-7',
    threadUrl: 'https://example.test/thread/7',
    agentId: 'codex',
    canSteer: true,
    kind: 'task',
    kindLabel: 'Task',
    model: 'gpt-5.6',
    reasoningEffort: 'high',
    worktreePath: '/tmp/mobile',
    createdAt: '2026-08-11T09:00:00Z',
    finishedAt: '2026-08-11T10:00:00Z',
    sourceJobId: null,
    ephemeral: false,
    reviewPhase: '',
    prompt: 'Build it',
    resultText: 'Done',
    reviewDetails: '',
    reviewSummary: '',
    content: '',
    events: [],
    queuedFollowUps: [],
    inputQuestions: [],
    files: [],
    additions: 0,
    deletions: 0,
    diff: '',
    diffError: '',
    suggestions: [],
    ...patch,
  }
}

function props(value = detail()) {
  return {
    serviceUrl: 'http://fixture:4173',
    detail: value,
    busy: false,
    onInterrupt: jest.fn(),
    onRetry: jest.fn(),
    onReReview: jest.fn(),
    onSaveTasks: jest.fn(),
    onFork: jest.fn(),
    onTransfer: jest.fn(),
    onOpenWork: jest.fn(),
    onOpenParent: undefined,
    onOpenPullRequest: jest.fn(),
    onError: jest.fn(),
  }
}

describe('MobileThreadRunActions', () => {
  beforeEach(() => jest.mocked(loadMobileThreadTransferTargets).mockResolvedValue([]))

  test('collects a complete fork request with branch and execution settings', () => {
    const value = props()
    render(<MobileThreadRunActions {...value} />)

    fireEvent.press(screen.getByLabelText('Thread actions'))
    fireEvent.press(screen.getByText('Fork into a new worktree'))
    fireEvent(screen.getByTestId('thread-action-branch-type-select'), 'valueChange', 'fix')
    fireEvent.changeText(screen.getByLabelText('Fork title'), 'Fix mobile thread')
    fireEvent.changeText(screen.getByLabelText('Fork instruction'), 'Finish the workflow')
    fireEvent.press(screen.getByText('Fork and start'))

    expect(value.onFork).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Fix mobile thread',
      prompt: 'Finish the workflow',
      base: 'current',
      branchType: 'fix',
      options: expect.objectContaining({ agentId: 'codex', model: 'gpt-5.6', reasoningEffort: 'high' }),
    }))
  })

  test('loads destinations and creates a durable context transfer', async () => {
    jest.mocked(loadMobileThreadTransferTargets).mockResolvedValue([{
      id: 21,
      status: 'completed',
      taskTitle: 'Idle target',
      branchName: 'feature/other',
      workItemKey: 'W-0002',
      workItemTitle: 'Other work',
      fullName: 'vertexade/other',
    }])
    const value = props()
    render(<MobileThreadRunActions {...value} />)

    fireEvent.press(screen.getByLabelText('Thread actions'))
    fireEvent.press(screen.getByText('Send output to another worktree'))
    await screen.findByText('W-0002 · vertexade/other')
    fireEvent.press(screen.getByText('W-0002 · vertexade/other'))
    fireEvent.changeText(screen.getByLabelText('Transfer title'), 'Apply findings')
    fireEvent.changeText(screen.getByLabelText('Transfer instruction'), 'Use the completed output')
    fireEvent.press(screen.getByText('Create sub-item and send'))

    await waitFor(() => expect(value.onTransfer).toHaveBeenCalledWith(21, 'Apply findings', 'Use the completed output'))
  })

  test('opens the linked pull request inside the mobile workspace', () => {
    const value = props()
    render(<MobileThreadRunActions {...value} />)

    fireEvent.press(screen.getByLabelText('Thread actions'))
    fireEvent.press(screen.getByText('Open pull request #42'))

    expect(value.onOpenPullRequest).toHaveBeenCalledTimes(1)
  })

  test('keeps the primary run action in the top actions menu', () => {
    const value = props(detail({ status: 'running' }))
    render(<MobileThreadRunActions {...value} />)

    expect(screen.queryByText('More actions')).not.toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('thread-more-actions'))
    fireEvent.press(screen.getByText('Interrupt thread'))

    expect(value.onInterrupt).toHaveBeenCalledTimes(1)
  })
})
