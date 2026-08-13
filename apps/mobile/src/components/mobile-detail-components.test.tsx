import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import * as Clipboard from 'expo-clipboard'
import {
  cancelMobileQueuedMessage,
  deliverMobileThreadMessage,
  loadMobilePullRequestDetails,
  loadMobileThreadDetails,
  loadMobileWorkItemDetails,
  postMobileReviewSuggestions,
  reorderMobileQueuedMessages,
  steerMobileQueuedMessage,
  uploadMobilePromptImages,
  type MobilePullRequestDetails,
  type MobileThreadDetails,
  type MobileWorkItemDetails,
} from '@/mobile-detail-service'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from '@/mobile-workspace-service'
import { MobilePullRequestDetail } from './mobile-pull-request-detail'
import { MobileThreadDetail } from './mobile-thread-detail'
import { MobileWorkDetail } from './mobile-work-detail'

jest.mock('@/mobile-detail-service', () => ({
  appendMobilePromptImages: (prompt: string, images: Array<{ name: string; url: string }>) =>
    [prompt.trim(), images.length ? `Attached reference images:\n${images.map((image) => `![${image.name}](${image.url})`).join('\n')}` : '']
      .filter(Boolean)
      .join('\n\n'),
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
  reorderMobileQueuedMessages: jest.fn(),
  retryMobileThread: jest.fn(),
  saveMobileThreadTasks: jest.fn(),
  steerMobileQueuedMessage: jest.fn(),
  submitMobileThreadInput: jest.fn(),
  transferMobileThreadContext: jest.fn(),
  uploadMobilePromptImages: jest.fn(),
  updateMobileWorkState: jest.fn(),
}))

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }))
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }))
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string
    name = 'pasted.png'
    type = 'image/png'
    size = 3
    constructor(uri: string) {
      this.uri = uri
    }
    base64() {
      return Promise.resolve('pasted-base64')
    }
  },
}))
jest.mock('@fluidinference/react-native-fluidaudio', () => ({
  ASRManager: class {
    async initialize() {
      return { success: true, compilationDuration: 0 }
    }
  },
  onModelLoadProgress: (callback: (event: unknown) => void) => {
    callback({ type: 'asr', status: 'compiling', progress: 50 })
    return { remove: jest.fn() }
  },
  StreamingASRManager: class {
    active = false
    async start(_config: unknown, onUpdate: (update: unknown) => void) {
      this.active = true
      onUpdate({ confirmed: 'Voice', volatile: 'draft', isFinal: false })
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    isStreaming() {
      return this.active
    }
    async stop() {
      this.active = false
      return { success: true, text: 'Voice draft complete' }
    }
  },
}))

jest.mock('./mobile-markdown', () => {
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    MobileMarkdown: ({ content, emptyText }: { content: string; emptyText: string }) => <ReactNative.Text>{content || emptyText}</ReactNative.Text>,
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
    jest.clearAllMocks()
    jest.mocked(loadMobilePullRequestDetails).mockResolvedValue(pullRequestDetails)
    jest.mocked(loadMobileWorkItemDetails).mockResolvedValue(workDetails)
    jest.mocked(loadMobileThreadDetails).mockResolvedValue(threadDetails)
    jest.mocked(deliverMobileThreadMessage).mockResolvedValue(undefined)
    jest.mocked(steerMobileQueuedMessage).mockResolvedValue(undefined)
    jest.mocked(cancelMobileQueuedMessage).mockResolvedValue(undefined)
    jest.mocked(postMobileReviewSuggestions).mockResolvedValue(1)
    jest.mocked(uploadMobilePromptImages).mockResolvedValue([])
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
    expect(screen.getByTestId('workspace-detail-native-modal').props).toMatchObject({
      allowSwipeDismissal: true,
      presentationStyle: 'pageSheet',
    })
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
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({
      ...threadDetails,
      events: [
        ...threadDetails.events,
        { id: 'event-2', kind: 'userMessage', title: 'User message', text: '', time: '2026-08-11T10:01:00Z', status: '', event: 'user_message' },
        {
          id: 'event-3',
          kind: 'system',
          title: 'Turn completed',
          text: 'Turn completed',
          time: '2026-08-11T10:02:00Z',
          status: 'completed',
          event: 'turn_completed',
        },
        { id: 'event-4', kind: 'system', title: 'Steer accepted', text: 'Steer accepted', time: '2026-08-11T10:03:00Z', status: '', event: 'steer_accepted' },
        {
          id: 'event-5',
          kind: 'action',
          title: 'Read mobile source',
          text: 'Verbose tool output that should stay collapsed',
          time: '2026-08-11T10:04:00Z',
          status: 'completed',
          event: 'tool_call_completed',
        },
      ],
    })
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    await screen.findByTestId('thread-markdown-transcript')
    expect(screen.getByText('Worked for 1h')).toBeOnTheScreen()
    expect(screen.getByText(/Building full thread details/)).toBeOnTheScreen()
    expect(screen.queryByText(/\*\*You\*\*/)).not.toBeOnTheScreen()
    expect(screen.queryByText(/### Codex/)).not.toBeOnTheScreen()
    expect(screen.getAllByText(/Implement the full view\./).length).toBeGreaterThan(0)
    expect(screen.queryByText(/No message content/)).not.toBeOnTheScreen()
    expect(screen.queryByText(/Turn completed/)).not.toBeOnTheScreen()
    expect(screen.queryByText(/Steer accepted/)).not.toBeOnTheScreen()
    expect(screen.getByText('Read mobile source')).toBeOnTheScreen()
    expect(screen.queryByText(/Verbose tool output/)).not.toBeOnTheScreen()
    fireEvent.changeText(screen.getByLabelText('Thread message'), 'Continue with tests')
    fireEvent.press(screen.getByLabelText('Queue next turn'))
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

  test('groups a completed follow-up from its trigger through the final response', async () => {
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({
      ...threadDetails,
      status: 'completed',
      events: [
        ...threadDetails.events,
        { id: 'event-2', kind: 'system', title: 'Turn completed', text: '', time: '2026-08-11T10:01:00Z', status: 'completed', event: 'turn_completed' },
        {
          id: 'event-3',
          kind: 'user_message',
          title: 'You continued the thread',
          text: 'Make the spacing native',
          time: '2026-08-11T10:02:00Z',
          status: 'completed',
          event: 'follow_up_started',
        },
        {
          id: 'event-4',
          kind: 'action',
          title: 'Inspect composer',
          text: 'Read the composer styles',
          time: '2026-08-11T10:03:00Z',
          status: 'completed',
          event: 'tool_call_completed',
        },
        {
          id: 'event-5',
          kind: 'changes',
          title: 'Files changed',
          text: 'Updated the native composer layout',
          time: '2026-08-11T10:03:30Z',
          status: 'completed',
          event: 'diff_updated',
          files: [{ path: 'apps/mobile/src/components/mobile-thread-composer.tsx', additions: 12, deletions: 3, status: 'modified', binary: false }],
          additions: 12,
          deletions: 3,
        },
        {
          id: 'event-6',
          kind: 'message',
          title: 'Codex',
          text: 'The composer now uses native spacing.',
          time: '2026-08-11T10:04:00Z',
          status: 'completed',
          event: 'agent_message',
        },
        { id: 'event-7', kind: 'system', title: 'Turn completed', text: '', time: '2026-08-11T10:05:00Z', status: 'completed', event: 'turn_completed' },
      ],
    })

    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    await screen.findByText(/Make the spacing native/)
    const userMessage = screen.getAllByTestId('thread-user-message').at(-1)
    expect(userMessage).toHaveStyle({ alignItems: 'flex-end' })
    expect(screen.getAllByTestId('thread-user-bubble').at(-1)).toHaveStyle({ backgroundColor: '#0a84ff' })
    expect(screen.queryByText(/You continued the thread/)).not.toBeOnTheScreen()
    expect(screen.queryByText(/### Codex/)).not.toBeOnTheScreen()
    expect(screen.getByText('Worked for 2m')).toBeOnTheScreen()
    expect(screen.getByText(/The composer now uses native spacing/)).toBeOnTheScreen()
    expect(screen.queryByText('Inspect composer')).not.toBeOnTheScreen()
    expect(screen.getByText('1 changed file')).toBeOnTheScreen()
    fireEvent.press(screen.getByText('1 changed file'))
    expect(screen.getByText('apps/mobile/src/components/mobile-thread-composer.tsx')).toBeOnTheScreen()
    fireEvent.press(screen.getByText('Worked for 2m'))
    expect(screen.getByText(/The composer now uses native spacing/)).toBeOnTheScreen()
    expect(screen.getByText('Inspect composer')).toBeOnTheScreen()
  })

  test('loads a larger transcript window and fetches earlier messages when scrolling up', async () => {
    const events = Array.from({ length: 35 }, (_, index) => {
      const session = index + 1
      return [
        {
          id: `trigger-${session}`,
          kind: 'user_message',
          title: 'You continued the thread',
          text: `Session ${session} request`,
          time: `2026-08-11T10:${String(index).padStart(2, '0')}:00Z`,
          status: 'completed',
          event: 'follow_up_started',
        },
        {
          id: `final-${session}`,
          kind: 'message',
          title: 'Codex',
          text: `Session ${session} complete`,
          time: `2026-08-11T10:${String(index).padStart(2, '0')}:30Z`,
          status: 'completed',
          event: 'agent_message',
        },
        {
          id: `complete-${session}`,
          kind: 'system',
          title: 'Turn completed',
          text: '',
          time: `2026-08-11T10:${String(index).padStart(2, '0')}:40Z`,
          status: 'completed',
          event: 'turn_completed',
        },
      ]
    }).flat()
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({ ...threadDetails, status: 'completed', events })

    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    await screen.findByText(/Session 35 complete/)
    expect(screen.queryByText(/Session 1 request/)).not.toBeOnTheScreen()
    const scroll = screen.getByTestId('detail-scroll-view')
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 500 } } })
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 80 } } })
    expect(await screen.findByText(/Session 1 request/)).toBeOnTheScreen()
  })

  test('steers or removes queued messages from the full activity flow', async () => {
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({
      ...threadDetails,
      queuedFollowUps: [{ id: 4, prompt: 'Prioritize the failing test', model: 'gpt-5.6', reasoningEffort: 'high', queuedAt: '2026-08-11T10:10:00Z' }],
    })
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    expect(await screen.findByText('Prioritize the failing test')).toBeOnTheScreen()
    fireEvent.press(screen.getByText('Use to steer now'))
    await waitFor(() => expect(steerMobileQueuedMessage).toHaveBeenCalledWith('http://fixture:4173', thread, 4))
    fireEvent.press(screen.getByText('Remove'))
    await waitFor(() => expect(cancelMobileQueuedMessage).toHaveBeenCalledWith('http://fixture:4173', thread, 4))
  })

  test('copies messages and persists queued message ordering', async () => {
    jest.mocked(loadMobileThreadDetails).mockResolvedValue({
      ...threadDetails,
      queuedFollowUps: [
        { id: 4, prompt: 'First queued', model: '', reasoningEffort: '', queuedAt: '2026-08-11T10:10:00Z' },
        { id: 5, prompt: 'Second queued', model: '', reasoningEffort: '', queuedAt: '2026-08-11T10:11:00Z' },
      ],
    })
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    fireEvent.press(await screen.findByLabelText('Copy your message'))
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(threadDetails.prompt))
    fireEvent.press(screen.getAllByLabelText('Move queued message down')[0])
    await waitFor(() => expect(reorderMobileQueuedMessages).toHaveBeenCalledWith('http://fixture:4173', thread, [5, 4]))
  })

  test('uploads a selected image and sends its durable prompt reference', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          assetId: null,
          base64: 'abc',
          duration: null,
          exif: null,
          fileName: 'screen.png',
          fileSize: 3,
          height: 10,
          mimeType: 'image/png',
          pairedVideoAsset: null,
          type: 'image',
          uri: 'file:///screen.png',
          width: 10,
        },
      ],
    })
    jest.mocked(uploadMobilePromptImages).mockResolvedValue([{ name: 'screen.png', url: '/api/prompt-images/screen.png' }])
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    await screen.findByLabelText('Attach images')
    fireEvent.press(screen.getByLabelText('Attach images'))
    await screen.findByLabelText('Remove screen.png')
    await waitFor(() => expect(screen.getByLabelText('Queue next turn').props.accessibilityState.disabled).toBe(false))
    fireEvent.press(screen.getByLabelText('Queue next turn'))

    await waitFor(() =>
      expect(deliverMobileThreadMessage).toHaveBeenCalledWith(
        'http://fixture:4173',
        thread,
        'Attached reference images:\n![screen.png](/api/prompt-images/screen.png)',
        'queue',
        expect.any(Object),
      ),
    )
  })

  test('adds pasted or dropped images through the attachment pipeline', async () => {
    jest.mocked(uploadMobilePromptImages).mockResolvedValue([{ name: 'pasted.png', url: '/api/prompt-images/pasted.png' }])
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    fireEvent(await screen.findByTestId('thread-paste-target'), 'paste', { nativeEvent: { type: 'images', uris: ['file:///pasted.png'] } })

    await waitFor(() =>
      expect(uploadMobilePromptImages).toHaveBeenCalledWith('http://fixture:4173', 'fixture', [
        { filename: 'pasted.png', mediaType: 'image/png', url: 'data:image/png;base64,pasted-base64' },
      ]),
    )
    expect(await screen.findByLabelText('Remove pasted.png')).toBeOnTheScreen()
  })

  test('transcribes voice into the composer draft with FluidAudio', async () => {
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    fireEvent.press(await screen.findByLabelText('Start voice input'))
    expect(await screen.findByText('Preparing bundled voice model')).toBeOnTheScreen()
    expect(screen.getByText('50%')).toBeOnTheScreen()
    expect(await screen.findByText('Voice draft')).toBeOnTheScreen()
    fireEvent.press(await screen.findByLabelText('Stop voice input'))

    await waitFor(() => expect(screen.getByLabelText('Thread message').props.value).toBe('Voice draft complete'))
  })

  test('cleans up text from the composer controls', async () => {
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    fireEvent.changeText(await screen.findByLabelText('Thread message'), 'Um, please please update src/app.ts.')
    fireEvent.press(screen.getByLabelText('Clean up message'))

    await waitFor(() => expect(screen.getByLabelText('Thread message').props.value).toBe('please update src/app.ts.'))
  })

  test('shows composer tools and the active execution configuration below the input', async () => {
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    expect(await screen.findByTestId('thread-composer-controls')).toBeOnTheScreen()
    expect(screen.getByLabelText('Attach images')).toBeOnTheScreen()
    expect(screen.getByLabelText('Start voice input')).toBeOnTheScreen()
    expect(screen.getByLabelText('Clean up message')).toBeOnTheScreen()
    expect(screen.getByLabelText('Execution settings')).toBeOnTheScreen()
    expect(screen.getByLabelText('Machine Fixture')).toBeOnTheScreen()
    expect(screen.getByText('gpt-5.6')).toBeOnTheScreen()
    expect(screen.getByText('high · codex · Subagents off')).toBeOnTheScreen()
  })

  test('renders review summary, findings, and editable suggestions before posting', async () => {
    const review = {
      ...threadDetails,
      status: 'completed',
      kind: 'review',
      reviewSummary: 'The pull request is sound.',
      reviewDetails: 'One focused improvement remains.',
      resultText: 'Review complete.',
      suggestions: [
        {
          id: 9,
          path: 'src/app.ts',
          line: 14,
          side: 'RIGHT' as const,
          description: 'Use the validated value',
          replacement: 'return value',
          selected: true,
          postedAt: '',
        },
      ],
    }
    jest.mocked(loadMobileThreadDetails).mockResolvedValue(review)
    render(<MobileThreadDetail serviceUrl="http://fixture:4173" thread={thread} onClose={jest.fn()} onChanged={jest.fn().mockResolvedValue(undefined)} />)

    await screen.findByTestId('thread-markdown-transcript')
    fireEvent.press(screen.getByTestId('detail-tab-summary'))
    expect(screen.getByText('The pull request is sound.')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-findings'))
    expect(screen.getByText('One focused improvement remains.')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('detail-tab-suggestions'))
    fireEvent.changeText(screen.getByLabelText('Review comment for src/app.ts:14'), 'Guard the validated value')
    fireEvent.press(screen.getByText('Post 1 as one review'))
    await waitFor(() =>
      expect(postMobileReviewSuggestions).toHaveBeenCalledWith('http://fixture:4173', thread, [
        expect.objectContaining({ id: 9, description: 'Guard the validated value', selected: true }),
      ]),
    )
  })
})
