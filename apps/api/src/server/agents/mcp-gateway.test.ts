import { describe, expect, it, vi } from 'vite-plus/test'
import { agentPluginMcpFetch, toolAppResourceUri } from './mcp-gateway.ts'

describe('MCP gateway app metadata', () => {
  it('accepts the standard nested UI resource metadata', () => {
    expect(toolAppResourceUri({ _meta: { ui: { resourceUri: 'ui://example/app.html' } } })).toBe('ui://example/app.html')
  })

  it('rejects non-UI resources at the trust boundary', () => {
    expect(() => toolAppResourceUri({ _meta: { ui: { resourceUri: 'https://example.test/app.html' } } })).toThrow(/ui:\/\//)
  })
})

describe('Agent Plugin MCP HTTP boundary', () => {
  it('disables redirects, keeps requests on-origin, and gives client headers precedence', async () => {
    const implementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const guarded = agentPluginMcpFetch('https://mcp.example.test', { Authorization: 'plugin-value', 'X-Tenant': 'public' }, implementation)

    await expect(
      guarded('https://mcp.example.test/rpc', { method: 'POST', headers: { Authorization: 'client-value', Accept: 'application/json' } }),
    ).resolves.toMatchObject({ status: 200 })
    const init = implementation.mock.calls[0]![1]
    const headers = new Headers(init?.headers)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(Object.fromEntries(headers.entries())).toEqual({
      accept: 'application/json',
      authorization: 'client-value',
      'x-tenant': 'public',
    })
    await expect(guarded('https://redirected.example.test/rpc')).rejects.toThrow('cannot leave its configured origin')
    expect(implementation).toHaveBeenCalledTimes(1)
  })
})
