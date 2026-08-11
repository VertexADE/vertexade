import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { createMobileWorkItem, startMobileThread, type MobileWorkspace } from '@/mobile-workspace-service'
import { MobileWorkspaceCreateModal } from './mobile-workspace-create-modal'

jest.mock('@/mobile-workspace-service', () => ({
  createMobileWorkItem: jest.fn(),
  startMobileThread: jest.fn(),
}))

const createWork = jest.mocked(createMobileWorkItem)
const startThread = jest.mocked(startMobileThread)
const backends = [{ id: 'local', label: 'Local', isDefault: true }, { id: 'team', label: 'Team', isDefault: false }]
const workspace: MobileWorkspace = {
  repositories: [{ id: 1, fullName: 'dovo/local', backendId: 'local', backendName: 'Local' }],
  pullRequests: [],
  workItems: [{
    id: 2,
    key: 'W-0002',
    title: 'Existing Work',
    description: 'Finish the existing outcome',
    kind: 'implementation',
    state: 'active',
    priority: 'normal',
    primaryRepositoryId: 1,
    repositoryNames: ['dovo/local'],
    threadCount: 0,
    attention: null,
    archived: false,
    updatedAt: '2026-08-11T12:00:00Z',
    backendId: 'local',
    backendName: 'Local',
  }],
  threads: [],
}

describe('MobileWorkspaceCreateModal', () => {
  beforeEach(() => {
    createWork.mockReset()
    startThread.mockReset()
  })

  test('creates Work and starts an agent configured to publish a draft PR', async () => {
    createWork.mockResolvedValue({ id: 3, key: 'W-0003', title: 'New delivery', backendId: 'local', backendName: 'Local' })
    startThread.mockResolvedValue()
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="pullRequest" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent.changeText(screen.getByLabelText('Outcome and pull request title'), 'New delivery')
    fireEvent.press(screen.getByTestId('create-repository-1'))
    fireEvent.changeText(screen.getByLabelText('Agent prompt'), 'Implement and verify it')
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(createWork).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      title: 'New delivery',
      description: 'Implement and verify it',
      repositoryId: 1,
    }))
    expect(startThread).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      workItemId: 3,
      repositoryId: 1,
      prompt: 'Implement and verify it',
      createPullRequest: true,
      agentOptions: {
        agentId: '',
        allowSubagents: false,
        model: '',
        reasoningEffort: '',
        serviceTier: '',
      },
    })
    expect(onCompleted).toHaveBeenCalledWith('W-0003 created. Its agent will publish the draft PR when the work is ready.')
  })

  test('starts a thread from existing Work without creating another item', async () => {
    startThread.mockResolvedValue()
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="thread" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} initialWorkItem={workspace.workItems[0]} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent(screen.getByLabelText('Publish a draft pull request'), 'valueChange', true)
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(startThread).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      workItemId: 2,
      repositoryId: 1,
      prompt: 'Finish the existing outcome',
      createPullRequest: true,
      agentOptions: {
        agentId: '',
        allowSubagents: false,
        model: '',
        reasoningEffort: '',
        serviceTier: '',
      },
    }))
    expect(createWork).not.toHaveBeenCalled()
    expect(onCompleted).toHaveBeenCalledWith('W-0002 agent thread started with draft PR delivery enabled.')
  })

  test('closes through completion with a recoverable notice when Work exists but its draft PR thread fails', async () => {
    createWork.mockResolvedValue({ id: 4, key: 'W-0004', title: 'Partial delivery', backendId: 'local', backendName: 'Local' })
    startThread.mockRejectedValue(new Error('Agent unavailable'))
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="pullRequest" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent.changeText(screen.getByLabelText('Outcome and pull request title'), 'Partial delivery')
    fireEvent.press(screen.getByTestId('create-repository-1'))
    fireEvent.changeText(screen.getByLabelText('Agent prompt'), 'Implement it')
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith('W-0004 was created, but its draft PR thread could not start: Agent unavailable. Retry from Work.'))
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen()
  })
})
