import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { handleSubagentMcpRequest, modernProtocolVersion, subagentTools } from './subagent-mcp.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VERTEXADE_SUBAGENT_API_URL
  delete process.env.VERTEXADE_SUBAGENT_TOKEN
  delete process.env.VERTEXADE_SUBAGENTS_ENABLED
})

describe('VertexADE sub-agent MCP server', () => {
  it('advertises the hybrid orchestration tools', async () => {
    const listed = (await handleSubagentMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })) as { tools: typeof subagentTools }
    expect(listed.tools.map(({ name }) => name)).toEqual([
      'form',
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
      instructions: expect.stringMatching(/every collaboration mode, including Default mode.*prefer form for questionnaires/i),
    })
  })

  it('only exposes the general form tool when sub-agents are disabled', async () => {
    process.env.VERTEXADE_SUBAGENTS_ENABLED = '0'
    const listed = (await handleSubagentMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as {
      tools: typeof subagentTools
    }
    expect(listed.tools.map(({ name }) => name)).toEqual(['form'])
    expect(listed.tools[0]?.description).toMatch(/available in every collaboration mode, including Default mode/i)
    expect(listed.tools[0]?.description).toMatch(/Prefer it over a plain chat questionnaire/i)
  })

  it('supports modern stateless discovery and MCP App resources', async () => {
    const metadata = {
      'io.modelcontextprotocol/protocolVersion': modernProtocolVersion,
      'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
      'io.modelcontextprotocol/clientCapabilities': {
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      },
    }
    await expect(
      handleSubagentMcpRequest({ jsonrpc: '2.0', id: 10, method: 'server/discover', params: { _meta: metadata } }),
    ).resolves.toMatchObject({
      supportedVersions: [modernProtocolVersion, '2025-06-18'],
      resultType: 'complete',
      ttlMs: 60_000,
      cacheScope: 'private',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': expect.any(Object) } },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'vertexade-subagents' } },
    })

    const listed = (await handleSubagentMcpRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/list',
      params: { _meta: metadata },
    })) as { tools: typeof subagentTools; resultType: string }
    expect(listed.resultType).toBe('complete')
    expect(listed.tools[0]?._meta).toEqual({ ui: { resourceUri: 'ui://vertexade/form/index.html' } })

    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'resources/read',
        params: { uri: 'ui://vertexade/form/index.html', _meta: metadata },
      }),
    ).resolves.toMatchObject({
      resultType: 'complete',
      cacheScope: 'private',
      contents: [{ uri: 'ui://vertexade/form/index.html', mimeType: 'text/html;profile=mcp-app' }],
    })
  })

  it('keeps the legacy initialize protocol available', async () => {
    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }),
    ).resolves.toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'vertexade-subagents' } })
  })

  it('uses stateless MRTR elicitation for modern form calls', async () => {
    const meta = { 'io.modelcontextprotocol/protocolVersion': modernProtocolVersion }
    const first = await handleSubagentMcpRequest({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'form',
        arguments: {
          title: 'Release',
          fields: [{ id: 'channel', label: 'Channel', type: 'select', options: [{ label: 'Stable', value: 'stable' }] }],
        },
        _meta: meta,
      },
    })
    expect(first).toMatchObject({
      resultType: 'input_required',
      inputRequests: { form: { method: 'elicitation/create', params: { requestedSchema: { required: ['channel'] } } } },
    })
    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'form',
          arguments: { title: 'Release', fields: [] },
          inputResponses: { form: { action: 'accept', content: { channel: 'stable' } } },
          _meta: meta,
        },
      }),
    ).resolves.toMatchObject({ resultType: 'complete', structuredContent: { channel: 'stable' } })
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

  it('rejects an oversized internal API response before buffering its body', async () => {
    process.env.VERTEXADE_SUBAGENT_API_URL = 'http://127.0.0.1:4174'
    process.env.VERTEXADE_SUBAGENT_TOKEN = 'parent.capability'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { headers: { 'content-length': '250001', 'content-type': 'application/json' } })),
    )

    await expect(
      handleSubagentMcpRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'spawn_agent', arguments: { task: 'Try it' } },
      }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: { error: 'Response body is too large' },
    })
  })
})
