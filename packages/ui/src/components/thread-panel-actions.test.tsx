import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'
import { getThreadActionAvailability, ThreadPanelActions } from '@vertexade/ui/components/thread-panel-actions'

function job(overrides: Partial<JobLog> = {}): JobLog {
  return {
    id: 42,
    status: 'completed',
    kind: 'work',
    thread_id: 'thread-42',
    ephemeral: 0,
    agent_name: 'Codex',
    pr_closed_at: null,
    result_text: 'done',
    review_details: null,
    review_summary: null,
    work_item_id: 1,
    ...overrides,
  } as JobLog
}

function render(current: JobLog, activityOnly = false) {
  const action = vi.fn()
  return renderToStaticMarkup(
    <ThreadPanelActions
      activityOnly={activityOnly}
      job={current}
      outcome={null}
      savingTasks={false}
      retrying={false}
      stopping={false}
      reReviewing={false}
      onClose={action}
      onHandoff={action}
      onSubmitReview={action}
      onSaveTasks={action}
      onCopyLink={action}
      onRetry={action}
      onStop={action}
      onReReview={action}
      onFork={action}
      onTransfer={action}
    />,
  )
}

describe('thread panel responsive actions', () => {
  it('uses the same primary action in compact and desktop presentations', () => {
    expect(render(job({ status: 'running' })).match(/Interrupt thread/g)).toHaveLength(2)
    expect(render(job({ status: 'failed' })).match(/Retry task/g)).toHaveLength(2)
    const completedReview = render(job({ kind: 'review', status: 'completed' }))
    expect(completedReview.match(/Submit review/g)).toHaveLength(2)
    expect(completedReview.match(/Re-review/g)).toHaveLength(1)
  })

  it('preserves the compact ephemeral fork while omitting the unsupported desktop fork', () => {
    expect(getThreadActionAvailability(job({ ephemeral: 1 }))).toMatchObject({ canFork: true, canForkOnDesktop: false })
    expect(getThreadActionAvailability(job({ ephemeral: 0 }))).toMatchObject({ canFork: true, canForkOnDesktop: true })
  })

  it('hides both action presentations for activity-only threads', () => {
    const markup = render(job(), true)
    expect(markup.match(/hidden=""/g)).toHaveLength(2)
  })
})
