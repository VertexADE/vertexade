import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { handleSubagentMcpRequest, subagentTools } from './subagent-mcp.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VERTEXADE_SUBAGENT_API_URL
  delete process.env.VERTEXADE_SUBAGENT_TOKEN
})

describe('VertexADE sub-agent MCP server', () => {
  it('advertises the hybrid orchestration tools', async () => {
    const listed = (await handleSubagentMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })) as { tools: typeof subagentTools }
    expect(listed.tools.map(({ name }) => name)).toEqual([
      'list_agents',
      'spawn_agent',
      'get_agent',
      'wait_agent',
      'integrate_agent',
      'cancel_agent',
    ])
    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    ).resolves.toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'vertexade-subagents' },
    })
  })

  it('uses the scoped capability when spawning a selected model', async () => {
    process.env.VERTEXADE_SUBAGENT_API_URL = 'http://127.0.0.1:4174/'
    process.env.VERTEXADE_SUBAGENT_TOKEN = 'parent.capability'
    const fetchMock = vi.fn(async () => Response.json({ run_id: 42, status: 'starting' }, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = (await handleSubagentMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'spawn_agent',
        arguments: { task: 'Review the cache', agent_id: 'opencode', model: 'openai/gpt-5' },
      },
    })) as { structuredContent: Record<string, unknown>; isError: boolean }

    expect(result).toMatchObject({
      structuredContent: { run_id: 42, status: 'starting' },
      isError: false,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4174/api/internal/subagents/runs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          task: 'Review the cache',
          agent_id: 'opencode',
          model: 'openai/gpt-5',
        }),
        headers: expect.objectContaining({ authorization: 'Bearer parent.capability' }),
      }),
    )
  })

  it('returns tool failures to the agent instead of breaking MCP', async () => {
    process.env.VERTEXADE_SUBAGENT_API_URL = 'http://127.0.0.1:4174'
    process.env.VERTEXADE_SUBAGENT_TOKEN = 'parent.capability'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Model is not available' }, { status: 400 })),
    )

    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'spawn_agent', arguments: { task: 'Try it' } },
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: 'Model is not available' },
    })
  })
})
