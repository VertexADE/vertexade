import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { BackendBadge } from '@vertexade/ui/components/backend-badge'

describe('BackendBadge', () => {
  it('can show only the assigned server name in work and thread context', () => {
    const markup = renderToStaticMarkup(
      <BackendBadge source={{ backend_id: 'team', backend_name: 'Studio', backend_connected: true }} nameOnly />,
    )

    expect(markup).toContain('>Studio<')
    expect(markup).toContain('bg-success')
    expect(markup).not.toContain('Server ·')
    expect(markup).not.toContain('lucide-server')
  })
})
