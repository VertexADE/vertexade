import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { addMobileRepository, createMobileWorkItem, searchMobileRepositories, startMobileThread, type MobileWorkspace } from '@/mobile-workspace-service'
import { MobileWorkspaceCreateModal } from './mobile-workspace-create-modal'

jest.mock('@/mobile-workspace-service', () => ({
  createMobileWorkItem: jest.fn(),
  addMobileRepository: jest.fn(),
  searchMobileRepositories: jest.fn(),
  startMobileThread: jest.fn(),
}))

const createWork = jest.mocked(createMobileWorkItem)
const startThread = jest.mocked(startMobileThread)
const searchRepositories = jest.mocked(searchMobileRepositories)
const addRepository = jest.mocked(addMobileRepository)
const backends = [{ id: 'local', label: 'Local', isDefault: true }, { id: 'team', label: 'Team', isDefault: false }]
const workspace: MobileWorkspace = {
  repositories: [{
    id: 1,
    fullName: 'dovo/local',
    sourceKind: 'git',
    workspaceStrategy: 'worktree',
    backendId: 'local',
    backendName: 'Local',
  }, {
    id: 4,
    fullName: 'Local notes',
    sourceKind: 'directory',
    workspaceStrategy: 'copy',
    backendId: 'local',
    backendName: 'Local',
  }],
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
    searchRepositories.mockReset().mockResolvedValue({ repositories: [], source: 'authenticated' })
    addRepository.mockReset()
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

  test('routes creation through the chosen direct server when backend IDs overlap', async () => {
    createWork.mockResolvedValue({ id: 1, key: 'W-0001', title: 'Second server work', backendId: 'local', backendName: 'Two', serviceUrl: 'http://two:4173' })
    const directBackends = [
      { id: 'local', label: 'One', isDefault: true, serviceUrl: 'http://one:4173' },
      { id: 'local', label: 'Two', isDefault: true, serviceUrl: 'http://two:4173' },
    ]
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://one:4173" backends={directBackends} workspace={{ repositories: [], pullRequests: [], workItems: [], threads: [] }} onClose={jest.fn()} onCompleted={jest.fn().mockResolvedValue(undefined)} />)

    fireEvent.press(screen.getByTestId('create-server-http://two:4173::local'))
    fireEvent.changeText(screen.getByLabelText('Work title'), 'Second server work')
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(createWork).toHaveBeenCalledWith('http://two:4173', expect.objectContaining({ backendId: 'local', title: 'Second server work' })))
  })

  test('creates repository-free Work in an explicit general workspace', async () => {
    createWork.mockResolvedValue({ id: 5, key: 'W-0005', title: 'Plan launch', backendId: 'local', backendName: 'Local' })
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent.changeText(screen.getByLabelText('Work title'), 'Plan launch')
    fireEvent.press(screen.getByTestId('create-repository-general'))
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(createWork).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      title: 'Plan launch',
      description: '',
    }))
    expect(screen.getByText('Managed · isolated · no repository or Git required')).toBeOnTheScreen()
  })

  test('searches, adds, and selects an authenticated repository without leaving the modal', async () => {
    searchRepositories.mockResolvedValue({
      source: 'authenticated',
      repositories: [{ id: 'acme/private-app', name: 'acme/private-app', description: '', private: true, ownerType: 'organization', source: 'authenticated' }],
    })
    addRepository.mockResolvedValue({
      id: 12,
      fullName: 'acme/private-app',
      sourceKind: 'git',
      workspaceStrategy: 'worktree',
      backendId: 'local',
      backendName: 'Local',
    })
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={jest.fn()} />)

    fireEvent.changeText(screen.getByTestId('create-repository-search'), 'private')
    await waitFor(() => expect(screen.getByText('acme/private-app')).toBeOnTheScreen())
    fireEvent.press(screen.getByText('acme/private-app'))

    await waitFor(() => expect(addRepository).toHaveBeenCalledWith('http://fixture:4173', backends[0], 'acme/private-app'))
    expect(screen.getByTestId('create-repository-12')).toHaveProp('accessibilityState', { selected: true })
  })
})
