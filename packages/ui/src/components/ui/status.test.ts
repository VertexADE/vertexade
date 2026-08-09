import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'
import { StatusPanel, StatusPanelActions, StatusPanelContent, StatusPanelDescription, StatusPanelTitle, statusVariants } from './status.tsx'

describe('status system', () => {
  it('maps semantic tones to stable treatments', () => {
    expect(statusVariants({ tone: 'success' })).toContain('text-success')
    expect(statusVariants({ tone: 'info' })).toContain('text-info')
    expect(statusVariants({ tone: 'warning' })).toContain('text-warning')
    expect(statusVariants({ tone: 'danger' })).toContain('text-destructive')
    expect(statusVariants({ tone: 'neutral' })).toContain('text-muted-foreground')
  })

  it('provides a consistent responsive feedback structure', () => {
    const markup = renderToStaticMarkup(
      createElement(
        StatusPanel,
        { tone: 'danger' },
        createElement(
          StatusPanelContent,
          null,
          createElement(StatusPanelTitle, null, 'Could not load'),
          createElement(StatusPanelDescription, null, 'Try again.'),
        ),
        createElement(StatusPanelActions, null, createElement('button', null, 'Retry')),
      ),
    )

    expect(markup).toContain('data-slot="status-panel-content"')
    expect(markup).toContain('data-slot="status-panel-title"')
    expect(markup).toContain('data-slot="status-panel-description"')
    expect(markup).toContain('data-slot="status-panel-actions"')
    expect(markup).toContain('sm:grid-cols-[auto_minmax(0,1fr)_auto]')
  })
})
