import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { ConfirmProvider } from '@vertexade/ui/components/confirm-provider'
import { threadHeaderClass } from '@vertexade/ui/components/thread-dialog-support'
import { ThreadPanel } from '@vertexade/ui/components/thread-panel'

function renderPanel(props: { activityOnly?: boolean; showCompactHeader?: boolean } = {}): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ConfirmProvider>
        <ThreadPanel jobId={null} {...props} />
      </ConfirmProvider>
    </QueryClientProvider>,
  )
}

describe('run panel', () => {
  it('keeps the thread header vertically compact', () => {
    expect(threadHeaderClass).toContain('py-2')
    expect(threadHeaderClass).toContain('sm:py-2.5')
    expect(threadHeaderClass).not.toContain('sm:py-4')
  })

  it('provides the canonical embedded agent run experience without a dialog shell', () => {
    const markup = renderPanel()

    expect(markup).toContain('data-slot="thread-panel"')
    expect(markup).toContain('Agent run')
    expect(markup).toContain('Activity')
    expect(markup).toContain('Changes')
    expect(markup).not.toContain('aria-label="Thread chat"')
  })

  it('keeps the activity-only thread free of work-item chrome while retaining the activity surface', () => {
    const markup = renderPanel({ activityOnly: true })

    expect(markup).toContain('data-slot="thread-panel"')
    expect(markup).toContain('data-slot="tabs-content"')
    expect(markup).toContain('<header hidden=""')
    expect(markup).toContain('<footer hidden=""')
    expect(markup).not.toContain('Run actions')
    expect(markup).not.toContain('Save as tasks')
  })

  it('can retain compact run context in an activity-only workspace', () => {
    const markup = renderPanel({ activityOnly: true, showCompactHeader: true })

    expect(markup).toContain('data-slot="thread-panel"')
    expect(markup).toContain('Loading session context')
    expect(markup).not.toContain('<header hidden=""')
    expect(markup).toContain('<footer hidden=""')
  })
})
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
