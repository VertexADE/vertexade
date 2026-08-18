import { describe, expect, it, vi } from 'vite-plus/test'
import { MAX_REQUEST_BODY_BYTES } from '@vertexade/platform-server/http'
import { createAgentResourceRoutes } from './resource-routes.ts'

function service() {
  const plugin = { id: 'agent-plugin-one', name: 'plugin', mcpServerIds: ['mcp-one'] }
  return {
    addSkill: vi.fn((value) => value),
    upsertMcpServer: vi.fn((value) => value),
    upsertProfile: vi.fn((value) => value),
    installPlugin: vi.fn(() => plugin),
    reloadPlugin: vi.fn(() => plugin),
    removePlugin: vi.fn(() => ({ plugin, mcpServerIds: plugin.mcpServerIds })),
    catalog: vi.fn(() => ({ plugins: [plugin] })),
    selection: vi.fn(() => ({})),
    searchSkills: vi.fn(() => []),
    removeProfile: vi.fn(),
    remove: vi.fn(),
    setDefault: vi.fn(),
    setSelection: vi.fn(),
  }
}

describe('agent resource HTTP boundaries', () => {
  it('returns 413 before an oversized JSON body reaches the service', async () => {
    const resources = service()
    const routes = createAgentResourceRoutes(resources as never)
    const response = await routes(
      new Request('http://localhost/api/agent-resources/skills', {
        method: 'POST',
        body: JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }),
      }),
    )

    expect(response?.status).toBe(413)
    await expect(response?.json()).resolves.toEqual({ error: 'Request body is too large' })
    expect(resources.addSkill).not.toHaveBeenCalled()
  })

  it('installs, reloads, and removes a plugin through plugin-scoped routes', async () => {
    const resources = service()
    const routes = createAgentResourceRoutes(resources as never)

    const installed = await routes(
      new Request('http://localhost/api/agent-resources/plugins', {
        method: 'POST',
        body: JSON.stringify({ path: '/srv/plugins/example' }),
      }),
    )
    const reloaded = await routes(new Request('http://localhost/api/agent-resources/plugins/agent-plugin-one/reload', { method: 'POST' }))
    const removed = await routes(new Request('http://localhost/api/agent-resources/plugins/agent-plugin-one', { method: 'DELETE' }))

    expect(installed?.status).toBe(201)
    expect(resources.installPlugin).toHaveBeenCalledWith({ path: '/srv/plugins/example' })
    expect(reloaded?.status).toBe(200)
    expect(resources.reloadPlugin).toHaveBeenCalledWith('agent-plugin-one')
    expect(removed?.status).toBe(200)
    expect(resources.removePlugin).toHaveBeenCalledWith('agent-plugin-one')
  })
})
