import type { MobileThreadDetails } from './mobile-detail-service'
import {
  canComposeThreadMessage,
  canForkMobileThread,
  canSaveMobileThreadTasks,
  canTransferMobileThread,
  initialMobileThreadTab,
  mobileThreadOutcome,
  mobileThreadTabs,
} from './mobile-thread-presentation'

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
    events: [{ id: '1', kind: 'assistant', title: 'Done', text: '', time: '', status: '', event: 'turn_completed' }],
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

describe('mobile thread presentation', () => {
  test('prioritizes review summary and includes the complete review workbench', () => {
    const value = detail({
      kind: 'review',
      reviewSummary: 'Ready',
      reviewDetails: 'Full findings',
      suggestions: [{ id: 1, path: 'src/app.ts', line: 4, side: 'RIGHT', description: 'Fix', replacement: '', selected: true, postedAt: '' }],
    })

    expect(initialMobileThreadTab(value)).toBe('summary')
    expect(mobileThreadTabs(value)).toEqual([
      { id: 'summary', label: 'Summary' },
      { id: 'findings', label: 'Full review' },
      { id: 'suggestions', label: 'Suggestions (1)' },
      { id: 'activity', label: 'Activity' },
      { id: 'changes', label: 'Changes' },
      { id: 'context', label: 'Context' },
    ])
    expect(canComposeThreadMessage(value)).toBe(false)
  })

  test('preserves completed output while a follow-up is active', () => {
    const value = detail({
      status: 'running',
      events: [
        { id: '1', kind: 'assistant', title: 'Done', text: '', time: '', status: '', event: 'turn_completed' },
        { id: '2', kind: 'user', title: 'Follow-up', text: '', time: '', status: '', event: 'follow_up_started' },
      ],
    })

    expect(mobileThreadOutcome(value)).toMatchObject({
      outputReady: true,
      headline: 'Updating completed output',
      tone: 'active',
    })
    expect(canForkMobileThread(value)).toBe(false)
    expect(canTransferMobileThread(value)).toBe(false)
  })

  test('exposes completed workflow actions only when their contracts allow them', () => {
    expect(canForkMobileThread(detail())).toBe(true)
    expect(canTransferMobileThread(detail())).toBe(true)
    expect(canSaveMobileThreadTasks(detail({ kind: 'stack_analysis' }))).toBe(true)
    expect(canForkMobileThread(detail({ ephemeral: true }))).toBe(false)
    expect(canSaveMobileThreadTasks(detail({ kind: 'task' }))).toBe(false)
  })
})
