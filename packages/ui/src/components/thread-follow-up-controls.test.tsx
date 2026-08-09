import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'
import { FollowUpComposer } from '@vertexade/ui/components/thread-dialog-support'
import { TooltipProvider } from '@vertexade/ui/components/ui/tooltip'
import type { JobLog } from '@vertexade/ui/lib/dashboard-types'

const activeJob = {
  id: 42,
  status: 'running',
  kind: 'task',
  thread_id: 'thread-42',
  agent_id: 'codex',
  agent_name: 'Codex',
  can_steer: true,
  queued_follow_ups: [],
} as unknown as JobLog

function render(value: string) {
  const action = vi.fn()
  return renderToStaticMarkup(
    <TooltipProvider>
      <FollowUpComposer
        job={activeJob}
        value={value}
        focusToken={0}
        options={{ agentId: '', model: '', reasoningEffort: '', allowSubagents: false }}
        sending={false}
        stopping={false}
        steeringQueuedId={null}
        cancellingQueuedId={null}
        compact
        onChange={action}
        onOptionsChange={action}
        onSubmit={action}
        onSteerQueued={action}
        onCancelQueued={action}
        onInterrupt={action}
      />
    </TooltipProvider>,
  )
}

describe('thread follow-up controls', () => {
  it('keeps interrupt visible while hiding delivery actions until a prompt is written', () => {
    const empty = render('   ')
    expect(empty).toContain('Interrupt')
    expect(empty).not.toContain('Steer now')
    expect(empty).not.toContain('>Queue<')

    const written = render('Change direction')
    expect(written).toContain('Interrupt')
    expect(written).toContain('Steer now')
    expect(written).toContain('value="queue"')
  })
})
