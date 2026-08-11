import { createPlatformClient } from '@vertexade/platform-client'
import {
  createMobileWorkItem,
  loadMobileWorkspace,
  startMobileThread,
} from './mobile-workspace-service'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

const createClient = jest.mocked(createPlatformClient)
const backends = [
  { id: 'local', label: 'Local', isDefault: true },
  { id: 'team', label: 'Team', isDefault: false },
]

function entry(value: Record<string, unknown>) {
  return { key: String(value.id), value, sourceUpdatedAt: null, position: 0 }
}

describe('mobile workspace service', () => {
  beforeEach(() => createClient.mockReset())

  test('parses and sorts the federated workspace with source attribution', async () => {
    createClient.mockReturnValue({ request: jest.fn().mockResolvedValue({
      instanceId: 'federated-fixture',
      version: 4,
      updates: {
        repositories: { mode: 'replace', entries: [entry({ id: 1, full_name: 'dovo/local', backend_id: 'local', backend_name: 'Local' })] },
        pullRequests: { mode: 'replace', entries: [entry({ id: 2, work_item_id: 8, repo_id: 1, number: 17, title: 'Ship mobile', full_name: 'dovo/local', author: 'dom', url: 'https://example.test/pr/17', base_ref: 'main', head_ref: 'mobile', draft: 1, checks_pending: 2, checks_failed: 0, review_decision: null, updated_at: '2026-08-11T10:00:00Z', backend_id: 'local', backend_name: 'Local' })] },
        workItems: { mode: 'replace', entries: [entry({ id: 3, key: 'team~W-0003', title: 'Create queue', description: 'Native queue', kind: 'implementation', state: 'active', priority: 'high', primary_repository_id: 1_000_000_001, repository_names: ['dovo/team'], threads: [{ id: 4 }], attention: null, archived_at: null, updated_at: '2026-08-11T11:00:00Z', backend_id: 'team', backend_name: 'Team' })] },
        agentThreads: { mode: 'replace', entries: [entry({ id: 4, work_item_id: 3, full_name: 'dovo/team', status: 'running', agent_id: 'codex', agent_name: 'Codex', task_title: 'Create queue', latest_activity: 'Implementing', activity_at: '2026-08-11T11:30:00Z', branch_name: 'feature/mobile', linked_pr_number: null, linked_pr_url: null, archived_at: null, backend_id: 'team', backend_name: 'Team' })] },
      },
    }) } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileWorkspace('http://fixture:4173', backends)).resolves.toEqual({
      repositories: [expect.objectContaining({ backendId: 'local', fullName: 'dovo/local' })],
      pullRequests: [expect.objectContaining({ number: 17, workItemId: 8, draft: true, checksPending: 2 })],
      workItems: [expect.objectContaining({ backendId: 'team', key: 'team~W-0003', threadCount: 1 })],
      threads: [expect.objectContaining({ backendId: 'team', status: 'running', agentName: 'Codex' })],
    })
  })

  test('fails closed when a collection entry claims an unknown server', async () => {
    createClient.mockReturnValue({ request: jest.fn().mockResolvedValue({
      updates: {
        repositories: { entries: [entry({ id: 1, full_name: 'unknown/repo', backend_id: 'unknown' })] },
        pullRequests: { entries: [] },
        workItems: { entries: [] },
        agentThreads: { entries: [] },
      },
    }) } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileWorkspace('http://fixture:4173', backends)).rejects.toThrow('unknown backend "unknown"')
  })

  test('creates Work on one server with bounded typed input', async () => {
    const request = jest.fn().mockResolvedValue({
      id: 9,
      key: 'team~W-0009',
      title: 'Ship mobile',
      backend_id: 'team',
      backend_name: 'Team',
    })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(createMobileWorkItem('http://fixture:4173', {
      backendId: 'team',
      title: '  Ship mobile  ',
      description: ' Native first ',
      repositoryId: 1_000_000_002,
    })).resolves.toMatchObject({ id: 9, key: 'team~W-0009', backendId: 'team' })
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://fixture:4173', headers: { 'x-vertexade-backend': 'team' } })
    expect(request).toHaveBeenCalledWith('/api/work-items', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'Ship mobile', description: 'Native first', kind: 'implementation', priority: 'normal', repository_ids: [1_000_000_002] }),
    }))
  })

  test('starts a backend-scoped Work thread with draft PR delivery', async () => {
    const request = jest.fn().mockResolvedValue({ status: 'started' })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await startMobileThread('http://fixture:4173', {
      backendId: 'team',
      workItemId: 1_000_000_009,
      repositoryId: 1_000_000_002,
      prompt: ' Implement it ',
      createPullRequest: true,
    })

    expect(request).toHaveBeenCalledWith('/api/work-items/1000000009/threads', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ repository_ids: [1_000_000_002], prompt: 'Implement it', create_pr: true }),
    }))
  })
})
