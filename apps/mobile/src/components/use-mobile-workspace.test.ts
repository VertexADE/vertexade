import { act, renderHook, waitFor } from '@testing-library/react-native'
import { loadMobileWorkspace, type MobileThread, type MobileWorkspace } from '@/mobile-workspace-service'
import { useMobileWorkspace } from './use-mobile-workspace'

jest.mock('@/mobile-workspace-service', () => ({ loadMobileWorkspace: jest.fn() }))

const thread: MobileThread = {
  id: 7, workItemId: null, fullName: 'vertexade/mobile', status: 'running', agentName: 'Codex', taskTitle: 'Finish HUD', latestActivity: 'Working', activityAt: '2026-08-12T10:00:00Z', branchName: 'mobile', pullRequestNumber: null, pullRequestUrl: '', archived: false, backendId: 'server', backendName: 'Server', serviceUrl: 'http://server',
}
const workspace = (status: string): MobileWorkspace => ({ repositories: [], pullRequests: [], workItems: [], threads: [{ ...thread, status }] })
const connections = [{ serviceUrl: 'http://server', servers: [] }]

describe('useMobileWorkspace completion monitoring', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('silently polls active threads and exposes a new completion', async () => {
    jest.mocked(loadMobileWorkspace).mockResolvedValueOnce(workspace('running')).mockResolvedValueOnce(workspace('completed'))
    const { result } = renderHook(() => useMobileWorkspace(connections))
    await waitFor(() => expect(result.current.workspace.threads[0]?.status).toBe('running'))

    await act(async () => { jest.advanceTimersByTime(5_000) })
    await waitFor(() => expect(result.current.completedThread?.id).toBe(7))
    expect(result.current.loading).toBe(false)
  })
})
