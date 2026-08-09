import { describe, expect, it, vi } from 'vite-plus/test'
import { MAX_REQUEST_BODY_BYTES } from '@vertexade/platform-server/http'
import { createAgentResourceRoutes } from './resource-routes.ts'

function service() {
  return {
    addSkill: vi.fn((value) => value),
    upsertMcpServer: vi.fn((value) => value),
    upsertProfile: vi.fn((value) => value),
    catalog: vi.fn(() => []),
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
})
