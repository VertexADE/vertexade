import { describe, expect, it } from 'vite-plus/test'
import { toolAppResourceUri } from './mcp-gateway.ts'

describe('MCP gateway app metadata', () => {
  it('accepts the standard nested UI resource metadata', () => {
    expect(toolAppResourceUri({ _meta: { ui: { resourceUri: 'ui://example/app.html' } } })).toBe('ui://example/app.html')
  })

  it('rejects non-UI resources at the trust boundary', () => {
    expect(() => toolAppResourceUri({ _meta: { ui: { resourceUri: 'https://example.test/app.html' } } })).toThrow(/ui:\/\//)
  })
})
