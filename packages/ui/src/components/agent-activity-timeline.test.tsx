import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { AgentActivityTimeline } from '@vertexade/ui/components/agent-activity-timeline'
import { TooltipProvider } from '@vertexade/ui/components/ui/tooltip'
import type { LogEvent } from '@vertexade/ui/lib/dashboard-types'

function event(kind: string, text: string, time: string, extra: Partial<LogEvent> = {}): LogEvent {
  return { kind, title: kind, text, time, ...extra }
}

describe('agent activity timeline', () => {
  it('renders compact work sessions with action-specific icons and no nested agent avatar', () => {
    const events = [
      event('user_message', 'First request', '2026-08-17T10:00:00Z'),
      event('action', 'pnpm test', '2026-08-17T10:00:01Z', {
        action_kind: 'command',
        status: 'completed',
      }),
      event('message', 'First response', '2026-08-17T10:00:02Z'),
      event('completed', '', '2026-08-17T10:00:03Z', { status: 'completed' }),
      event('user_message', 'Second request', '2026-08-17T10:01:00Z'),
      event('action', 'Update source', '2026-08-17T10:01:01Z', {
        action_kind: 'file_edit',
        status: 'completed',
      }),
      event('message', 'Second response', '2026-08-17T10:01:02Z'),
      event('completed', '', '2026-08-17T10:01:03Z', { status: 'completed' }),
    ]

    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AgentActivityTimeline events={events} content="" state="completed" onOpenFile={() => undefined} worktreePath="/workspace" />
      </TooltipProvider>,
    )

    expect(markup).toContain('Worked for')
    expect(markup).toContain('lucide-terminal')
    expect(markup).toContain('lucide-file-pen-line')
    expect(markup).not.toContain('lucide-bot')
    expect(markup).not.toContain('lucide-message-square-text')
    expect(markup).toContain('aria-label="Jump to turn 1: First request"')
    expect(markup).toContain('aria-current="location"')
    expect(markup).toContain('h-0.5 w-2')
    expect(markup).toContain('rounded-xl rounded-br-sm')
  })

  it('renders userMessage actions as plain assistant messages instead of tool rows', () => {
    const events = [
      event('user_message', 'Initial request', '2026-08-17T10:00:00Z'),
      event('action', '👍', '2026-08-17T10:00:01Z', {
        title: 'userMessage',
        action_kind: 'userMessage',
        status: 'completed',
      }),
    ]

    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <AgentActivityTimeline events={events} content="" state="running" onOpenFile={() => undefined} worktreePath="/workspace" />
      </TooltipProvider>,
    )

    expect(markup).not.toContain('userMessage')
    expect(markup).not.toContain('lucide-wrench')
    expect(markup).not.toContain('lucide-message-square-text')
    expect(markup).toContain('aria-label="Copy message"')
  })
})
