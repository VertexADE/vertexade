import { describe, expect, it } from 'vite-plus/test'
import { securedMcpAppHtml, type McpAppFrameDescriptor } from './mcp-app-frame.tsx'

const descriptor: McpAppFrameDescriptor = {
  serverId: 'docs',
  toolName: 'show',
  resourceUri: 'ui://docs/show.html',
  html: '<!doctype html><html><head><title>App</title></head><body>Safe</body></html>',
  csp: { connectDomains: ['https://api.example.test'], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
  permissions: { camera: false, microphone: false, geolocation: false, clipboardWrite: false },
}

describe('MCP App iframe policy', () => {
  it('injects a restrictive CSP into the resource document', () => {
    const html = securedMcpAppHtml(descriptor)
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('connect-src https://api.example.test')
    expect(html).toContain("object-src 'none'")
  })
})
