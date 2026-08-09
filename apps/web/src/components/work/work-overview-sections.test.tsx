import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { WorkItem } from '@vertexade/ui/lib/dashboard-types'
import { WorkThreads } from './work-overview-sections'

function job(id: number, kind: WorkItem['threads'][number]['kind'], fullName: string): WorkItem['threads'][number] {
  return {
    id,
    status: 'completed',
    kind,
    thread_id: `thread-${id}`,
    agent_id: 'codex',
    task_title: fullName,
    pr_number: 0,
    branch_name: `feature/thread-${id}`,
    head_sha: null,
    latest_activity: 'Completed',
    activity_at: null,
    created_at: '2026-08-04T00:00:00Z',
    finished_at: '2026-08-04T00:01:00Z',
    input_questions: null,
    linked_pr_number: null,
    full_name: fullName,
  }
}

describe('WorkThreads', () => {
  it('renders work and review threads once in separate sections', () => {
    const item = {
      kind: 'task',
      threads: [job(1, 'task', 'example/work-thread'), job(2, 'work_review', 'example/review-thread')],
      context_transfers: [],
    } as unknown as WorkItem
    const html = renderToStaticMarkup(<WorkThreads item={item} onOpenRun={vi.fn()} onStartWork={vi.fn()} onStartReview={vi.fn()} />)

    expect(html.match(/<h3[^>]*>Work threads/g)).toHaveLength(1)
    expect(html.match(/<h3[^>]*>Review threads/g)).toHaveLength(1)
    expect(html.match(/example\/work-thread/g)).toHaveLength(1)
    expect(html.match(/example\/review-thread/g)).toHaveLength(2)
    expect(html).toContain('feature/thread-1')
    expect(html).toContain('Open &amp; continue · #1')
    expect(html).toContain('detached worktree snapshot')
    expect(html).toContain('Findings ready')
    expect(html).toContain('Open findings · #2')
    expect(html).toContain('New agent thread')
    expect(html).toContain('New review')
    expect(html).toContain('data-audit-action="work.thread.new-agent"')
    expect(html).toContain('data-audit-action="work.thread.new-review"')
    expect(html).not.toContain('New work thread')
    expect(html).not.toContain('New agent run')
  })
})
