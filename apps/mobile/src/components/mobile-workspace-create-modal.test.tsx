import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { addMobileLocalFolder, addMobileRepository, browseMobileDirectories, createMobileWorkItem, loadMobileAgentResourceSelection, searchMobileRepositories, startMobileThread, type MobileWorkspace } from '@/mobile-workspace-service'
import { MobileWorkspaceCreateModal } from './mobile-workspace-create-modal'

jest.mock('@/mobile-workspace-service', () => ({
  createMobileWorkItem: jest.fn(),
  addMobileRepository: jest.fn(),
  addMobileLocalFolder: jest.fn(),
  browseMobileDirectories: jest.fn(),
  loadMobileAgentResourceSelection: jest.fn(),
  searchMobileRepositories: jest.fn(),
  startMobileThread: jest.fn(),
}))

const createWork = jest.mocked(createMobileWorkItem)
const startThread = jest.mocked(startMobileThread)
const searchRepositories = jest.mocked(searchMobileRepositories)
const addRepository = jest.mocked(addMobileRepository)
const addLocalFolder = jest.mocked(addMobileLocalFolder)
const browseDirectories = jest.mocked(browseMobileDirectories)
const loadAgentResources = jest.mocked(loadMobileAgentResourceSelection)
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
    addLocalFolder.mockReset()
    browseDirectories.mockReset().mockResolvedValue({ path: '/Users/dom', parent: '/Users', home: '/Users/dom', entries: [], hasMore: false })
    loadAgentResources.mockReset().mockResolvedValue({ skills: [], mcpServers: [] })
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
      repositoryIds: [1],
    }))
    expect(startThread).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      workItemId: 3,
      repositoryIds: [1],
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

    fireEvent.press(screen.getByText('More options'))
    await waitFor(() => expect(screen.getByText('No skills or MCP servers are configured on this server.')).toBeOnTheScreen())
    fireEvent(screen.getByLabelText('Publish a draft pull request'), 'valueChange', true)
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(startThread).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      workItemId: 2,
      repositoryIds: [1],
      prompt: 'Finish the existing outcome',
      createPullRequest: true,
      agentOptions: {
        agentId: '',
        allowSubagents: false,
        model: '',
        reasoningEffort: '',
        serviceTier: '',
      },
      resourceSelection: { skills: [], mcpServers: [] },
    }))
    expect(createWork).not.toHaveBeenCalled()
    expect(onCompleted).toHaveBeenCalledWith('W-0002 agent thread started with draft PR delivery enabled.')
  })

  test('shows and preserves General for existing repository-free Work', async () => {
    startThread.mockResolvedValue()
    const generalWork = {
      ...workspace.workItems[0],
      id: 8,
      key: 'W-0008',
      title: 'General operations',
      primaryRepositoryId: 999,
      repositoryNames: ['Workspace/General'],
    }
    render(<MobileWorkspaceCreateModal mode="thread" serviceUrl="http://fixture:4173" backends={backends} workspace={{ ...workspace, workItems: [...workspace.workItems, generalWork] }} initialWorkItem={generalWork} onClose={jest.fn()} onCompleted={jest.fn().mockResolvedValue(undefined)} />)

    expect(screen.getByTestId('create-repository-general')).toHaveProp('accessibilityState', { selected: true })
    expect(screen.getByText('Managed · isolated · no repository or Git required')).toBeOnTheScreen()
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(startThread).toHaveBeenCalledWith('http://fixture:4173', expect.objectContaining({
      workItemId: 8,
      prompt: 'Finish the existing outcome',
    })))
    expect(startThread.mock.calls[0]?.[1]).not.toHaveProperty('repositoryIds')
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

  test('starts newly created Work with selected agent skills and MCP servers', async () => {
    createWork.mockResolvedValue({ id: 7, key: 'W-0007', title: 'Configured work', backendId: 'local', backendName: 'Local' })
    startThread.mockResolvedValue()
    loadAgentResources.mockResolvedValue({
      skills: [{ id: 'skill-review', name: 'Review', enabled: true, defaultEnabled: true }],
      mcpServers: [{ id: 'mcp-github', name: 'GitHub', enabled: false, defaultEnabled: false, transport: 'stdio' }],
    })
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent.changeText(screen.getByLabelText('Work title'), 'Configured work')
    fireEvent.press(screen.getByText('More options'))
    fireEvent(screen.getByLabelText('Start agent now'), 'valueChange', true)
    await waitFor(() => expect(screen.getByText('GitHub')).toBeOnTheScreen())
    fireEvent.press(screen.getByText('GitHub'))
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(createWork).toHaveBeenCalledWith('http://fixture:4173', expect.objectContaining({
      resourceSelection: { skills: ['skill-review'], mcpServers: ['mcp-github'] },
    })))
    expect(startThread).toHaveBeenCalledWith('http://fixture:4173', expect.objectContaining({
      workItemId: 7,
      prompt: 'Configured work',
      createPullRequest: false,
      resourceSelection: { skills: ['skill-review'], mcpServers: ['mcp-github'] },
    }))
    expect(onCompleted).toHaveBeenCalledWith('W-0007 created and its agent started.')
  })

  test('creates one Work item spanning multiple project sources', async () => {
    createWork.mockResolvedValue({ id: 6, key: 'W-0006', title: 'Shared delivery', backendId: 'local', backendName: 'Local' })
    const onCompleted = jest.fn().mockResolvedValue(undefined)
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={onCompleted} />)

    fireEvent.press(screen.getByTestId('create-mode-guided'))
    fireEvent.changeText(screen.getByLabelText('Work title'), 'Shared delivery')
    fireEvent.press(screen.getByTestId('create-continue'))
    fireEvent.press(screen.getByTestId('create-repository-1'))
    fireEvent.press(screen.getByTestId('create-repository-4'))
    fireEvent.press(screen.getByTestId('create-continue'))
    fireEvent.press(screen.getByTestId('create-submit'))

    await waitFor(() => expect(createWork).toHaveBeenCalledWith('http://fixture:4173', {
      backendId: 'local',
      title: 'Shared delivery',
      description: '',
      repositoryIds: [1, 4],
    }))
    expect(screen.getByText('2 projects')).toBeOnTheScreen()
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

  test('browses, adds, and selects a direct local folder without leaving the modal', async () => {
    browseDirectories.mockResolvedValueOnce({
      path: '/Users/dom/Projects', parent: '/Users/dom', home: '/Users/dom',
      entries: [{ name: 'client', path: '/Users/dom/Projects/client' }], hasMore: false,
    }).mockResolvedValueOnce({
      path: '/Users/dom/Projects/client', parent: '/Users/dom/Projects', home: '/Users/dom', entries: [], hasMore: false,
    })
    addLocalFolder.mockResolvedValue({
      id: 18, fullName: 'Client files', sourceKind: 'directory', workspaceStrategy: 'direct', backendId: 'local', backendName: 'Local',
    })
    render(<MobileWorkspaceCreateModal mode="work" serviceUrl="http://fixture:4173" backends={backends} workspace={workspace} onClose={jest.fn()} onCompleted={jest.fn()} />)

    fireEvent.press(screen.getByTestId('create-local-folder-open'))
    await waitFor(() => expect(screen.getByText('client')).toBeOnTheScreen())
    fireEvent.press(screen.getByTestId('create-local-folder-entry-client'))
    await waitFor(() => expect(screen.getByTestId('create-local-folder-path')).toHaveProp('value', '/Users/dom/Projects/client'))
    fireEvent.changeText(screen.getByTestId('create-local-folder-name'), 'Client files')
    fireEvent.press(screen.getByTestId('create-local-folder-add'))

    await waitFor(() => expect(addLocalFolder).toHaveBeenCalledWith('http://fixture:4173', backends[0], {
      localPath: '/Users/dom/Projects/client', name: 'Client files', workspaceStrategy: 'direct',
    }))
    expect(screen.getByTestId('create-repository-18')).toHaveProp('accessibilityState', { selected: true })
  })
})
