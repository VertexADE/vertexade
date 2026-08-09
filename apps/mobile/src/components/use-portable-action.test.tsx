import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { PortableItemAction } from '@vertexade/platform-contracts'
import type { PlatformExtensionClient } from '@vertexade/platform-client'
import { usePortableAction } from './use-portable-action'

function action(overrides: Partial<PortableItemAction> = {}): PortableItemAction {
  return {
    id: 'launch',
    label: 'Launch work',
    method: 'POST',
    path: '/work',
    inputs: [{ name: 'title', label: 'Title', type: 'text', required: true }],
    ...overrides,
  }
}

function extension(overrides: Record<string, jest.Mock> = {}) {
  return {
    executeAction: jest.fn().mockResolvedValue({}),
    request: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as PlatformExtensionClient
}

function hook(actionValue: PortableItemAction, extensionValue: PlatformExtensionClient) {
  const onClose = jest.fn()
  const onCompleted = jest.fn().mockResolvedValue(undefined)
  const data = {}
  const rendered = renderHook(() =>
    usePortableAction({ action: actionValue, item: null, data, extension: extensionValue, onClose, onCompleted }),
  )
  return { ...rendered, onClose, onCompleted }
}

describe('usePortableAction', () => {
  test('blocks missing required values before transport', async () => {
    const api = extension()
    const { result } = hook(action(), api)
    await act(async () => result.current.execute())
    expect(result.current.error).toBe('Title is required')
    expect(api.executeAction).not.toHaveBeenCalled()
  })

  test('executes an immediate action and refreshes the collection', async () => {
    const api = extension()
    const { result, onClose, onCompleted } = hook(action(), api)
    act(() => result.current.setValues({ title: 'Ship it' }))
    await act(async () => result.current.execute())
    expect(api.executeAction).toHaveBeenCalledWith(action(), undefined, { title: 'Ship it' }, undefined)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  test('surfaces transport failures without closing', async () => {
    const api = extension({ executeAction: jest.fn().mockRejectedValue(new Error('launch failed')) })
    const { result, onClose } = hook(action(), api)
    act(() => result.current.setValues({ title: 'Ship it' }))
    await act(async () => result.current.execute())
    expect(result.current.error).toBe('launch failed')
    expect(onClose).not.toHaveBeenCalled()
  })

  test('polls, refines, and completes a workflow result', async () => {
    jest.useFakeTimers()
    const workflow = action({
      intent: 'launch-work',
      job: {
        idPath: 'job.id',
        statusPath: '/jobs/{jobId}',
        statusValuePath: 'status',
        resultPath: 'result',
        completedValues: ['completed'],
        failedValues: ['failed'],
        pollIntervalMs: 10,
        completeAction: { id: 'complete', label: 'Complete', method: 'PATCH', path: '/work' },
        refineAction: { id: 'refine', label: 'Refine', method: 'POST', path: '/jobs/{jobId}/refine' },
      },
    })
    const executeAction = jest
      .fn()
      .mockResolvedValueOnce({ job: { id: 'job-1' } })
      .mockResolvedValueOnce({ job: { id: 'job-2' } })
      .mockResolvedValueOnce({})
    const api = extension({ executeAction, request: jest.fn().mockResolvedValue({ status: 'completed', result: { answer: 42 } }) })
    const { result, onClose, onCompleted } = hook(workflow, api)
    act(() => {
      result.current.setValues({ title: 'Ship it' })
      result.current.setAgent({ agentId: 'codex', model: 'gpt', reasoningEffort: 'high' })
    })
    await act(async () => result.current.execute())
    expect(result.current.jobId).toBe('job-1')
    await act(async () => {
      jest.advanceTimersByTime(10)
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.jobComplete).toBe(true))
    expect(result.current.jobResult).toBe('{\n  "answer": 42\n}')

    act(() => result.current.setRefinement('Add evidence'))
    await act(async () => result.current.refineWorkflow())
    expect(executeAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'refine', path: '/jobs/job-1/refine' }),
      undefined,
      { prompt: 'Add evidence' },
    )
    expect(result.current.jobId).toBe('job-2')

    act(() => result.current.setJobResult('{"approved":true}'))
    await act(async () => result.current.completeWorkflow())
    expect(executeAction).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: 'complete' }),
      undefined,
      { __workflow_result: { approved: true } },
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })
})
