import { createPlatformClient } from '@vertexade/platform-client'
import {
  cancelMobileQueuedMessage,
  appendMobilePromptImages,
  deliverMobileThreadMessage,
  ensureMobilePullRequestWork,
  forkMobileThread,
  loadMobileThreadTransferTargets,
  loadMobilePullRequestDetails,
  loadMobileThreadDetails,
  loadMobileWorkItemDetails,
  postMobileReviewSuggestions,
  reReviewMobileThread,
  reorderMobileQueuedMessages,
  saveMobileThreadTasks,
  steerMobileQueuedMessage,
  submitMobileThreadInput,
  transferMobileThreadContext,
  uploadMobilePromptImages,
  updateMobileWorkState,
} from './mobile-detail-service'
import type { MobilePullRequest, MobileThread, MobileWorkItem } from './mobile-workspace-service'

jest.mock('@vertexade/platform-client', () => ({ createPlatformClient: jest.fn() }))

test('uploads mobile prompt images through the selected backend and embeds them', async () => {
  const request = jest.fn().mockResolvedValue({ images: [{ name: 'screen[1].png', url: '/api/prompt-images/screen.png' }] })
  createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

  const images = await uploadMobilePromptImages('http://fixture:4173', 'team', [{ filename: 'screen.png', mediaType: 'image/png', url: 'data:image/png;base64,abc' }])

  expect(request).toHaveBeenCalledWith('/api/prompt-images', expect.objectContaining({ method: 'POST' }))
  expect(appendMobilePromptImages('Check this', images)).toBe('Check this\n\nAttached reference images:\n![screen-1-.png](/api/prompt-images/screen.png)')
})

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
      conversation: [
        { author: 'reviewer', body: 'Looks close' },
        { author: 'reviewer', state: 'APPROVED' },
      ],
      checks: [{ name: 'mobile', status: 'SUCCESS' }],
      unresolvedThreads: 1,
      files: [{ path: 'apps/mobile/app/index.tsx' }],
    })
    expect(createClient).toHaveBeenCalledWith({
      baseUrl: 'http://fixture:4173',
      getAccessToken: expect.any(Function),
      headers: { 'x-vertexade-backend': 'team' },
    })
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
    const request = jest
      .fn()
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

    expect(request.mock.calls).toEqual(
      expect.arrayContaining([
        ['/api/pulls/1/299/work', expect.objectContaining({ method: 'POST', body: '{}' })],
        ['/api/work-items/1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ state: 'review', reason: 'Moved from VertexADE mobile Work details' }) })],
        ['/api/agent-threads/7/queue', expect.objectContaining({ body: JSON.stringify({ prompt: 'Continue' }) })],
        ['/api/agent-threads/7/input', expect.objectContaining({ body: JSON.stringify({ answers: { scope: { answers: ['Full'] } } }) })],
      ]),
    )
  })

  test('loads private review suggestions with the complete desktop thread metadata', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path.endsWith('/log'))
        return Promise.resolve({
          status: 'completed',
          thread_id: 'provider-thread-7',
          thread_url: 'https://example.test/thread/7',
          agent_id: 'codex',
          kind: 'review',
          kind_label: 'Code review',
          agent_model: 'gpt-5.6',
          agent_reasoning_effort: 'high',
          worktree_path: '/tmp/worktree',
          created_at: '2026-08-11T09:00:00Z',
          finished_at: '2026-08-11T10:00:00Z',
          source_job_id: 3,
          review_phase: 'complete',
          review_summary: 'Ready to merge',
          events: [{ data: { event: 'turn_completed' }, title: 'Completed' }],
        })
      if (path.endsWith('/diff')) return Promise.resolve({ diff: '', diff_summary: { files: [] } })
      return Promise.resolve({
        suggestions: [{ id: 4, path: 'src/app.ts', line: 12, side: 'RIGHT', description: 'Guard this value', replacement: '  return value\n', selected: 1 }],
      })
    })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await expect(loadMobileThreadDetails('http://fixture:4173', thread)).resolves.toMatchObject({
      threadUrl: 'https://example.test/thread/7',
      agentId: 'codex',
      kind: 'review',
      kindLabel: 'Code review',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      sourceJobId: 3,
      events: [{ event: 'turn_completed' }],
      suggestions: [{ id: 4, selected: true, replacement: '  return value\n' }],
    })
  })

  test('executes the complete server-scoped thread workflow', async () => {
    const request = jest.fn().mockImplementation((path: string) => {
      if (path.endsWith('/fork'))
        return Promise.resolve({
          id: 11,
          status: 'starting',
          full_name: 'vertexade/fixture',
          agent_id: 'codex',
          task_title: 'Forked mobile flow',
          branch_name: 'fix/forked-mobile-flow',
        })
      if (path.endsWith('/re-review'))
        return Promise.resolve({
          threads: [{ id: 12, status: 'starting', full_name: 'vertexade/fixture', agent_id: 'codex', task_title: 'Fresh review' }],
        })
      if (path.endsWith('/save-stack-tasks')) return Promise.resolve({ saved: 3 })
      if (path.endsWith('/suggestions')) return Promise.resolve({ posted: 2 })
      if (path.startsWith('/api/work-context-targets'))
        return Promise.resolve({
          targets: [
            {
              id: 21,
              status: 'completed',
              full_name: 'vertexade/other',
              work_item_key: 'W-0002',
              work_item_title: 'Other work',
              task_title: 'Idle target',
              branch_name: 'feature/other',
            },
          ],
        })
      return Promise.resolve({ accepted: true })
    })
    createClient.mockReturnValue({ request } as unknown as ReturnType<typeof createPlatformClient>)

    await deliverMobileThreadMessage('http://fixture:4173', thread, ' Continue ', 'follow-up', {
      agentId: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'high',
      serviceTier: 'priority',
      allowSubagents: true,
    })
    await steerMobileQueuedMessage('http://fixture:4173', thread, 8)
    await cancelMobileQueuedMessage('http://fixture:4173', thread, 8)
    await reorderMobileQueuedMessages('http://fixture:4173', thread, [9, 8])
    await expect(saveMobileThreadTasks('http://fixture:4173', thread)).resolves.toBe(3)
    await expect(
      forkMobileThread('http://fixture:4173', thread, {
        title: 'Forked mobile flow',
        prompt: 'Finish the complete flow',
        base: 'current',
        branchType: 'fix',
        options: { agentId: 'codex', model: 'gpt-5.6', reasoningEffort: 'high', serviceTier: '', allowSubagents: false },
      }),
    ).resolves.toMatchObject({ id: 11, backendId: 'team', branchName: 'fix/forked-mobile-flow' })
    await expect(reReviewMobileThread('http://fixture:4173', thread)).resolves.toMatchObject([{ id: 12, backendId: 'team' }])
    await expect(
      postMobileReviewSuggestions('http://fixture:4173', thread, [
        {
          id: 2,
          path: 'src/app.ts',
          line: 3,
          side: 'RIGHT',
          description: 'Guard this value',
          replacement: 'return value',
          selected: true,
          postedAt: '',
        },
      ]),
    ).resolves.toBe(2)
    await expect(loadMobileThreadTransferTargets('http://fixture:4173', thread)).resolves.toMatchObject([{ id: 21, workItemKey: 'W-0002' }])
    await transferMobileThreadContext('http://fixture:4173', thread, 21, 'Use the result', 'Apply the validated findings')

    expect(request).toHaveBeenCalledWith(
      '/api/agent-threads/7/follow-up',
      expect.objectContaining({
        body: JSON.stringify({ prompt: 'Continue' }),
        headers: expect.objectContaining({
          'x-agent-provider': 'codex',
          'x-agent-model': 'gpt-5.6',
          'x-agent-reasoning-effort': 'high',
          'x-agent-service-tier': 'priority',
          'x-agent-subagents': 'true',
        }),
      }),
    )
    expect(request).toHaveBeenCalledWith('/api/agent-threads/7/queue/8/steer', expect.objectContaining({ method: 'POST' }))
    expect(request).toHaveBeenCalledWith('/api/agent-threads/7/queue/8', expect.objectContaining({ method: 'DELETE' }))
    expect(request).toHaveBeenCalledWith(
      '/api/agent-threads/7/queue',
      expect.objectContaining({
        body: JSON.stringify({ ids: [9, 8] }),
        method: 'PATCH',
      }),
    )
    expect(request).toHaveBeenCalledWith(
      '/api/work-items/1/sub-items',
      expect.objectContaining({
        body: JSON.stringify({ source_job_id: 7, destination_job_id: 21, title: 'Use the result', instruction: 'Apply the validated findings' }),
      }),
    )
  })
})
