import { describe, expect, it } from 'vite-plus/test'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { workCompletionBlocker } from './work-completion'

function item(overrides: Partial<WorkItem> = {}) {
  return {
    kind: 'implementation',
    threads: [],
    resources: [],
    ...overrides,
  } as WorkItem
}

describe('workCompletionBlocker', () => {
  it('keeps outcomes open while an agent is still running', () => {
    expect(workCompletionBlocker(item({ threads: [{ status: 'running', input_questions: null } as any] }))).toContain('agent run')
  })

  it('keeps delivery outcomes automatic while a pull request is open', () => {
    expect(workCompletionBlocker(item({ resources: [{ kind: 'pull_request', role: 'delivery', state: 'open' } as any] }))).toContain(
      'merged',
    )
  })

  it('keeps tracked deployments visible until they succeed', () => {
    expect(
      workCompletionBlocker(
        item({
          resources: [
            { kind: 'pull_request', role: 'delivery', state: 'merged' } as any,
            { kind: 'deployment', role: 'delivery', state: 'waiting' } as any,
          ],
        }),
      ),
    ).toContain('deployment')
  })

  it('allows manual completion when no automated finish condition remains', () => {
    expect(workCompletionBlocker(item())).toBeNull()
  })

  it('allows an intentionally closed delivery to be finished manually', () => {
    expect(workCompletionBlocker(item({ resources: [{ kind: 'pull_request', role: 'delivery', state: 'closed' } as any] }))).toBeNull()
  })
})
