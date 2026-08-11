import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import {
  cancelMobileQueuedMessage,
  deliverMobileThreadMessage,
  loadMobilePullRequestDetails,
  loadMobileThreadDetails,
  loadMobileWorkItemDetails,
  postMobileReviewSuggestions,
  steerMobileQueuedMessage,
  type MobilePullRequestDetails,
  type MobileThreadDetails,
  type MobileWorkItemDetails,
} from '@/mobile-detail-service'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from '@/mobile-workspace-service'
import { MobilePullRequestDetail } from './mobile-pull-request-detail'
import { MobileThreadDetail } from './mobile-thread-detail'
import { MobileWorkDetail } from './mobile-work-detail'

jest.mock('@/mobile-detail-service', () => ({
  cancelMobileQueuedMessage: jest.fn(),
  deliverMobileThreadMessage: jest.fn(),
  ensureMobilePullRequestWork: jest.fn(),
  interruptMobileThread: jest.fn(),
  loadMobilePullRequestDetails: jest.fn(),
  loadMobileThreadDetails: jest.fn(),
  loadMobileWorkItemDetails: jest.fn(),
  loadMobileThreadTransferTargets: jest.fn(),
  forkMobileThread: jest.fn(),
  postMobileReviewSuggestions: jest.fn(),
  reReviewMobileThread: jest.fn(),
  retryMobileThread: jest.fn(),
  saveMobileThreadTasks: jest.fn(),
  steerMobileQueuedMessage: jest.fn(),
  submitMobileThreadInput: jest.fn(),
  transferMobileThreadContext: jest.fn(),
  updateMobileWorkState: jest.fn(),
}))

jest.mock('./mobile-markdown', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    MobileMarkdown: ({ content, emptyText }: { content: string; emptyText: string }) => (
      <ReactNative.Text>{content || emptyText}</ReactNative.Text>
    ),
  }
})

jest.mock('./mobile-diff', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    MobileDiff: ({ patch }: { patch: string }) => <ReactNative.Text>{patch}</ReactNative.Text>,
  }
})

const pullRequest: MobilePullRequest = {
  id: 299,
  workItemId: null,
  repoId: 1,
  number: 299,
  title: 'Complete PR overview',
  fullName: 'vertexade/fixture',
  author: 'dom',
  url: 'https://example.test/pr/299',
  baseRef: 'main',
  headRef: 'mobile',
  draft: false,
  checksPending: 0,
  checksFailed: 0,
  reviewDecision: 'REVIEW_REQUIRED',
  updatedAt: '2026-08-11T10:00:00Z',
  backendId: 'fixture',
  backendName: 'Fixture',
}
const thread: MobileThread = {
  id: 7,
  workItemId: 1,
  fullName: 'vertexade/fixture',
  status: 'running',
  agentName: 'Codex',
  taskTitle: 'Complete mobile details',
  latestActivity: 'Building the thread view',
  activityAt: '2026-08-11T10:00:00Z',
  branchName: 'feature/mobile',
  pullRequestNumber: 299,
  pullRequestUrl: 'https://example.test/pr/299',
  archived: false,
  backendId: 'fixture',
  backendName: 'Fixture',
}
const workItem: MobileWorkItem = {
  id: 1,
  key: 'W-0001',
  title: 'Complete mobile details',
  description: 'Match the important web UI information.',
  kind: 'implementation',
  state: 'active',
  priority: 'high',
  primaryRepositoryId: 1,
  repositoryNames: ['vertexade/fixture'],
  threadCount: 1,
  attention: null,
  archived: false,
  updatedAt: '2026-08-11T10:00:00Z',
  backendId: 'fixture',
  backendName: 'Fixture',
}
const pullRequestDetails: MobilePullRequestDetails = {
  title: pullRequest.title,
  body: 'Full PR description',
  url: pullRequest.url,
  author: { login: 'dom', name: 'Dominic' },
  createdAt: '2026-08-11T09:00:00Z',
  updatedAt: pullRequest.updatedAt,
  additions: 12,
  deletions: 3,
  changedFiles: 1,
  commits: [
    {
      oid: 'abc123',
      title: 'Complete overview',
      body: '',
      authoredAt: '2026-08-11T09:00:00Z',
      authors: [{ login: 'dom', name: 'Dominic' }],
    },
  ],
  conversation: [
    {
      id: 'comment-1',
      author: 'reviewer',
      body: 'Physical phone verified',
      createdAt: '2026-08-11T09:30:00Z',
      state: '',
    },
  ],
  checks: [{ name: 'mobile-check', status: 'SUCCESS', url: '' }],
  assignees: [{ login: 'dom', name: 'Dominic' }],
  milestone: 'Mobile parity',
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  reviewDecision: 'REVIEW_REQUIRED',
  headRef: 'mobile',
  baseRef: 'main',
  draft: false,
  labels: [{ name: 'mobile', color: '00ff00' }],
  unresolvedThreads: 0,
  files: [
    {
      path: 'apps/mobile/app/index.tsx',
      additions: 12,
      deletions: 3,
      status: 'modified',
      binary: false,
    },
  ],
  diff: '+full overview',
  providerName: 'GitHub',
}
const workDetails: MobileWorkItemDetails = {
  ...workItem,
  owner: 'dom',
  createdAt: '2026-08-11T09:00:00Z',
  resources: [
    {
      id: 1,
      kind: 'pull_request',
      label: 'PR #299',
      url: pullRequest.url,
      state: 'open',
      role: 'delivery',
      primary: true,
    },
  ],
  threads: [thread],
  events: [
    {
      id: 1,
      type: 'thread_started',
      summary: 'Thread started',
      actor: 'dom',
      createdAt: '2026-08-11T09:20:00Z',
    },
  ],
  relations: [],
  contextTransfers: [],
}
const threadDetails: MobileThreadDetails = {
  ...thread,
  threadId: 'provider-thread-7',
  threadUrl: 'https://example.test/thread/7',
  agentId: 'codex',
  canSteer: true,
  kind: 'task',
  kindLabel: 'Task',
  model: 'gpt-5.6',
  reasoningEffort: 'high',
  worktreePath: '/tmp/vertexade-mobile',
  createdAt: '2026-08-11T09:00:00Z',
  finishedAt: '',
  sourceJobId: null,
  ephemeral: false,
  reviewPhase: '',
  prompt: 'Implement the full view.',
  resultText: '',
  reviewDetails: '',
  reviewSummary: '',
  content: 'Raw agent log',
  events: [
    {
      id: 'event-1',
      kind: 'assistant',
      title: 'Implementing',
      text: 'Building full thread details',
      time: '2026-08-11T10:00:00Z',
      status: 'running',
      event: '',
    },
  ],
  queuedFollowUps: [],
  inputQuestions: [],
  files: [
    {
      path: 'apps/mobile/src/thread.tsx',
      additions: 8,
      deletions: 2,
      status: 'modified',
      binary: false,
    },
  ],
  additions: 8,
  deletions: 2,
  diff: '+thread details',
  diffError: '',
  suggestions: [],
}

describe('mobile full detail views', () => {
  beforeEach(() => {
    jest.mocked(loadMobilePullRequestDetails).mockResolvedValue(pullRequestDetails)
    jest.mocked(loadMobileWorkItemDetails).mockResolvedValue(workDetails)
    jest.mocked(loadMobileThreadDetails).mockResolvedValue(threadDetails)
    jest.mocked(deliverMobileThreadMessage).mockResolvedValue(undefined)
    jest.mocked(steerMobileQueuedMessage).mockResolvedValue(undefined)
    jest.mocked(cancelMobileQueuedMessage).mockResolvedValue(undefined)
    jest.mocked(postMobileReviewSuggestions).mockResolvedValue(1)
  })

  test('shows PR overview, conversation, checks, commits, and changed files', async () => {
    render(
      <MobilePullRequestDetail
        serviceUrl="http://fixture:4173"
        pullRequest={pullRequest}
        onClose={jest.fn()}
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(await screen.findByText('Full PR description')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-conversation'))
    expect(screen.getByText('Physical phone verified')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-checks'))
    expect(screen.getByText('mobile-check')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-commits'))
    expect(screen.getByText('Complete overview')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-changes'))
    expect(screen.getByText('apps/mobile/app/index.tsx')).toBeOnTheScreen()
  })

  test('drills from complete Work details into its owning-server thread', async () => {
    const onOpenThread = jest.fn()
    render(
      <MobileWorkDetail
        serviceUrl="http://fixture:4173"
        item={workItem}
        onClose={jest.fn()}
        onChanged={jest.fn().mockResolvedValue(undefined)}
        onOpenThread={onOpenThread}
        onStartThread={jest.fn()}
      />,
    )

    expect(await screen.findByText('Match the important web UI information.')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-threads'))
    fireEvent.press(screen.getByTestId('detail-thread-fixture-7'))
    expect(onOpenThread).toHaveBeenCalledWith(thread)
    fireEvent.press(screen.getByTestId('detail-tab-activity'))
    expect(screen.getByText('Thread started')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-links'))
    expect(screen.getByText('PR #299')).toBeOnTheScreen()
  })

  test('shows thread activity and changes and queues a bounded follow-up', async () => {
    render(
      <MobileThreadDetail
        serviceUrl="http://fixture:4173"
        thread={thread}
        onClose={jest.fn()}
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(await screen.findByText('Building full thread details')).toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Thread message'), 'Continue with tests')
    fireEvent.press(screen.getByText('Queue next turn'))
    await waitFor(() =>
      expect(deliverMobileThreadMessage).toHaveBeenCalledWith('http://fixture:4173', thread, 'Continue with tests', 'queue', {
        agentId: 'codex',
        allowSubagents: false,
        model: 'gpt-5.6',
        reasoningEffort: 'high',
        serviceTier: '',
      }),
    )
    fireEvent.press(screen.getByTestId('detail-tab-changes'))
    expect(screen.getByText('apps/mobile/src/thread.tsx')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-context'))
    expect(screen.getByText('Implement the full view.')).toBeOnTheScreen()
  })

  test('steers or removes queued messages from the full activity flow', async () => {
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({
      ...threadDetails,
      queuedFollowUps: [{ id: 4, prompt: 'Prioritize the failing test', model: 'gpt-5.6', reasoningEffort: 'high', queuedAt: '2026-08-11T10:10:00Z' }],
    })
    render(
      <MobileThreadDetail
        serviceUrl="http://fixture:4173"
        thread={thread}
        onClose={jest.fn()}
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(await screen.findByText('Prioritize the failing test')).toBeOnTheScreen()
    fireEvent.press(screen.getByText('Use to steer now'))
    await waitFor(() => expect(steerMobileQueuedMessage).toHaveBeenCalledWith('http://fixture:4173', thread, 4))
    fireEvent.press(screen.getByText('Remove'))
    await waitFor(() => expect(cancelMobileQueuedMessage).toHaveBeenCalledWith('http://fixture:4173', thread, 4))
  })

  test('renders review summary, findings, and editable suggestions before posting', async () => {
    const review = {
      ...threadDetails,
      status: 'completed',
      kind: 'review',
      reviewSummary: 'The pull request is sound.',
      reviewDetails: 'One focused improvement remains.',
      resultText: 'Review complete.',
      suggestions: [{ id: 9, path: 'src/app.ts', line: 14, side: 'RIGHT' as const, description: 'Use the validated value', replacement: 'return value', selected: true, postedAt: '' }],
    }
    jest.mocked(loadMobileThreadDetails).mockResolvedValue(review)
    render(
      <MobileThreadDetail
        serviceUrl="http://fixture:4173"
        thread={thread}
        onClose={jest.fn()}
        onChanged={jest.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(await screen.findByText('The pull request is sound.')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-findings'))
    expect(screen.getByText('One focused improvement remains.')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-suggestions'))
    fireEvent.changeText(screen.getByLabelText('Review comment for src/app.ts:14'), 'Guard the validated value')
    fireEvent.press(screen.getByText('Post 1 as one review'))
    await waitFor(() => expect(postMobileReviewSuggestions).toHaveBeenCalledWith(
      'http://fixture:4173',
      thread,
      [expect.objectContaining({ id: 9, description: 'Guard the validated value', selected: true })],
    ))
  })
})
