import { createPlatformClient } from '@vertexade/platform-client'
import {
  deliverMobileThreadMessage,
  ensureMobilePullRequestWork,
  loadMobilePullRequestDetails,
  loadMobileThreadDetails,
  loadMobileWorkItemDetails,
  submitMobileThreadInput,
  updateMobileWorkState,
} from './mobile-detail-service'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from './mobile-workspace-service'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

const createClient = jest.mocked(createPlatformClient)
const pullRequest: MobilePullRequest = {
  id: 299,
  workItemId: null,
  repoId: 1,
  number: 299,
  title: 'Improve release quality',
  fullName: 'vertexade/fixture',
  author: 'dom',
  url: 'https://example.test/pr/299',
  baseRef: 'main',
  headRef: 'release-quality',
  draft: false,
  checksPending: 0,
  checksFailed: 0,
  reviewDecision: 'REVIEW_REQUIRED',
  updatedAt: '2026-08-11T10:00:00Z',
  backendId: 'team',
  backendName: 'Team',
}
const workItem: MobileWorkItem = {
  id: 1,
  key: 'W-0001',
  title: 'Complete mobile',
  description: 'Match the web overview.',
  kind: 'implementation',
  state: 'active',
  priority: 'high',
  primaryRepositoryId: 1,
  repositoryNames: ['vertexade/fixture'],
  threadCount: 1,
  attention: null,
  archived: false,
  updatedAt: '2026-08-11T10:00:00Z',
  backendId: 'team',
  backendName: 'Team',
}
const thread: MobileThread = {
  id: 7,
  workItemId: 1,
  fullName: 'vertexade/fixture',
  status: 'running',
  agentName: 'Codex',
  taskTitle: 'Complete mobile',
  latestActivity: 'Working',
  activityAt: '2026-08-11T10:00:00Z',
  branchName: 'feature/mobile',
  pullRequestNumber: null,
  pullRequestUrl: '',
  archived: false,
  backendId: 'team',
  backendName: 'Team',
}

describe('mobile detail service', () => {
  beforeEach(() => createClient.mockReset())

  test('loads a bounded full pull request overview', async () => {
    const request = jest.fn().mockResolvedValue({
      title: 'Improve release quality',
      body: 'Full description',
      url: 'https://example.test/pr/299',
      author: { login: 'dom', name: 'Dominic' },
      additions: 10,
      deletions: 2,
      changedFiles: 1,
      commits: [{ oid: 'abc123', messageHeadline: 'Ship it', authoredDate: '2026-08-11T09:00:00Z', authors: [{ login: 'dom' }] }],
      comments: [{ id: 'c1', author: { login: 'reviewer' }, body: 'Looks close', createdAt: '2026-08-11T09:10:00Z' }],
      reviews: [{ id: 'r1', author: { login: 'reviewer' }, body: 'Approved', state: 'APPROVED', createdAt: '2026-08-11T09:20:00Z' }],
      statusCheckRollup: [{ name: 'mobile', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/check' }],
      assignees: [{ login: 'dom' }],
      labels: [{ name: 'mobile', color: '00ff00' }],
      reviewThreads: [{ isResolved: false, comments: [] }],
      diff_summary: { files: [{ path: 'apps/mobile/app/index.tsx', additions: 10, deletions: 2, status: 'modified' }] },
      diff: 'diff body',
      scm_provider_name: 'GitHub',
    })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobilePullRequestDetails('http://fixture:4173', pullRequest)).resolves.toMatchObject({
      title: 'Improve release quality',
      author: { login: 'dom', name: 'Dominic' },
      conversation: [{ author: 'reviewer', body: 'Looks close' }, { author: 'reviewer', state: 'APPROVED' }],
      checks: [{ name: 'mobile', status: 'SUCCESS' }],
      unresolvedThreads: 1,
      files: [{ path: 'apps/mobile/app/index.tsx' }],
    })
    expect(createClient).toHaveBeenCalledWith({ baseUrl: 'http://fixture:4173', headers: { 'x-vertexade-backend': 'team' } })
    expect(request).toHaveBeenCalledWith('/api/pulls/1/299/details', { maxJsonResponseBytes: 32 * 1024 * 1024 })
  })

  test('loads complete Work history and attributes nested threads to their server', async () => {
    const request = jest.fn().mockResolvedValue({
      key: 'W-0001',
      title: 'Complete mobile',
      description: 'Full Work outcome',
      state: 'review',
      priority: 'urgent',
      repository_names: ['vertexade/fixture'],
      owner: 'dom',
      created_at: '2026-08-11T09:00:00Z',
      updated_at: '2026-08-11T10:00:00Z',
      resources: [{ id: 3, kind: 'pull_request', label: 'PR #299', role: 'delivery', is_primary: 1 }],
      threads: [{ id: 7, full_name: 'vertexade/fixture', status: 'running', agent_name: 'Codex', task_title: 'Complete mobile' }],
      events: [{ id: 4, event_type: 'thread_started', summary: 'Thread started', actor: 'dom', created_at: '2026-08-11T09:30:00Z' }],
      relations: [{ key: 'W-0002', title: 'Release', state: 'backlog', relation: 'blocks' }],
      context_transfers: [{ id: 5, status: 'completed', instruction: 'Carry context', created_at: '2026-08-11T09:40:00Z' }],
    })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileWorkItemDetails('http://fixture:4173', workItem)).resolves.toMatchObject({
      state: 'review',
      priority: 'urgent',
      owner: 'dom',
      threads: [{ id: 7, backendId: 'team', workItemId: 1 }],
      resources: [{ id: 3, primary: true }],
      events: [{ type: 'thread_started' }],
      relations: [{ key: 'W-0002' }],
      contextTransfers: [{ id: 5 }],
    })
  })

  test('keeps thread activity usable when the optional diff fails', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        status: 'running',
        thread_id: 'provider-thread-7',
        can_steer: true,
        events: [{ id: 'event-1', kind: 'assistant', title: 'Working', text: 'Implementing details' }],
        queued_follow_ups: [{ id: 2, prompt: 'Add tests', queued_at: '2026-08-11T10:00:00Z' }],
        input_questions: JSON.stringify([{ id: 'scope', header: 'Scope', question: 'Which scope?', options: [{ label: 'Full', description: 'Everything' }] }]),
        diff_summary: { additions: 2, deletions: 1, files: [{ path: 'fallback.ts', additions: 2, deletions: 1 }] },
      })
      .mockRejectedValueOnce(new Error('Diff is not available'))
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileThreadDetails('http://fixture:4173', thread)).resolves.toMatchObject({
      threadId: 'provider-thread-7',
      canSteer: true,
      events: [{ title: 'Working', text: 'Implementing details' }],
      queuedFollowUps: [{ prompt: 'Add tests' }],
      inputQuestions: [{ id: 'scope', options: [{ label: 'Full' }] }],
      files: [{ path: 'fallback.ts' }],
      diffError: 'Diff is not available',
    })
  })

  test('sends server-scoped action payloads and rejects empty user input', async () => {
    const request = jest.fn().mockResolvedValue({ id: 1, key: 'W-0001' })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(ensureMobilePullRequestWork('http://fixture:4173', pullRequest)).resolves.toEqual({ id: 1, key: 'W-0001' })
    await updateMobileWorkState('http://fixture:4173', workItem, 'review')
    await deliverMobileThreadMessage('http://fixture:4173', thread, '  Continue  ', 'queue')
    await submitMobileThreadInput('http://fixture:4173', thread, { scope: ' Full ' })
    await expect(submitMobileThreadInput('http://fixture:4173', thread, {})).rejects.toThrow('Answer every question')

    expect(request.mock.calls).toEqual(expect.arrayContaining([
      ['/api/pulls/1/299/work', expect.objectContaining({ method: 'POST', body: '{}' })],
      ['/api/work-items/1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ state: 'review', reason: 'Moved from VertexADE mobile Work details' }) })],
      ['/api/agent-threads/7/queue', expect.objectContaining({ body: JSON.stringify({ prompt: 'Continue' }) })],
      ['/api/agent-threads/7/input', expect.objectContaining({ body: JSON.stringify({ answers: { scope: { answers: ['Full'] } } }) })],
    ]))
  })
})
