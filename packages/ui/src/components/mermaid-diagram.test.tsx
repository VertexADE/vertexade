import { renderToStaticMarkup } from 'react-dom/server'
import type { Mermaid } from 'mermaid'
import { describe, expect, it } from 'vite-plus/test'

import { MermaidDiagram } from '@vertexade/ui/components/mermaid-diagram'
import { renderMermaidWithCapacity } from '@vertexade/ui/lib/mermaid-rendering'

describe('MermaidDiagram', () => {
  it('exposes concise diagram controls and a non-blocking render state', () => {
    const markup = renderToStaticMarkup(<MermaidDiagram chart={'flowchart LR\n  A --> B'} title="System architecture" />)

    expect(markup).toContain('System architecture')
    expect(markup).toContain('aria-label="Zoom in"')
    expect(markup).toContain('aria-label="Fit diagram"')
    expect(markup).toContain('aria-label="Copy Mermaid source"')
    expect(markup).toContain('aria-label="Download SVG"')
    expect(markup).toContain('Rendering diagram')
    expect(markup).not.toContain('bg-white')
  })

  it('starts above Mermaid default and grows the edge budget only when needed', async () => {
    const initializedLimits: number[] = []
    let attempts = 0
    const renderer: Pick<Mermaid, 'initialize' | 'render'> = {
      initialize(config) {
        initializedLimits.push(config.maxEdges || 0)
      },
      async render() {
        attempts += 1
        if (attempts === 1) throw new Error('Edge limit exceeded. 2048 edges found, but the limit is 2048.')
        return { diagramType: 'flowchart-v2', svg: '<svg />' }
      },
    }

    const result = await renderMermaidWithCapacity(renderer, 'flowchart LR\n  A --> B', 'diagram-id', 'dark', 'sans-serif')

    expect(result.svg).toBe('<svg />')
    expect(initializedLimits).toEqual([2_048, 4_096])
    expect(attempts).toBe(2)
  })

  it('does not retry syntax failures as capacity failures', async () => {
    const initializedLimits: number[] = []
    const renderer: Pick<Mermaid, 'initialize' | 'render'> = {
      initialize(config) {
        initializedLimits.push(config.maxEdges || 0)
      },
      async render() {
        throw new Error('Parse error on line 2')
      },
    }

    await expect(renderMermaidWithCapacity(renderer, 'flowchart LR\n  broken', 'diagram-id', 'light', 'sans-serif')).rejects.toThrow(
      'Parse error on line 2',
    )
    expect(initializedLimits).toEqual([2_048])
  })

  it('rejects pathological source sizes before invoking Mermaid', async () => {
    let initialized = false
    const renderer: Pick<Mermaid, 'initialize' | 'render'> = {
      initialize() {
        initialized = true
      },
      async render() {
        return { diagramType: 'flowchart-v2', svg: '<svg />' }
      },
    }

    await expect(renderMermaidWithCapacity(renderer, 'x'.repeat(500_001), 'diagram-id', 'light', 'sans-serif')).rejects.toThrow(
      'Diagram source is too large to render safely',
    )
    expect(initialized).toBe(false)
  })
})
